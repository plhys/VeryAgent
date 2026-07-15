//! Tauri / core commands for OpenWiki configuration, status, and runner.

use std::path::{Path, PathBuf};

use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};

use crate::app_error::AppCommandError;
use crate::db::service::{app_metadata_service, folder_service};
use crate::openwiki::config::{OpenWikiConfig, OpenWikiRuntimeConfig};
use crate::openwiki::runner::{
    collect_status, maybe_update_agents_md, read_instructions, run_action, write_instructions,
    OpenWikiAction, OpenWikiRunResult, OpenWikiStatus,
};
use crate::web::event_bridge::{emit_event, EventEmitter, OPENWIKI_SETTINGS_CHANGED_EVENT};

pub const KEY_OPENWIKI_CONFIG: &str = "openwiki.config";

/// True when two path strings refer to the same location (Windows-insensitive).
fn path_strings_equivalent(a: &str, b: &str) -> bool {
    let a = a.trim().trim_end_matches(['/', '\\']);
    let b = b.trim().trim_end_matches(['/', '\\']);
    if a == b {
        return true;
    }
    #[cfg(windows)]
    {
        a.eq_ignore_ascii_case(b)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn paths_equivalent(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    path_strings_equivalent(
        &a.as_os_str().to_string_lossy(),
        &b.as_os_str().to_string_lossy(),
    )
}

/// Require `workspace` to be an existing directory that is currently open in
/// VeryAgent. Prevents authenticated web clients from pointing runner /
/// instructions IO at arbitrary local paths.
pub async fn require_open_workspace(
    conn: &DatabaseConnection,
    workspace: &str,
) -> Result<PathBuf, AppCommandError> {
    let trimmed = workspace.trim();
    if trimmed.is_empty() {
        return Err(AppCommandError::invalid_input(
            "workspace path is required".to_string(),
        ));
    }
    let ws = Path::new(trimmed);
    if !ws.is_dir() {
        return Err(AppCommandError::invalid_input(format!(
            "workspace is not a directory: {trimmed}"
        )));
    }

    let open = folder_service::list_open_folders(conn)
        .await
        .map_err(AppCommandError::from)?;

    let canonical_ws = std::fs::canonicalize(ws).unwrap_or_else(|_| ws.to_path_buf());
    for entry in &open {
        if path_strings_equivalent(trimmed, &entry.path) {
            return Ok(canonical_ws);
        }
        let entry_path = Path::new(&entry.path);
        let canonical_entry =
            std::fs::canonicalize(entry_path).unwrap_or_else(|_| entry_path.to_path_buf());
        if paths_equivalent(&canonical_ws, &canonical_entry) {
            return Ok(canonical_ws);
        }
    }

    Err(AppCommandError::permission_denied(format!(
        "workspace is not an open folder in VeryAgent: {trimmed}"
    )))
}

/// Soft resolve for status probes: only report wiki state for open folders.
async fn optional_open_workspace(
    conn: &DatabaseConnection,
    workspace: Option<&str>,
) -> Option<PathBuf> {
    let Some(raw) = workspace.map(str::trim).filter(|s| !s.is_empty()) else {
        return None;
    };
    require_open_workspace(conn, raw).await.ok()
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/// Load config from app_metadata; corrupt / missing → defaults.
pub async fn load_openwiki_config(conn: &DatabaseConnection) -> OpenWikiConfig {
    match app_metadata_service::get_value(conn, KEY_OPENWIKI_CONFIG).await {
        Ok(Some(raw)) => serde_json::from_str::<OpenWikiConfig>(&raw)
            .map(|c| c.normalize())
            .unwrap_or_default(),
        _ => OpenWikiConfig::default(),
    }
}

/// Push persisted config into the runtime handle (startup / after save).
pub async fn apply_persisted_openwiki_config(
    conn: &DatabaseConnection,
    runtime: &OpenWikiRuntimeConfig,
) {
    let config = load_openwiki_config(conn).await;
    runtime.set(config).await;
}

/// Persist + apply + broadcast.
pub async fn set_openwiki_config_core(
    conn: &DatabaseConnection,
    runtime: &OpenWikiRuntimeConfig,
    emitter: &EventEmitter,
    desired: OpenWikiConfig,
) -> Result<OpenWikiConfig, AppCommandError> {
    let normalized = desired.normalize();
    let json = serde_json::to_string(&normalized).map_err(|e| {
        AppCommandError::configuration_invalid(format!("failed to serialize openwiki config: {e}"))
    })?;
    app_metadata_service::upsert_value(conn, KEY_OPENWIKI_CONFIG, &json)
        .await
        .map_err(AppCommandError::from)?;
    runtime.set(normalized.clone()).await;
    emit_event(emitter, OPENWIKI_SETTINGS_CHANGED_EVENT, &normalized);
    Ok(normalized)
}

// ---------------------------------------------------------------------------
// Core helpers (shared by Tauri + HTTP)
// ---------------------------------------------------------------------------

pub async fn openwiki_get_config_core(conn: &DatabaseConnection) -> OpenWikiConfig {
    load_openwiki_config(conn).await
}

pub async fn openwiki_status_core(
    conn: &DatabaseConnection,
    runtime: &OpenWikiRuntimeConfig,
    workspace: Option<String>,
) -> OpenWikiStatus {
    // Prefer runtime snapshot (hot); fall back to DB if somehow empty.
    let mut config = runtime.snapshot().await;
    if config.agent_types_list.is_empty() && config.agent_permissions.is_empty() {
        // Runtime may still be empty before startup apply finishes.
        config = load_openwiki_config(conn).await;
    }
    // Soft-gate: only surface wiki status for currently open workspaces.
    let ws_owned = optional_open_workspace(conn, workspace.as_deref()).await;
    collect_status(&config, ws_owned.as_deref())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWikiRunParams {
    pub action: OpenWikiAction,
    pub workspace: Option<String>,
}

pub async fn openwiki_run_core(
    conn: &DatabaseConnection,
    runtime: &OpenWikiRuntimeConfig,
    params: OpenWikiRunParams,
) -> Result<OpenWikiRunResult, AppCommandError> {
    let config = runtime.snapshot().await;
    let ws_owned = match params.action {
        OpenWikiAction::Status => {
            optional_open_workspace(conn, params.workspace.as_deref()).await
        }
        OpenWikiAction::CodeInit | OpenWikiAction::CodeUpdate => {
            let raw = params.workspace.as_deref().ok_or_else(|| {
                AppCommandError::invalid_input("workspace path is required for this action")
            })?;
            Some(require_open_workspace(conn, raw).await?)
        }
    };
    let result = run_action(&config, params.action, ws_owned.as_deref()).await?;

    // After a successful init/update, optionally maintain AGENTS.md markers.
    if result.success {
        if matches!(
            params.action,
            OpenWikiAction::CodeInit | OpenWikiAction::CodeUpdate
        ) {
            if let Some(ws_path) = ws_owned.as_deref() {
                if let Err(e) = maybe_update_agents_md(&config, ws_path) {
                    tracing::warn!("[openwiki] agents.md update failed: {e}");
                }
            }
        }
    }
    Ok(result)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWikiInstructionsParams {
    pub workspace: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWikiInstructionsUpdate {
    pub workspace: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWikiInstructions {
    pub content: String,
    pub path: String,
}

pub async fn openwiki_get_instructions_core(
    conn: &DatabaseConnection,
    runtime: &OpenWikiRuntimeConfig,
    params: OpenWikiInstructionsParams,
) -> Result<OpenWikiInstructions, AppCommandError> {
    let config = runtime.snapshot().await;
    let ws = require_open_workspace(conn, &params.workspace).await?;
    let content = read_instructions(&config, &ws)?;
    let path = config
        .code_wiki_dir(&ws)
        .join("INSTRUCTIONS.md")
        .display()
        .to_string();
    Ok(OpenWikiInstructions { content, path })
}

pub async fn openwiki_save_instructions_core(
    conn: &DatabaseConnection,
    runtime: &OpenWikiRuntimeConfig,
    update: OpenWikiInstructionsUpdate,
) -> Result<OpenWikiInstructions, AppCommandError> {
    let config = runtime.snapshot().await;
    let ws = require_open_workspace(conn, &update.workspace).await?;
    write_instructions(&config, &ws, &update.content)?;
    let path = config
        .code_wiki_dir(&ws)
        .join("INSTRUCTIONS.md")
        .display()
        .to_string();
    Ok(OpenWikiInstructions {
        content: update.content,
        path,
    })
}

// ---------------------------------------------------------------------------
// CLI install / uninstall — delegates to the generic npm_cli module so that
// adding npm-based plugins never requires a Rust recompile.
// ---------------------------------------------------------------------------

const OPENWIKI_NPM_PACKAGE: &str = "openwiki";
const OPENWIKI_NPM_BIN: &str = "openwiki";
const OPENWIKI_INSTALL_EVENT: &str = "app://openwiki-install";

/// Result of installing / locating the OpenWiki CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWikiInstallResult {
    pub success: bool,
    pub executable_path: Option<String>,
    pub message: String,
}

/// Install the OpenWiki CLI via the generic npm installer, then persist the
/// resolved executable path into the OpenWiki config so status/runner work
/// without a restart.
pub async fn openwiki_install_cli_core(
    conn: &DatabaseConnection,
    runtime: &OpenWikiRuntimeConfig,
    emitter: &EventEmitter,
    task_id: String,
) -> Result<OpenWikiInstallResult, AppCommandError> {
    use crate::commands::npm_cli::{npm_install_cli_core, NpmInstallParams};

    let params = NpmInstallParams {
        package_name: OPENWIKI_NPM_PACKAGE.to_string(),
        binary_name: OPENWIKI_NPM_BIN.to_string(),
        event_channel: OPENWIKI_INSTALL_EVENT.to_string(),
        task_id,
        include_optional: true,
    };

    let result = npm_install_cli_core(&params, emitter).await?;

    // Persist the resolved executable path into OpenWiki config so the
    // runner doesn't depend on the process PATH being refreshed at runtime.
    if let Some(ref path_str) = result.executable_path {
        let mut config = runtime.snapshot().await;
        if config.agent_types_list.is_empty() && config.agent_permissions.is_empty() {
            config = load_openwiki_config(conn).await;
        }
        if config.paths.executable.trim().is_empty() {
            config.paths.executable = path_str.clone();
            set_openwiki_config_core(conn, runtime, emitter, config).await?;
        }
    }

    // Convert generic result to OpenWiki-flavored result.
    Ok(OpenWikiInstallResult {
        success: result.success,
        executable_path: result.executable_path,
        message: result.message,
    })
}

/// Uninstall openwiki from the default global prefix and the user-local prefix.
/// Also clears a saved `paths.executable` when it pointed at a removed binary.
pub async fn openwiki_uninstall_cli_core(
    conn: &DatabaseConnection,
    runtime: &OpenWikiRuntimeConfig,
    emitter: &EventEmitter,
) -> Result<OpenWikiInstallResult, AppCommandError> {
    use crate::commands::npm_cli::npm_uninstall_package;

    let result = npm_uninstall_package(OPENWIKI_NPM_PACKAGE, OPENWIKI_NPM_BIN).await?;

    // Clear saved executable path if the binary is gone.
    let mut config = runtime.snapshot().await;
    if config.agent_types_list.is_empty() && config.agent_permissions.is_empty() {
        config = load_openwiki_config(conn).await;
    }
    let configured = config.paths.executable.trim().to_string();
    if !configured.is_empty() {
        let p = PathBuf::from(&configured);
        if !p.is_file() {
            config.paths.executable = String::new();
            set_openwiki_config_core(conn, runtime, emitter, config).await?;
        }
    }

    Ok(OpenWikiInstallResult {
        success: result.success,
        executable_path: result.executable_path,
        message: result.message,
    })
}

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn openwiki_get_config(
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
) -> Result<OpenWikiConfig, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        Ok(openwiki_get_config_core(&db.conn).await)
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn openwiki_save_config(
    #[cfg(feature = "tauri-runtime")] app: tauri::AppHandle,
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
    #[cfg(feature = "tauri-runtime")] runtime: tauri::State<'_, OpenWikiRuntimeConfig>,
    settings: OpenWikiConfig,
) -> Result<OpenWikiConfig, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        let emitter = EventEmitter::Tauri(app);
        set_openwiki_config_core(&db.conn, &runtime, &emitter, settings).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = settings;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn openwiki_status(
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
    #[cfg(feature = "tauri-runtime")] runtime: tauri::State<'_, OpenWikiRuntimeConfig>,
    workspace: Option<String>,
) -> Result<OpenWikiStatus, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        Ok(openwiki_status_core(&db.conn, &runtime, workspace).await)
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = workspace;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn openwiki_run(
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
    #[cfg(feature = "tauri-runtime")] runtime: tauri::State<'_, OpenWikiRuntimeConfig>,
    params: OpenWikiRunParams,
) -> Result<OpenWikiRunResult, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        openwiki_run_core(&db.conn, &runtime, params).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = params;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn openwiki_get_instructions(
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
    #[cfg(feature = "tauri-runtime")] runtime: tauri::State<'_, OpenWikiRuntimeConfig>,
    params: OpenWikiInstructionsParams,
) -> Result<OpenWikiInstructions, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        openwiki_get_instructions_core(&db.conn, &runtime, params).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = params;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn openwiki_save_instructions(
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
    #[cfg(feature = "tauri-runtime")] runtime: tauri::State<'_, OpenWikiRuntimeConfig>,
    update: OpenWikiInstructionsUpdate,
) -> Result<OpenWikiInstructions, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        openwiki_save_instructions_core(&db.conn, &runtime, update).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = update;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn openwiki_install_cli(
    #[cfg(feature = "tauri-runtime")] app: tauri::AppHandle,
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
    #[cfg(feature = "tauri-runtime")] runtime: tauri::State<'_, OpenWikiRuntimeConfig>,
    task_id: String,
) -> Result<OpenWikiInstallResult, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        let emitter = EventEmitter::Tauri(app);
        openwiki_install_cli_core(&db.conn, &runtime, &emitter, task_id).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = task_id;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn openwiki_uninstall_cli(
    #[cfg(feature = "tauri-runtime")] app: tauri::AppHandle,
    #[cfg(feature = "tauri-runtime")] db: tauri::State<'_, crate::db::AppDatabase>,
    #[cfg(feature = "tauri-runtime")] runtime: tauri::State<'_, OpenWikiRuntimeConfig>,
) -> Result<OpenWikiInstallResult, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        let emitter = EventEmitter::Tauri(app);
        openwiki_uninstall_cli_core(&db.conn, &runtime, &emitter).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::openwiki::config::{OpenWikiAgentCapability, OpenWikiConfig};
    use crate::web::event_bridge::EventEmitter;

    #[tokio::test]
    async fn load_returns_default_when_unset() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let cfg = load_openwiki_config(&db.conn).await;
        assert!(!cfg.enabled);
        assert!(cfg.agent_types_list.is_empty());
    }

    #[tokio::test]
    async fn set_then_load_round_trip_and_runtime_applied() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let runtime = OpenWikiRuntimeConfig::new();
        let mut desired = OpenWikiConfig::default();
        desired.enabled = true;
        desired.agent_types_list = vec!["claude_code".into()];

        let saved = set_openwiki_config_core(
            &db.conn,
            &runtime,
            &EventEmitter::Noop,
            desired,
        )
        .await
        .unwrap();

        assert!(saved.enabled);
        assert!(saved.is_enabled_for_agent("claude_code", OpenWikiAgentCapability::ReadWiki));
        assert!(
            runtime
                .is_enabled_for_agent("claude_code", OpenWikiAgentCapability::ReadWiki)
                .await
        );

        let loaded = load_openwiki_config(&db.conn).await;
        assert_eq!(loaded.enabled, saved.enabled);
        assert!(loaded.agent_types_list.contains(&"claude_code".to_string()));
    }

    #[tokio::test]
    async fn require_open_workspace_rejects_closed_paths() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().to_string();

        // Path exists on disk but is not an open folder in DB.
        let err = require_open_workspace(&db.conn, &path)
            .await
            .expect_err("closed workspace must be rejected");
        let msg = err.to_string();
        assert!(
            msg.contains("not an open folder") || msg.contains("permission"),
            "unexpected error: {msg}"
        );
    }

    #[tokio::test]
    async fn require_open_workspace_accepts_open_folder() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().to_string();
        crate::db::service::folder_service::add_folder(&db.conn, &path)
            .await
            .expect("add open folder");

        let resolved = require_open_workspace(&db.conn, &path)
            .await
            .expect("open workspace must be accepted");
        assert!(resolved.is_dir());
    }

    #[tokio::test]
    async fn save_instructions_rejects_non_open_workspace() {
        let db = crate::db::test_helpers::fresh_in_memory_db().await;
        let runtime = OpenWikiRuntimeConfig::new();
        let mut cfg = OpenWikiConfig::default();
        cfg.enabled = true;
        runtime.set(cfg).await;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().to_string();
        let err = openwiki_save_instructions_core(
            &db.conn,
            &runtime,
            OpenWikiInstructionsUpdate {
                workspace: path,
                content: "hello".into(),
            },
        )
        .await
        .expect_err("must reject non-open workspace");
        let msg = err.to_string();
        assert!(
            msg.contains("not an open folder") || msg.contains("permission"),
            "unexpected error: {msg}"
        );
    }
}
