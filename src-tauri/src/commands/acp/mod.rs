pub mod general;
pub(crate) use general::*;
pub mod binary;
pub(crate) use binary::*;
pub mod codex_config;
pub(crate) use codex_config::*;
pub mod cline_config;
pub(crate) use cline_config::*;
pub mod opencode_config;
pub(crate) use opencode_config::*;
pub mod kimi_config;
pub(crate) use kimi_config::*;
pub mod pi_config;
pub(crate) use pi_config::*;
pub mod openclaw_config;
pub(crate) use openclaw_config::*;
pub mod hermes_config;
pub(crate) use hermes_config::*;
pub mod codebuddy_config;
pub(crate) use codebuddy_config::*;
pub mod command_code_config;
pub(crate) use command_code_config::*;
pub mod diagnose;
pub(crate) use diagnose::*;
pub mod native_login;
pub(crate) use native_login::*;
pub mod skills;
pub(crate) use skills::*;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
#[cfg(feature = "tauri-runtime")]
use tauri::{Manager, State};

use crate::acp::binary_cache;
use crate::acp::error::AcpError;
use crate::acp::manager::ConnectionManager;
use crate::acp::opencode_plugins::{self, PluginCheckSummary};
use crate::acp::preflight::{self, PreflightResult};
use crate::acp::registry;
use crate::acp::types::{
    AcpAgentInfo, AgentSkillContent, AgentSkillItem, AgentSkillLayout, AgentSkillLocation,
    AgentSkillScope, AgentSkillsListResult, ConfigStaleKind, ConnectionStatus,
};
#[cfg(feature = "tauri-runtime")]
use crate::acp::types::{ConnectionInfo, ForkResultInfo, PromptInputBlock};
use crate::commands::skills::{copy_dir_recursive, user_skills_dir};

/// Global Codex proxy guard: (fingerprint, ShutdownGuard). The proxy is started
/// once per process and reused across Codex sessions. If the upstream URL or
/// API key changes, the old proxy is shut down and a new one is started.
static CODECX_PROXY_GUARD: OnceLock<Mutex<Option<(String, crate::acp::provider_proxy::ShutdownGuard)>>> =
    OnceLock::new();
use crate::db::service::agent_setting_service;
use crate::db::service::model_provider_service;
use crate::db::AppDatabase;
use crate::models::agent::AgentType;
use crate::web::event_bridge::EventEmitter;

static NPM_GLOBAL_PREFIX_CACHE: tokio::sync::OnceCell<PathBuf> = tokio::sync::OnceCell::const_new();

#[derive(Debug, Clone, Serialize)]
pub(crate) struct AgentInstallEvent {
    pub task_id: String,
    pub kind: AgentInstallEventKind,
    pub payload: String,
}

/// Check whether an NPX agent command is spawnable.
/// Uses PATH first, then falls back to the current npm global prefix to handle
/// GUI environments that don't inherit the user's shell PATH.
pub(crate) async fn is_cmd_available(cmd: &str) -> bool {
    resolve_npx_command(cmd).await.is_some()
}

pub(crate) fn resolve_command_on_path(cmd: &str) -> Option<PathBuf> {
    which::which(cmd).ok()
}

/// Resolve the `uvx` (uv tool runner) executable used to launch Python ACP
/// agents (e.g. Hermes). Checks veryagent's managed uv cache FIRST (isolation:
/// the managed tool is authoritative), then PATH (respecting a user's own
/// `uv`), then the common install locations the official `uv` installer /
/// cargo use (`~/.local/bin`, `~/.cargo/bin`).
pub(crate) fn resolve_uvx_command() -> Option<PathBuf> {
    if let Some(path) = crate::acp::binary_cache::find_cached_uv_tool("uvx") {
        return Some(path);
    }
    if let Some(path) = resolve_command_on_path("uvx") {
        return Some(path);
    }
    let exe = if cfg!(windows) { "uvx.exe" } else { "uvx" };
    let home = home_dir_or_default();
    for dir in [home.join(".local").join("bin"), home.join(".cargo").join("bin")] {
        let cand = dir.join(exe);
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

/// The `uvx` flags that pin the interpreter for a `Uvx` agent, inserted before
/// `--from`. Returns `["--python", <ver>]` when the distribution sets a
/// `python` pin, else an empty vec. Centralizes the pin so every uvx invocation
/// (launch, prewarm, setup/model guidance) stays consistent.
pub(crate) fn uvx_python_args(python: Option<&str>) -> Vec<String> {
    match python {
        Some(ver) => vec!["--python".to_string(), ver.to_string()],
        None => Vec::new(),
    }
}

/// Pre-fetch a `Uvx` agent's pinned package into uvx's cache by running
/// `uvx --from <package> <cmd> --version`, so the first real connect doesn't
/// pay the download cost. Streams progress to the install event stream.
async fn prewarm_uvx_agent(
    agent_name: &str,
    package: &str,
    cmd: &str,
    python: Option<&str>,
    task_id: &str,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    // uv must already be installed; provision it separately via the "Install
    // uv" preflight action. We deliberately do NOT auto-install it here so the
    // two steps stay separate — the Settings UI disables this agent-install
    // action until uv is ready, so a normal user never reaches this error.
    let uvx = resolve_uvx_command().ok_or_else(|| {
        AcpError::SdkNotInstalled("uv is not installed; install the uv runtime first".to_string())
    })?;
    let python_args = uvx_python_args(python);
    let python_display = if python_args.is_empty() {
        String::new()
    } else {
        format!("{} ", python_args.join(" "))
    };
    emit_agent_install_event(
        emitter,
        task_id,
        AgentInstallEventKind::Log,
        format!("$ uvx {python_display}--from {package} {cmd} --version"),
    );
    let output = crate::process::tokio_command(&uvx)
        .args(&python_args)
        .arg("--from")
        .arg(package)
        .arg(cmd)
        .arg("--version")
        .output()
        .await
        .map_err(|e| AcpError::SpawnFailed(format!("failed to run uvx: {e}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    for line in stderr.lines().chain(stdout.lines()) {
        if !line.trim().is_empty() {
            emit_agent_install_event(
                emitter,
                task_id,
                AgentInstallEventKind::Log,
                line.to_string(),
            );
        }
    }
    if !output.status.success() {
        return Err(AcpError::protocol(format!(
            "uvx prepare for {agent_name} failed: {}",
            stderr.lines().last().unwrap_or("unknown error")
        )));
    }
    Ok(())
}

pub(crate) async fn resolve_npx_command(cmd: &str) -> Option<PathBuf> {
    // Isolation: the user-owned npm prefix (~/.veryagent/npm-global/) is
    // authoritative. The system PATH is only a fallback so legacy system
    // installs still work until migrated.
    if let Some(path) = resolve_npx_command_from_current_npm_prefix(cmd).await {
        return Some(path);
    }
    resolve_command_on_path(cmd)
}

#[derive(Default)]
struct NpxCommandResolver {
    per_cmd_cache: HashMap<String, Option<PathBuf>>,
    request_npm_prefix: Option<Option<PathBuf>>,
}

impl NpxCommandResolver {
    async fn resolve_for_list(&mut self, cmd: &str) -> Option<PathBuf> {
        if let Some(cached) = self.per_cmd_cache.get(cmd) {
            return cached.clone();
        }

        let resolved = if let Some(prefix) = if let Some(prefix) = &self.request_npm_prefix {
            prefix.clone()
        } else {
            let resolved_prefix = cached_npm_global_prefix().await;
            self.request_npm_prefix = Some(resolved_prefix.clone());
            resolved_prefix
        } {
            // Isolated prefix first (authoritative), then system PATH fallback.
            resolve_npx_command_from_npm_prefix(cmd, &prefix).or_else(|| {
                resolve_command_on_path(cmd)
            })
        } else {
            resolve_command_on_path(cmd)
        };

        self.per_cmd_cache.insert(cmd.to_string(), resolved.clone());
        resolved
    }
}

/// Verify that the agent SDK / binary is installed and usable.
///
/// This is the pre-spawn guard used by the session-page connect path:
/// the session page must NEVER trigger a download or install, so if the
/// agent isn't ready we return `AcpError::SdkNotInstalled` immediately
/// and let the frontend prompt the user to install from Agent Settings.
///
/// For NPX agents: checks the command is spawnable in this process environment.
/// For Binary agents: checks platform support and that the binary is
/// already cached locally.
pub(crate) async fn verify_agent_installed(agent_type: AgentType) -> Result<(), AcpError> {
    let meta = registry::get_agent_meta(agent_type);
    // Command Code ships its ACP adapter inside the app itself, so there is
    // never a binary to install; the only runtime prerequisite is a Node.js
    // ≥ 22 interpreter to execute the adapter script.
    if agent_type == AgentType::CommandCode {
        if !is_cmd_available("node").await {
            return Err(AcpError::SdkNotInstalled(format!(
                "{} requires Node.js ≥ 22. Please install it and try again.",
                meta.name
            )));
        }
        return Ok(());
    }
    match meta.distribution {
        registry::AgentDistribution::Npx { cmd, .. } => {
            if !is_cmd_available(cmd).await {
                // INVARIANT: the substring "is not installed" is matched
                // verbatim by the frontend catch block in
                // `src/contexts/acp-connections-context.tsx` to surface a
                // localized install prompt. Do not change the wording.
                return Err(AcpError::SdkNotInstalled(format!(
                    "{} is not installed. Please install it in Agent Settings.",
                    meta.name
                )));
            }
            Ok(())
        }
        registry::AgentDistribution::Binary { cmd, platforms, .. } => {
            let platform = registry::current_platform();
            if !platforms.iter().any(|p| p.platform == platform) {
                return Err(AcpError::PlatformNotSupported(format!(
                    "{} is not available on {platform}",
                    meta.name
                )));
            }
            // Accept any cached version — the Settings page will still
            // surface "upgrade available" for stale caches via its own
            // version-badge flow.
            if binary_cache::find_best_cached_binary_for_agent(agent_type, cmd)?.is_none() {
                // INVARIANT: see note above — "is not installed" is a
                // stable substring the frontend matches against.
                return Err(AcpError::SdkNotInstalled(format!(
                    "{} is not installed. Please install it in Agent Settings.",
                    meta.name
                )));
            }
            Ok(())
        }
        registry::AgentDistribution::Uvx { system_cmd, .. } => {
            // Launchable when uvx is resolvable (veryagent auto-provisions it on
            // install, so this holds post-prepare) or the agent's own CLI is on
            // PATH. Kept consistent with the Settings status/list paths via the
            // shared helper, so connect and the UI never disagree on readiness.
            if uvx_agent_launchable(system_cmd) {
                Ok(())
            } else {
                Err(AcpError::SdkNotInstalled(format!(
                    "{} is not installed. Please install it in Agent Settings.",
                    meta.name
                )))
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SkillStorageKind {
    SkillDirectoryOnly,
    SkillDirectoryOrMarkdownFile,
}

#[derive(Debug, Clone)]
pub(crate) struct SkillStorageSpec {
    pub kind: SkillStorageKind,
    pub global_dirs: Vec<PathBuf>,
    pub project_rel_dirs: Vec<&'static str>,
}

/// Hermes config/data directory. Honors `HERMES_HOME`, defaults to `~/.hermes`.
/// Hermes self-manages credentials (`.env`), config (`config.yaml`), session
/// store (`state.db`), and skills (`skills/`) here.
pub(crate) fn hermes_home_dir() -> PathBuf {
    let configured = std::env::var("HERMES_HOME").ok().and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    match configured {
        Some(value) => {
            if value == "~" {
                home_dir_or_default()
            } else if let Some(remain) = value.strip_prefix("~/") {
                home_dir_or_default().join(remain)
            } else {
                PathBuf::from(value)
            }
        }
        None => home_dir_or_default().join(".hermes"),
    }
}

fn load_codex_local_config_json() -> Option<String> {
    let mut merged = match fs::read_to_string(codex_config_toml_path()) {
        Ok(raw_toml) => codex_config_projection_from_toml(&raw_toml),
        Err(_) => serde_json::Map::new(),
    };

    if let Ok(raw_auth) = fs::read_to_string(codex_auth_json_path()) {
        if let Ok(auth) = serde_json::from_str::<serde_json::Value>(&raw_auth) {
            if let Some(api_key) = auth
                .get("OPENAI_API_KEY")
                .and_then(|item| item.as_str())
                .map(str::trim)
                .filter(|item| !item.is_empty())
            {
                merged.insert(
                    "apiKey".to_string(),
                    serde_json::Value::String(api_key.to_string()),
                );
            }
        }
    }

    if merged.is_empty() {
        return None;
    }
    serde_json::to_string_pretty(&serde_json::Value::Object(merged)).ok()
}

/// Resolve the MiMo Code auth.json path: `~/.local/share/mimocode/auth.json`.
fn mimo_auth_json_path() -> PathBuf {
    crate::parsers::mimo_code::resolve_mimo_code_base_dir().join("auth.json")
}

/// Strip `//` line comments and `/* */` block comments from a JSONC string,
/// producing valid JSON that serde_json can parse. String literals are
/// preserved — `//` inside a quoted string is left untouched.
fn strip_jsonc_comments(raw: &str) -> String {
    let chars: Vec<char> = raw.chars().collect();
    let mut out = String::with_capacity(raw.len());
    let mut in_string = false;
    let mut escaped = false;
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
        } else if c == '"' {
            in_string = true;
            out.push(c);
            i += 1;
        } else if c == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = (i + 2).min(chars.len());
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// The resolved veryagent-managed provider/model block to write into config.toml.
pub(crate) struct KimiManagedSpec {
    interface_type: String,
    base_url: Option<String>,
    /// Direct `api_key` field (when the user picks "direct key" auth).
    api_key: Option<String>,
    /// `[providers.veryagent.env]` sub-table entries — the env-sub-table API key, or
    /// Vertex's `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION`.
    env: BTreeMap<String, String>,
    model: String,
    max_context_size: Option<i64>,
}

/// Read-modify-write `config.toml`, upserting (`Some`) or clearing (`None`) the
/// veryagent-managed block. A clear on a non-existent file is a no-op (never creates
/// an empty file). Reuses the existing `toml` crate: data in other sections is
/// preserved; comments/formatting are not (the raw editor covers that).
fn mutate_kimi_config_toml(spec: Option<&KimiManagedSpec>) -> Result<(), AcpError> {
    let path = kimi_code_config_toml_path();
    if spec.is_none() && !path.exists() {
        return Ok(());
    }
    let mut toml_value = if path.exists() {
        match fs::read_to_string(&path)
            .ok()
            .and_then(|raw| raw.parse::<toml::Value>().ok())
        {
            Some(existing) if existing.is_table() => existing,
            _ => toml::Value::Table(toml::map::Map::new()),
        }
    } else {
        toml::Value::Table(toml::map::Map::new())
    };
    apply_kimi_managed_block(&mut toml_value, spec)?;
    let serialized = toml::to_string_pretty(&toml_value)
        .map_err(|e| AcpError::protocol(format!("serialize kimi config.toml failed: {e}")))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AcpError::protocol(format!("create kimi config directory failed: {e}")))?;
    }
    fs::write(&path, format!("{serialized}\n"))
        .map_err(|e| AcpError::protocol(format!("write kimi config.toml failed: {e}")))?;
    Ok(())
}

/// Whether any usable credential (real or synthetic) is present.
fn kimi_credential_present() -> bool {
    read_kimi_token().map(|t| kimi_token_has_access(&t)).unwrap_or(false)
}

/// Whether the present credential is veryagent's synthetic gate token.
fn kimi_credential_is_synthetic() -> bool {
    read_kimi_token()
        .map(|t| kimi_token_is_synthetic(&t))
        .unwrap_or(false)
}

fn load_kimi_code_config_json() -> Option<String> {
    let raw = fs::read_to_string(kimi_code_config_toml_path()).ok();
    let mut merged = match raw.as_deref().and_then(|text| text.parse::<toml::Value>().ok()) {
        Some(value) => project_kimi_managed_config(&value),
        None => {
            let mut m = serde_json::Map::new();
            m.insert("hasManagedBlock".to_string(), serde_json::Value::Bool(false));
            m
        }
    };
    // Surface the gate-credential state so the panel can show whether `kimi acp`
    // is currently authenticated and whether that came from veryagent's synthetic
    // token or a real OAuth login.
    merged.insert(
        "credentialPresent".to_string(),
        serde_json::Value::Bool(kimi_credential_present()),
    );
    merged.insert(
        "credentialSynthetic".to_string(),
        serde_json::Value::Bool(kimi_credential_is_synthetic()),
    );
    if let Some(text) = raw {
        merged.insert("rawConfigToml".to_string(), serde_json::Value::String(text));
    }
    serde_json::to_string_pretty(&serde_json::Value::Object(merged)).ok()
}

/// Structured Kimi Code config update from the settings UI. `mode` is one of:
/// `apikey` — write the veryagent-managed `config.toml` provider/model block AND seed
/// the synthetic gate token, so the API key actually authenticates `kimi acp`;
/// `login` — clear the managed block + remove our synthetic token so a real OAuth
/// login governs; `raw` — write a verbatim config.toml then seed the gate token.
/// Every mode also clears any stale `KIMI_MODEL_*` env override (it would
/// silently win over config.toml).
#[derive(Debug, Clone)]
pub(crate) struct KimiCodeConfigUpdate {
    pub mode: String,
    pub interface_type: Option<String>,
    pub auth_type: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub max_context_size: Option<i64>,
    pub vertex_project: Option<String>,
    pub vertex_location: Option<String>,
    pub raw_config_toml: Option<String>,
}

/// Clear any `KIMI_MODEL_*` env override from the DB `env_json`, preserving every
/// other env key and the agent's enabled/provider state. `kimi acp` reads that
/// env family BEFORE config.toml, so a stale entry would silently override the
/// veryagent-managed provider; every save clears it to keep config.toml authoritative.
/// Ensures the settings row exists first. No-op fast path when nothing to clear.
async fn clear_kimi_model_env(db: &AppDatabase) -> Result<(), AcpError> {
    let default = agent_setting_service::AgentDefaultInput {
        agent_type: AgentType::KimiCode,
        registry_id: registry::registry_id_for(AgentType::KimiCode).to_string(),
        default_sort_order: i32::MAX / 2,
    };
    agent_setting_service::ensure_defaults(&db.conn, &[default])
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;
    let setting = agent_setting_service::get_by_agent_type(&db.conn, AgentType::KimiCode)
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;
    let enabled = setting.as_ref().map(|m| m.enabled).unwrap_or(false);
    let _model_provider_id = setting.as_ref().and_then(|m| m.model_provider_id);
    let mut env: BTreeMap<String, String> = setting
        .and_then(|m| m.env_json)
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let had = env.remove(KIMI_MODEL_BASE_URL_ENV).is_some()
        | env.remove(KIMI_MODEL_API_KEY_ENV).is_some()
        | env.remove(KIMI_MODEL_NAME_ENV).is_some();
    if !had {
        return Ok(());
    }
    let env_json = serde_json::to_string(&env)
        .map_err(|e| AcpError::protocol(format!("serialize kimi env failed: {e}")))?;
    // When saving apikey/login config, clear model_provider_id so the UI
    // doesn't revert to model_provider mode on refresh.
    agent_setting_service::update(
        &db.conn,
        AgentType::KimiCode,
        agent_setting_service::AgentSettingsUpdate {
            enabled,
            env_json: Some(env_json),
            model_provider_id: None,
        },
    )
    .await
    .map_err(|e| AcpError::protocol(e.to_string()))?;
    Ok(())
}

/// Apply a structured Kimi config update across both stores (DB `env_json` +
/// `~/.kimi-code/config.toml`), keeping exactly one authoritative. Validates the
/// whole request before any write, then writes config.toml first so an env-write
/// failure can never leave the file pointing at credentials that were rolled back.
pub(crate) async fn acp_update_kimi_code_config_core(
    update: KimiCodeConfigUpdate,
    db: &AppDatabase,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    enum FileAction {
        Managed(Option<KimiManagedSpec>),
        Raw(String),
    }
    // What to do with the synthetic gate token after the config write. `kimi acp`
    // won't open a session without it, so API-key/raw seed it; OAuth-login removes
    // only OUR token (never a real login).
    enum CredentialAction {
        Seed,
        RemoveIfOurs,
    }

    // ---- Plan + validate (no writes yet) ----
    let (file_action, credential_action) = match update.mode.trim() {
        "apikey" => (
            FileAction::Managed(Some(build_kimi_managed_spec(&update)?)),
            CredentialAction::Seed,
        ),
        "login" => (FileAction::Managed(None), CredentialAction::RemoveIfOurs),
        "raw" => {
            let raw = update.raw_config_toml.as_deref().unwrap_or("");
            toml::from_str::<toml::Table>(raw)
                .map_err(|e| AcpError::protocol(format!("invalid kimi config.toml: {e}")))?;
            (FileAction::Raw(raw.to_string()), CredentialAction::Seed)
        }
        other => {
            return Err(AcpError::protocol(format!("unknown kimi config mode: '{other}'")));
        }
    };

    // ---- Apply: config.toml, then the gate token, then clear the env override ----
    match file_action {
        FileAction::Managed(spec) => mutate_kimi_config_toml(spec.as_ref())?,
        FileAction::Raw(raw) => {
            let path = kimi_code_config_toml_path();
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    AcpError::protocol(format!("create kimi config directory failed: {e}"))
                })?;
            }
            fs::write(&path, raw)
                .map_err(|e| AcpError::protocol(format!("write kimi config.toml failed: {e}")))?;
        }
    }
    match credential_action {
        CredentialAction::Seed => seed_kimi_synthetic_credential()?,
        CredentialAction::RemoveIfOurs => remove_kimi_synthetic_credential_if_ours()?,
    }
    clear_kimi_model_env(db).await?;
    emit_acp_agents_updated(emitter, "config_updated", Some(AgentType::KimiCode));
    Ok(())
}

/// `acp_update_kimi_code_config_core` followed by a session staleness refresh.
/// Shared by the Tauri command and the web handler; returns the count of running
/// Kimi sessions left on stale (launch-time) config.
pub(crate) async fn acp_update_kimi_code_config_and_refresh(
    update: KimiCodeConfigUpdate,
    db: &AppDatabase,
    manager: &ConnectionManager,
    data_dir: &Path,
    emitter: &EventEmitter,
) -> Result<usize, AcpError> {
    acp_update_kimi_code_config_core(update, db, emitter).await?;
    Ok(refresh_config_staleness(
        manager,
        db,
        data_dir,
        &[AgentType::KimiCode],
        ConfigStaleKind::AgentConfig,
    )
    .await)
}

/// Validate an API key + endpoint by listing the account's models. GETs
/// `<base_url>/models` with the key as a Bearer token and returns the model ids
/// (OpenAI-compatible `{ "data": [{ "id": ... }] }`). Surfaces the provider's
/// own error message on failure. Lets the settings panel populate a model picker
/// and doubles as a one-click connection test — directly preventing the
/// "Not found the model ..." trap of typing a model the account can't access.
pub(crate) async fn acp_fetch_kimi_models_core(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, AcpError> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err(AcpError::protocol("base URL is required to list models"));
    }
    let key = api_key.trim();
    if key.is_empty() {
        return Err(AcpError::protocol("API key is required to list models"));
    }
    let url = format!("{base}/models");
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(key)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| AcpError::protocol(format!("list models request failed: {e}")))?;
    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AcpError::protocol(format!("list models returned invalid JSON: {e}")))?;
    if !status.is_success() {
        let msg = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("request rejected");
        return Err(AcpError::protocol(format!("{status}: {msg}")));
    }
    let mut ids: Vec<String> = body
        .get("data")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    m.get("id")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Like [`pi_agent_dir`], but resolves `PI_CODING_AGENT_DIR` from a per-agent
/// `runtime_env` map first (the BYO-pi override path) before falling back to the
/// process env / `~/.pi/agent`. Launch-time trust seeding only has the per-agent
/// env (the override never lands in veryagent's own process env), so it must consult
/// `runtime_env` to target the same agent dir pi-acp will spawn pi against.
fn pi_agent_dir_for_env(runtime_env: &BTreeMap<String, String>) -> PathBuf {
    match runtime_env
        .get("PI_CODING_AGENT_DIR")
        .map(|raw| raw.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(value) => PathBuf::from(value),
        None => pi_agent_dir(),
    }
}

/// Per-agent `env_json` key gating launch-time workspace-trust seeding for pi.
/// Absent or any value other than `"0"` ⇒ enabled (default on); `"0"` disables.
pub(crate) const PI_TRUST_WORKSPACE_ENV: &str = "PI_ACP_TRUST_WORKSPACE";

/// Seed pi's `trust.json` so the workspace veryagent is launching pi into is trusted.
///
/// pi stores trust as a flat `{ "<canonical-dir>": true|false|null }` map and the
/// nearest-ancestor entry decides whether it loads a project's local `.pi/*`
/// config and `.agents/skills`. This gates ONLY config/skill loading, never tool
/// execution — veryagent has already authorized full execution in `cwd` by connecting
/// an agent there, so trusting the same folder for config loading is consistent
/// and removes a redundant, mid-connection trust prompt.
///
/// Guarantees: scoped (only `cwd`, never machine-wide), additive-only (never
/// writes `false` or removes entries), idempotent (any existing entry for `cwd` —
/// including a user's explicit `false`/`null` set in pi — is left untouched), and
/// crash-safe for pi's file (a present-but-unparseable `trust.json` is never
/// clobbered). Best-effort: every failure is logged at debug and swallowed so
/// trust seeding can never block a connect. Honors `PI_CODING_AGENT_DIR` via
/// `runtime_env`.
pub(crate) fn seed_pi_workspace_trust(cwd: &Path, runtime_env: &BTreeMap<String, String>) {
    // Default on: only an explicit "0" disables.
    if runtime_env
        .get(PI_TRUST_WORKSPACE_ENV)
        .is_some_and(|v| v.trim() == "0")
    {
        return;
    }
    // pi keys trust by the realpath of the directory; mirror `realpathSync` with
    // `fs::canonicalize`. A non-canonicalizable cwd can't be matched anyway.
    let canonical = match fs::canonicalize(cwd) {
        Ok(p) => p,
        Err(e) => {
            tracing::debug!("[pi] trust seed skipped: canonicalize {cwd:?} failed: {e}");
            return;
        }
    };
    let key = canonical.to_string_lossy().to_string();
    let path = pi_agent_dir_for_env(runtime_env).join("trust.json");

    // Read pi's file strictly: a missing file is fine (we create one), but a file
    // that exists yet doesn't parse to a JSON object must NOT be overwritten —
    // that would destroy decisions veryagent can't see.
    let mut obj = match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(serde_json::Value::Object(map)) => map,
            _ => {
                tracing::debug!("[pi] trust seed skipped: {path:?} is not a JSON object");
                return;
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::Map::new(),
        Err(e) => {
            tracing::debug!("[pi] trust seed skipped: read {path:?} failed: {e}");
            return;
        }
    };

    // Idempotent + respect any decision the user already made for this folder.
    if obj.contains_key(&key) {
        return;
    }
    obj.insert(key, serde_json::Value::Bool(true));
    if let Err(e) = write_json_object_pretty(&path, &obj) {
        tracing::debug!("[pi] trust seed write failed for {path:?}: {e}");
    }
}

/// Structured Pi config update from the settings UI. Writes pi's native files:
/// `settings.json` always (provider/model/thinking level), and `auth.json` only
/// when an API key is supplied (merge-preserving other providers).
#[derive(Debug, Clone)]
pub(crate) struct PiConfigUpdate {
    pub provider: String,
    pub model: String,
    pub thinking_level: Option<String>,
    pub api_key: Option<String>,
    /// When set (non-empty), `provider` is a custom / self-hosted provider: its
    /// definition is merge-written to `models.json` (`baseUrl` + `api`, with the
    /// chosen `model` folded into the provider's `models` array). `None` leaves
    /// `models.json` untouched (built-in provider).
    pub custom_base_url: Option<String>,
    /// Wire protocol for the custom provider (defaults to `openai-completions`).
    /// Ignored when `custom_base_url` is `None`.
    pub custom_api: Option<String>,
}

/// Apply a structured Pi config update to pi's native files. Validates the whole
/// request before any write: provider/model must be non-empty after trim and the
/// API key must not contain newlines (it lands verbatim in a JSON string). Writes
/// `settings.json` first (merge-preserving), then `auth.json` only when an API
/// key is supplied. Ensures the settings row exists, then emits the agents-updated
/// event so the settings panel refreshes.
pub(crate) async fn acp_update_pi_config_core(
    update: PiConfigUpdate,
    db: &AppDatabase,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    // ---- Validate (no writes yet) ----
    let provider = update.provider.trim();
    if provider.is_empty() {
        return Err(AcpError::protocol("pi provider is required"));
    }
    let model = update.model.trim();
    if model.is_empty() {
        return Err(AcpError::protocol("pi model is required"));
    }
    let thinking_level = update
        .thinking_level
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let api_key = update
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(key) = api_key {
        if key.contains('\n') || key.contains('\r') {
            return Err(AcpError::protocol(
                "pi API key must not contain line breaks",
            ));
        }
    }

    // Ensure the settings row exists (mirrors the kimi flow) so the agent shows
    // up as configured/enabled in the DB-backed settings list.
    let default = agent_setting_service::AgentDefaultInput {
        agent_type: AgentType::Pi,
        registry_id: registry::registry_id_for(AgentType::Pi).to_string(),
        default_sort_order: i32::MAX / 2,
    };
    agent_setting_service::ensure_defaults(&db.conn, &[default])
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;

    // ---- settings.json: merge-write provider/model/thinking level ----
    let settings_path = pi_settings_json_path();
    let mut settings = read_json_object_or_empty(&settings_path);
    settings.insert(
        "defaultProvider".to_string(),
        serde_json::Value::String(provider.to_string()),
    );
    settings.insert(
        "defaultModel".to_string(),
        serde_json::Value::String(model.to_string()),
    );
    if let Some(level) = thinking_level {
        settings.insert(
            "defaultThinkingLevel".to_string(),
            serde_json::Value::String(level.to_string()),
        );
    }
    write_json_object_pretty(&settings_path, &settings)?;

    // ---- auth.json: merge-write the provider credential (only when given) ----
    if let Some(key) = api_key {
        let auth_path = pi_auth_json_path();
        let mut auth = read_json_object_or_empty(&auth_path);
        let mut entry = serde_json::Map::new();
        entry.insert(
            "type".to_string(),
            serde_json::Value::String("api_key".to_string()),
        );
        entry.insert(
            "key".to_string(),
            serde_json::Value::String(key.to_string()),
        );
        auth.insert(provider.to_string(), serde_json::Value::Object(entry));
        write_json_object_pretty(&auth_path, &auth)?;
    }

    // ---- models.json: define the custom provider (only when a base URL is
    // given). Built-in providers leave this file untouched. Merge-preserving:
    // `baseUrl`/`api` are overwritten from the form, but any other fields the
    // user hand-tuned (headers/compat/modelOverrides) and previously-defined
    // models are kept; the chosen model is folded into the `models` array. ----
    let custom_base_url = update
        .custom_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(base_url) = custom_base_url {
        let custom_api = update
            .custom_api
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("openai-completions");
        let models_path = pi_models_json_path();
        let mut models_doc = read_json_object_or_empty(&models_path);
        let mut providers = match models_doc.remove("providers") {
            Some(serde_json::Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        };
        let mut entry = match providers.remove(provider) {
            Some(serde_json::Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        };
        entry.insert(
            "baseUrl".to_string(),
            serde_json::Value::String(base_url.to_string()),
        );
        entry.insert(
            "api".to_string(),
            serde_json::Value::String(custom_api.to_string()),
        );
        let mut models_arr = match entry.remove("models") {
            Some(serde_json::Value::Array(arr)) => arr,
            _ => Vec::new(),
        };
        let already = models_arr
            .iter()
            .any(|m| m.get("id").and_then(serde_json::Value::as_str) == Some(model));
        if !already {
            let mut model_obj = serde_json::Map::new();
            model_obj.insert(
                "id".to_string(),
                serde_json::Value::String(model.to_string()),
            );
            model_obj.insert(
                "name".to_string(),
                serde_json::Value::String(model.to_string()),
            );
            models_arr.push(serde_json::Value::Object(model_obj));
        }
        entry.insert("models".to_string(), serde_json::Value::Array(models_arr));
        providers.insert(provider.to_string(), serde_json::Value::Object(entry));
        models_doc.insert(
            "providers".to_string(),
            serde_json::Value::Object(providers),
        );
        write_json_object_pretty(&models_path, &models_doc)?;
    }

    emit_acp_agents_updated(emitter, "config_updated", Some(AgentType::Pi));
    Ok(())
}

/// Projection of pi's current native config for the settings panel: the three
/// `settings.json` model keys plus the provider names present in `auth.json`
/// (sorted). Missing files surface as all-`None` / empty.
/// A custom / self-hosted provider defined in `models.json`, projected for the
/// settings panel so it can rehydrate the custom-provider form (and detect that
/// the current `defaultProvider` is a custom one).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiCustomProvider {
    pub id: String,
    pub base_url: String,
    pub api: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiConfigProjection {
    pub default_provider: Option<String>,
    pub default_model: Option<String>,
    pub default_thinking_level: Option<String>,
    pub auth_providers: Vec<String>,
    pub custom_providers: Vec<PiCustomProvider>,
}

/// Read pi's native files into a `PiConfigProjection`. Never errors: absent or
/// malformed files yield `None` / an empty provider list (the panel treats that
/// as "not configured yet").
pub(crate) fn load_pi_config_core() -> PiConfigProjection {
    let settings = read_json_object_or_empty(&pi_settings_json_path());
    let string_key = |key: &str| {
        settings
            .get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    };
    let mut auth_providers: Vec<String> = read_json_object_or_empty(&pi_auth_json_path())
        .keys()
        .cloned()
        .collect();
    auth_providers.sort();
    let mut custom_providers: Vec<PiCustomProvider> =
        read_json_object_or_empty(&pi_models_json_path())
            .get("providers")
            .and_then(serde_json::Value::as_object)
            .map(|providers| {
                providers
                    .iter()
                    .map(|(id, entry)| PiCustomProvider {
                        id: id.clone(),
                        base_url: entry
                            .get("baseUrl")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        api: entry
                            .get("api")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("openai-completions")
                            .to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
    custom_providers.sort_by(|a, b| a.id.cmp(&b.id));
    PiConfigProjection {
        default_provider: string_key("defaultProvider"),
        default_model: string_key("defaultModel"),
        default_thinking_level: string_key("defaultThinkingLevel"),
        auth_providers,
        custom_providers,
    }
}

/// Result of validating a user-supplied custom pi binary (BYO-pi). `found=false`
/// with `resolved_path=None` is a normal result (not an error) — the panel shows
/// "not found" rather than surfacing an exception.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiCommandValidation {
    pub found: bool,
    pub resolved_path: Option<String>,
    pub version: Option<String>,
}

/// Local OpenClaw gateway discovery result for the settings UI.
///
/// Values come from process env and/or `~/.openclaw/openclaw.json` (or
/// `OPENCLAW_CONFIG_PATH`). Empty fields mean "not found" — we never invent a
/// default port as an authoritative URL. `gateway_reachable` is a live TCP
/// probe and is the only signal that may justify a "ready" badge.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawGatewayDiscovery {
    /// Resolved gateway WebSocket URL, if any.
    pub gateway_url: Option<String>,
    /// Where `gateway_url` came from (`env`, `config_remote_url`, `config_port`, …).
    pub gateway_url_source: Option<String>,
    /// Gateway auth token, if any.
    pub gateway_token: Option<String>,
    /// Where `gateway_token` came from (`env`, `config_remote_token`,
    /// `config_auth_token`, `config_token_file`, …).
    pub gateway_token_source: Option<String>,
    /// Config file path that was consulted (resolved path, even if missing).
    pub config_path: String,
    /// Whether that config file exists on disk.
    pub config_exists: bool,
    /// Whether the config file was readable as JSON/JSON5-ish.
    pub config_parsed: bool,
    /// Port observed from env or `gateway.port` (informational; may be None).
    pub gateway_port: Option<u16>,
    /// Source of `gateway_port` when present.
    pub gateway_port_source: Option<String>,
    /// `gateway.mode` from config when present (`local` / `remote` / …).
    pub gateway_mode: Option<String>,
    /// Live TCP probe against the resolved host:port. False when unreachable
    /// or when no host/port can be resolved.
    pub gateway_reachable: bool,
}

/// Result of the settings "one-click" OpenClaw local gateway bootstrap.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawGatewayEnsureResult {
    pub ok: bool,
    /// Short machine-ish status: already_running / started / configured / failed.
    pub status: String,
    pub message: String,
    pub discovery: OpenClawGatewayDiscovery,
    pub steps: Vec<String>,
}

fn openclaw_expand_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "~" {
        home_dir_or_default()
    } else if let Some(remain) = trimmed.strip_prefix("~/") {
        home_dir_or_default().join(remain)
    } else {
        PathBuf::from(trimmed)
    }
}

fn openclaw_read_token_file(raw_path: &str) -> Option<String> {
    let path = openclaw_expand_path(raw_path);
    let contents = fs::read_to_string(path).ok()?;
    let token = contents.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

/// Discover OpenClaw gateway URL/token from process env + local openclaw.json.
/// Never fabricates a default port as truth — only reports what is configured.
/// Live reachability is filled by `discover_openclaw_gateway_core`.
pub(crate) async fn discover_openclaw_gateway_core() -> OpenClawGatewayDiscovery {
    let mut discovery = discover_openclaw_gateway_from(
        openclaw_config_path(),
        openclaw_env_nonempty("OPENCLAW_GATEWAY_URL"),
        openclaw_env_nonempty("OPENCLAW_GATEWAY_PORT"),
        openclaw_env_nonempty("OPENCLAW_GATEWAY_TOKEN"),
    );
    discovery.gateway_reachable = probe_openclaw_gateway_reachable(&discovery).await;
    discovery
}

fn openclaw_probe_target(discovery: &OpenClawGatewayDiscovery) -> Option<(String, u16)> {
    if let Some(url) = discovery.gateway_url.as_deref() {
        if let Some(parsed) = parse_openclaw_ws_host_port(url) {
            return Some(parsed);
        }
    }
    if let Some(port) = discovery.gateway_port.filter(|p| *p != 0) {
        return Some(("127.0.0.1".to_string(), port));
    }
    None
}

async fn resolve_openclaw_cli() -> Result<PathBuf, AcpError> {
    if let Some(path) = resolve_npx_command("openclaw").await {
        return Ok(path);
    }
    if let Ok(path) = which::which("openclaw") {
        return Ok(path);
    }
    #[cfg(windows)]
    {
        if let Ok(path) = which::which("openclaw.cmd") {
            return Ok(path);
        }
    }
    Err(AcpError::protocol(
        "openclaw CLI not found. Install OpenClaw in Settings first.".to_string(),
    ))
}

async fn spawn_openclaw_gateway_run(port: u16) -> Result<(), AcpError> {
    let cli = resolve_openclaw_cli().await?;
    let mut cmd = crate::process::tokio_command(&cli);
    // The gateway run process is a Node app — give it the isolated runtime PATH
    // so it resolves `node`/`npm` from VeryAgent's managed runtime.
    cmd.env("PATH", crate::process::isolated_path_string());
    cmd.args([
        "gateway",
        "run",
        "--port",
        &port.to_string(),
        "--force",
        "--allow-unconfigured",
    ]);
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    // Detach: we only care that the process starts; it keeps running.
    cmd.spawn()
        .map_err(|e| AcpError::protocol(format!("failed to start openclaw gateway: {e}")))?;
    Ok(())
}

/// Configure a minimal local OpenClaw gateway (if needed) and start it.
/// Intended for the settings one-click button — no terminal required.
pub(crate) async fn ensure_openclaw_gateway_core() -> Result<OpenClawGatewayEnsureResult, AcpError> {
    let mut steps: Vec<String> = Vec::new();
    let mut discovery = discover_openclaw_gateway_core().await;
    if discovery.gateway_reachable {
        steps.push("Gateway already reachable".into());
        return Ok(OpenClawGatewayEnsureResult {
            ok: true,
            status: "already_running".into(),
            message: "OpenClaw Gateway is already running.".into(),
            discovery,
            steps,
        });
    }

    // 1) Baseline config/workspace without interactive wizard.
    if !discovery.config_exists {
        steps.push("Creating OpenClaw baseline config".into());
        match run_openclaw_cli(
            &[
                "setup",
                "--non-interactive",
                "--accept-risk",
                "--mode",
                "local",
            ],
            90,
        )
        .await
        {
            Ok((ok, out)) => {
                if ok {
                    steps.push("openclaw setup completed".into());
                } else {
                    steps.push(format!("openclaw setup reported an issue: {out}"));
                }
            }
            Err(e) => steps.push(format!("openclaw setup failed: {e}")),
        }
        discovery = discover_openclaw_gateway_core().await;
    }

    // 2) Ensure gateway.mode=local so service start is allowed.
    let mode = discovery.gateway_mode.as_deref().unwrap_or("").trim();
    if mode.is_empty() || mode != "local" {
        steps.push("Setting gateway.mode=local".into());
        match run_openclaw_cli(&["config", "set", "gateway.mode", "local"], 30).await {
            Ok((ok, out)) => {
                if ok {
                    steps.push("gateway.mode set to local".into());
                } else {
                    steps.push(format!("config set gateway.mode failed: {out}"));
                }
            }
            Err(e) => steps.push(format!("config set gateway.mode error: {e}")),
        }
        discovery = discover_openclaw_gateway_core().await;
    }

    // Prefer configured port; else OpenClaw default 18789.
    let port = discovery
        .gateway_port
        .filter(|p| *p != 0)
        .unwrap_or(OPENCLAW_DEFAULT_LOCAL_PORT);
    if discovery.gateway_url.is_none() {
        // Write port so discovery and the UI can fill OPENCLAW_GATEWAY_URL.
        steps.push(format!("Setting gateway.port={port}"));
        let _ = run_openclaw_cli(
            &["config", "set", "gateway.port", &port.to_string()],
            30,
        )
        .await;
        discovery = discover_openclaw_gateway_core().await;
    }

    // 3) Try managed service start first (Windows Scheduled Task / launchd / systemd).
    steps.push("Starting OpenClaw Gateway service".into());
    let mut started = false;
    match run_openclaw_cli(&["gateway", "install", "--port", &port.to_string()], 60).await {
        Ok((ok, out)) => {
            if ok {
                steps.push("gateway service installed".into());
            } else if !out.trim().is_empty() {
                steps.push(format!("gateway install: {out}"));
            }
        }
        Err(e) => steps.push(format!("gateway install skipped: {e}")),
    }
    match run_openclaw_cli(&["gateway", "start"], 45).await {
        Ok((ok, out)) => {
            if ok {
                steps.push("gateway start ok".into());
                started = true;
            } else {
                steps.push(format!("gateway start: {out}"));
            }
        }
        Err(e) => steps.push(format!("gateway start error: {e}")),
    }

    // Wait briefly for the service to bind.
    for _ in 0..20 {
        discovery = discover_openclaw_gateway_core().await;
        if discovery.gateway_reachable {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }

    // 4) Fallback: foreground-style detached gateway run.
    if !discovery.gateway_reachable {
        steps.push(format!(
            "Service not reachable; launching openclaw gateway run on {port}"
        ));
        if let Err(e) = spawn_openclaw_gateway_run(port).await {
            steps.push(format!("gateway run failed: {e}"));
        } else {
            started = true;
            for _ in 0..30 {
                discovery = discover_openclaw_gateway_core().await;
                if discovery.gateway_reachable {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            }
        }
    }

    // If discovery still has no URL but we know the local port, surface it.
    if discovery.gateway_url.is_none() {
        discovery.gateway_url = Some(openclaw_local_ws_url(port));
        discovery.gateway_url_source = Some("default_local".to_string());
        discovery.gateway_port = Some(port);
        discovery.gateway_port_source = discovery
            .gateway_port_source
            .or_else(|| Some("default_local".to_string()));
        discovery.gateway_reachable = probe_openclaw_gateway_reachable(&discovery).await;
    }

    if discovery.gateway_reachable {
        steps.push("Gateway is reachable".into());
        return Ok(OpenClawGatewayEnsureResult {
            ok: true,
            status: if started {
                "started".into()
            } else {
                "configured".into()
            },
            message: format!(
                "OpenClaw Gateway is running at {}.",
                discovery
                    .gateway_url
                    .clone()
                    .unwrap_or_else(|| openclaw_local_ws_url(port))
            ),
            discovery,
            steps,
        });
    }

    Ok(OpenClawGatewayEnsureResult {
        ok: false,
        status: "failed".into(),
        message: "Could not start OpenClaw Gateway. Check Node/openclaw install, then retry.".into(),
        discovery,
        steps,
    })
}

/// Best-effort check that `resolved` looks executable on unix (any execute bit
/// set). On non-unix we already know it exists; treat that as good enough.
#[cfg(unix)]
fn pi_path_is_executable(resolved: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(resolved)
        .map(|meta| meta.is_file() && (meta.permissions().mode() & 0o111 != 0))
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn pi_path_is_executable(resolved: &Path) -> bool {
    resolved.is_file()
}

/// Resolve a user-supplied pi command. A value containing a path separator (or an
/// absolute path) is treated as a path and checked on disk; a bare name is looked
/// up on `PATH` via the `which` crate. On success, best-effort `--version` is run
/// (failures tolerated → `version=None`). Never errors on a not-found / probe
/// failure: returns `found=false` (or `version=None`) instead.
/// Resolve a pi command to an executable path: a value containing a path
/// separator (or an absolute path) is checked on disk; a bare name is looked up
/// on `PATH` via the `which` crate. Returns `None` when it can't be resolved to
/// an executable. Shared by the BYO-pi validate command and the launch preflight
/// ([`crate::acp::connection`]) so both agree on what "pi is resolvable" means —
/// and both see the same `PATH` the spawned pi-acp process inherits.
pub(crate) fn resolve_pi_command_path(command: &str) -> Option<PathBuf> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    let looks_like_path = trimmed.contains(std::path::MAIN_SEPARATOR)
        || trimmed.contains('/')
        || Path::new(trimmed).is_absolute();

    if looks_like_path {
        let candidate = Path::new(trimmed);
        if pi_path_is_executable(candidate) {
            // Canonicalize to an absolute path; fall back to the raw path if the
            // FS rejects canonicalization (e.g. permissions) but it is executable.
            Some(fs::canonicalize(candidate).unwrap_or_else(|_| candidate.to_path_buf()))
        } else {
            None
        }
    } else {
        which::which(trimmed).ok()
    }
}

pub(crate) fn acp_validate_pi_command_core(command: String) -> PiCommandValidation {
    let Some(resolved_path) = resolve_pi_command_path(&command) else {
        return PiCommandValidation {
            found: false,
            resolved_path: None,
            version: None,
        };
    };

    let version = probe_pi_version(&resolved_path);
    PiCommandValidation {
        found: true,
        resolved_path: Some(resolved_path.to_string_lossy().into_owned()),
        version,
    }
}

/// Best-effort `<resolved> --version`, returning the trimmed first stdout line.
/// Any failure (spawn error, non-zero exit, empty output) → `None`; never panics
/// and never blocks indefinitely (`Command::output` waits for the short-lived
/// `--version` child to exit on its own).
fn probe_pi_version(resolved: &Path) -> Option<String> {
    let output = std::process::Command::new(resolved)
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
}

pub(crate) fn hermes_config_yaml_path() -> PathBuf {
    hermes_home_dir().join("config.yaml")
}

/// Ensure the Hermes git runtime has a `git.exe`. Hermes bundles a minimal
/// Git for Windows runtime, but the `git.exe` binary may be missing if the
/// installation was interrupted or incomplete. When detected, we locate
/// `git.exe` on the system PATH and copy it into the runtime directory so
/// Hermes' terminal tool works correctly.
pub(crate) fn ensure_hermes_git_runtime() {
    let git_runtime_dir = home_dir_or_default()
        .join("AppData")
        .join("Local")
        .join("hermes")
        .join("runtime")
        .join("git")
        .join("bin");
    let git_exe = git_runtime_dir.join("git.exe");
    if git_exe.exists() {
        return;
    }
    // Locate git.exe on the system PATH.
    let found = std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path).find_map(|dir| {
            let candidate = dir.join("git.exe");
            if candidate.exists() { Some(candidate) } else { None }
        })
    });
    if let Some(src) = found {
        if let Err(e) = std::fs::copy(&src, &git_exe) {
            tracing::warn!("[Hermes] failed to copy git.exe to runtime: {e}");
        } else {
            tracing::info!("[Hermes] copied git.exe to runtime dir: {}", git_exe.display());
        }
    } else {
        tracing::warn!("[Hermes] git.exe not found on PATH — terminal tool may fail");
    }
}

/// A managed Hermes provider: the config.yaml `model.provider` value (its `id`)
/// and the `.env` variable that carries its API key. `key_env_var` is the
/// variable Hermes' own setup writes first (mirrors `auth.py` PROVIDER_REGISTRY
/// priority order); it is empty for OAuth providers (credentials set via the
/// terminal `--setup` flow) and AWS Bedrock (resolved from the AWS SDK chain).
/// `needs_base_url` marks providers whose endpoint is user-supplied (the
/// OpenAI-compatible `openai-api` path). The frontend mirror owns the auth-kind
/// UI flag.
pub(crate) struct HermesProvider {
    id: &'static str,
    key_env_var: &'static str,
    needs_base_url: bool,
    /// The `.env` variable Hermes reads for a user-supplied endpoint URL. When
    /// set (only `openai-api` today), veryagent mirrors the structured base URL into
    /// both this var and config.yaml `model.base_url`, because Hermes' own
    /// resolution paths disagree on which one wins — keeping them in sync makes
    /// the saved endpoint authoritative under either path.
    base_url_env_var: &'static str,
}

/// Curated subset of Hermes providers veryagent edits via structured fields, keyed
/// by the canonical `model.provider` id and `.env` key var from Hermes'
/// `hermes_cli/auth.py` PROVIDER_REGISTRY (the single source of truth its own
/// setup uses). The long tail and any exotic credential layout go through the
/// raw config.yaml escape hatch and the terminal `--setup` flow.
const HERMES_PROVIDERS: &[HermesProvider] = &[
    // API-key providers — `key_env_var` is the first env var Hermes' own
    // setup writes (auth.py PROVIDER_REGISTRY priority order).
    HermesProvider {
        id: "openrouter",
        key_env_var: "OPENROUTER_API_KEY",
        needs_base_url: false,
        base_url_env_var: "OPENROUTER_BASE_URL",
    },
    HermesProvider {
        id: "openai-api",
        key_env_var: "OPENAI_API_KEY",
        needs_base_url: true,
        base_url_env_var: "OPENAI_BASE_URL",
    },
    // User-supplied OpenAI-compatible endpoint. Unlike every other provider,
    // `custom` carries BOTH its key and endpoint INLINE in config.yaml
    // (`model.api_key` / `model.base_url`) and reads no `.env` var — verified
    // against a working 0.16.0 config and `hermes_cli/auth.py`, where `custom`
    // is a canonical provider. Empty key/base-url env vars keep the `.env`
    // writer and the panel projection away; `plan_hermes_write` /
    // `project_hermes_key_and_base` special-case the inline key via
    // `hermes_inlines_api_key`.
    HermesProvider {
        id: "custom",
        key_env_var: "",
        needs_base_url: true,
        base_url_env_var: "",
    },
    HermesProvider {
        id: "anthropic",
        key_env_var: "ANTHROPIC_API_KEY",
        needs_base_url: false,
        base_url_env_var: "ANTHROPIC_BASE_URL",
    },
    HermesProvider {
        id: "gemini",
        key_env_var: "GOOGLE_API_KEY",
        needs_base_url: false,
        base_url_env_var: "GEMINI_BASE_URL",
    },
    HermesProvider {
        id: "deepseek",
        key_env_var: "DEEPSEEK_API_KEY",
        needs_base_url: false,
        base_url_env_var: "DEEPSEEK_BASE_URL",
    },
    HermesProvider {
        id: "xai",
        key_env_var: "XAI_API_KEY",
        needs_base_url: false,
        base_url_env_var: "XAI_BASE_URL",
    },
    HermesProvider {
        id: "zai",
        key_env_var: "GLM_API_KEY",
        needs_base_url: false,
        base_url_env_var: "GLM_BASE_URL",
    },
    HermesProvider {
        id: "minimax",
        key_env_var: "MINIMAX_API_KEY",
        needs_base_url: false,
        base_url_env_var: "MINIMAX_BASE_URL",
    },
    HermesProvider {
        id: "minimax-cn",
        key_env_var: "MINIMAX_CN_API_KEY",
        needs_base_url: false,
        base_url_env_var: "MINIMAX_CN_BASE_URL",
    },
    HermesProvider {
        id: "kimi-coding",
        key_env_var: "KIMI_API_KEY",
        needs_base_url: false,
        base_url_env_var: "KIMI_BASE_URL",
    },
    HermesProvider {
        id: "kimi-coding-cn",
        key_env_var: "KIMI_CN_API_KEY",
        needs_base_url: false,
        base_url_env_var: "",
    },
    HermesProvider {
        id: "nvidia",
        key_env_var: "NVIDIA_API_KEY",
        needs_base_url: false,
        base_url_env_var: "NVIDIA_BASE_URL",
    },
    HermesProvider {
        id: "alibaba",
        key_env_var: "DASHSCOPE_API_KEY",
        needs_base_url: false,
        base_url_env_var: "DASHSCOPE_BASE_URL",
    },
    HermesProvider {
        id: "alibaba-coding-plan",
        key_env_var: "ALIBABA_CODING_PLAN_API_KEY",
        needs_base_url: false,
        base_url_env_var: "ALIBABA_CODING_PLAN_BASE_URL",
    },
    HermesProvider {
        id: "copilot",
        key_env_var: "COPILOT_GITHUB_TOKEN",
        needs_base_url: false,
        base_url_env_var: "COPILOT_API_BASE_URL",
    },
    HermesProvider {
        id: "lmstudio",
        key_env_var: "LM_API_KEY",
        needs_base_url: true,
        base_url_env_var: "LM_BASE_URL",
    },
    HermesProvider {
        id: "azure-foundry",
        key_env_var: "AZURE_FOUNDRY_API_KEY",
        needs_base_url: true,
        base_url_env_var: "AZURE_FOUNDRY_BASE_URL",
    },
    HermesProvider {
        id: "stepfun",
        key_env_var: "STEPFUN_API_KEY",
        needs_base_url: false,
        base_url_env_var: "STEPFUN_BASE_URL",
    },
    HermesProvider {
        id: "arcee",
        key_env_var: "ARCEEAI_API_KEY",
        needs_base_url: false,
        base_url_env_var: "ARCEE_BASE_URL",
    },
    HermesProvider {
        id: "gmi",
        key_env_var: "GMI_API_KEY",
        needs_base_url: false,
        base_url_env_var: "GMI_BASE_URL",
    },
    HermesProvider {
        id: "huggingface",
        key_env_var: "HF_TOKEN",
        needs_base_url: false,
        base_url_env_var: "HF_BASE_URL",
    },
    HermesProvider {
        id: "kilocode",
        key_env_var: "KILOCODE_API_KEY",
        needs_base_url: false,
        base_url_env_var: "KILOCODE_BASE_URL",
    },
    HermesProvider {
        id: "opencode-zen",
        key_env_var: "OPENCODE_ZEN_API_KEY",
        needs_base_url: false,
        base_url_env_var: "OPENCODE_ZEN_BASE_URL",
    },
    HermesProvider {
        id: "opencode-go",
        key_env_var: "OPENCODE_GO_API_KEY",
        needs_base_url: false,
        base_url_env_var: "OPENCODE_GO_BASE_URL",
    },
    HermesProvider {
        id: "xiaomi",
        key_env_var: "XIAOMI_API_KEY",
        needs_base_url: false,
        base_url_env_var: "XIAOMI_BASE_URL",
    },
    HermesProvider {
        id: "tencent-tokenhub",
        key_env_var: "TOKENHUB_API_KEY",
        needs_base_url: false,
        base_url_env_var: "TOKENHUB_BASE_URL",
    },
    HermesProvider {
        id: "ollama-cloud",
        key_env_var: "OLLAMA_API_KEY",
        needs_base_url: false,
        base_url_env_var: "OLLAMA_BASE_URL",
    },
    HermesProvider {
        id: "novita",
        key_env_var: "NOVITA_API_KEY",
        needs_base_url: false,
        base_url_env_var: "NOVITA_BASE_URL",
    },
    // OAuth / external-process providers — credentials set via the terminal
    // `--setup` flow; no `.env` key var.
    HermesProvider {
        id: "nous",
        key_env_var: "",
        needs_base_url: false,
        base_url_env_var: "",
    },
    HermesProvider {
        id: "openai-codex",
        key_env_var: "",
        needs_base_url: false,
        base_url_env_var: "",
    },
    HermesProvider {
        id: "minimax-oauth",
        key_env_var: "",
        needs_base_url: false,
        base_url_env_var: "",
    },
    HermesProvider {
        id: "xai-oauth",
        key_env_var: "",
        needs_base_url: false,
        base_url_env_var: "",
    },
    HermesProvider {
        id: "qwen-oauth",
        key_env_var: "",
        needs_base_url: false,
        base_url_env_var: "",
    },
    HermesProvider {
        id: "google-gemini-cli",
        key_env_var: "",
        needs_base_url: false,
        base_url_env_var: "",
    },
    HermesProvider {
        id: "copilot-acp",
        key_env_var: "",
        needs_base_url: false,
        base_url_env_var: "",
    },
    // AWS Bedrock — credentials from the AWS SDK chain.
    HermesProvider {
        id: "bedrock",
        key_env_var: "",
        needs_base_url: false,
        base_url_env_var: "",
    },
];

fn yaml_str(value: &serde_yaml::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Read `model.provider` from an existing config.yaml document, if present. Used
/// to tell an out-of-band base URL for the *current* provider (keep) apart from a
/// stale one left by a provider the user just switched away from (clear).
fn existing_hermes_model_provider(existing: Option<&str>) -> Option<String> {
    let raw = existing?;
    let value: serde_yaml::Value = serde_yaml::from_str(raw).ok()?;
    value.get("model").and_then(|m| yaml_str(m, "provider"))
}

/// How `merge_hermes_model_config` should treat the `model.base_url` field.
pub(crate) enum BaseUrlWrite<'a> {
    /// Write this endpoint, or remove the field when the value is empty/blank.
    /// Used for providers whose base URL is user-editable in the panel.
    Set(&'a str),
    /// Leave any existing `model.base_url` untouched. Used for providers whose
    /// endpoint is not exposed in the structured fields, so a base URL set
    /// out-of-band (a proxy/Azure endpoint, etc.) survives a structured save.
    Preserve,
}

/// How `merge_hermes_model_config` should treat the inline `model.api_key`
/// (and the companion `model.api_mode`), which only the `custom` provider uses.
pub(crate) enum InlineApiKeyWrite<'a> {
    /// Inline-key provider (`custom`): write `key` (or remove the field when
    /// blank — a keyless local server). `scrub_mode` clears a stale
    /// `model.api_mode`: `true` when switching TO custom from a different
    /// provider (the prior mode must not bleed in), `false` on a custom→custom
    /// re-save so a user's raw-editor `api_mode` (e.g. `anthropic_messages` for
    /// an Anthropic-compatible proxy) survives a structured save.
    Set { key: &'a str, scrub_mode: bool },
    /// Non-inline provider (keyed/OAuth/AWS): scrub any stale inline
    /// `model.api_key` / `model.api_mode` left over from a previous `custom`
    /// endpoint so it can't bleed into the newly selected provider — mirroring
    /// Hermes' own `auth.py` cleanup on a provider switch.
    Clear,
}

/// Structured Hermes config update from the settings UI.
#[derive(Debug, Clone)]
pub(crate) struct HermesConfigUpdate {
    pub provider: String,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    /// When present, the raw config.yaml is validated and written verbatim
    /// (advanced mode), bypassing the structured `model:` merge.
    pub raw_config_yaml: Option<String>,
}

/// Whether to skip tightening Hermes file/dir permissions, mirroring the opt-outs
/// Hermes itself honors: containerized / managed deployments (Docker/Podman/LXC/
/// Kubernetes volume mounts with mapped UIDs, etc.) where forcing `0700`/`0600`
/// breaks the multi-process access model. Mirrors Hermes 0.16.0 `_is_container`:
/// the `HERMES_CONTAINER` / `HERMES_SKIP_CHMOD` env opt-outs, the Docker
/// (`/.dockerenv`) and Podman (`/run/.containerenv`) markers, and a
/// docker/lxc/kubepods marker in `/proc/1/cgroup`.
#[cfg(unix)]
fn hermes_skip_chmod() -> bool {
    // Match Hermes' Python truthiness (`os.environ.get(...)` — an empty value is
    // falsy): only a NON-EMPTY opt-out enables skip, so a blank `HERMES_SKIP_CHMOD=`
    // does not (and veryagent still performs the 0644→0600 repair Hermes would).
    let truthy = |key: &str| std::env::var(key).map(|v| !v.is_empty()).unwrap_or(false);
    if truthy("HERMES_CONTAINER")
        || truthy("HERMES_SKIP_CHMOD")
        || Path::new("/.dockerenv").exists()
        || Path::new("/run/.containerenv").exists()
    {
        return true;
    }
    fs::read_to_string("/proc/1/cgroup")
        .map(|cgroup| {
            cgroup.contains("docker") || cgroup.contains("lxc") || cgroup.contains("kubepods")
        })
        .unwrap_or(false)
}

/// Create the Hermes home directory if needed. On Unix, tighten it to
/// `HERMES_HOME_MODE` (or `0700`) **only when veryagent just created it** and Hermes
/// itself would chmod (not a container/managed deployment). An existing
/// `HERMES_HOME` is left untouched — it may be a NixOS-managed `0750`, a
/// UID-mapped Docker volume, or otherwise deliberately group-accessible, and
/// revoking that would break other Hermes users/processes.
pub(crate) fn ensure_hermes_home_secure(home: &Path) -> Result<(), AcpError> {
    #[cfg(unix)]
    let preexisting = home.exists();
    fs::create_dir_all(home)
        .map_err(|e| AcpError::protocol(format!("create hermes directory failed: {e}")))?;
    #[cfg(unix)]
    if !preexisting && !hermes_skip_chmod() {
        use std::os::unix::fs::PermissionsExt;
        let mode = parse_hermes_home_mode(std::env::var("HERMES_HOME_MODE").ok().as_deref());
        // Best-effort: a chmod hiccup must not block saving the config.
        let _ = fs::set_permissions(home, fs::Permissions::from_mode(mode));
    }
    Ok(())
}

/// Write a Hermes secret file (`.env` / `config.yaml`).
///
/// A brand-new secret — a path whose resolved target does not exist yet, whether
/// `path` itself is absent or a symlink to a missing target — is created
/// owner-only (`0600` on Unix) so it is never world-readable under the process
/// umask, the one real exposure for a first-time veryagent-driven setup. An EXISTING
/// target is written through in place, which preserves everything that identifies
/// it: its inode, mode, owner/group, POSIX ACL and xattrs, and any symlink (a
/// dotfile-manager or secret-manager `~/.hermes/.env` keeps pointing at its real
/// target). This deliberately favors preserving a managed/linked layout over an
/// atomic temp+rename replace — a rename would drop the symlink and the inode's
/// owner/ACL/xattrs, and on Windows would swap the file's security descriptor for
/// the parent directory's. It matches Hermes' own model (config.py `_secure_dir`
/// is a Windows no-op; file chmod is Unix-only) and the prior baseline. A crash
/// during the brief write window is recoverable by re-saving. `label` names the
/// file for error messages.
pub(crate) fn write_hermes_secret_file(
    path: &Path,
    contents: &str,
    label: &str,
) -> Result<(), AcpError> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        // `metadata` FOLLOWS symlinks, so this is true when the resolved target
        // does not exist yet — a genuinely fresh path OR a symlink whose target
        // is missing (e.g. `~/.hermes/.env -> /vault/hermes.env`). Creating with
        // `O_CREAT` likewise follows the symlink, so the new secret lands at the
        // real target with owner-only `0600` instead of the umask default
        // (`0644`). An existing resolved target is written through in place below.
        if fs::metadata(path).is_err() {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(path)
                .map_err(|e| AcpError::protocol(format!("create hermes {label} failed: {e}")))?;
            return file
                .write_all(contents.as_bytes())
                .map_err(|e| AcpError::protocol(format!("write hermes {label} failed: {e}")));
        }
    }
    // Existing target (or non-Unix): write through in place, preserving the
    // target's identity (inode, owner/group, ACL, xattrs, and any symlink).
    fs::write(path, contents)
        .map_err(|e| AcpError::protocol(format!("write hermes {label} failed: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Repair an accidentally WORLD-accessible secret (e.g. a `0644` left by an
        // older veryagent build or by the pre-fix dangling-symlink path) back to
        // owner-only `0600`: a world-readable API key is a leak, and tightening it
        // to `0640` would still expose it to a broad group like `staff`. A file
        // with no "other" bits — including a deliberately group-shared managed
        // `0640` — is left untouched, and the container/managed chmod opt-out is
        // honored. Best-effort: never fail the save on a chmod hiccup.
        if !hermes_skip_chmod() {
            if let Ok(meta) = fs::metadata(path) {
                if meta.permissions().mode() & 0o007 != 0 {
                    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
                }
            }
        }
    }
    Ok(())
}

/// Write a Hermes config update to `~/.hermes/.env` (the active provider's API
/// key) and `~/.hermes/config.yaml` (the `model:` section, or a verbatim raw
/// document in advanced mode).
pub(crate) fn acp_update_hermes_config_core(
    update: HermesConfigUpdate,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    let HermesConfigUpdate {
        provider,
        api_key,
        model,
        base_url,
        raw_config_yaml,
    } = update;

    let home = hermes_home_dir();
    ensure_hermes_home_secure(&home)?;

    // Build + validate everything BEFORE any write, so an invalid document or a
    // crafted key never half-applies (the secret in particular).
    let config_path = hermes_config_yaml_path();
    let existing = if raw_config_yaml.is_none() {
        fs::read_to_string(&config_path).ok()
    } else {
        None
    };
    let model_trimmed = model.as_deref().map(str::trim).unwrap_or_default();
    let (config_yaml, env_updates) = plan_hermes_write(
        &provider,
        api_key.as_deref(),
        model_trimmed,
        base_url.as_deref(),
        raw_config_yaml.as_deref(),
        existing.as_deref(),
    )?;

    // Write config.yaml first, then `.env` — a config-write failure must never
    // leave the stored credential changed. Both are owner-only (they can carry
    // secrets: the `.env` key, and a raw config.yaml in advanced mode).
    write_hermes_secret_file(&config_path, &config_yaml, "config.yaml")?;
    if !env_updates.is_empty() {
        let env_path = hermes_env_path();
        let existing_env = fs::read_to_string(&env_path).unwrap_or_default();
        let updates: Vec<(&str, &str)> =
            env_updates.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let patched = patch_env_text(&existing_env, &updates);
        write_hermes_secret_file(&env_path, &patched, ".env")?;
    }

    emit_acp_agents_updated(emitter, "config_updated", Some(AgentType::Hermes));
    Ok(())
}

/// The result of planning a Hermes save: the `config.yaml` content to write and
/// the ordered list of `.env` `(var name, value)` updates to apply (empty when
/// nothing in `.env` changes).
type HermesWritePlan = (String, Vec<(&'static str, String)>);

/// Compare two base URLs for equality, ignoring a trailing slash — every Hermes
/// endpoint rstrips `/`, so `https://x/v1` and `https://x/v1/` are the same host
/// and must not churn a managed/symlinked `.env` on every launch. Used for the
/// reconcile decision ONLY; the value written to `.env` stays verbatim.
fn base_url_eq(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

/// Reconcile `~/.hermes/.env`'s base-URL variable with `config.yaml`'s
/// `model.base_url` for the active provider, right before launching Hermes, so
/// auxiliary tasks and the main loop hit the same endpoint (see
/// `plan_hermes_base_url_reconcile`). Best-effort: a failure here must never
/// block a launch, so the result is logged and swallowed.
///
/// Note: for `openai-api` this sets `OPENAI_BASE_URL`, which makes Hermes log a
/// one-time "OPENAI_BASE_URL is set but provider is not custom" warning. That is
/// a false positive — `OPENAI_BASE_URL` IS the correct base-URL var for
/// `openai-api` — so do not "fix" it by dropping the var.
/// Resolve the Hermes home a launch with `runtime_env` will actually use, so
/// reconcile patches the same `.env` the launched process reads.
///
/// When the agent's `env_json` sets `HERMES_HOME` it lands in `runtime_env`,
/// which `merge_agent_env` gives highest precedence — so it *replaces* the
/// parent's value in the child. We must resolve that override exactly as the
/// launched Hermes' own `get_hermes_home` does: trim it; a non-empty value is
/// used VERBATIM (`Path(val)` — Hermes does NOT expand `~`); a blank value falls
/// back to the default `~/.hermes` (it does NOT re-inherit the parent). With no
/// override the child inherits the parent env, so defer to `hermes_home_dir()`
/// (veryagent's existing resolution, shared with the settings panel).
fn hermes_home_for_launch(runtime_env: &BTreeMap<String, String>) -> PathBuf {
    match runtime_env.get("HERMES_HOME") {
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                home_dir_or_default().join(".hermes")
            } else {
                PathBuf::from(trimmed)
            }
        }
        None => hermes_home_dir(),
    }
}

pub(crate) fn reconcile_hermes_runtime_env(runtime_env: &BTreeMap<String, String>) {
    if let Err(err) = reconcile_hermes_runtime_env_in(&hermes_home_for_launch(runtime_env)) {
        tracing::warn!("[ACP][Hermes] base_url reconcile skipped: {err}");
    }
}

pub(crate) fn load_agent_local_config_json(agent_type: AgentType) -> Option<String> {
    if agent_type == AgentType::Codex {
        return load_codex_local_config_json();
    }
    if agent_type == AgentType::Cline {
        return load_cline_local_config_json();
    }
    if agent_type == AgentType::KimiCode {
        return load_kimi_code_config_json();
    }

    let path = agent_local_config_path(agent_type)?;
    if !path.exists() {
        return None;
    }

    let raw = fs::read_to_string(path).ok()?;
    let parsed = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    if !parsed.is_object() {
        return None;
    }
    serde_json::to_string_pretty(&parsed).ok()
}

pub(crate) fn skill_storage_spec(agent_type: AgentType) -> Option<SkillStorageSpec> {
    match agent_type {
        AgentType::ClaudeCode => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOnly,
            global_dirs: vec![home_dir_or_default().join(".claude").join("skills")],
            project_rel_dirs: vec![".claude/skills"],
        }),
        AgentType::Codex => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOrMarkdownFile,
            global_dirs: vec![
                codex_home_dir().join("skills"),
                // `.system` is where Codex CLI stores its own bundled
                // skills (imagegen, skill-creator, etc.). The directory
                // name is a Codex convention, not a stable contract —
                // if Codex renames it we'll silently stop listing them.
                // `is_read_only_skill_path` mirrors this path to prevent
                // edit/delete from clobbering CLI assets.
                codex_home_dir().join("skills").join(".system"),
                home_dir_or_default().join(".agents").join("skills"),
            ],
            project_rel_dirs: vec![".codex/skills", ".agents/skills"],
        }),
        AgentType::OpenCode => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOnly,
            // OpenCode is a "universal" agent for the `skills` CLI (its
            // skillsDir is `.agents/skills`): a global `skills add` writes the
            // real skill into the shared `~/.agents/skills` store and does NOT
            // create a `~/.config/opencode/skills` symlink. OpenCode reads both
            // locations, so probe both — otherwise CLI-installed skills are
            // invisible here and in Settings → Skills.
            global_dirs: vec![
                home_dir_or_default()
                    .join(".config")
                    .join("opencode")
                    .join("skills"),
                home_dir_or_default().join(".agents").join("skills"),
            ],
            project_rel_dirs: vec![".agents/skills", ".opencode/skills"],
        }),
        AgentType::Gemini => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOnly,
            global_dirs: vec![
                home_dir_or_default().join(".gemini").join("skills"),
                home_dir_or_default().join(".agents").join("skills"),
            ],
            project_rel_dirs: vec![".gemini/skills", ".agents/skills"],
        }),
        AgentType::OpenClaw => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOnly,
            global_dirs: vec![home_dir_or_default().join(".openclaw").join("skills")],
            project_rel_dirs: vec!["skills"],
        }),
        AgentType::Cline => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOnly,
            global_dirs: vec![
                home_dir_or_default().join(".agents").join("skills"),
                home_dir_or_default().join(".cline").join("skills"),
            ],
            project_rel_dirs: vec![
                ".agents/skills",
                ".cline/skills",
                ".clinerules/skills",
                ".claude/skills",
            ],
        }),
        AgentType::Hermes => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOnly,
            global_dirs: vec![hermes_home_dir().join("skills")],
            project_rel_dirs: vec![],
        }),
        // CodeBuddy is a Claude Code derivative: same `skills` directory
        // layout, under `~/.codebuddy` instead of `~/.claude`.
        AgentType::CodeBuddy => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOnly,
            global_dirs: vec![home_dir_or_default().join(".codebuddy").join("skills")],
            project_rel_dirs: vec![".codebuddy/skills"],
        }),
        // Kimi Code reads skills from `<KIMI_CODE_HOME>/skills/` (default
        // `~/.kimi-code/skills/`) and project-local `<root>/.kimi-code/skills/`.
        AgentType::KimiCode => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOnly,
            global_dirs: vec![
                crate::parsers::kimi_code::resolve_kimi_code_home_dir().join("skills"),
            ],
            project_rel_dirs: vec![".kimi-code/skills"],
        }),
        // pi auto-loads skills from `~/.pi/agent/skills` and the shared
        // `~/.agents/skills` store (both global), plus project-local
        // `.pi/skills` / `.agents/skills` once the workspace is trusted (veryagent
        // seeds that trust on connect). `~/.pi/agent/skills` additionally
        // accepts standalone `.md` files, so this mirrors Codex's spec shape.
        // The pi-native dir comes first so toggling pi links into its own dir
        // without cross-agent side effects on the shared store.
        AgentType::Pi => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOrMarkdownFile,
            global_dirs: vec![
                pi_agent_dir().join("skills"),
                home_dir_or_default().join(".agents").join("skills"),
            ],
            project_rel_dirs: vec![".pi/skills", ".agents/skills"],
        }),
        // MiMo Code is an OpenCode fork; it shares the same skills directory
        // convention. Return None for now — can be enabled when MiMo Code's
        // skill system is validated.
        AgentType::MimoCode => None,
        // Command Code uses its own `.commandcode/skills` / `~/.commandcode/
        // skills` layout, which is not compatible with the shared skill store.
        AgentType::CommandCode => Some(SkillStorageSpec {
            kind: SkillStorageKind::SkillDirectoryOnly,
            global_dirs: vec![home_dir_or_default().join(".commandcode").join("skills")],
            project_rel_dirs: vec![],
        }),
    }
}

pub(crate) fn validate_skill_id(raw: &str) -> Result<String, AcpError> {
    let id = raw.trim();
    if id.is_empty() {
        return Err(AcpError::protocol("skill id cannot be empty"));
    }
    if id.starts_with('.') {
        return Err(AcpError::protocol("skill id cannot start with a dot (.)"));
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(AcpError::protocol(
            "skill id cannot contain path separators",
        ));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(AcpError::protocol(
            "skill id can only include letters, numbers, '-', '_' and '.'",
        ));
    }
    Ok(id.to_string())
}

pub(crate) fn scoped_skill_dirs(
    agent_type: AgentType,
    scope: AgentSkillScope,
    workspace_path: Option<&str>,
) -> Result<Vec<PathBuf>, AcpError> {
    let spec = skill_storage_spec(agent_type).ok_or_else(|| {
        AcpError::protocol(format!(
            "{agent_type} skills are not supported in Settings yet"
        ))
    })?;

    match scope {
        AgentSkillScope::Global => Ok(spec.global_dirs),
        AgentSkillScope::Project => {
            let workspace = workspace_path
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .ok_or_else(|| {
                    AcpError::protocol("workspace_path is required for project scoped skills")
                })?;
            Ok(spec
                .project_rel_dirs
                .iter()
                .map(|relative| PathBuf::from(workspace).join(relative))
                .collect())
        }
    }
}

pub(crate) fn preferred_scope_skill_dir(
    agent_type: AgentType,
    scope: AgentSkillScope,
    workspace_path: Option<&str>,
) -> Result<PathBuf, AcpError> {
    let dirs = scoped_skill_dirs(agent_type, scope, workspace_path)?;
    dirs.into_iter()
        .next()
        .ok_or_else(|| AcpError::protocol("no skill directory resolved for this agent"))
}

/// Symlink-safe removal: if `path` is a symlink (to a file or directory),
/// only the link itself is removed. Otherwise directories are removed
/// recursively and files are unlinked. This prevents `remove_dir_all` from
/// accidentally wiping the contents of a symlink target — which is critical
/// for the Experts feature where agent skill dirs may contain symlinks into
/// the central `~/.veryagent/skills/` store.
pub(crate) fn remove_skill_entry(path: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(path)?;
    let file_type = meta.file_type();

    #[cfg(windows)]
    let is_reparse_point = {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    };

    if file_type.is_symlink() {
        #[cfg(windows)]
        {
            // Directory symlinks on Windows require remove_dir.
            return match fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
                    fs::remove_dir(path)
                }
                Err(err) => Err(err),
            };
        }

        #[cfg(not(windows))]
        {
            return fs::remove_file(path);
        }
    }

    if file_type.is_dir() {
        #[cfg(windows)]
        {
            // Junctions are directory reparse points; remove only the link.
            if is_reparse_point {
                return fs::remove_dir(path);
            }
        }
        return fs::remove_dir_all(path);
    }

    fs::remove_file(path)
}

pub(crate) fn list_skills_from_dir(
    scope: AgentSkillScope,
    dir: &Path,
    kind: SkillStorageKind,
) -> Result<Vec<AgentSkillItem>, AcpError> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(dir)
        .map_err(|e| AcpError::protocol(format!("failed to read skills directory: {e}")))?;

    let mut by_id: BTreeMap<String, AgentSkillItem> = BTreeMap::new();
    for entry in entries {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        let file_name = entry.file_name();
        let id = file_name.to_string_lossy().to_string();

        if path.is_dir()
            && matches!(
                kind,
                SkillStorageKind::SkillDirectoryOnly
                    | SkillStorageKind::SkillDirectoryOrMarkdownFile
            )
        {
            let skill_doc = path.join("SKILL.md");
            if !skill_doc.is_file() {
                continue;
            }
            by_id.insert(
                id.clone(),
                build_skill_item(id, scope, AgentSkillLayout::SkillDirectory, path),
            );
            continue;
        }

        if path.is_file()
            && matches!(kind, SkillStorageKind::SkillDirectoryOrMarkdownFile)
            && is_markdown_file(&path)
        {
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(str::to_string)
                .unwrap_or_else(|| id.clone());
            if by_id.contains_key(&stem) {
                continue;
            }
            by_id.insert(
                stem.clone(),
                build_skill_item(stem, scope, AgentSkillLayout::MarkdownFile, path),
            );
        }
    }

    Ok(by_id.into_values().collect())
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentRuntimeConfig {
    #[serde(default, alias = "api_base_url")]
    api_base_url: Option<String>,
    #[serde(default, alias = "api_key")]
    api_key: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
}

pub(crate) fn build_runtime_env_from_setting(
    agent_type: AgentType,
    setting: Option<&crate::db::entities::agent_setting::Model>,
    local_config_json: Option<&str>,
) -> BTreeMap<String, String> {
    let mut merged = setting
        .and_then(|model| model.env_json.as_deref())
        .and_then(|raw| serde_json::from_str::<BTreeMap<String, String>>(raw).ok())
        .unwrap_or_default();

    let Some(raw_config_json) = local_config_json else {
        return merged;
    };
    let Ok(config) = serde_json::from_str::<AgentRuntimeConfig>(raw_config_json) else {
        return merged;
    };

    for (key, value) in config.env {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        merged.insert(key, trimmed.to_string());
    }

    let (api_base_url_key, api_key_key, model_key) = agent_env_keys(agent_type);
    if let Some(value) = trim_non_empty(config.api_base_url) {
        merged.insert(api_base_url_key.to_string(), value);
    }
    if let Some(value) = trim_non_empty(config.api_key) {
        merged.insert(api_key_key.to_string(), value);
    }
    if agent_type != AgentType::ClaudeCode {
        if let Some(value) = trim_non_empty(config.model) {
            merged.insert(model_key.to_string(), value);
        }
    }

    merged
}

/// Resolve model provider credentials into runtime env vars if `model_provider_id` is set.
pub(crate) async fn apply_model_provider_env(
    agent_type: AgentType,
    setting: Option<&crate::db::entities::agent_setting::Model>,
    runtime_env: &mut BTreeMap<String, String>,
    conn: &sea_orm::DatabaseConnection,
) {
    let provider_id = match setting.and_then(|s| s.model_provider_id) {
        Some(id) => id,
        None => return,
    };
    let provider = match model_provider_service::get_by_id(conn, provider_id).await {
        Ok(Some(p)) => p,
        _ => return,
    };
    let (url_key, key_key, model_key) = agent_env_keys(agent_type);
    // Pi authenticates the managed A计划 provider via models.json/auth.json,
    // not process env. Injecting OPENAI_API_KEY unlocks pi's entire built-in
    // OpenAI catalog (~40 placeholder models) in the chat picker even though
    // they are not configured for A计划 and cannot be used.
    //
    // CodeBuddy is the same class of problem: A计划 credentials belong in
    // ~/.codebuddy/models.json as additive custom models. Writing them into
    // CODEBUDDY_BASE_URL / CODEBUDDY_API_KEY hijacks the whole agent onto the
    // gateway and breaks native China/overseas Tencent models.
    //
    // Command Code (cmdc) authenticates against its own account (cmdc login)
    // and resolves models from its built-in provider catalog; it ignores
    // OPENAI_* process env entirely (verified empirically), so injecting them
    // is a no-op that would falsely suggest the bound provider took effect.
    let inject_openai_compat_env = !matches!(
        agent_type,
        AgentType::Pi | AgentType::CodeBuddy | AgentType::MimoCode
    );
    if inject_openai_compat_env && !provider.api_url.trim().is_empty() {
        // Agents that append `/chat/completions` themselves need a `/v1` base.
        // Shared provider rows are often bare host roots (`http://host:port`).
        let api_url = match agent_type {
            AgentType::KimiCode
            | AgentType::Codex
            | AgentType::OpenClaw
            | AgentType::Cline
            | AgentType::Hermes => normalize_openai_compatible_base_url(&provider.api_url),
            _ => provider.api_url.clone(),
        };
        runtime_env.insert(url_key.to_string(), api_url);
    }
    if inject_openai_compat_env && !provider.api_key.trim().is_empty() {
        runtime_env.insert(key_key.to_string(), provider.api_key.clone());
    }
    if agent_type == AgentType::CodeBuddy {
        // Scrub leftover "replace native endpoint" knobs from older binds so
        // Tencent built-ins work again alongside A计划 custom models.
        runtime_env.remove("CODEBUDDY_BASE_URL");
        runtime_env.remove("CODEBUDDY_DISABLE_BUILTIN_MODELS");
        // Keep CODEBUDDY_INTERNET_ENVIRONMENT / CODEBUDDY_API_KEY if present —
        // those are the native China/overseas/iOA path, independent of A计划.
        let model = runtime_env
            .get(model_key)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if let Some(ref model) = model {
            // Optional default selection + Claude-derived custom option label.
            runtime_env.insert("ANTHROPIC_CUSTOM_MODEL_OPTION".to_string(), model.clone());
            runtime_env.insert(
                "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME".to_string(),
                model.clone(),
            );
        }
        // Additive custom model in models.json (own url/apiKey). Native models
        // stay available from CodeBuddy's built-in catalog + region auth.
        if let Err(e) = write_codebuddy_managed_provider(
            &provider.api_url,
            &provider.api_key,
            model.as_deref().unwrap_or(""),
            &[],
        ) {
            tracing::warn!(
                "[CodeBuddy] write managed models.json for shared model provider failed: {e}"
            );
        }
        // Mirror the key into ~/.codebuddy/settings.json env so CodeBuddy's
        // ACP startup passes its global auth check (models.json apiKey alone
        // is per-model and does not satisfy the env-based auth probe).
        if !provider.api_key.trim().is_empty() {
            if let Err(e) = crate::commands::acp::codebuddy_config::persist_codebuddy_settings_env(
                &provider.api_key,
            ) {
                tracing::warn!(
                    "[CodeBuddy] write settings.json env for shared model provider failed: {e}"
                );
            }
        }
    }

    // OpenClaw's gateway owns inference. Keep openclaw.json in sync even when
    // the user bound a provider before this write path existed (no re-save).
    if agent_type == AgentType::OpenClaw {
        let model = runtime_env
            .get(model_key)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                let agent_type_str = serde_json::to_value(&agent_type)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_else(|| agent_type.to_string());
                extract_agent_model(provider.model.as_deref(), &agent_type_str)
            });
        if let Err(e) = write_openclaw_managed_provider(
            &provider.api_url,
            &provider.api_key,
            model.as_deref(),
        ) {
            tracing::warn!(
                "[OpenClaw] write managed provider into openclaw.json failed: {e}"
            );
        }
    }

    // Pi / OpenCode / MiMo Code: refresh the managed `veryagent` provider on
    // every session start so credentials + the agent-selected model stay
    // current. Pass an empty catalog — chat should only show the configured
    // model, not the entire gateway /models dump.
    if matches!(agent_type, AgentType::Pi | AgentType::OpenCode | AgentType::MimoCode) {
        let model = runtime_env
            .get(model_key)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let empty_catalog: Vec<String> = Vec::new();
        let result = match agent_type {
            AgentType::Pi => write_pi_managed_provider(
                &provider.api_url,
                &provider.api_key,
                model.as_deref().unwrap_or(""),
                &empty_catalog,
            ),
            AgentType::MimoCode => write_mimo_managed_provider(
                &provider.api_url,
                &provider.api_key,
                model.as_deref(),
                &empty_catalog,
            ),
            _ => write_opencode_managed_provider(
                &provider.api_url,
                &provider.api_key,
                model.as_deref(),
                &empty_catalog,
            ),
        };
        if let Err(e) = result {
            tracing::warn!(
                "[{agent_type}] write managed provider for shared model provider failed: {e}"
            );
        }
    }

    // After writing Pi's managed files, scrub any leftover OPENAI_* credentials
    // from env_json so the spawned pi process cannot unlock built-in openai/*.
    // Keep OPENAI_MODEL in env_json for settings UI bookkeeping only — strip it
    // from the runtime process as well; defaultModel lives in settings.json.
    if agent_type == AgentType::Pi {
        runtime_env.remove("OPENAI_BASE_URL");
        runtime_env.remove("OPENAI_API_KEY");
        runtime_env.remove("OPENAI_MODEL");
    }

    // ── Hermes: refresh config files on every startup ──────────────────
    //
    // Hermes reads credentials from ~/.hermes/config.yaml and ~/.hermes/.env,
    // not from runtime env. The cascade path writes these files on save, but
    // we also refresh them here on every startup so that a session started
    // after a provider change (or a config file cleanup) always picks up the
    // current credentials. Mirrors the Pi/OpenCode/MiMoCode refresh pattern.
    if agent_type == AgentType::Hermes {
        tracing::info!(
            "[Hermes] refresh config on startup: provider={}, api_url={}, model={}",
            provider.name,
            provider.api_url,
            runtime_env.get(model_key).map(|s| s.as_str()).unwrap_or("(none)"),
        );
        let model = runtime_env
            .get(model_key)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let mut model_env: BTreeMap<String, Option<String>> = BTreeMap::new();
        model_env.insert("OPENAI_MODEL".to_string(), model);
        // Use the same normalized base URL format as the cascade path.
        let hermes_base_url = normalize_openai_compatible_base_url(&provider.api_url);
        if let Err(e) = cascade_update_agent_config(
            agent_type,
            &hermes_base_url,
            &provider.api_key,
            &model_env,
            &CodexModelAction::NoOp,
        )
        .await
        {
            tracing::warn!(
                "[Hermes] refresh config on startup failed: {e}"
            );
        }
    }

    // ── Codex: local proxy for developer → system role conversion ────────
    //
    // Codex sends messages with `role: "developer"` (Responses API format),
    // but many third-party model providers only recognise `role: "system"`.
    // We start a lightweight local HTTP proxy that sits between Codex and
    // the provider, rewriting `developer` → `system` before forwarding.
    //
    // The proxy is a process-level singleton: once started, it is reused
    // across all Codex sessions. If the upstream URL or API key changes,
    // the old proxy is shut down and a new one is started.
    if agent_type == AgentType::Codex && inject_openai_compat_env {
        let upstream = runtime_env.get(url_key).map(|s| s.as_str()).unwrap_or("");
        let key = runtime_env.get(key_key).map(|s| s.as_str()).unwrap_or("");
        if !upstream.is_empty() && !key.is_empty() {
            let fingerprint = format!("{upstream}|{key}");

            // Read the model name from config.toml so the proxy can advertise
            // it via /v1/models and suppress Codex's metadata warning.
            let model_name = crate::commands::acp::codex_config::read_codex_model_name();
            // Read the provider model ID from runtime_env (set by user in settings).
            // Fall back to reading from config.toml's env section.
            let fallback_model_id = crate::commands::acp::codex_config::read_codex_env_value("CODEX_PROVIDER_MODEL_ID");
            let provider_model_id = runtime_env
                .get("CODEX_PROVIDER_MODEL_ID")
                .map(|s| s.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| fallback_model_id.as_deref().filter(|s| !s.is_empty()));
            if let Some(pid) = provider_model_id {
                tracing::info!("[Codex] provider model ID mapping: Codex model → {pid}");
            }

            // Check if the proxy is already running with the correct upstream.
            // Drop the lock before any .await to avoid !Send issues.
            let (needs_restart, existing_port) = {
                let mut guards = CODECX_PROXY_GUARD
                    .get_or_init(|| Mutex::new(None))
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                match guards.as_ref() {
                    Some((fp, guard)) if fp == &fingerprint => (false, Some(guard.port())),
                    _ => {
                        // Shut down the old proxy if one exists.
                        guards.take();
                        (true, None)
                    }
                }
            };

            if needs_restart {
                match crate::acp::provider_proxy::start_proxy(upstream, key, model_name.as_deref(), provider_model_id).await {
                    Ok(guard) => {
                        let proxy_port = guard.port();
                        let proxy_url = format!("http://127.0.0.1:{proxy_port}/v1");
                        runtime_env.insert(url_key.to_string(), proxy_url);
                        // Store the new guard.
                        let mut guards = CODECX_PROXY_GUARD
                            .get_or_init(|| Mutex::new(None))
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        guards.replace((fingerprint, guard));
                        tracing::info!(
                            "[Codex] started role-conversion proxy on port {proxy_port}"
                        );
                    }
                    Err(e) => {
                        tracing::error!("[Codex] failed to start role-conversion proxy: {e}");
                    }
                }
            } else if let Some(port) = existing_port {
                let proxy_url = format!("http://127.0.0.1:{port}/v1");
                runtime_env.insert(url_key.to_string(), proxy_url);
            }

            // Also rewrite the base_url in ~/.codex/config.toml so Codex reads
            // the proxy URL from its config file (Codex uses config.toml rather
            // than OPENAI_BASE_URL env var to resolve the provider endpoint).
            let proxy_url = runtime_env
                .get(url_key)
                .map(|s| s.to_string())
                .unwrap_or_default();
            if !proxy_url.is_empty() {
                rewrite_codex_provider_base_url(&proxy_url);
            }

            // ── codex-acp 1.1.0 custom-provider wiring ─────────────────────
            //
            // codex-acp resolves its model provider at session creation:
            //   - new sessions: `MODEL_PROVIDER` env → threadStart modelProvider
            //   - config: `CODEX_CONFIG` env JSON is merged into every session
            //     config, so `model_providers.<name>` defined here reaches the
            //     Codex app server even when `~/.codex/config.toml` is a
            //     template-rendered `[provider]` layout that Codex ignores.
            //
            // Without these, codex-acp falls back to the built-in `openai`
            // provider and sends the gateway API key to api.openai.com → 401.
            let codex_provider_name = "veryagent";
            runtime_env.insert(
                "MODEL_PROVIDER".to_string(),
                codex_provider_name.to_string(),
            );
            let mut codex_config = serde_json::Map::new();
            let mut provider_def = serde_json::Map::new();
            provider_def.insert(
                "name".to_string(),
                serde_json::Value::String(codex_provider_name.to_string()),
            );
            provider_def.insert(
                "base_url".to_string(),
                serde_json::Value::String(proxy_url.clone()),
            );
            // Codex reads the API key from this process env var. VeryAgent
            // injects `OPENAI_API_KEY` (= key_key) into the codex-acp process
            // env earlier in this function, and codex-acp forwards its own
            // process env to the codex app server it spawns.
            provider_def.insert(
                "env_key".to_string(),
                serde_json::Value::String(key_key.to_string()),
            );
            // Codex 2026+ only supports the Responses API (chat was removed).
            provider_def.insert(
                "wire_api".to_string(),
                serde_json::Value::String("responses".to_string()),
            );
            let mut providers = serde_json::Map::new();
            providers.insert(
                codex_provider_name.to_string(),
                serde_json::Value::Object(provider_def),
            );
            codex_config.insert(
                "model_providers".to_string(),
                serde_json::Value::Object(providers),
            );
            runtime_env.insert(
                "CODEX_CONFIG".to_string(),
                serde_json::to_string(&serde_json::Value::Object(codex_config))
                    .unwrap_or_default(),
            );
            tracing::info!(
                "[Codex] wired codex-acp custom provider: MODEL_PROVIDER={}, CODEX_CONFIG base_url={}",
                codex_provider_name,
                proxy_url
            );
        }
    }
}

/// Claude Code provider-model JSON keys → ANTHROPIC_*_MODEL env var names.
const CLAUDE_MODEL_KEY_MAP: &[(&str, &str)] = &[
    ("main", "ANTHROPIC_MODEL"),
    ("reasoning", "ANTHROPIC_REASONING_MODEL"),
    ("haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    ("sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL"),
    ("opus", "ANTHROPIC_DEFAULT_OPUS_MODEL"),
    // The custom model option trio appends one entry to the in-session /model
    // picker (a model the provider's gateway serves). Carried by the provider's
    // model JSON like the five model fields, so binding/cascade pushes it too.
    ("customOption", "ANTHROPIC_CUSTOM_MODEL_OPTION"),
    ("customOptionName", "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME"),
    (
        "customOptionDescription",
        "ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION",
    ),
];

/// Parse the model field stored on a model_provider into the env-var actions to
/// apply on the dependent agent's `env_json` / local config file.
///
/// The provider's model field is authoritative: every env key relevant to the
/// agent type is returned, with `Some(value)` meaning "set" and `None` meaning
/// "clear". This lets the caller overwrite even when the provider's value is
/// empty.
///
/// - Claude: returns one entry per `CLAUDE_MODEL_KEY_MAP` row — the five
///   ANTHROPIC_*_MODEL fields plus the ANTHROPIC_CUSTOM_MODEL_OPTION trio. Each
///   entry is `None` when the provider's JSON omits that key or has an empty
///   value.
/// - Gemini: returns `GEMINI_MODEL`.
/// - Codex: returns `OPENAI_MODEL` so the provider can override env_json (the
///   root `model` in `config.toml` is handled separately by
///   `provider_codex_model_action`).
/// - Others: returns `OPENAI_MODEL`.
pub(crate) fn parse_provider_model(
    agent_type: AgentType,
    raw: Option<&str>,
) -> BTreeMap<String, Option<String>> {
    let mut out: BTreeMap<String, Option<String>> = BTreeMap::new();
    let trimmed_raw = raw.map(str::trim).filter(|s| !s.is_empty());
    match agent_type {
        AgentType::ClaudeCode => {
            let parsed = trimmed_raw
                .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
                .and_then(|v| v.as_object().cloned());
            if parsed.is_some() {
                // JSON object format: {"main": "...", "reasoning": "...", ...}
                for (key, env_name) in CLAUDE_MODEL_KEY_MAP {
                    let value = parsed
                        .as_ref()
                        .and_then(|obj| obj.get(*key))
                        .and_then(|x| x.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string);
                    out.insert((*env_name).to_string(), value);
                }
            } else if let Some(raw) = trimmed_raw {
                // Plain string: use as the main model (ANTHROPIC_MODEL)
                out.insert("ANTHROPIC_MODEL".to_string(), Some(raw.to_string()));
            }
        }
        AgentType::Gemini => {
            out.insert("GEMINI_MODEL".to_string(), trimmed_raw.map(str::to_string));
        }
        // Kimi reads its model name from KIMI_MODEL_NAME (the `KIMI_MODEL_*`
        // family), not OPENAI_MODEL — see `agent_env_keys`.
        AgentType::KimiCode => {
            out.insert(
                "KIMI_MODEL_NAME".to_string(),
                trimmed_raw.map(str::to_string),
            );
        }
        AgentType::CodeBuddy => {
            out.insert(
                "CODEBUDDY_MODEL".to_string(),
                trimmed_raw.map(str::to_string),
            );
        }
        _ => {
            out.insert("OPENAI_MODEL".to_string(), trimmed_raw.map(str::to_string));
        }
    }
    out
}

/// Action to apply to the Codex `config.toml` root `model` key.
pub(crate) enum CodexModelAction {
    /// Not a Codex agent — leave the toml untouched.
    NoOp,
    /// Set the `model` key to this value.
    Set(String),
    /// Remove the `model` key.
    Clear,
}

pub(crate) fn provider_codex_model_action(
    agent_type: AgentType,
    raw: Option<&str>,
) -> CodexModelAction {
    if agent_type != AgentType::Codex {
        return CodexModelAction::NoOp;
    }
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        Some(v) => CodexModelAction::Set(v.to_string()),
        None => CodexModelAction::Clear,
    }
}

/// Cascade model provider changes (credentials + model) to all dependent agent settings
/// and config files.
/// Extract the model value for a specific agent_type from a provider's model
/// field. The model field can be in two formats:
/// - **Multi-agent format** (new): `{"claude_code": {...}, "codex": "gpt-5"}`
///   → returns the value for the given `agent_type_str` as a string.
/// - **Legacy single-agent format**: a plain string or a Claude JSON object
///   (when there's only one agent_type) → returned as-is.
///
/// Returns `None` when the model field is absent or the agent_type has no entry.
/// Strip ANSI escape codes from a string. Model names copied from terminal
/// output may carry `\x1b[1m` (bold) or similar sequences that would cause
/// "model not found" errors when passed to the agent CLI.
fn strip_ansi(s: &str) -> String {
    // Matches ANSI escape sequences: \x1b\[ ... m
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip until we hit 'm' (the end of an ANSI sequence)
            while let Some(n) = chars.next() {
                if n == 'm' {
                    break;
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

pub(crate) fn extract_agent_model(
    raw: Option<&str>,
    agent_type_str: &str,
) -> Option<String> {
    let trimmed = raw.map(str::trim).filter(|s| !s.is_empty())?;
    let cleaned = strip_ansi(trimmed);
    let trimmed = cleaned.as_str();
    // Try parsing as a multi-agent JSON object first.
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(obj) = val.as_object() {
            // If the top-level key matches an agent_type, it's the multi-agent format.
            if let Some(entry) = obj.get(agent_type_str) {
                // Use as_str() for string values to avoid JSON quoting (e.g.
                // "glm-5.1" should stay "glm-5.1", not become '"glm-5.1"').
                // Non-string values (numbers, etc.) fall back to to_string().
                return Some(
                    entry
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| entry.to_string()),
                );
            }
            // If the object contains known agent_type keys but not ours, we have no model.
            // Heuristic: check if any key looks like an agent_type (contains underscore
            // or matches known types).
            let has_agent_key = obj.keys().any(|k| {
                k.contains('_')
                    || k == "claude_code"
                    || k == "codex"
                    || k == "gemini"
                    || k == "kimi_code"
                    || k == "hermes"
                    || k == "openhands"
                    || k == "openclaw"
                    || k == "open_claw"
                    || k == "cline"
                    || k == "open_code"
                    || k == "pi"
                    || k == "augment"
            });
            if has_agent_key {
                // Multi-agent format but this agent_type has no entry.
                return None;
            }
            // Otherwise it might be a Claude JSON object (legacy single-agent).
            // Fall through to return as-is.
        }
    }
    // Legacy single-agent format: return as-is.
    Some(trimmed.to_string())
}

pub(crate) async fn cascade_update_model_provider(
    db: &AppDatabase,
    provider_id: i32,
    new_api_url: &str,
    new_api_key: &str,
    new_model: Option<&str>,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    let dependents = agent_setting_service::find_by_model_provider_id(&db.conn, provider_id)
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;

    for setting in &dependents {
        let agent_type: AgentType = match serde_json::from_str(&setting.agent_type) {
            Ok(at) => at,
            Err(_) => continue,
        };

        // Provider rows no longer own a model name; models are chosen per-agent.
        // Only cascade a model when the caller explicitly supplies one.
        let agent_model = new_model
            .map(str::trim)
            .filter(|s| !s.is_empty());

        // 1. Update env_json in database (uses agent_env_keys for consistent key names)
        let (url_key, key_key, _) = agent_env_keys(agent_type);
        let mut env_map: BTreeMap<String, String> = setting
            .env_json
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok())
            .unwrap_or_default();

        // CodeBuddy: A计划 credentials go into models.json only. Do not overwrite
        // CODEBUDDY_BASE_URL / CODEBUDDY_API_KEY — that breaks native Tencent
        // models (China/overseas/iOA).
        if agent_type != AgentType::CodeBuddy {
            if !new_api_url.trim().is_empty() {
                env_map.insert(url_key.to_string(), new_api_url.to_string());
            }
            if !new_api_key.trim().is_empty() {
                env_map.insert(key_key.to_string(), new_api_key.to_string());
            }
        }
        if agent_type == AgentType::CodeBuddy {
            env_map.remove("CODEBUDDY_BASE_URL");
            env_map.remove("CODEBUDDY_DISABLE_BUILTIN_MODELS");
            if let Some(model) = env_map
                .get("CODEBUDDY_MODEL")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
            {
                env_map.insert("ANTHROPIC_CUSTOM_MODEL_OPTION".to_string(), model.clone());
                env_map.insert(
                    "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME".to_string(),
                    model.clone(),
                );
            }
        }

        // Preserve each agent's currently selected model when credentials change.
        let model_env = if agent_model.is_some() {
            let parsed = parse_provider_model(agent_type, agent_model);
            for (k, v) in &parsed {
                match v {
                    Some(value) => {
                        env_map.insert(k.clone(), value.clone());
                    }
                    None => {
                        env_map.remove(k);
                    }
                }
            }
            parsed
        } else {
            BTreeMap::new()
        };

        let patch = agent_setting_service::AgentSettingsUpdate {
            enabled: setting.enabled,
            env_json: serialize_env_map(&env_map)?,
            model_provider_id: setting.model_provider_id,
        };
        agent_setting_service::update(&db.conn, agent_type, patch)
            .await
            .map_err(|e| AcpError::protocol(e.to_string()))?;

        // 2. Update on-disk config files
        let codex_action = if agent_model.is_some() {
            provider_codex_model_action(agent_type, agent_model)
        } else {
            CodexModelAction::NoOp
        };
        if let Err(e) = cascade_update_agent_config(
            agent_type,
            new_api_url,
            new_api_key,
            &model_env,
            &codex_action,
        )
        .await
        {
            tracing::warn!(
                "[ModelProvider] cascade_update_agent_config({agent_type}) failed: {e}, skipping config update"
            );
        } else if agent_type == AgentType::OpenClaw {
            restart_openclaw_gateway_after_provider_write().await;
        }

        emit_acp_agents_updated(emitter, "env_updated", Some(agent_type));
    }

    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_preflight(
    agent_type: AgentType,
    force_refresh: Option<bool>,
) -> Result<PreflightResult, AcpError> {
    if force_refresh.unwrap_or(false) {
        preflight::clear_npm_env_cache();
    }
    Ok(preflight::run_preflight(agent_type).await)
}

/// Resolve the full runtime env every ACP spawn should receive — settings
/// override, model provider credentials, git credential helper, OpenClaw
/// reset flag. Returns `AcpError::protocol("...disabled in settings")` when
/// the user has disabled the agent.
///
/// This is the **single source of truth** for "what env does an agent
/// process see". Three call sites depend on it:
///
///   1. `acp_connect` — the user-initiated session entry point.
///   2. `ConnectionManagerSpawner::spawn` — used by the delegation broker
///      to spawn subagents. Before this helper existed, delegation passed
///      `BTreeMap::new()`, silently bypassing settings/credentials and
///      letting disabled agents still be invoked through delegation.
///   3. `probe_agent_options` — the live settings-page probe. Must match
///      delegation's env exactly so what the user sees in the panel is
///      what `delegate_to_agent` will actually receive.
///
/// Diverging any of these from the others reintroduces the
/// "[UI shows options] != [delegation gets options]" inconsistency that
/// the multi-agent settings panel was designed to prevent.
pub(crate) async fn build_session_runtime_env(
    db: &AppDatabase,
    agent_type: AgentType,
    session_id: Option<&str>,
    data_dir: &Path,
) -> Result<BTreeMap<String, String>, AcpError> {
    let setting = agent_setting_service::get_by_agent_type(&db.conn, agent_type)
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;
    let disabled = setting
        .as_ref()
        .map(|model| !model.enabled)
        .unwrap_or(false);
    if disabled {
        return Err(AcpError::protocol(format!(
            "{agent_type} is disabled in settings"
        )));
    }

    let local_config_json = load_agent_local_config_json(agent_type);
    let mut runtime_env =
        build_runtime_env_from_setting(agent_type, setting.as_ref(), local_config_json.as_deref());
    apply_model_provider_env(agent_type, setting.as_ref(), &mut runtime_env, &db.conn).await;

    // codex resume no longer needs a `MODEL_PROVIDER` pin: codex-acp 1.0.1
    // (#224) resolves the resumed provider from `~/.codex/config.toml` via
    // `config/read`, matching new sessions (which pass `null` so codex reads the
    // config's own `model_provider`). The 1.0.0 workaround that injected
    // `MODEL_PROVIDER` to stop resumed sessions falling back to "openai" is now
    // redundant and was removed.

    if let Some(cred_env) = crate::commands::terminal::prepare_credential_env(data_dir) {
        for (key, value) in cred_env {
            runtime_env.insert(key, value);
        }
    }

    if agent_type == AgentType::OpenClaw {
        // OpenClaw ACP is always a gateway client. Model-provider mode still
        // needs a reachable local gateway — it only changes how that gateway
        // authenticates to the LLM (via openclaw.json), not whether gateway is
        // required. Skipping ensure here caused silent empty turns after the
        // user selected a shared provider.
        ensure_openclaw_gateway_for_session(&mut runtime_env).await?;
        if session_id.is_none() {
            runtime_env.insert("OPENCLAW_RESET_SESSION".into(), "1".into());
        }
    }

    Ok(runtime_env)
}

/// Best-effort ensure + fill OpenClaw gateway URL/token into session env.
/// Fail hard only when the gateway is still unreachable after ensure — that is
/// exactly the ECONNREFUSED the user would hit a moment later from openclaw-acp.
async fn ensure_openclaw_gateway_for_session(
    runtime_env: &mut BTreeMap<String, String>,
) -> Result<(), AcpError> {
    let result = ensure_openclaw_gateway_core().await?;
    let discovery = &result.discovery;

    if let Some(url) = discovery
        .gateway_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
    {
        // Saved settings win if the user deliberately set a remote URL.
        runtime_env
            .entry("OPENCLAW_GATEWAY_URL".into())
            .or_insert_with(|| url.to_string());
    }
    if let Some(token) = discovery
        .gateway_token
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        runtime_env
            .entry("OPENCLAW_GATEWAY_TOKEN".into())
            .or_insert_with(|| token.to_string());
    }

    if !discovery.gateway_reachable {
        return Err(AcpError::protocol(format!(
            "OpenClaw Gateway is not reachable ({}). {}",
            discovery
                .gateway_url
                .clone()
                .unwrap_or_else(|| openclaw_local_ws_url(OPENCLAW_DEFAULT_LOCAL_PORT)),
            result.message
        )));
    }

    if !result.ok {
        tracing::warn!(
            "[OpenClaw] ensure reported not-ok but probe is reachable: {} steps={:?}",
            result.message,
            result.steps
        );
    }

    Ok(())
}

/// Fingerprint the effective config a spawned agent process is locked to: the
/// resolved `runtime_env` (minus per-launch volatile keys), the raw content of
/// the agent's native config file(s), and platform companion feature bits that
/// are fixed at MCP injection time (today: image generation). All of these only
/// take effect at process start, so a change to any is exactly what "this
/// running session is stale" means. The digest is process-local — never
/// persisted, never sent on the wire (only the resulting `stale` bool reaches
/// the frontend) — so a non-cryptographic hash would do; SHA-256 keeps it
/// deterministic and matches the rest of the codebase.
pub(crate) fn fingerprint_config(
    agent_type: AgentType,
    runtime_env: &BTreeMap<String, String>,
    image_enabled: bool,
) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    // BTreeMap iterates in sorted key order → deterministic across calls.
    for (k, v) in runtime_env {
        if is_volatile_fingerprint_key(k) {
            continue;
        }
        hasher.update(k.as_bytes());
        hasher.update([0u8]);
        hasher.update(v.as_bytes());
        hasher.update([0u8]);
    }
    hasher.update(b"\x01native\x01");
    if let Some(native) = load_agent_local_config_json(agent_type) {
        hasher.update(native.as_bytes());
    }
    // Companion `--features` image bit is read from runtime config at injection,
    // not from agent env — include it so toggling 出图 marks sessions stale.
    hasher.update(b"\x01platform\x01");
    hasher.update(if image_enabled { b"image=1" } else { b"image=0" });
    format!("{:x}", hasher.finalize())
}

/// Every known agent type. Used when a platform-wide setting (e.g. image
/// generation) changes and every running connection may need a staleness check.
pub(crate) fn all_agent_types() -> &'static [AgentType] {
    &[
        AgentType::ClaudeCode,
        AgentType::KimiCode,
        AgentType::OpenCode,
        AgentType::CodeBuddy,
        AgentType::Pi,
        AgentType::Gemini,
        AgentType::OpenClaw,
        AgentType::Cline,
        AgentType::Hermes,
        AgentType::Codex,
        AgentType::MimoCode,
        AgentType::CommandCode,
    ]
}

/// Recompute the canonical config fingerprint for `agent_type` from current
/// settings (DB + native config files + platform companion bits), independent
/// of any running session. Passes `session_id = None` so the result is
/// session-independent (the only session-derived key is excluded anyway),
/// making it directly comparable to the fingerprint `fingerprint_config`
/// produced at spawn time. Propagates the agent's "disabled in settings" error
/// verbatim.
pub(crate) async fn compute_session_config_fingerprint(
    db: &AppDatabase,
    agent_type: AgentType,
    data_dir: &Path,
) -> Result<String, AcpError> {
    let runtime_env = build_session_runtime_env(db, agent_type, None, data_dir).await?;
    let image_enabled = crate::db::service::image_generation_service::get_config(&db.conn)
        .await
        .enabled;
    Ok(fingerprint_config(agent_type, &runtime_env, image_enabled))
}

/// After a settings save, recompute the effective config fingerprint for each of
/// `agent_types` and tell every running connection of those agents whether it
/// has drifted onto stale (launch-time) config. Best-effort: an agent whose
/// fingerprint can't be recomputed (e.g. it was just disabled) is skipped, not
/// fatal. Returns the number of running connections currently on stale config
/// across the affected agents — for the settings-side "N sessions need restart"
/// toast.
pub(crate) async fn refresh_config_staleness(
    manager: &ConnectionManager,
    db: &AppDatabase,
    data_dir: &Path,
    agent_types: &[AgentType],
    kind: ConfigStaleKind,
) -> usize {
    let mut fresh: HashMap<AgentType, String> = HashMap::new();
    for &agent_type in agent_types {
        if fresh.contains_key(&agent_type) {
            continue;
        }
        if let Ok(fp) = compute_session_config_fingerprint(db, agent_type, data_dir).await {
            fresh.insert(agent_type, fp);
        }
    }
    if fresh.is_empty() {
        return 0;
    }
    manager.refresh_connection_staleness(&fresh, kind).await
}

/// `acp_update_agent_env_core` followed by a staleness refresh. Shared by the
/// Tauri command and the web handler so both report how many running sessions
/// the save left on stale config. Returns that count.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn acp_update_agent_env_and_refresh(
    agent_type: AgentType,
    enabled: bool,
    env: BTreeMap<String, String>,
    model_provider_id: Option<i32>,
    db: &AppDatabase,
    manager: &ConnectionManager,
    data_dir: &Path,
    emitter: &EventEmitter,
) -> Result<usize, AcpError> {
    acp_update_agent_env_core(agent_type, enabled, env, model_provider_id, db, emitter).await?;
    Ok(refresh_config_staleness(manager, db, data_dir, &[agent_type], ConfigStaleKind::AgentConfig).await)
}

/// `acp_update_agent_preferences_core` followed by a staleness refresh. Shared
/// by the Tauri command and the web handler; returns the count of running
/// sessions left on stale config.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn acp_update_agent_preferences_and_refresh(
    agent_type: AgentType,
    enabled: bool,
    env: BTreeMap<String, String>,
    config_json: Option<String>,
    opencode_auth_json: Option<String>,
    codex_auth_json: Option<String>,
    codex_config_toml: Option<String>,
    db: &AppDatabase,
    manager: &ConnectionManager,
    data_dir: &Path,
    emitter: &EventEmitter,
) -> Result<usize, AcpError> {
    acp_update_agent_preferences_core(
        agent_type,
        enabled,
        env,
        config_json,
        opencode_auth_json,
        codex_auth_json,
        codex_config_toml,
        db,
        emitter,
    )
    .await?;
    Ok(refresh_config_staleness(manager, db, data_dir, &[agent_type], ConfigStaleKind::AgentConfig).await)
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub async fn acp_connect(
    agent_type: AgentType,
    working_dir: Option<String>,
    session_id: Option<String>,
    preferred_mode_id: Option<String>,
    preferred_config_values: Option<BTreeMap<String, String>>,
    manager: State<'_, ConnectionManager>,
    db: State<'_, AppDatabase>,
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<String, AcpError> {
    // Resolve through the effective data dir so a custom `VERYAGENT_DATA_DIR`
    // reaches the credential helper script the agent's git subprocess
    // will execute. `acp_connect` may be called before the app data dir
    // exists on disk (first launch); fall back to a sentinel that the
    // credential helper treats as "no credentials configured".
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let runtime_env =
        build_session_runtime_env(&db, agent_type, session_id.as_deref(), &app_data_dir).await?;

    // Guard: the session page must never trigger a download or install.
    // If the agent isn't ready, return SdkNotInstalled here so the frontend
    // can prompt the user to install it from Agent Settings.
    verify_agent_installed(agent_type).await?;

    let emitter = EventEmitter::Tauri(app_handle);
    manager
        .spawn_agent(
            agent_type,
            working_dir,
            session_id,
            runtime_env,
            window.label().to_string(),
            emitter,
            preferred_mode_id,
            preferred_config_values.unwrap_or_default(),
        )
        .await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_prompt(
    connection_id: String,
    blocks: Vec<PromptInputBlock>,
    folder_id: Option<i32>,
    conversation_id: Option<i32>,
    client_message_id: Option<String>,
    db: State<'_, crate::db::AppDatabase>,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AcpError> {
    manager
        .send_prompt_linked_with_message_id(
            &db,
            &connection_id,
            blocks,
            folder_id,
            conversation_id,
            None,
            client_message_id,
        )
        .await
        .map(|_| ())
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_set_mode(
    connection_id: String,
    mode_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AcpError> {
    manager.set_mode(&connection_id, mode_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_set_config_option(
    connection_id: String,
    config_id: String,
    value_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AcpError> {
    manager
        .set_config_option(&connection_id, config_id, value_id)
        .await
}

/// Spawn a transient ACP connection for `agent_type` with a silent emitter,
/// read whatever `SessionConfigOptions` / `SessionModes` the agent advertises,
/// and tear it down. The returned snapshot drives the delegation-settings UI
/// so the user picks from the exact option set the agent will accept when
/// veryagent-mcp later spawns a subagent.
///
/// Does NOT touch the chat-side `selectorsCache`, `localStorage` preferences,
/// or any active connection state — see `ConnectionManager::probe_agent_options`
/// for the isolation guarantees.
pub async fn acp_describe_agent_options_core(
    manager: &ConnectionManager,
    db: &AppDatabase,
    data_dir: &Path,
    agent_type: AgentType,
    working_dir: Option<String>,
) -> Result<crate::acp::types::AgentOptionsSnapshot, AcpError> {
    verify_agent_installed(agent_type).await?;
    // Build the same runtime env delegation/acp_connect would build so
    // probe sees exactly what `delegate_to_agent` will see at runtime.
    // Without this, the settings UI could show options that the agent
    // never advertises in production (settings override an API URL,
    // model_provider injects a different model list, etc.).
    let runtime_env = build_session_runtime_env(db, agent_type, None, data_dir).await?;
    manager
        .probe_agent_options(agent_type, working_dir, runtime_env)
        .await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_describe_agent_options(
    agent_type: AgentType,
    working_dir: Option<String>,
    manager: State<'_, ConnectionManager>,
    db: State<'_, AppDatabase>,
    app_handle: tauri::AppHandle,
) -> Result<crate::acp::types::AgentOptionsSnapshot, AcpError> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| PathBuf::from("."));
    acp_describe_agent_options_core(&manager, &db, &app_data_dir, agent_type, working_dir).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_cancel(
    connection_id: String,
    db: State<'_, AppDatabase>,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AcpError> {
    manager.cancel(&db.conn, &connection_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_fork(
    connection_id: String,
    db: State<'_, AppDatabase>,
    manager: State<'_, ConnectionManager>,
) -> Result<ForkResultInfo, AcpError> {
    manager.fork_session(&db, &connection_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_respond_permission(
    connection_id: String,
    request_id: String,
    option_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AcpError> {
    manager
        .respond_permission(&connection_id, &request_id, &option_id)
        .await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_answer_question(
    connection_id: String,
    question_id: String,
    answer: crate::acp::question::QuestionAnswer,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AcpError> {
    manager
        .answer_question(&connection_id, &question_id, answer)
        .await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_disconnect(
    connection_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<(), AcpError> {
    manager.disconnect(&connection_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_touch_connection(
    connection_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<bool, AcpError> {
    Ok(manager.touch(&connection_id).await)
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_list_connections(
    manager: State<'_, ConnectionManager>,
) -> Result<Vec<ConnectionInfo>, AcpError> {
    Ok(manager.list_connections().await)
}

pub(crate) async fn acp_get_session_snapshot_core(
    manager: &ConnectionManager,
    connection_id: &str,
) -> Result<Option<crate::acp::LiveSessionSnapshot>, AcpError> {
    let Some(state) = manager.get_state(connection_id).await else {
        return Ok(None);
    };
    let snap = state.read().await.to_snapshot();
    Ok(Some(snap))
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_get_session_snapshot(
    connection_id: String,
    manager: State<'_, ConnectionManager>,
) -> Result<Option<crate::acp::LiveSessionSnapshot>, AcpError> {
    acp_get_session_snapshot_core(&manager, &connection_id).await
}

pub(crate) async fn acp_get_session_snapshot_by_conversation_core(
    manager: &ConnectionManager,
    conversation_id: i32,
) -> Result<Option<crate::acp::LiveSessionSnapshot>, AcpError> {
    let Some(conn_id) = manager
        .find_connection_by_conversation_id(conversation_id)
        .await
    else {
        return Ok(None);
    };
    acp_get_session_snapshot_core(manager, &conn_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_get_session_snapshot_by_conversation(
    conversation_id: i32,
    manager: State<'_, ConnectionManager>,
) -> Result<Option<crate::acp::LiveSessionSnapshot>, AcpError> {
    acp_get_session_snapshot_by_conversation_core(&manager, conversation_id).await
}

/// Discover the live connection (if any) another client is currently running
/// for this conversation, returning its id plus the current `event_seq`
/// (informational). The frontend calls this when opening a conversation: if
/// `Some`, it attaches to that connection as a viewer (cross-client live
/// streaming) instead of spawning a fresh agent; if `None`, no client is live
/// and it spawns/owns one.
///
/// Matches by `conversation_id` first, then falls back to `session_id`
/// (`external_id`). The fallback is load-bearing: a connection binds its
/// `conversation_id` only on the first prompt, so a historical conversation
/// opened by a second client BEFORE any prompt is sent would miss the
/// by-conversation lookup — and then `acp_connect` would reuse the live owner's
/// connection by `external_id` and the frontend would mis-tag it as a locally
/// owned connection, tearing it down (killing the real owner's agent) on tab
/// close. Discovering it here lets the second client attach as a viewer.
pub(crate) async fn acp_find_connection_for_conversation_core(
    manager: &ConnectionManager,
    conversation_id: i32,
    session_id: Option<&str>,
    agent_type: AgentType,
) -> Result<Option<crate::acp::ConversationConnectionInfo>, AcpError> {
    let connection_id = match manager
        .find_connection_by_conversation_id(conversation_id)
        .await
    {
        Some(id) => id,
        // The `session_id` (external_id) fallback is matched WITH `agent_type`:
        // `external_id` is unique only per agent, so matching it alone could
        // attach a viewer to a different agent's connection sharing a session id.
        None => match session_id {
            Some(sid) if !sid.is_empty() => {
                match manager
                    .find_connection_by_external_id(sid, agent_type)
                    .await
                {
                    Some(id) => id,
                    None => return Ok(None),
                }
            }
            _ => return Ok(None),
        },
    };
    // The connection may be GC'd between the lookup and the state read; treat a
    // missing state as "no live connection" rather than erroring.
    let Some(state) = manager.get_state(&connection_id).await else {
        return Ok(None);
    };
    let s = state.read().await;
    // Discovery means "a LIVE connection a viewer can attach to". Teardown
    // writes a terminal status onto the state BEFORE the cleanup hook removes
    // the map entry (see `acp/connection.rs`), and `find_connection_by_
    // conversation_id` only matches `conversation_id` — so without this guard
    // discovery can briefly hand back a connection that is going away, and the
    // viewer would attach to a dead stream. Treat terminal statuses as "no live
    // connection" (matching `find_connection_for_reuse`'s contract) so the
    // client reads the persisted detail instead.
    if matches!(
        s.status,
        ConnectionStatus::Disconnected | ConnectionStatus::Error
    ) {
        return Ok(None);
    }
    Ok(Some(crate::acp::ConversationConnectionInfo {
        connection_id,
        event_seq: s.event_seq,
    }))
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_find_connection_for_conversation(
    conversation_id: i32,
    session_id: Option<String>,
    agent_type: AgentType,
    manager: State<'_, ConnectionManager>,
) -> Result<Option<crate::acp::ConversationConnectionInfo>, AcpError> {
    acp_find_connection_for_conversation_core(
        &manager,
        conversation_id,
        session_id.as_deref(),
        agent_type,
    )
    .await
}

pub(crate) async fn acp_get_agent_status_core(
    agent_type: AgentType,
    db: &AppDatabase,
) -> Result<crate::acp::types::AcpAgentStatus, AcpError> {
    let platform = registry::current_platform();
    let meta = registry::get_agent_meta(agent_type);
    let setting = agent_setting_service::get_by_agent_type(&db.conn, agent_type)
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;

    let (available, installed_version) = match &meta.distribution {
        registry::AgentDistribution::Npx { cmd, .. } => (
            true,
            resolve_npx_command(cmd)
                .await
                .and_then(|_| setting.as_ref().and_then(|m| m.installed_version.clone())),
        ),
        registry::AgentDistribution::Binary { platforms, cmd, .. } => {
            // Command Code's adapter is embedded; always available.
            if agent_type == AgentType::CommandCode {
                (true, meta.registry_version().map(str::to_string))
            } else {
                let detected = binary_cache::detect_installed_version(agent_type, cmd)
                    .ok()
                    .flatten();
                (platforms.iter().any(|p| p.platform == platform), detected)
            }
        }
        registry::AgentDistribution::Uvx { system_cmd, .. } => (
            uvx_agent_launchable(*system_cmd),
            binary_cache::uvx_prepared_version(agent_type),
        ),
    };

    Ok(crate::acp::types::AcpAgentStatus {
        agent_type,
        available,
        enabled: setting.map(|m| m.enabled).unwrap_or(false),
        installed_version,
        resident: meta.resident,
    })
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_get_agent_status(
    agent_type: AgentType,
    db: tauri::State<'_, AppDatabase>,
) -> Result<crate::acp::types::AcpAgentStatus, AcpError> {
    acp_get_agent_status_core(agent_type, &db).await
}

pub(crate) async fn acp_list_agents_core(db: &AppDatabase) -> Result<Vec<AcpAgentInfo>, AcpError> {
    let platform = registry::current_platform();
    let agent_types = registry::all_acp_agents();

    let defaults = agent_types
        .iter()
        .enumerate()
        .map(
            |(idx, agent_type)| agent_setting_service::AgentDefaultInput {
                agent_type: *agent_type,
                registry_id: registry::registry_id_for(*agent_type).to_string(),
                default_sort_order: idx as i32,
            },
        )
        .collect::<Vec<_>>();

    agent_setting_service::ensure_defaults(&db.conn, &defaults)
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;
    let settings_map = agent_setting_service::list_map_by_agent_type(&db.conn)
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;

    let mut agents = Vec::new();
    let mut npx_resolver = NpxCommandResolver::default();
    for (idx, agent_type) in agent_types.into_iter().enumerate() {
        let setting = settings_map.get(&agent_type);
        let meta = registry::get_agent_meta(agent_type);
        let (available, dist_type, local_installed_version) = match &meta.distribution {
            registry::AgentDistribution::Npx { cmd, .. } => {
                // Keep the list path bounded: each list request probes npm
                // global prefix at most once, then reuses the result across
                // all NPX agents in the loop.
                let cached = npx_resolver
                    .resolve_for_list(cmd)
                    .await
                    .and_then(|_| setting.and_then(|m| m.installed_version.clone()));
                (true, "npx", cached)
            }
            registry::AgentDistribution::Binary { platforms, cmd, .. } => {
                // Command Code's adapter is bundled inside the app; it is
                // always available and its version tracks the embedded adapter.
                if agent_type == AgentType::CommandCode {
                    (
                        true,
                        "binary",
                        meta.registry_version().map(str::to_string),
                    )
                } else {
                    let detected = binary_cache::detect_installed_version(agent_type, cmd)
                        .ok()
                        .flatten();
                    (
                        platforms.iter().any(|p| p.platform == platform),
                        "binary",
                        detected,
                    )
                }
            }
            registry::AgentDistribution::Uvx { system_cmd, .. } => (
                uvx_agent_launchable(*system_cmd),
                "uvx",
                binary_cache::uvx_prepared_version(agent_type),
            ),
        };

        let mut env = setting
            .and_then(|m| m.env_json.as_deref())
            .and_then(|s| serde_json::from_str::<BTreeMap<String, String>>(s).ok())
            .unwrap_or_default();
        let local_config_json = load_agent_local_config_json(agent_type);
        if let Some(raw_local_config) = local_config_json.as_deref() {
            if let Ok(local_cfg) = serde_json::from_str::<AgentRuntimeConfig>(raw_local_config) {
                for (key, value) in local_cfg.env {
                    let trimmed = value.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    env.insert(key, trimmed.to_string());
                }
                let (api_base_url_key, api_key_key, model_key) = agent_env_keys(agent_type);
                if let Some(value) = trim_non_empty(local_cfg.api_base_url) {
                    env.insert(api_base_url_key.to_string(), value);
                }
                if let Some(value) = trim_non_empty(local_cfg.api_key) {
                    env.insert(api_key_key.to_string(), value);
                }
                if agent_type != AgentType::ClaudeCode {
                    if let Some(value) = trim_non_empty(local_cfg.model) {
                        env.insert(model_key.to_string(), value);
                    }
                }
            }
        }
        let sort_order = setting.map(|m| m.sort_order).unwrap_or(idx as i32);
        // Persist detected version to DB for binary agents (npx written during install/upgrade)
        if dist_type == "binary" {
            let _ = agent_setting_service::set_installed_version(
                &db.conn,
                agent_type,
                local_installed_version.clone(),
            )
            .await;
        }
        let codex_auth_json = if agent_type == AgentType::Codex {
            load_codex_auth_json_raw()
        } else {
            None
        };
        let opencode_auth_json = if agent_type == AgentType::OpenCode {
            load_opencode_auth_json_raw()
        } else {
            None
        };
        let codex_config_toml = if agent_type == AgentType::Codex {
            load_codex_config_toml_raw()
        } else {
            None
        };
        let cline_secrets_json = if agent_type == AgentType::Cline {
            load_cline_secrets_json_raw()
        } else {
            None
        };
        let command_code_auth_json = if agent_type == AgentType::CommandCode {
            load_command_code_auth_json_raw()
        } else {
            None
        };
        // Hermes is self-managed: project its own ~/.hermes/.env + config.yaml
        // into config_json (read-only) and attach the raw config.yaml for the
        // advanced editor. The env-merge block above is skipped because
        // `load_agent_local_config_json` returns None for Hermes (no veryagent
        // local config path), so no Hermes credential leaks into process env.
        //
        // Auto-repair: when the local config files are missing (e.g. after
        // switching machines or wiping ~/.hermes) but the agent has a model
        // provider bound in the database, regenerate the config files from the
        // provider so the settings page shows correct values immediately.
        let (config_json, hermes_config_yaml) = if agent_type == AgentType::Hermes {
            let initial_config = load_hermes_local_config_json();
            let initial_yaml = fs::read_to_string(hermes_config_yaml_path()).ok();
            if initial_config.is_none() && initial_yaml.is_none() {
                if let Some(provider_id) = setting.and_then(|s| s.model_provider_id) {
                    if let Ok(Some(provider)) =
                        model_provider_service::get_by_id(&db.conn, provider_id).await
                    {
                        let model_env: BTreeMap<String, Option<String>> = BTreeMap::new();
                        let hermes_base_url = normalize_openai_compatible_base_url(
                                &provider.api_url,
                            );
                        if let Err(e) = cascade_update_agent_config(
                            agent_type,
                            &hermes_base_url,
                            &provider.api_key,
                            &model_env,
                            &CodexModelAction::NoOp,
                        )
                        .await
                        {
                            tracing::warn!(
                                "[Hermes] auto-repair config on list failed: {e}"
                            );
                        }
                        (load_hermes_local_config_json(), fs::read_to_string(hermes_config_yaml_path()).ok())
                    } else {
                        (initial_config, initial_yaml)
                    }
                } else {
                    (initial_config, initial_yaml)
                }
            } else {
                (initial_config, initial_yaml)
            }
        } else {
            (local_config_json, None)
        };

        agents.push(AcpAgentInfo {
            agent_type,
            registry_id: registry::registry_id_for(agent_type).to_string(),
            registry_version: meta.registry_version().map(ToString::to_string),
            name: meta.name.to_string(),
            description: meta.description.to_string(),
            available,
            distribution_type: dist_type.to_string(),
            enabled: setting.map(|m| m.enabled).unwrap_or(false),
            sort_order,
            installed_version: local_installed_version,
            env,
            config_json,
            config_file_path: agent_local_config_path(agent_type)
                .map(|path| path.display().to_string()),
            opencode_auth_json,
            codex_auth_json,
            codex_config_toml,
            cline_secrets_json,
            hermes_config_yaml,
            command_code_auth_json,
            model_provider_id: setting.and_then(|m| m.model_provider_id),
            resident: meta.resident,
        });
    }

    // Resident butlers first, then user sort_order, then name.
    agents.sort_by(|a, b| {
        b.resident
            .cmp(&a.resident)
            .then_with(|| a.sort_order.cmp(&b.sort_order))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(agents)
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_list_agents(
    db: tauri::State<'_, AppDatabase>,
) -> Result<Vec<AcpAgentInfo>, AcpError> {
    acp_list_agents_core(&db).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_clear_binary_cache(agent_type: AgentType) -> Result<(), AcpError> {
    let meta = registry::get_agent_meta(agent_type);
    if matches!(
        meta.distribution,
        registry::AgentDistribution::Binary { .. }
    ) {
        binary_cache::clear_agent_cache(agent_type)?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn acp_update_agent_preferences_core(
    agent_type: AgentType,
    enabled: bool,
    env: BTreeMap<String, String>,
    config_json: Option<String>,
    opencode_auth_json: Option<String>,
    codex_auth_json: Option<String>,
    codex_config_toml: Option<String>,
    db: &AppDatabase,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    let default = agent_setting_service::AgentDefaultInput {
        agent_type,
        registry_id: registry::registry_id_for(agent_type).to_string(),
        default_sort_order: i32::MAX / 2,
    };

    agent_setting_service::ensure_defaults(&db.conn, &[default])
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;

    let env_json = serialize_env_map(&env)?;
    let config_json = config_json.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    if let Some(raw) = config_json.as_deref() {
        let parsed = serde_json::from_str::<serde_json::Value>(raw)
            .map_err(|e| AcpError::protocol(format!("invalid config_json: {e}")))?;
        if !parsed.is_object() {
            return Err(AcpError::protocol(
                "invalid config_json: root must be a JSON object",
            ));
        }
    }

    let patch = agent_setting_service::AgentSettingsUpdate {
        enabled,
        env_json,
        model_provider_id: None,
    };
    agent_setting_service::update(&db.conn, agent_type, patch)
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;

    if agent_type == AgentType::Codex {
        if codex_auth_json.is_some() || codex_config_toml.is_some() {
            persist_codex_native_config_files(
                codex_auth_json.as_deref(),
                codex_config_toml.as_deref(),
            )?;
        }
        emit_acp_agents_updated(emitter, "preferences_updated", Some(agent_type));
        return Ok(());
    }

    if agent_type == AgentType::OpenCode {
        persist_opencode_native_config(
            opencode_auth_json.as_deref(),
            config_json.as_deref(),
        )?;
        emit_acp_agents_updated(emitter, "preferences_updated", Some(agent_type));
        return Ok(());
    }

    if agent_type == AgentType::Cline {
        if let Some(raw) = config_json.as_deref() {
            persist_cline_local_config(Some(raw))?;
        }
        emit_acp_agents_updated(emitter, "preferences_updated", Some(agent_type));
        return Ok(());
    }

    let mut local_patch_value = config_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .filter(|value| value.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    if !env.is_empty() {
        let env_json_value =
            serde_json::to_value(&env).map_err(|e| AcpError::protocol(e.to_string()))?;
        if let Some(obj) = local_patch_value.as_object_mut() {
            obj.insert("env".to_string(), env_json_value);
        }
    }
    let local_patch_json = serde_json::to_string(&local_patch_value)
        .map_err(|e| AcpError::protocol(format!("serialize local patch failed: {e}")))?;
    persist_agent_local_config_json(agent_type, Some(local_patch_json.as_str()))?;
    emit_acp_agents_updated(emitter, "preferences_updated", Some(agent_type));
    Ok(())
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub async fn acp_update_agent_preferences(
    agent_type: AgentType,
    enabled: bool,
    env: BTreeMap<String, String>,
    config_json: Option<String>,
    opencode_auth_json: Option<String>,
    codex_auth_json: Option<String>,
    codex_config_toml: Option<String>,
    manager: State<'_, ConnectionManager>,
    db: State<'_, AppDatabase>,
    app: tauri::AppHandle,
) -> Result<usize, AcpError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let emitter = EventEmitter::Tauri(app);
    acp_update_agent_preferences_and_refresh(
        agent_type,
        enabled,
        env,
        config_json,
        opencode_auth_json,
        codex_auth_json,
        codex_config_toml,
        &db,
        &manager,
        &app_data_dir,
        &emitter,
    )
    .await
}

pub(crate) async fn acp_update_agent_env_core(
    agent_type: AgentType,
    enabled: bool,
    env: BTreeMap<String, String>,
    model_provider_id: Option<i32>,
    db: &AppDatabase,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    let default = agent_setting_service::AgentDefaultInput {
        agent_type,
        registry_id: registry::registry_id_for(agent_type).to_string(),
        default_sort_order: i32::MAX / 2,
    };

    agent_setting_service::ensure_defaults(&db.conn, &[default])
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;

    // If a provider is selected, the provider's model field is authoritative:
    // each relevant env key is set when the provider has a value and cleared
    // (removed) when empty. Codex's root `model` in config.toml is handled the
    // same way.
    let mut merged_env = env;
    let mut codex_action = CodexModelAction::NoOp;
    // When a Claude provider is bound, capture the inputs to also rewrite the
    // on-disk config.env below. Claude's model fields live in config.env, which
    // the runtime overlays OVER db env_json (see `build_runtime_env_from_setting`),
    // so clearing a key from db env alone is not enough — a stale value left in
    // `~/.claude/settings.json` (e.g. ANTHROPIC_CUSTOM_MODEL_OPTION) would win at
    // launch. Binding must therefore be authoritative on disk too, matching the
    // provider-edit cascade.
    let mut claude_local_cascade: Option<(String, String, BTreeMap<String, Option<String>>)> = None;
    if let Some(pid) = model_provider_id {
        let provider = crate::db::service::model_provider_service::get_by_id(&db.conn, pid)
            .await
            .map_err(|e| AcpError::protocol(e.to_string()))?
            .ok_or_else(|| AcpError::protocol(format!("model provider not found: {pid}")))?;

        // Model providers are shared credentials for every agent. Legacy rows may
        // still carry agent_types_json / agent_type restrictions from older builds;
        // those fields are ignored so any agent can bind any provider.
        let agent_type_str = serde_json::to_value(&agent_type)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| agent_type.to_string());

        // Prefer the model the agent already selected in env (per-agent choice).
        // Fall back to any legacy value still stored on the provider row.
        let env_model = {
            let (_, _, model_key) = agent_env_keys(agent_type);
            merged_env
                .get(model_key)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let agent_model = env_model.or_else(|| {
            extract_agent_model(provider.model.as_deref(), &agent_type_str)
        });

        let model_env = parse_provider_model(agent_type, agent_model.as_deref());
        // Only apply set values from the provider model field. Do not clear an
        // agent-chosen model when the provider row has no model of its own.
        for (k, v) in &model_env {
            if let Some(value) = v {
                merged_env.insert(k.clone(), value.clone());
            }
        }
        // CodeBuddy has no separate config file: env_json is the source of truth.
        // Bind writes the shared provider into CODEBUDDY_* and clears the hosted
        // region selector so it cannot fight a custom endpoint. Also mirror the
        // selected model into Claude-derived custom-option env so the ACP
        // model picker surfaces the A计划 model in chat.
        if agent_type == AgentType::CodeBuddy {
            // A计划 is additive custom models only. Keep native CODEBUDDY_API_KEY
            // + CODEBUDDY_INTERNET_ENVIRONMENT (China/overseas/iOA). Strip any
            // leftover endpoint hijack from older binds.
            let (_, _, model_key) = agent_env_keys(agent_type);
            merged_env.remove("CODEBUDDY_BASE_URL");
            merged_env.remove("CODEBUDDY_DISABLE_BUILTIN_MODELS");
            if let Some(model) = merged_env
                .get(model_key)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
            {
                merged_env.insert("ANTHROPIC_CUSTOM_MODEL_OPTION".to_string(), model.clone());
                merged_env.insert(
                    "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME".to_string(),
                    model.clone(),
                );
            }
        }
        codex_action = provider_codex_model_action(agent_type, agent_model.as_deref());
        // Codex's on-disk config is handled by `apply_codex_root_model_action`
        // below; Gemini's analogous config.env gap is pre-existing and out of
        // scope here. Claude, KimiCode, Hermes, Cline, and OpenClaw need the
        // local-config cascade on bind so that their on-disk config files are
        // updated immediately (OpenClaw writes gateway model auth into
        // openclaw.json — ACP env alone cannot authenticate inference).
        if matches!(
            agent_type,
            AgentType::ClaudeCode
                | AgentType::KimiCode
                | AgentType::Hermes
                | AgentType::Cline
                | AgentType::OpenClaw
                | AgentType::OpenCode
                | AgentType::Pi
                | AgentType::CodeBuddy
        ) {
            claude_local_cascade = Some((provider.api_url.clone(), provider.api_key.clone(), model_env));
        }
    }

    let patch = agent_setting_service::AgentSettingsUpdate {
        enabled,
        env_json: serialize_env_map(&merged_env)?,
        model_provider_id,
    };
    agent_setting_service::update(&db.conn, agent_type, patch)
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;

    // Authoritatively rewrite the local config.env so a stale model key (e.g. the
    // custom model option) cannot survive a bind/rebind via any save path. `None`
    // entries become JSON-null and are removed by `merge_json_values`.
    if let Some((api_url, api_key, model_env)) = claude_local_cascade {
        if let Err(e) = cascade_update_agent_config(
            agent_type,
            &api_url,
            &api_key,
            &model_env,
            &CodexModelAction::NoOp,
        )
        .await
        {
            eprintln!("[acp_update_agent_env] cascade_update_agent_config({agent_type}) failed: {e}");
        } else if agent_type == AgentType::OpenClaw {
            // Gateway may already be running with old credentials; nudge a restart.
            restart_openclaw_gateway_after_provider_write().await;
        }
    }

    if let Err(e) = apply_codex_root_model_action(&codex_action) {
        tracing::error!("[acp_update_agent_env] apply_codex_root_model_action failed: {e}");
    }

    emit_acp_agents_updated(emitter, "env_updated", Some(agent_type));
    Ok(())
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_update_agent_env(
    agent_type: AgentType,
    enabled: bool,
    env: BTreeMap<String, String>,
    model_provider_id: Option<i32>,
    manager: State<'_, ConnectionManager>,
    db: State<'_, AppDatabase>,
    app: tauri::AppHandle,
) -> Result<usize, AcpError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let emitter = EventEmitter::Tauri(app);
    acp_update_agent_env_and_refresh(
        agent_type,
        enabled,
        env,
        model_provider_id,
        &db,
        &manager,
        &app_data_dir,
        &emitter,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn acp_update_agent_config_core(
    agent_type: AgentType,
    config_json: Option<String>,
    opencode_auth_json: Option<String>,
    codex_auth_json: Option<String>,
    codex_config_toml: Option<String>,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    let config_json = config_json.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    if let Some(raw) = config_json.as_deref() {
        let parsed = serde_json::from_str::<serde_json::Value>(raw)
            .map_err(|e| AcpError::protocol(format!("invalid config_json: {e}")))?;
        if !parsed.is_object() {
            return Err(AcpError::protocol(
                "invalid config_json: root must be a JSON object",
            ));
        }
    }

    if agent_type == AgentType::Codex {
        if codex_auth_json.is_some() || codex_config_toml.is_some() {
            persist_codex_native_config_files(
                codex_auth_json.as_deref(),
                codex_config_toml.as_deref(),
            )?;
        }
        emit_acp_agents_updated(emitter, "config_updated", Some(agent_type));
        return Ok(());
    }

    if agent_type == AgentType::OpenCode {
        persist_opencode_native_config(
            opencode_auth_json.as_deref(),
            config_json.as_deref(),
        )?;
        emit_acp_agents_updated(emitter, "config_updated", Some(agent_type));
        return Ok(());
    }

    if agent_type == AgentType::Cline {
        if let Some(raw) = config_json.as_deref() {
            persist_cline_local_config(Some(raw))?;
        }
        emit_acp_agents_updated(emitter, "config_updated", Some(agent_type));
        return Ok(());
    }

    // Claude Code, Gemini, OpenClaw — write config JSON to local file without merging env
    let local_patch_value = config_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .filter(|value| value.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    let local_patch_json = serde_json::to_string(&local_patch_value)
        .map_err(|e| AcpError::protocol(format!("serialize local patch failed: {e}")))?;
    persist_agent_local_config_json(agent_type, Some(local_patch_json.as_str()))?;
    emit_acp_agents_updated(emitter, "config_updated", Some(agent_type));
    Ok(())
}

/// `acp_update_agent_config_core` (native config file write) followed by a
/// staleness refresh. Shared by the Tauri command and the web handler; returns
/// the count of running sessions left on stale config.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn acp_update_agent_config_and_refresh(
    agent_type: AgentType,
    config_json: Option<String>,
    opencode_auth_json: Option<String>,
    codex_auth_json: Option<String>,
    codex_config_toml: Option<String>,
    db: &AppDatabase,
    manager: &ConnectionManager,
    data_dir: &Path,
    emitter: &EventEmitter,
) -> Result<usize, AcpError> {
    acp_update_agent_config_core(
        agent_type,
        config_json,
        opencode_auth_json,
        codex_auth_json,
        codex_config_toml,
        emitter,
    )
    .await?;
    Ok(refresh_config_staleness(manager, db, data_dir, &[agent_type], ConfigStaleKind::AgentConfig).await)
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub async fn acp_update_agent_config(
    agent_type: AgentType,
    config_json: Option<String>,
    opencode_auth_json: Option<String>,
    codex_auth_json: Option<String>,
    codex_config_toml: Option<String>,
    manager: State<'_, ConnectionManager>,
    db: State<'_, AppDatabase>,
    app: tauri::AppHandle,
) -> Result<usize, AcpError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let emitter = EventEmitter::Tauri(app);
    acp_update_agent_config_and_refresh(
        agent_type,
        config_json,
        opencode_auth_json,
        codex_auth_json,
        codex_config_toml,
        &db,
        &manager,
        &app_data_dir,
        &emitter,
    )
    .await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_update_hermes_config(
    provider: String,
    api_key: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
    raw_config_yaml: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), AcpError> {
    let emitter = EventEmitter::Tauri(app);
    acp_update_hermes_config_core(
        HermesConfigUpdate {
            provider,
            api_key,
            model,
            base_url,
            raw_config_yaml,
        },
        &emitter,
    )
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub async fn acp_update_kimi_code_config(
    mode: String,
    interface_type: Option<String>,
    auth_type: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    max_context_size: Option<i64>,
    vertex_project: Option<String>,
    vertex_location: Option<String>,
    raw_config_toml: Option<String>,
    manager: State<'_, ConnectionManager>,
    db: State<'_, AppDatabase>,
    app: tauri::AppHandle,
) -> Result<usize, AcpError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let emitter = EventEmitter::Tauri(app);
    acp_update_kimi_code_config_and_refresh(
        KimiCodeConfigUpdate {
            mode,
            interface_type,
            auth_type,
            base_url,
            api_key,
            model,
            max_context_size,
            vertex_project,
            vertex_location,
            raw_config_toml,
        },
        &db,
        &manager,
        &app_data_dir,
        &emitter,
    )
    .await
}

/// List the models an API key + endpoint can access (validates the key and
/// populates the Kimi settings model picker). Desktop command; the web handler
/// calls `acp_fetch_kimi_models_core` directly.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_fetch_kimi_models(
    base_url: String,
    api_key: String,
) -> Result<Vec<String>, AcpError> {
    acp_fetch_kimi_models_core(&base_url, &api_key).await
}

/// Apply a structured Pi config update, writing pi's native `settings.json`
/// (provider/model/thinking level) and `auth.json` (when an API key is given).
/// Desktop command; the web handler calls `acp_update_pi_config_core` directly.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub async fn acp_update_pi_config(
    provider: String,
    model: String,
    thinking_level: Option<String>,
    api_key: Option<String>,
    custom_base_url: Option<String>,
    custom_api: Option<String>,
    db: State<'_, AppDatabase>,
    app: tauri::AppHandle,
) -> Result<(), AcpError> {
    let emitter = EventEmitter::Tauri(app);
    acp_update_pi_config_core(
        PiConfigUpdate {
            provider,
            model,
            thinking_level,
            api_key,
            custom_base_url,
            custom_api,
        },
        &db,
        &emitter,
    )
    .await
}

/// Read pi's current native config (model selection + configured auth providers)
/// for the settings panel. Desktop command; the web handler calls
/// `load_pi_config_core` directly. Reads the filesystem only — no DB/state needed.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_load_pi_config() -> Result<PiConfigProjection, AcpError> {
    Ok(load_pi_config_core())
}

/// Discover local OpenClaw gateway URL/token from env + openclaw.json, then
/// TCP-probe reachability. Never invents a default port as truth; empty fields
/// mean "not found". Desktop command; the web handler awaits the same core.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_discover_openclaw_gateway() -> Result<OpenClawGatewayDiscovery, AcpError> {
    Ok(discover_openclaw_gateway_core().await)
}

/// One-click local OpenClaw gateway bootstrap for the settings UI: create
/// baseline config if missing, set gateway.mode=local, install/start service
/// (or fall back to detached `gateway run`), then re-probe.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_ensure_openclaw_gateway() -> Result<OpenClawGatewayEnsureResult, AcpError> {
    ensure_openclaw_gateway_core().await
}

/// Validate a user-supplied custom pi binary (BYO-pi): resolve it (path or
/// `PATH`) and best-effort read its `--version`. A not-found binary returns
/// `found=false` (not an error). Desktop command; the web handler calls
/// `acp_validate_pi_command_core` directly.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_validate_pi_command(command: String) -> Result<PiCommandValidation, AcpError> {
    Ok(acp_validate_pi_command_core(command))
}

/// Launch Hermes's interactive setup in the OS terminal. `kind` selects the
/// flow (`"setup"` → `hermes-acp --setup`, `"model"` → `hermes model`); the
/// exact command is constructed by the backend from the registry recipe (the
/// renderer cannot supply arbitrary shell text). Ensures `~/.hermes` exists so
/// the `cd` into it can't fail on a fresh install. Desktop-only: these flows
/// need a real interactive TTY and a browser for OAuth.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_open_hermes_setup_terminal(kind: String) -> Result<(), AcpError> {
    let (setup, model) = hermes_setup_commands();
    let command = match kind.as_str() {
        "setup" => setup,
        "model" => model,
        other => {
            return Err(AcpError::protocol(format!(
                "unknown hermes setup kind: {other}"
            )));
        }
    };
    let home = hermes_home_dir();
    ensure_hermes_home_secure(&home)?;
    let home_str = home.to_string_lossy();
    open_external_terminal_impl(&command, Some(home_str.as_ref()))
}

/// Report whether the Command Code CLI is logged in for the shared official
/// account: `~/.commandcode/auth.json` from `cmdc login` exists with a
/// credential, or the agent env carries `COMMAND_CODE_API_KEY`. Purely a file
/// probe — no subprocess, safe to call on every settings-page render.
pub(crate) async fn acp_get_command_code_login_status_core(
    db: &AppDatabase,
) -> Result<CommandCodeLoginStatus, AcpError> {
    let setting = agent_setting_service::get_by_agent_type(&db.conn, AgentType::CommandCode)
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;
    let env_has_api_key = setting
        .and_then(|m| m.env_json)
        .and_then(|raw| serde_json::from_str::<BTreeMap<String, String>>(&raw).ok())
        .map(|env| {
            env.get("COMMAND_CODE_API_KEY")
                .is_some_and(|v| !v.trim().is_empty())
        })
        .unwrap_or(false);
    Ok(command_code_login_status(env_has_api_key))
}

/// Tauri wrapper for [`acp_get_command_code_login_status_core`].
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_get_command_code_login_status(
    db: tauri::State<'_, AppDatabase>,
) -> Result<CommandCodeLoginStatus, AcpError> {
    acp_get_command_code_login_status_core(&db).await
}

/// Launch `cmdc login` (the official browser-OAuth flow) in the background.
/// Command Code opens the browser itself and completes the OAuth callback
/// against its temporary localhost server, then writes `~/.commandcode/auth.json`
/// and exits — no terminal window needed. The settings page polls
/// [`acp_get_command_code_login_status`] until `logged_in` flips.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_start_command_code_login() -> Result<(), AcpError> {
    start_command_code_login()
}

/// Cancel a pending background `cmdc login`, if any.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_cancel_command_code_login() -> Result<(), AcpError> {
    cancel_command_code_login();
    Ok(())
}

/// Log out of Command Code by deleting the local auth.json credential.
/// Returns Ok(true) if the file was deleted, Ok(false) if it didn't exist.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_logout_command_code() -> Result<(), AcpError> {
    logout_command_code()
}

// ---------------------------------------------------------------------------
// Unified native-login API
// ---------------------------------------------------------------------------

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_start_native_login(
    agent_type: AgentType,
    db: tauri::State<'_, AppDatabase>,
) -> Result<(), AcpError> {
    start_native_login(&db, agent_type).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_get_native_login_status(
    agent_type: AgentType,
    db: tauri::State<'_, AppDatabase>,
) -> Result<NativeLoginStatus, AcpError> {
    probe_native_login_status(&db, agent_type).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_cancel_native_login(agent_type: AgentType) -> Result<(), AcpError> {
    cancel_native_login(agent_type).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_logout_native_login(
    agent_type: AgentType,
    db: tauri::State<'_, AppDatabase>,
) -> Result<(), AcpError> {
    logout_native_login(&db, agent_type).await
}

/// Whether an agent has a first-party native login at all (UI uses this to
/// decide whether to show the "native login" half of the auth-mode choice).
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn acp_supports_native_login(agent_type: AgentType) -> bool {
    supports_native_login(agent_type)
}

/// Ensure `~/.hermes` exists and reveal it in the system file manager.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_reveal_hermes_home(app: tauri::AppHandle) -> Result<(), AcpError> {
    use tauri_plugin_opener::OpenerExt;
    let home = hermes_home_dir();
    ensure_hermes_home_secure(&home)?;
    app.opener()
        .open_path(home.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| AcpError::protocol(format!("open hermes folder failed: {e}")))?;
    Ok(())
}

pub(crate) async fn acp_download_agent_binary_core(
    agent_type: AgentType,
    version_override: Option<String>,
    task_id: String,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    emit_agent_install_event(emitter, &task_id, AgentInstallEventKind::Started, "");

    let meta = registry::get_agent_meta(agent_type);
    // Command Code's adapter is bundled inside the app; there is nothing to
    // download — surface a completed install so the Settings page UX is a
    // no-op success.
    if agent_type == AgentType::CommandCode {
        emit_agent_install_event(
            emitter,
            &task_id,
            AgentInstallEventKind::Log,
            format!("{} ships its adapter built-in; nothing to download", meta.name),
        );
        return Ok(());
    }
    let result = match meta.distribution {
        registry::AgentDistribution::Binary {
            version,
            cmd,
            platforms,
            ..
        } => {
            // A custom version substitutes into the pinned download URL and the
            // cache key; `None`/empty keeps the registry-pinned version.
            let custom = match version_override.as_deref() {
                Some(raw) if !raw.trim().is_empty() => {
                    Some(sanitize_custom_version(raw).ok_or_else(|| {
                        AcpError::protocol(format!("invalid custom version: {}", raw.trim()))
                    })?)
                }
                _ => None,
            };

            let platform = registry::current_platform();
            let fallback = platforms
                .iter()
                .find(|p| p.platform == platform)
                .ok_or_else(|| {
                    AcpError::PlatformNotSupported(format!(
                        "{} is not available on {platform}",
                        meta.name
                    ))
                })?;

            let effective_version = custom.as_deref().unwrap_or(version);
            let archive_url = match &custom {
                Some(c) => apply_custom_version_to_url(fallback.url, version, c),
                None => fallback.url.to_string(),
            };

            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Log,
                format!(
                    "Downloading {} v{effective_version} for {platform}",
                    meta.name
                ),
            );

            let emitter_clone = emitter.clone();
            let task_id_clone = task_id.clone();
            let _ = binary_cache::ensure_binary_for_agent_with_progress(
                agent_type,
                effective_version,
                &archive_url,
                cmd,
                move |msg| {
                    emit_agent_install_event(
                        &emitter_clone,
                        &task_id_clone,
                        AgentInstallEventKind::Log,
                        msg,
                    );
                },
            )
            .await?;
            emit_acp_agents_updated(emitter, "binary_downloaded", Some(agent_type));
            Ok(())
        }
        registry::AgentDistribution::Npx { .. } => Err(AcpError::protocol(
            "download is only supported for binary agents",
        )),
        registry::AgentDistribution::Uvx { .. } => Err(AcpError::protocol(
            "download is only supported for binary agents",
        )),
    };

    match &result {
        Ok(()) => {
            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Completed,
                format!("{} installed successfully", meta.name),
            );
        }
        Err(e) => {
            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Failed,
                e.to_string(),
            );
        }
    }
    result
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_download_agent_binary(
    agent_type: AgentType,
    version: Option<String>,
    task_id: String,
    app: tauri::AppHandle,
) -> Result<(), AcpError> {
    let emitter = EventEmitter::Tauri(app);
    acp_download_agent_binary_core(agent_type, version, task_id, &emitter).await
}

/// Provision ONLY the uv toolchain (uvx) into veryagent's cache — independent of
/// installing any `Uvx` agent's package. Streams progress over the shared
/// agent-install event stream so the Settings page shows a live log. Backs the
/// uv preflight check's "Install uv" fix. After this succeeds,
/// `resolve_uvx_command()` resolves the cached uvx, so a subsequent preflight /
/// agent-status reports uv as available.
pub(crate) async fn acp_install_uv_tool_core(
    task_id: String,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    emit_agent_install_event(emitter, &task_id, AgentInstallEventKind::Started, "");

    let emitter_clone = emitter.clone();
    let task_id_clone = task_id.clone();
    let result = crate::acp::binary_cache::ensure_uv_tool(move |msg| {
        emit_agent_install_event(
            &emitter_clone,
            &task_id_clone,
            AgentInstallEventKind::Log,
            msg.to_string(),
        );
    })
    .await
    .map(|_| ());

    match &result {
        Ok(()) => {
            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Completed,
                "uv runtime installed successfully".to_string(),
            );
            // uv is shared across all uvx agents, so its arrival flips their
            // availability — notify every client to refetch the agent list.
            emit_acp_agents_updated(emitter, "uv_installed", None);
        }
        Err(e) => {
            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Failed,
                e.to_string(),
            );
        }
    }
    result
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_install_uv_tool(
    task_id: String,
    app: tauri::AppHandle,
) -> Result<(), AcpError> {
    let emitter = EventEmitter::Tauri(app);
    acp_install_uv_tool_core(task_id, &emitter).await
}

pub(crate) async fn acp_detect_agent_local_version_core(
    agent_type: AgentType,
    conn: &sea_orm::DatabaseConnection,
) -> Result<Option<String>, AcpError> {
    let detected = detect_local_version(agent_type).await;
    if let Some(version) = detected.clone() {
        let _ =
            agent_setting_service::set_installed_version(conn, agent_type, Some(version.clone()))
                .await;
        return Ok(Some(version));
    }

    // Binary agents detect their version purely from the on-disk cache, so a
    // `None` here means the binary is genuinely absent (cleared cache, or a
    // failed custom/upgrade install). Return `None` authoritatively rather than
    // falling back to the DB, which would resurrect a removed version as a
    // phantom that can no longer be launched. The returned value does NOT depend
    // on the mirror write below, so a swallowed write cannot reintroduce the
    // phantom. (NPX detection runs `npm list`, which can fail transiently, so
    // for npx we keep the DB value as a best-effort fallback.)
    if matches!(
        registry::get_agent_meta(agent_type).distribution,
        registry::AgentDistribution::Binary { .. }
    ) {
        let _ = agent_setting_service::set_installed_version(conn, agent_type, None).await;
        return Ok(None);
    }

    let fallback = agent_setting_service::get_by_agent_type(conn, agent_type)
        .await
        .ok()
        .flatten()
        .and_then(|m| m.installed_version);
    Ok(fallback)
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_detect_agent_local_version(
    agent_type: AgentType,
    db: State<'_, AppDatabase>,
) -> Result<Option<String>, AcpError> {
    acp_detect_agent_local_version_core(agent_type, &db.conn).await
}

pub(crate) async fn acp_prepare_npx_agent_core(
    agent_type: AgentType,
    registry_version: Option<String>,
    version_override: Option<String>,
    clean_first: bool,
    task_id: String,
    db: &AppDatabase,
    emitter: &EventEmitter,
) -> Result<String, AcpError> {
    emit_agent_install_event(emitter, &task_id, AgentInstallEventKind::Started, "");

    let meta = registry::get_agent_meta(agent_type);
    // Command Code's adapter is built in — nothing to install; return the
    // embedded version so the Settings page shows it as ready.
    if agent_type == AgentType::CommandCode {
        let version = meta.registry_version().map(str::to_string);
        emit_agent_install_event(
            emitter,
            &task_id,
            AgentInstallEventKind::Log,
            format!("{} ships its adapter built-in; nothing to install", meta.name),
        );
        return Ok(version.unwrap_or_default());
    }
    let result = match meta.distribution {
        registry::AgentDistribution::Npx { package, .. } => {
            // `version_override` of None/empty keeps the registry-pinned spec;
            // a custom version installs `<name>@<version>` instead.
            let install_spec = build_npm_install_spec(package, version_override.as_deref())?;

            let default = agent_setting_service::AgentDefaultInput {
                agent_type,
                registry_id: registry::registry_id_for(agent_type).to_string(),
                default_sort_order: i32::MAX / 2,
            };
            agent_setting_service::ensure_defaults(&db.conn, &[default])
                .await
                .map_err(|e| AcpError::protocol(e.to_string()))?;

            let existing = agent_setting_service::get_by_agent_type(&db.conn, agent_type)
                .await
                .ok()
                .flatten()
                .and_then(|m| m.installed_version);

            // Best-effort uninstall before reinstall. Forces npm to re-resolve
            // the dependency graph from scratch, which is required for
            // platform-specific optionalDependencies (e.g. native CLI binaries
            // shipped as `<pkg>-darwin-x64`) to be picked up after an upgrade.
            // Failures here are logged and swallowed so we still attempt the
            // install — for example when nothing is currently installed.
            if clean_first {
                let package_name = package_name_from_spec(package);
                emit_agent_install_event(
                    emitter,
                    &task_id,
                    AgentInstallEventKind::Log,
                    format!("$ npm uninstall -g {package_name} (clean reinstall)"),
                );
                if let Err(e) = uninstall_npm_global_package(package).await {
                    emit_agent_install_event(
                        emitter,
                        &task_id,
                        AgentInstallEventKind::Log,
                        format!("(warning) uninstall step failed, continuing: {e}"),
                    );
                }
            }

            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Log,
                format!("Installing {} ({install_spec})", meta.name),
            );
            install_npm_global_package_streaming(&install_spec, &task_id, emitter).await?;

            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Log,
                "Detecting installed version...",
            );
            let resolved = detect_local_version(agent_type)
                .await
                .or_else(|| version_from_package_spec(&install_spec))
                .or_else(|| {
                    registry_version
                        .as_deref()
                        .and_then(normalize_version_candidate)
                })
                .or(existing)
                .ok_or_else(|| {
                    AcpError::protocol(
                        "npm global install succeeded but failed to determine local version",
                    )
                })?;

            agent_setting_service::set_installed_version(
                &db.conn,
                agent_type,
                Some(resolved.clone()),
            )
            .await
            .map_err(|e| AcpError::protocol(e.to_string()))?;
            emit_acp_agents_updated(emitter, "npx_prepared", Some(agent_type));
            Ok(resolved)
        }
        registry::AgentDistribution::Binary { .. } => Err(AcpError::protocol(
            "prepare is only supported for npx agents",
        )),
        registry::AgentDistribution::Uvx {
            package,
            cmd,
            version,
            python,
            ..
        } => {
            let default = agent_setting_service::AgentDefaultInput {
                agent_type,
                registry_id: registry::registry_id_for(agent_type).to_string(),
                default_sort_order: i32::MAX / 2,
            };
            agent_setting_service::ensure_defaults(&db.conn, &[default])
                .await
                .map_err(|e| AcpError::protocol(e.to_string()))?;

            // Pre-fetch the pinned package into uvx's cache so the first
            // connect doesn't pay the download cost. The version is pinned in
            // the package spec, so `version_override` does not apply here.
            prewarm_uvx_agent(meta.name, package, cmd, python, &task_id, emitter).await?;

            let resolved = version.to_string();
            binary_cache::mark_uvx_agent_prepared(agent_type, &resolved)?;
            agent_setting_service::set_installed_version(
                &db.conn,
                agent_type,
                Some(resolved.clone()),
            )
            .await
            .map_err(|e| AcpError::protocol(e.to_string()))?;
            emit_acp_agents_updated(emitter, "uvx_prepared", Some(agent_type));
            Ok(resolved)
        }
    };

    match &result {
        Ok(version) => {
            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Completed,
                format!("{} v{version} installed successfully", meta.name),
            );
        }
        Err(e) => {
            // When clean_first was true the uninstall step may already have
            // succeeded by the time install failed, leaving the DB pointing at
            // a version that no longer exists on disk. Resync the DB to the
            // actual filesystem state so the UI doesn't mislead the user into
            // thinking they can connect.
            if clean_first {
                let detected = detect_local_version(agent_type).await;
                if let Err(sync_err) =
                    agent_setting_service::set_installed_version(&db.conn, agent_type, detected)
                        .await
                {
                    tracing::error!(
                        "[acp] failed to resync installed_version after clean upgrade failure: {sync_err}"
                    );
                }
                emit_acp_agents_updated(emitter, "npx_prepare_failed", Some(agent_type));
            }
            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Failed,
                e.to_string(),
            );
        }
    }
    result
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_prepare_npx_agent(
    agent_type: AgentType,
    registry_version: Option<String>,
    version: Option<String>,
    clean_first: Option<bool>,
    task_id: String,
    db: State<'_, AppDatabase>,
    app: tauri::AppHandle,
) -> Result<String, AcpError> {
    let emitter = EventEmitter::Tauri(app);
    acp_prepare_npx_agent_core(
        agent_type,
        registry_version,
        version,
        clean_first.unwrap_or(false),
        task_id,
        &db,
        &emitter,
    )
    .await
}

pub(crate) async fn acp_uninstall_agent_core(
    agent_type: AgentType,
    task_id: String,
    db: &AppDatabase,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    emit_agent_install_event(emitter, &task_id, AgentInstallEventKind::Started, "");

    let meta = registry::get_agent_meta(agent_type);
    emit_agent_install_event(
        emitter,
        &task_id,
        AgentInstallEventKind::Log,
        format!("Uninstalling {}...", meta.name),
    );

    let result: Result<(), AcpError> = async {
        // Command Code's adapter is embedded in the app; there is nothing to
        // uninstall (skipping clear_agent_cache also keeps the adapter script).
        if agent_type == AgentType::CommandCode {
            // fall through to DB version reset below
        } else {
            match meta.distribution {
                registry::AgentDistribution::Binary { .. } => {
                    binary_cache::clear_agent_cache(agent_type)?;
                }
                registry::AgentDistribution::Npx { package, .. } => {
                    uninstall_npm_global_package(package).await?;
                }
                registry::AgentDistribution::Uvx { .. } => {
                    binary_cache::clear_uvx_agent_prepared(agent_type)?;
                }
            }
        }

        agent_setting_service::set_installed_version(&db.conn, agent_type, None)
            .await
            .map_err(|e| AcpError::protocol(e.to_string()))?;
        emit_acp_agents_updated(emitter, "agent_uninstalled", Some(agent_type));
        Ok(())
    }
    .await;

    match &result {
        Ok(()) => {
            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Completed,
                format!("{} uninstalled successfully", meta.name),
            );
        }
        Err(e) => {
            emit_agent_install_event(
                emitter,
                &task_id,
                AgentInstallEventKind::Failed,
                e.to_string(),
            );
        }
    }
    result
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_uninstall_agent(
    agent_type: AgentType,
    task_id: String,
    db: State<'_, AppDatabase>,
    app: tauri::AppHandle,
) -> Result<(), AcpError> {
    let emitter = EventEmitter::Tauri(app);
    acp_uninstall_agent_core(agent_type, task_id, &db, &emitter).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_install_pi_binary(
    task_id: String,
    app: tauri::AppHandle,
) -> Result<(), AcpError> {
    let emitter = EventEmitter::Tauri(app);
    acp_install_pi_binary_core(task_id, &emitter).await
}

/// Uninstall the global `pi` binary. Mirrors `acp_uninstall_agent_core`'s event
/// envelope; the npm subprocess output isn't streamed (the shared helper
/// collects it via `.output()`), but the Started/Log/Completed/Failed events
/// drive the same install-log block in the panel.
pub(crate) async fn acp_uninstall_pi_binary_core(
    task_id: String,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    emit_agent_install_event(emitter, &task_id, AgentInstallEventKind::Started, "");
    emit_agent_install_event(
        emitter,
        &task_id,
        AgentInstallEventKind::Log,
        format!("$ npm uninstall -g {PI_CODING_AGENT_PACKAGE}"),
    );

    let result = uninstall_npm_global_package(PI_CODING_AGENT_PACKAGE).await;

    match &result {
        Ok(()) => emit_agent_install_event(
            emitter,
            &task_id,
            AgentInstallEventKind::Completed,
            "pi uninstalled successfully",
        ),
        Err(e) => emit_agent_install_event(
            emitter,
            &task_id,
            AgentInstallEventKind::Failed,
            e.to_string(),
        ),
    }
    result
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_uninstall_pi_binary(
    task_id: String,
    app: tauri::AppHandle,
) -> Result<(), AcpError> {
    let emitter = EventEmitter::Tauri(app);
    acp_uninstall_pi_binary_core(task_id, &emitter).await
}

pub(crate) async fn acp_reorder_agents_core(
    agent_types: &[AgentType],
    db: &AppDatabase,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    if agent_types.is_empty() {
        return Ok(());
    }
    agent_setting_service::reorder(&db.conn, agent_types)
        .await
        .map_err(|e| {
            let message = e.to_string();
            if message.contains("database or disk is full") || message.contains("(code: 13)") {
                AcpError::protocol("无法保存排序：数据库可写空间不足。请释放磁盘空间后重试。")
            } else {
                AcpError::protocol(message)
            }
        })?;
    emit_acp_agents_updated(emitter, "agent_reordered", None);
    Ok(())
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_reorder_agents(
    agent_types: Vec<AgentType>,
    db: State<'_, AppDatabase>,
    app: tauri::AppHandle,
) -> Result<(), AcpError> {
    let emitter = EventEmitter::Tauri(app);
    acp_reorder_agents_core(&agent_types, &db, &emitter).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_list_agent_skills(
    agent_type: AgentType,
    workspace_path: Option<String>,
) -> Result<AgentSkillsListResult, AcpError> {
    let Some(spec) = skill_storage_spec(agent_type) else {
        return Ok(AgentSkillsListResult {
            supported: false,
            message: Some(format!("{agent_type} 暂不支持在设置页管理 Skills")),
            locations: Vec::new(),
            skills: Vec::new(),
        });
    };

    let mut locations = Vec::new();
    let mut skills_by_key: BTreeMap<String, AgentSkillItem> = BTreeMap::new();

    for dir in &spec.global_dirs {
        locations.push(AgentSkillLocation {
            scope: AgentSkillScope::Global,
            path: dir.to_string_lossy().to_string(),
            exists: dir.exists(),
        });
        let listed = list_skills_from_dir(AgentSkillScope::Global, dir, spec.kind)?;
        for skill in listed {
            let key = format!("global:{}", skill.id);
            skills_by_key.entry(key).or_insert(skill);
        }
    }

    if let Some(workspace) = workspace_path.as_deref().map(str::trim) {
        if !workspace.is_empty() {
            for relative in &spec.project_rel_dirs {
                let project_dir = PathBuf::from(workspace).join(relative);
                locations.push(AgentSkillLocation {
                    scope: AgentSkillScope::Project,
                    path: project_dir.to_string_lossy().to_string(),
                    exists: project_dir.exists(),
                });
                let listed =
                    list_skills_from_dir(AgentSkillScope::Project, &project_dir, spec.kind)?;
                for skill in listed {
                    let key = format!("project:{}", skill.id);
                    skills_by_key.entry(key).or_insert(skill);
                }
            }
        }
    }

    let mut skills = skills_by_key.into_values().collect::<Vec<_>>();
    for skill in &mut skills {
        if is_read_only_skill_path(agent_type, Path::new(&skill.path)) {
            skill.read_only = true;
        }
    }
    skills.sort_by(|a, b| {
        scope_rank(a.scope)
            .cmp(&scope_rank(b.scope))
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(AgentSkillsListResult {
        supported: true,
        message: None,
        locations,
        skills,
    })
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_read_agent_skill(
    agent_type: AgentType,
    scope: AgentSkillScope,
    skill_id: String,
    workspace_path: Option<String>,
) -> Result<AgentSkillContent, AcpError> {
    let Some(spec) = skill_storage_spec(agent_type) else {
        return Err(AcpError::protocol(format!(
            "{agent_type} skills are not supported in Settings yet"
        )));
    };
    let id = validate_skill_id(&skill_id)?;
    let dirs = scoped_skill_dirs(agent_type, scope, workspace_path.as_deref())?;

    let mut skill = locate_existing_skill_across_dirs(&dirs, spec.kind, &id, scope)
        .ok_or_else(|| AcpError::protocol(format!("skill not found: {id}")))?;
    if is_read_only_skill_path(agent_type, Path::new(&skill.path)) {
        skill.read_only = true;
    }
    let content_path = skill_content_path(skill.layout, Path::new(&skill.path));
    let content = fs::read_to_string(&content_path)
        .map_err(|e| AcpError::protocol(format!("failed to read skill content: {e}")))?;
    Ok(AgentSkillContent { skill, content })
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_save_agent_skill(
    agent_type: AgentType,
    scope: AgentSkillScope,
    skill_id: String,
    content: String,
    workspace_path: Option<String>,
    layout: Option<AgentSkillLayout>,
) -> Result<AgentSkillItem, AcpError> {
    let Some(spec) = skill_storage_spec(agent_type) else {
        return Err(AcpError::protocol(format!(
            "{agent_type} skills are not supported in Settings yet"
        )));
    };
    let id = validate_skill_id(&skill_id)?;
    let dirs = scoped_skill_dirs(agent_type, scope, workspace_path.as_deref())?;
    let preferred_dir = preferred_scope_skill_dir(agent_type, scope, workspace_path.as_deref())?;

    fs::create_dir_all(&preferred_dir)
        .map_err(|e| AcpError::protocol(format!("failed to create skills directory: {e}")))?;

    let existing = locate_existing_skill_across_dirs(&dirs, spec.kind, &id, scope);
    if let Some(ref item) = existing {
        if is_read_only_skill_path(agent_type, Path::new(&item.path)) {
            return Err(AcpError::protocol(format!(
                "skill '{id}' is a built-in system skill and cannot be modified"
            )));
        }
    }
    let mut skill = if let Some(item) = existing {
        item
    } else {
        let new_layout = match spec.kind {
            SkillStorageKind::SkillDirectoryOnly => AgentSkillLayout::SkillDirectory,
            SkillStorageKind::SkillDirectoryOrMarkdownFile => {
                layout.unwrap_or(AgentSkillLayout::MarkdownFile)
            }
        };
        let skill_path = match new_layout {
            AgentSkillLayout::SkillDirectory => preferred_dir.join(&id),
            AgentSkillLayout::MarkdownFile => preferred_dir.join(format!("{id}.md")),
        };
        build_skill_item(id.clone(), scope, new_layout, skill_path)
    };

    let skill_path = PathBuf::from(&skill.path);
    let content_path = skill_content_path(skill.layout, &skill_path);

    if skill.layout == AgentSkillLayout::SkillDirectory {
        fs::create_dir_all(&skill_path).map_err(|e| {
            AcpError::protocol(format!(
                "failed to create skill directory '{}': {e}",
                skill.path
            ))
        })?;
    } else if let Some(parent) = content_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            AcpError::protocol(format!("failed to create skill parent directory: {e}"))
        })?;
    }

    fs::write(&content_path, content)
        .map_err(|e| AcpError::protocol(format!("failed to write skill content: {e}")))?;

    // Also save a copy to the user central store (~/.veryagent/user-skills/<id>/)
    // so the skill can be enabled/disabled per agent without losing content.
    if scope == AgentSkillScope::Global {
        let central_root = user_skills_dir();
        if let Err(e) = fs::create_dir_all(&central_root) {
            tracing::warn!("[Skills] failed to create user skills dir: {e}");
        }
        let central_path = if skill.layout == AgentSkillLayout::SkillDirectory {
            let dir = central_root.join(&id);
            if let Err(e) = fs::create_dir_all(&dir) {
                tracing::warn!("[Skills] failed to create central skill dir: {e}");
            }
            dir.join("SKILL.md")
        } else {
            central_root.join(format!("{id}.md"))
        };
        // Only copy the content file, not the full directory
        if let Err(e) = fs::copy(&content_path, &central_path) {
            tracing::warn!("[Skills] failed to save to central store: {e}");
        }
    }

    // Re-read the name, description, and category from the freshly written
    // frontmatter so the returned item reflects the user's actual name and
    // category grouping (not the id or none).
    skill.name = read_skill_name(&content_path).unwrap_or_else(|| skill_name_from_id(&id));
    skill.description = read_skill_description(&content_path);
    skill.category = read_skill_category(&content_path);

    Ok(skill)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_delete_agent_skill(
    agent_type: AgentType,
    scope: AgentSkillScope,
    skill_id: String,
    workspace_path: Option<String>,
) -> Result<(), AcpError> {
    let Some(spec) = skill_storage_spec(agent_type) else {
        return Err(AcpError::protocol(format!(
            "{agent_type} skills are not supported in Settings yet"
        )));
    };
    let id = validate_skill_id(&skill_id)?;
    let dirs = scoped_skill_dirs(agent_type, scope, workspace_path.as_deref())?;

    let skill = locate_existing_skill_across_dirs(&dirs, spec.kind, &id, scope)
        .ok_or_else(|| AcpError::protocol(format!("skill not found: {id}")))?;
    if is_read_only_skill_path(agent_type, Path::new(&skill.path)) {
        return Err(AcpError::protocol(format!(
            "skill '{id}' is a built-in system skill and cannot be deleted"
        )));
    }
    let skill_path = PathBuf::from(&skill.path);
    remove_skill_entry(&skill_path)
        .map_err(|e| AcpError::protocol(format!("failed to delete skill entry: {e}")))?;
    Ok(())
}

/// Enable a custom skill: copy from user central store to agent's skill dir.
/// If the skill doesn't exist in the central store, it's created there first.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_enable_custom_skill(
    agent_type: AgentType,
    skill_id: String,
) -> Result<(), AcpError> {
    let id = validate_skill_id(&skill_id)
        .map_err(|e| AcpError::protocol(e.to_string()))?;
    let central = user_skills_dir().join(&id);
    if !central.exists() {
        return Err(AcpError::protocol(format!(
            "custom skill '{id}' not found in central store"
        )));
    }
    let agent_dir = preferred_scope_skill_dir(agent_type, AgentSkillScope::Global, None)
        .map_err(|_| AcpError::protocol(format!("{agent_type} does not support skills")))?;
    let target = agent_dir.join(&id);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| AcpError::protocol(e.to_string()))?;
    }
    // Remove existing, then copy fresh
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| AcpError::protocol(e.to_string()))?;
    }
    copy_dir_recursive(&central, &target).map_err(|e| AcpError::protocol(e.to_string()))?;
    Ok(())
}

/// Disable a custom skill: remove from agent's skill dir but keep in central store.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_disable_custom_skill(
    agent_type: AgentType,
    skill_id: String,
) -> Result<(), AcpError> {
    let id = validate_skill_id(&skill_id)
        .map_err(|e| AcpError::protocol(e.to_string()))?;
    let dirs = scoped_skill_dirs(agent_type, AgentSkillScope::Global, None)
        .map_err(|_| AcpError::protocol(format!("{agent_type} does not support skills")))?;
    for dir in dirs {
        let candidate = dir.join(&id);
        if candidate.exists() {
            remove_skill_entry(&candidate)
                .map_err(|e| AcpError::protocol(format!("failed to remove skill: {e}")))?;
        }
    }
    Ok(())
}

pub(crate) async fn opencode_list_plugins_core() -> Result<PluginCheckSummary, AcpError> {
    opencode_plugins::check_opencode_plugins(None).map_err(AcpError::Protocol)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn opencode_list_plugins() -> Result<PluginCheckSummary, AcpError> {
    opencode_list_plugins_core().await
}

pub(crate) async fn opencode_provider_catalog_core(
    data_dir: &Path,
    force_refresh: bool,
) -> Vec<crate::acp::opencode_catalog::CatalogProvider> {
    crate::acp::opencode_catalog::provider_catalog(data_dir, force_refresh).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn opencode_provider_catalog(
    force_refresh: Option<bool>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<crate::acp::opencode_catalog::CatalogProvider>, AcpError> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| PathBuf::from("."));
    Ok(opencode_provider_catalog_core(&data_dir, force_refresh.unwrap_or(false)).await)
}

pub(crate) async fn opencode_install_plugins_core(
    names: Option<Vec<String>>,
    task_id: String,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    opencode_plugins::install_missing_plugins(names, task_id, emitter)
        .await
        .map_err(AcpError::Protocol)
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn opencode_install_plugins(
    names: Option<Vec<String>>,
    task_id: String,
    app: tauri::AppHandle,
) -> Result<(), AcpError> {
    let emitter = EventEmitter::Tauri(app);
    opencode_install_plugins_core(names, task_id, &emitter).await
}

pub(crate) async fn opencode_uninstall_plugin_core(
    name: String,
) -> Result<PluginCheckSummary, AcpError> {
    opencode_plugins::uninstall_plugin(name)
        .await
        .map_err(AcpError::Protocol)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn opencode_uninstall_plugin(name: String) -> Result<PluginCheckSummary, AcpError> {
    opencode_uninstall_plugin_core(name).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDeviceCodePollResult {
    pub status: String,
    pub message: Option<String>,
    pub id_token: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub account_id: Option<String>,
}

#[derive(Deserialize)]
struct DeviceCodeUserCodeResp {
    device_auth_id: String,
    #[serde(alias = "usercode")]
    user_code: String,
    #[serde(
        default = "default_interval",
        deserialize_with = "deserialize_interval"
    )]
    interval: u64,
}

fn deserialize_interval<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de;
    let value = serde_json::Value::deserialize(deserializer)?;
    match &value {
        serde_json::Value::Number(n) => n
            .as_u64()
            .ok_or_else(|| de::Error::custom(format!("invalid interval number: {n}"))),
        serde_json::Value::String(s) => s.trim().parse::<u64>().map_err(de::Error::custom),
        _ => Err(de::Error::custom(format!(
            "unexpected interval type: {value}"
        ))),
    }
}

#[derive(Deserialize)]
struct DeviceCodeTokenResp {
    authorization_code: String,
    #[allow(dead_code)]
    code_challenge: String,
    code_verifier: String,
}

#[derive(Deserialize)]
struct OAuthTokenResp {
    id_token: String,
    access_token: String,
    refresh_token: String,
}

pub(crate) async fn codex_request_device_code_core() -> Result<CodexDeviceCodeResponse, AcpError> {
    let client = reqwest::Client::new();
    let url = format!("{CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode");
    let body = serde_json::json!({ "client_id": CODEX_OAUTH_CLIENT_ID });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| AcpError::protocol(format!("device code request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AcpError::protocol(format!(
            "device code request returned {status}: {text}"
        )));
    }

    let raw_body = resp
        .text()
        .await
        .map_err(|e| AcpError::protocol(format!("read device code response failed: {e}")))?;
    let uc: DeviceCodeUserCodeResp = serde_json::from_str(&raw_body).map_err(|e| {
        AcpError::protocol(format!(
            "parse device code response failed: {e} | body: {raw_body}"
        ))
    })?;

    Ok(CodexDeviceCodeResponse {
        user_code: uc.user_code,
        verification_url: format!("{CODEX_OAUTH_ISSUER}/codex/device"),
        device_auth_id: uc.device_auth_id,
        interval: uc.interval,
    })
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn codex_request_device_code() -> Result<CodexDeviceCodeResponse, AcpError> {
    codex_request_device_code_core().await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn codex_poll_device_code(
    device_auth_id: String,
    user_code: String,
) -> Result<CodexDeviceCodePollResult, AcpError> {
    codex_poll_device_code_core(device_auth_id, user_code).await
}

pub(crate) async fn codex_poll_device_code_core(
    device_auth_id: String,
    user_code: String,
) -> Result<CodexDeviceCodePollResult, AcpError> {
    let client = reqwest::Client::new();
    let poll_url = format!("{CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token");
    let poll_body = serde_json::json!({
        "device_auth_id": device_auth_id,
        "user_code": user_code,
    });

    let resp = client
        .post(&poll_url)
        .json(&poll_body)
        .send()
        .await
        .map_err(|e| AcpError::protocol(format!("device code poll failed: {e}")))?;

    if !resp.status().is_success() {
        return Ok(CodexDeviceCodePollResult {
            status: "pending".into(),
            message: None,
            id_token: None,
            access_token: None,
            refresh_token: None,
            account_id: None,
        });
    }

    let code_resp: DeviceCodeTokenResp = resp
        .json()
        .await
        .map_err(|e| AcpError::protocol(format!("parse poll response failed: {e}")))?;

    let redirect_uri = format!("{CODEX_OAUTH_ISSUER}/deviceauth/callback");
    let token_url = format!("{CODEX_OAUTH_ISSUER}/oauth/token");

    let token_resp = client
        .post(&token_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!(
            "grant_type=authorization_code&code={}&redirect_uri={}&client_id={}&code_verifier={}",
            urlencoding::encode(&code_resp.authorization_code),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode(CODEX_OAUTH_CLIENT_ID),
            urlencoding::encode(&code_resp.code_verifier),
        ))
        .send()
        .await
        .map_err(|e| AcpError::protocol(format!("token exchange failed: {e}")))?;

    if !token_resp.status().is_success() {
        let status = token_resp.status();
        let text = token_resp.text().await.unwrap_or_default();
        return Ok(CodexDeviceCodePollResult {
            status: "error".into(),
            message: Some(format!("token exchange returned {status}: {text}")),
            id_token: None,
            access_token: None,
            refresh_token: None,
            account_id: None,
        });
    }

    let tokens: OAuthTokenResp = token_resp
        .json()
        .await
        .map_err(|e| AcpError::protocol(format!("parse token response failed: {e}")))?;

    let account_id = extract_jwt_account_id(&tokens.id_token).unwrap_or_default();

    Ok(CodexDeviceCodePollResult {
        status: "success".into(),
        message: None,
        id_token: Some(tokens.id_token),
        access_token: Some(tokens.access_token),
        refresh_token: Some(tokens.refresh_token),
        account_id: Some(account_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openclaw_strip_json5_noise_handles_comments_and_trailing_commas() {
        let raw = r#"{
          // comment
          "gateway": {
            "port": 19001, /* block */
            "remote": { "url": "ws://127.0.0.1:19001", },
          },
        }"#;
        let cleaned = strip_json5_noise(raw);
        let value: serde_json::Value = serde_json::from_str(&cleaned).expect("json");
        assert_eq!(openclaw_json_port(&value), Some(19001));
        assert_eq!(
            openclaw_json_str(&value, &["gateway", "remote", "url"]).as_deref(),
            Some("ws://127.0.0.1:19001")
        );
    }

    #[test]
    fn normalize_openclaw_openai_base_url_adds_v1_and_strips_chat() {
        assert_eq!(
            normalize_openclaw_openai_base_url("https://api.example.com"),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_openclaw_openai_base_url("https://api.example.com/v1/"),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_openclaw_openai_base_url(
                "https://api.example.com/v1/chat/completions"
            ),
            "https://api.example.com/v1"
        );
        assert_eq!(normalize_openclaw_openai_base_url("  "), "");
    }

    #[test]
    fn write_openclaw_managed_provider_merges_custom_provider_and_default_model() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("openclaw.json");
        fs::write(
            &path,
            r#"{ "gateway": { "mode": "local", "port": 18789 }, "agents": { "defaults": { "workspace": "W" } } }"#,
        )
        .expect("seed");
        // openclaw_config_path honors OPENCLAW_CONFIG_PATH.
        // SAFETY: test-only env mutation; serialized by cargo test default.
        unsafe {
            std::env::set_var("OPENCLAW_CONFIG_PATH", &path);
        }
        write_openclaw_managed_provider(
            "https://proxy.example.com",
            "sk-test",
            Some("my-model"),
        )
        .expect("write");
        unsafe {
            std::env::remove_var("OPENCLAW_CONFIG_PATH");
        }

        let raw = fs::read_to_string(&path).expect("read");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("json");
        assert_eq!(
            value["models"]["providers"]["veryagent"]["baseUrl"].as_str(),
            Some("https://proxy.example.com/v1")
        );
        assert_eq!(
            value["models"]["providers"]["veryagent"]["apiKey"].as_str(),
            Some("sk-test")
        );
        assert_eq!(
            value["models"]["providers"]["veryagent"]["api"].as_str(),
            Some("openai-completions")
        );
        assert_eq!(
            value["models"]["providers"]["veryagent"]["models"][0]["id"].as_str(),
            Some("my-model")
        );
        assert_eq!(
            value["agents"]["defaults"]["model"]["primary"].as_str(),
            Some("veryagent/my-model")
        );
        // Existing gateway settings preserved.
        assert_eq!(value["gateway"]["port"].as_u64(), Some(18789));
        assert_eq!(
            value["agents"]["defaults"]["workspace"].as_str(),
            Some("W")
        );
    }

    #[test]
    fn write_codebuddy_managed_provider_writes_chat_completions_model() {
        let tmp = tempfile::tempdir().expect("tempdir");
        // resolve_codebuddy_config_dir honors CODEBUDDY_CONFIG_DIR.
        // SAFETY: test-only env mutation.
        unsafe {
            std::env::set_var("CODEBUDDY_CONFIG_DIR", tmp.path());
        }
        // Preserve a non-managed custom model; replace a previous A计划 entry.
        let seed = serde_json::json!({
            "models": [
                {
                    "id": "user-custom",
                    "name": "User Custom",
                    "vendor": "OpenAI",
                    "url": "https://other.example.com/v1/chat/completions",
                    "apiKey": "sk-user"
                },
                {
                    "id": "stale-model",
                    "name": "stale-model",
                    "vendor": "A计划",
                    "url": "https://old.example.com/v1/chat/completions",
                    "apiKey": "sk-old"
                }
            ]
        });
        fs::write(
            tmp.path().join("models.json"),
            serde_json::to_string_pretty(&seed).unwrap(),
        )
        .expect("seed");

        write_codebuddy_managed_provider(
            "https://gateway.example.com",
            "sk-a-plan",
            "MiniMax-M2.7",
            &[],
        )
        .expect("write");
        unsafe {
            std::env::remove_var("CODEBUDDY_CONFIG_DIR");
        }

        let raw = fs::read_to_string(tmp.path().join("models.json")).expect("read");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("json");
        let models = value["models"].as_array().expect("models array");
        // Stale A计划 entry gone; user custom kept; new selection present.
        assert_eq!(models.len(), 2);
        let managed = models
            .iter()
            .find(|m| m["id"].as_str() == Some("MiniMax-M2.7"))
            .expect("managed model");
        assert_eq!(
            managed["url"].as_str(),
            Some("https://gateway.example.com/v1/chat/completions")
        );
        assert_eq!(managed["apiKey"].as_str(), Some("sk-a-plan"));
        assert_eq!(managed["vendor"].as_str(), Some("A计划"));
        assert!(
            models
                .iter()
                .any(|m| m["id"].as_str() == Some("user-custom")),
            "non-managed custom model must be preserved"
        );
        assert!(
            !models
                .iter()
                .any(|m| m["id"].as_str() == Some("stale-model")),
            "previous A计划 entry must be replaced"
        );
        // availableModels must stay absent so native Tencent built-ins remain
        // visible alongside additive custom models.
        assert!(
            value.get("availableModels").is_none(),
            "must not write availableModels (would hide native models)"
        );
    }

    #[test]
    fn codebuddy_chat_completions_url_normalizes_base() {
        assert_eq!(
            codebuddy_chat_completions_url("https://api.example.com"),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            codebuddy_chat_completions_url("https://api.example.com/v1/"),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            codebuddy_chat_completions_url(
                "https://api.example.com/v1/chat/completions"
            ),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(codebuddy_chat_completions_url("  "), "");
    }

    #[test]
    fn openclaw_discovery_uses_config_remote_url_and_token() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("openclaw.json");
        fs::write(
            &path,
            r#"{
              "gateway": {
                "port": 19002,
                "remote": {
                  "url": "ws://192.168.1.10:19002",
                  "token": "remote-tok"
                }
              }
            }"#,
        )
        .unwrap();
        let d = discover_openclaw_gateway_from(path.clone(), None, None, None);
        assert!(d.config_exists);
        assert!(d.config_parsed);
        assert_eq!(d.gateway_url.as_deref(), Some("ws://192.168.1.10:19002"));
        assert_eq!(d.gateway_url_source.as_deref(), Some("config_remote_url"));
        assert_eq!(d.gateway_token.as_deref(), Some("remote-tok"));
        assert_eq!(
            d.gateway_token_source.as_deref(),
            Some("config_remote_token")
        );
        assert_eq!(d.gateway_port, Some(19002));
    }

    #[test]
    fn openclaw_discovery_builds_url_from_config_port_only() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("openclaw.json");
        fs::write(&path, r#"{ "gateway": { "port": 19003 } }"#).unwrap();
        let d = discover_openclaw_gateway_from(path, None, None, None);
        assert_eq!(d.gateway_url.as_deref(), Some("ws://127.0.0.1:19003"));
        assert_eq!(d.gateway_url_source.as_deref(), Some("config_port"));
        assert_eq!(d.gateway_port, Some(19003));
        assert!(d.gateway_token.is_none());
    }

    #[test]
    fn openclaw_discovery_env_url_wins_over_config() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("openclaw.json");
        fs::write(
            &path,
            r#"{ "gateway": { "remote": { "url": "ws://from-config:1", "token": "cfg" } } }"#,
        )
        .unwrap();
        let d = discover_openclaw_gateway_from(
            path,
            Some("ws://from-env:2".into()),
            None,
            Some("env-tok".into()),
        );
        assert_eq!(d.gateway_url.as_deref(), Some("ws://from-env:2"));
        assert_eq!(d.gateway_url_source.as_deref(), Some("env"));
        assert_eq!(d.gateway_token.as_deref(), Some("env-tok"));
        assert_eq!(d.gateway_token_source.as_deref(), Some("env"));
    }

    #[test]
    fn openclaw_discovery_missing_config_is_empty_not_default_port() {
        let path = PathBuf::from("/definitely/missing/openclaw-no-such.json");
        let d = discover_openclaw_gateway_from(path, None, None, None);
        assert!(!d.config_exists);
        assert!(!d.config_parsed);
        assert!(d.gateway_url.is_none());
        assert!(d.gateway_token.is_none());
        assert!(d.gateway_port.is_none());
    }

    #[test]
    fn openclaw_discovery_skips_env_placeholder_auth_token() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("openclaw.json");
        fs::write(
            &path,
            r#"{ "gateway": { "auth": { "token": "${OPENCLAW_GATEWAY_TOKEN}" }, "port": 19004 } }"#,
        )
        .unwrap();
        let d = discover_openclaw_gateway_from(path, None, None, None);
        assert_eq!(d.gateway_url.as_deref(), Some("ws://127.0.0.1:19004"));
        assert!(d.gateway_token.is_none());
    }

    /// Build a `runtime_env` whose `PI_CODING_AGENT_DIR` points at `agent_dir`,
    /// so trust seeding writes a tempdir's `trust.json` instead of `~/.pi/agent`.
    fn pi_env_for(agent_dir: &Path) -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();
        env.insert(
            "PI_CODING_AGENT_DIR".to_string(),
            agent_dir.to_string_lossy().to_string(),
        );
        env
    }

    fn canonical_key(dir: &Path) -> String {
        fs::canonicalize(dir)
            .expect("canonicalize")
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn pi_trust_seed_creates_file_and_trusts_canonical_cwd() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let agent_dir = tmp.path().join("agent");
        let workspace = tmp.path().join("workspace");
        fs::create_dir_all(&workspace).unwrap();

        seed_pi_workspace_trust(&workspace, &pi_env_for(&agent_dir));

        let map = read_json_object_or_empty(&agent_dir.join("trust.json"));
        assert_eq!(
            map.get(&canonical_key(&workspace)),
            Some(&serde_json::Value::Bool(true)),
            "the opened workspace must be marked trusted",
        );
    }

    #[test]
    fn pi_trust_seed_preserves_existing_entries() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let agent_dir = tmp.path().join("agent");
        fs::create_dir_all(&agent_dir).unwrap();
        let workspace = tmp.path().join("ws");
        fs::create_dir_all(&workspace).unwrap();

        // Pre-existing decisions for unrelated folders must survive untouched.
        let mut initial = serde_json::Map::new();
        initial.insert("/some/other".to_string(), serde_json::Value::Bool(true));
        initial.insert("/denied".to_string(), serde_json::Value::Bool(false));
        write_json_object_pretty(&agent_dir.join("trust.json"), &initial).unwrap();

        seed_pi_workspace_trust(&workspace, &pi_env_for(&agent_dir));

        let map = read_json_object_or_empty(&agent_dir.join("trust.json"));
        assert_eq!(map.get("/some/other"), Some(&serde_json::Value::Bool(true)));
        assert_eq!(map.get("/denied"), Some(&serde_json::Value::Bool(false)));
        assert_eq!(
            map.get(&canonical_key(&workspace)),
            Some(&serde_json::Value::Bool(true)),
        );
    }

    #[test]
    fn pi_trust_seed_respects_existing_false_and_is_idempotent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let agent_dir = tmp.path().join("agent");
        fs::create_dir_all(&agent_dir).unwrap();
        let workspace = tmp.path().join("ws");
        fs::create_dir_all(&workspace).unwrap();
        let key = canonical_key(&workspace);
        let env = pi_env_for(&agent_dir);

        // The user explicitly distrusted this exact folder in pi: never overwrite.
        let mut initial = serde_json::Map::new();
        initial.insert(key.clone(), serde_json::Value::Bool(false));
        write_json_object_pretty(&agent_dir.join("trust.json"), &initial).unwrap();

        seed_pi_workspace_trust(&workspace, &env);
        let map = read_json_object_or_empty(&agent_dir.join("trust.json"));
        assert_eq!(
            map.get(&key),
            Some(&serde_json::Value::Bool(false)),
            "an explicit deny must be preserved (additive-only)",
        );

        // Idempotent: seeding an already-trusted folder must not rewrite the file.
        let mut trusted = serde_json::Map::new();
        trusted.insert(key.clone(), serde_json::Value::Bool(true));
        write_json_object_pretty(&agent_dir.join("trust.json"), &trusted).unwrap();
        let mtime1 = fs::metadata(agent_dir.join("trust.json"))
            .unwrap()
            .modified()
            .unwrap();
        seed_pi_workspace_trust(&workspace, &env);
        assert_eq!(
            fs::metadata(agent_dir.join("trust.json"))
                .unwrap()
                .modified()
                .unwrap(),
            mtime1,
            "a no-op seed must not rewrite trust.json",
        );
    }

    #[test]
    fn pi_trust_seed_disabled_writes_nothing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let agent_dir = tmp.path().join("agent");
        let workspace = tmp.path().join("ws");
        fs::create_dir_all(&workspace).unwrap();

        let mut env = pi_env_for(&agent_dir);
        env.insert(PI_TRUST_WORKSPACE_ENV.to_string(), "0".to_string());
        seed_pi_workspace_trust(&workspace, &env);

        assert!(
            !agent_dir.join("trust.json").exists(),
            "a disabled toggle must not touch trust.json",
        );
    }

    #[test]
    fn pi_trust_seed_leaves_unparseable_file_untouched() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let agent_dir = tmp.path().join("agent");
        fs::create_dir_all(&agent_dir).unwrap();
        let workspace = tmp.path().join("ws");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(agent_dir.join("trust.json"), "not json at all").unwrap();

        seed_pi_workspace_trust(&workspace, &pi_env_for(&agent_dir));

        assert_eq!(
            fs::read_to_string(agent_dir.join("trust.json")).unwrap(),
            "not json at all",
            "a present-but-unparseable trust.json must never be clobbered",
        );
    }

    #[test]
    fn opencode_auth_empty_payload_truncates_to_empty_object() {
        // Clearing the last credential sends "" — it must persist `{}` (clearing
        // the file), not be skipped (which would strand a stale key on disk).
        assert_eq!(
            opencode_auth_payload_to_write(Some("")),
            Some("{}".to_string())
        );
        assert_eq!(
            opencode_auth_payload_to_write(Some("   \n")),
            Some("{}".to_string())
        );
    }

    #[test]
    fn opencode_auth_payload_preserves_non_empty_and_skips_none() {
        let json = r#"{"openai":{"type":"api","key":"k"}}"#;
        assert_eq!(
            opencode_auth_payload_to_write(Some(json)),
            Some(json.to_string())
        );
        // No payload supplied → leave auth.json untouched.
        assert_eq!(opencode_auth_payload_to_write(None), None);
    }

    // Call-site guard: both acp_update_agent_config_core and
    // acp_update_agent_preferences_core route OpenCode persistence through
    // persist_opencode_native_config, so testing it covers both exposed paths.
    #[test]
    fn persist_opencode_native_config_empty_auth_clears_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        // Pin HOME and clear XDG_DATA_HOME so the auth path resolves under the
        // temp dir regardless of the developer's environment.
        temp_env::with_vars(
            [
                ("HOME", Some(tmp.path())),
                ("XDG_DATA_HOME", None::<&std::path::Path>),
            ],
            || {
                let auth_path = opencode_auth_json_path();
                fs::create_dir_all(auth_path.parent().unwrap()).expect("mkdir");
                fs::write(&auth_path, r#"{"openai":{"type":"api","key":"k"}}"#).expect("seed");

                // Disconnecting the last provider sends an empty auth payload: it
                // must truncate auth.json to {}, not strand the stale credential.
                persist_opencode_native_config(Some(""), None).expect("persist");

                assert_eq!(fs::read_to_string(&auth_path).unwrap().trim(), "{}");
            },
        );
    }

    #[test]
    fn persist_opencode_native_config_none_auth_leaves_file() {
        let tmp = tempfile::tempdir().expect("tempdir");
        temp_env::with_vars(
            [
                ("HOME", Some(tmp.path())),
                ("XDG_DATA_HOME", None::<&std::path::Path>),
            ],
            || {
                let auth_path = opencode_auth_json_path();
                fs::create_dir_all(auth_path.parent().unwrap()).expect("mkdir");
                let original = "{\"openai\":{\"type\":\"api\",\"key\":\"k\"}}\n";
                fs::write(&auth_path, original).expect("seed");

                // No auth payload supplied → file untouched.
                persist_opencode_native_config(None, None).expect("persist");

                assert_eq!(fs::read_to_string(&auth_path).unwrap(), original);
            },
        );
    }

    #[test]
    fn opencode_config_path_falls_back_when_xdg_config_home_empty() {
        // An empty XDG_CONFIG_HOME must fall back to <home>/.config, not resolve
        // to a relative "opencode/opencode.json". `dirs::home_dir()` ignores the
        // HOME env var on Windows, so derive the expected base from the same
        // resolution production uses instead of pinning HOME.
        temp_env::with_var("XDG_CONFIG_HOME", Some(""), || {
            assert_eq!(
                opencode_primary_config_path(),
                home_dir_or_default()
                    .join(".config")
                    .join("opencode")
                    .join("opencode.json")
            );
        });
    }

    #[test]
    fn opencode_paths_follow_xdg_when_set() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let cfg = tmp.path().join("xdg-config");
        let data = tmp.path().join("xdg-data");
        temp_env::with_vars(
            [
                ("HOME", Some(tmp.path())),
                ("XDG_CONFIG_HOME", Some(cfg.as_path())),
                ("XDG_DATA_HOME", Some(data.as_path())),
            ],
            || {
                assert_eq!(
                    opencode_primary_config_path(),
                    cfg.join("opencode").join("opencode.json")
                );
                assert_eq!(
                    opencode_auth_json_path(),
                    data.join("opencode").join("auth.json")
                );
            },
        );
    }

    #[test]
    fn codex_config_projection_tracks_model_provider_for_fingerprint() {
        // Two configs sharing one base_url but naming different providers must
        // produce different projections, so `fingerprint_config` (which hashes
        // this projection) flags a provider switch even though the resolved
        // endpoint is unchanged. codex-acp 1.0.1 reads `model_provider` from
        // config.toml directly, so it is no longer pinned into the launch env
        // where the fingerprint previously caught it incidentally.
        let veryagent = r#"
model = "gpt-5-codex"
model_provider = "veryagent"

[model_providers.veryagent]
base_url = "https://gateway.example/v1"
wire_api = "responses"

[model_providers.other]
base_url = "https://gateway.example/v1"
wire_api = "chat"
"#;
        let other = veryagent.replace(
            "model_provider = \"veryagent\"",
            "model_provider = \"other\"",
        );

        let p_veryagent = codex_config_projection_from_toml(veryagent);
        let p_other = codex_config_projection_from_toml(&other);

        assert_eq!(
            p_veryagent.get("modelProvider").and_then(|v| v.as_str()),
            Some("veryagent")
        );
        assert_eq!(
            p_other.get("modelProvider").and_then(|v| v.as_str()),
            Some("other")
        );
        // Same endpoint resolved for both providers...
        assert_eq!(p_veryagent.get("apiBaseUrl"), p_other.get("apiBaseUrl"));
        // ...yet the projections differ, so the launch-config fingerprint does too.
        assert_ne!(p_veryagent, p_other);

        // Deterministic for identical input.
        assert_eq!(codex_config_projection_from_toml(veryagent), p_veryagent);

        // `modelProvider` must NOT be an AgentRuntimeConfig key, or
        // build_runtime_env_from_setting would mirror it back into a runtime env
        // var (reintroducing the very MODEL_PROVIDER pin we removed).
        assert!(
            serde_json::from_value::<AgentRuntimeConfig>(serde_json::Value::Object(
                p_veryagent.clone()
            ))
            .is_ok()
        );

        // No model_provider declared (official OpenAI / ChatGPT) → no
        // modelProvider key, matching the pre-1.0.1 "leave MODEL_PROVIDER unset"
        // behavior; the bare `model` still projects.
        let bare = codex_config_projection_from_toml("model = \"gpt-5-codex\"\n");
        assert!(!bare.contains_key("modelProvider"));
        assert_eq!(bare.get("model").and_then(|v| v.as_str()), Some("gpt-5-codex"));

        // Malformed TOML must not panic — yields an empty projection.
        assert!(codex_config_projection_from_toml("model_provider = ").is_empty());
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("veryagent-acp-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create test directory");
        dir
    }

    #[test]
    fn kimi_code_skill_storage_spec_targets_kimi_home() {
        let spec =
            skill_storage_spec(AgentType::KimiCode).expect("Kimi Code supports skills");
        assert_eq!(spec.kind, SkillStorageKind::SkillDirectoryOnly);
        assert_eq!(spec.project_rel_dirs, vec![".kimi-code/skills"]);
        let expected = crate::parsers::kimi_code::resolve_kimi_code_home_dir().join("skills");
        assert_eq!(spec.global_dirs, vec![expected]);
    }

    #[test]
    fn pi_skill_storage_spec_targets_pi_agent_dir() {
        let spec = skill_storage_spec(AgentType::Pi).expect("Pi supports skills");
        // pi's native dir accepts standalone `.md` files, like Codex.
        assert_eq!(spec.kind, SkillStorageKind::SkillDirectoryOrMarkdownFile);
        assert_eq!(spec.project_rel_dirs, vec![".pi/skills", ".agents/skills"]);
        // Native pi dir first (preferred link target), shared store second.
        let expected = vec![
            pi_agent_dir().join("skills"),
            home_dir_or_default().join(".agents").join("skills"),
        ];
        assert_eq!(spec.global_dirs, expected);
    }

    #[test]
    fn parse_provider_model_emits_claude_custom_model_option_trio() {
        // A Claude provider that defines the custom model option must surface all
        // three ANTHROPIC_CUSTOM_MODEL_OPTION* env vars (Some => set) alongside
        // the standard model fields.
        let raw = r#"{
            "main": "gw/opus",
            "customOption": "gw/opus-preview",
            "customOptionName": "Gateway Opus",
            "customOptionDescription": "via gateway"
        }"#;
        let out = parse_provider_model(AgentType::ClaudeCode, Some(raw));
        assert_eq!(
            out.get("ANTHROPIC_CUSTOM_MODEL_OPTION"),
            Some(&Some("gw/opus-preview".to_string()))
        );
        assert_eq!(
            out.get("ANTHROPIC_CUSTOM_MODEL_OPTION_NAME"),
            Some(&Some("Gateway Opus".to_string()))
        );
        assert_eq!(
            out.get("ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION"),
            Some(&Some("via gateway".to_string()))
        );
        assert_eq!(out.get("ANTHROPIC_MODEL"), Some(&Some("gw/opus".to_string())));

        // Omitted custom keys are authoritative clears (None => remove from env),
        // matching the five model fields' overwrite semantics.
        let bare = parse_provider_model(AgentType::ClaudeCode, Some(r#"{"main":"x"}"#));
        assert_eq!(bare.get("ANTHROPIC_CUSTOM_MODEL_OPTION"), Some(&None));
        assert_eq!(bare.get("ANTHROPIC_CUSTOM_MODEL_OPTION_NAME"), Some(&None));
        assert_eq!(
            bare.get("ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION"),
            Some(&None)
        );
    }

    #[test]
    fn merge_json_values_clears_stale_custom_model_option_via_null() {
        // The local-config cascade (cascade_update_agent_config) encodes a
        // cleared model key as JSON-null. merge_json_values must DELETE that key
        // from the on-disk config (nested under `env`) while preserving sibling
        // keys — this is what stops a stale ANTHROPIC_CUSTOM_MODEL_OPTION* in
        // ~/.claude/settings.json from winning after binding to a provider that
        // omits the trio (parse_provider_model yields `None` => null here).
        let mut base = serde_json::json!({
            "env": {
                "ANTHROPIC_CUSTOM_MODEL_OPTION": "gw/opus-stale",
                "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": "Stale",
                "ANTHROPIC_MODEL": "keep-me"
            }
        });
        let patch = serde_json::json!({
            "env": {
                "ANTHROPIC_CUSTOM_MODEL_OPTION": null,
                "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": null
            }
        });
        merge_json_values(&mut base, &patch);
        let env = base
            .get("env")
            .and_then(|v| v.as_object())
            .expect("env object survives the merge");
        assert!(!env.contains_key("ANTHROPIC_CUSTOM_MODEL_OPTION"));
        assert!(!env.contains_key("ANTHROPIC_CUSTOM_MODEL_OPTION_NAME"));
        assert_eq!(
            env.get("ANTHROPIC_MODEL").and_then(|v| v.as_str()),
            Some("keep-me")
        );
    }

    #[test]
    fn fingerprint_config_is_deterministic_and_excludes_volatile_keys() {
        let agent = AgentType::Codex;
        let mut env = BTreeMap::new();
        env.insert("OPENAI_BASE_URL".to_string(), "https://a".to_string());
        env.insert("OPENAI_API_KEY".to_string(), "k1".to_string());

        // Same inputs → same fingerprint (the native-config read is identical
        // across all calls in this test, so only the env varies).
        let fp1 = fingerprint_config(agent, &env, false);
        assert_eq!(fp1, fingerprint_config(agent, &env, false));

        // Changing a real config value changes the fingerprint.
        let mut env_changed = env.clone();
        env_changed.insert("OPENAI_API_KEY".to_string(), "k2".to_string());
        assert_ne!(fp1, fingerprint_config(agent, &env_changed, false));

        // The per-launch volatile key is excluded — adding it must NOT change
        // the fingerprint (otherwise OpenClaw would look stale once a real
        // session id is assigned and the reset flag drops).
        let mut env_volatile = env.clone();
        env_volatile.insert("OPENCLAW_RESET_SESSION".to_string(), "1".to_string());
        assert_eq!(fp1, fingerprint_config(agent, &env_volatile, false));

        // Platform image toggle is part of the fingerprint (companion features).
        assert_ne!(fp1, fingerprint_config(agent, &env, true));
    }

    #[tokio::test]
    async fn find_connection_for_conversation_core_returns_info_when_bound() {
        // A live connection bound to the conversation → discovery returns its
        // id plus the current event_seq (informational; the viewer cold-attaches
        // with a full snapshot, not a cursor replay).
        use crate::acp::manager::ConnectionManager;
        use crate::models::AgentType;
        use crate::web::event_bridge::EventEmitter;

        let mgr = ConnectionManager::new();
        mgr.insert_test_connection("c1", AgentType::ClaudeCode, None, EventEmitter::Noop)
            .await;
        {
            let state = mgr.get_state("c1").await.expect("state present");
            let mut s = state.write().await;
            s.conversation_id = Some(42);
            s.event_seq = 7;
        }

        let info = acp_find_connection_for_conversation_core(&mgr, 42, None, AgentType::ClaudeCode)
            .await
            .expect("ok")
            .expect("a live connection is bound to conversation 42");
        assert_eq!(info.connection_id, "c1");
        assert_eq!(info.event_seq, 7);
    }

    #[tokio::test]
    async fn find_connection_for_conversation_core_none_when_unbound() {
        // No live connection owns the conversation → None (the client spawns +
        // owns one instead of attaching as a viewer).
        use crate::acp::manager::ConnectionManager;
        use crate::models::AgentType;
        use crate::web::event_bridge::EventEmitter;

        let mgr = ConnectionManager::new();
        mgr.insert_test_connection("c1", AgentType::ClaudeCode, None, EventEmitter::Noop)
            .await;
        assert!(
            acp_find_connection_for_conversation_core(&mgr, 999, None, AgentType::ClaudeCode)
                .await
                .expect("ok")
                .is_none()
        );
    }

    #[tokio::test]
    async fn find_connection_for_conversation_core_falls_back_to_session_id() {
        // A live connection exists with its external_id set but its
        // conversation_id NOT yet bound (the pre-first-prompt window). The
        // by-conversation lookup misses; the session_id fallback finds it, so a
        // second client opening the same historical conversation attaches as a
        // viewer instead of reusing-as-owner and later killing the connection.
        use crate::acp::manager::ConnectionManager;
        use crate::models::AgentType;
        use crate::web::event_bridge::EventEmitter;

        let mgr = ConnectionManager::new();
        mgr.insert_test_connection("c1", AgentType::ClaudeCode, None, EventEmitter::Noop)
            .await;
        {
            let state = mgr.get_state("c1").await.expect("state present");
            let mut s = state.write().await;
            s.external_id = Some("sess-abc".to_string());
            s.event_seq = 3;
            // conversation_id intentionally left None.
        }

        // by-conversation misses, no session fallback → None.
        assert!(
            acp_find_connection_for_conversation_core(&mgr, 42, None, AgentType::ClaudeCode)
                .await
                .expect("ok")
                .is_none(),
            "without a session_id fallback an unbound connection is undiscoverable"
        );

        // session fallback finds the live owner (matching agent_type).
        let info = acp_find_connection_for_conversation_core(
            &mgr,
            42,
            Some("sess-abc"),
            AgentType::ClaudeCode,
        )
        .await
        .expect("ok")
        .expect("session_id fallback finds the unbound live connection");
        assert_eq!(info.connection_id, "c1");
        assert_eq!(info.event_seq, 3);

        // a non-matching session id still misses.
        assert!(acp_find_connection_for_conversation_core(
            &mgr,
            42,
            Some("other"),
            AgentType::ClaudeCode
        )
        .await
        .expect("ok")
        .is_none());

        // the SAME session id but a DIFFERENT agent_type must NOT match
        // (external_id is unique only per agent) — otherwise a viewer could
        // attach to the wrong agent's connection.
        assert!(
            acp_find_connection_for_conversation_core(&mgr, 42, Some("sess-abc"), AgentType::Codex)
                .await
                .expect("ok")
                .is_none(),
            "external_id fallback must be scoped by agent_type"
        );
    }

    #[tokio::test]
    async fn find_connection_for_conversation_core_none_when_terminal_status() {
        // A connection bound to the conversation but already in a terminal
        // status (teardown wrote it before the map entry was removed) is NOT a
        // live attach target → None, so the viewer reads persisted detail
        // instead of attaching to a dying stream.
        use crate::acp::manager::ConnectionManager;
        use crate::models::AgentType;
        use crate::web::event_bridge::EventEmitter;

        for terminal in [ConnectionStatus::Disconnected, ConnectionStatus::Error] {
            let mgr = ConnectionManager::new();
            mgr.insert_test_connection("c1", AgentType::ClaudeCode, None, EventEmitter::Noop)
                .await;
            {
                let state = mgr.get_state("c1").await.expect("state present");
                let mut s = state.write().await;
                s.conversation_id = Some(42);
                s.status = terminal.clone();
            }
            assert!(
                acp_find_connection_for_conversation_core(&mgr, 42, None, AgentType::ClaudeCode)
                    .await
                    .expect("ok")
                    .is_none(),
                "terminal status {terminal:?} must not be returned as a live connection"
            );
        }
    }

    #[test]
    fn sanitize_custom_version_accepts_version_like_inputs() {
        assert_eq!(sanitize_custom_version("0.44.1").as_deref(), Some("0.44.1"));
        assert_eq!(
            sanitize_custom_version("  v1.2.3 ").as_deref(),
            Some("1.2.3")
        );
        assert_eq!(
            sanitize_custom_version("2026.5.20").as_deref(),
            Some("2026.5.20")
        );
        assert_eq!(
            sanitize_custom_version("1.2.3-beta.1").as_deref(),
            Some("1.2.3-beta.1")
        );
        assert_eq!(
            sanitize_custom_version("1.0.0+build.5").as_deref(),
            Some("1.0.0+build.5")
        );
    }

    #[test]
    fn sanitize_custom_version_rejects_invalid_inputs() {
        for bad in [
            "",
            "   ",
            "latest",
            "next",
            "v",
            "2",
            "v9",
            "1.2 .3",
            "1.2.3@evil",
            "../etc",
        ] {
            assert_eq!(
                sanitize_custom_version(bad),
                None,
                "expected {bad:?} rejected"
            );
        }
    }

    #[test]
    fn build_npm_install_spec_uses_registry_when_no_override() {
        assert_eq!(
            build_npm_install_spec("@google/gemini-cli@0.44.1", None).unwrap(),
            "@google/gemini-cli@0.44.1"
        );
        assert_eq!(
            build_npm_install_spec("@google/gemini-cli@0.44.1", Some("  ")).unwrap(),
            "@google/gemini-cli@0.44.1"
        );
    }

    #[test]
    fn build_npm_install_spec_applies_custom_version() {
        assert_eq!(
            build_npm_install_spec("@google/gemini-cli@0.44.1", Some("0.43.0")).unwrap(),
            "@google/gemini-cli@0.43.0"
        );
        // Scoped/plain package name is preserved; a leading `v` is stripped.
        assert_eq!(
            build_npm_install_spec("cline@3.0.9", Some("v2.0.0")).unwrap(),
            "cline@2.0.0"
        );
    }

    #[test]
    fn build_npm_install_spec_rejects_invalid_override() {
        assert!(build_npm_install_spec("cline@3.0.9", Some("latest")).is_err());
    }

    #[test]
    fn apply_custom_version_to_url_substitutes_all_occurrences() {
        // Codex URL embeds the version twice (path tag + asset filename).
        let codex = "https://github.com/zed-industries/codex-acp/releases/download/v0.15.0/codex-acp-0.15.0-aarch64-apple-darwin.tar.gz";
        assert_eq!(
            apply_custom_version_to_url(codex, "0.15.0", "0.14.0"),
            "https://github.com/zed-industries/codex-acp/releases/download/v0.14.0/codex-acp-0.14.0-aarch64-apple-darwin.tar.gz"
        );

        // OpenCode URL embeds the version once (path tag only).
        let opencode = "https://github.com/anomalyco/opencode/releases/download/v1.15.12/opencode-darwin-arm64.zip";
        assert_eq!(
            apply_custom_version_to_url(opencode, "1.15.12", "1.16.0"),
            "https://github.com/anomalyco/opencode/releases/download/v1.16.0/opencode-darwin-arm64.zip"
        );
    }

    #[test]
    fn resolves_npx_command_from_npm_prefix_bin_dir() {
        let prefix = unique_test_dir("npm-prefix");
        let bin_dir = npm_prefix_bin_dir(&prefix);
        std::fs::create_dir_all(&bin_dir).expect("create npm prefix bin directory");

        #[cfg(windows)]
        let command_path = bin_dir.join("gemini.cmd");
        #[cfg(not(windows))]
        let command_path = bin_dir.join("gemini");

        std::fs::write(&command_path, "").expect("write command shim");
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = std::fs::metadata(&command_path)
                .expect("read command shim metadata")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&command_path, permissions)
                .expect("mark command shim executable");
        }

        let resolved = resolve_npx_command_from_npm_prefix("gemini", &prefix);

        assert_eq!(resolved.as_deref(), Some(command_path.as_path()));
        let _ = std::fs::remove_dir_all(prefix);
    }

    #[tokio::test]
    async fn does_not_cache_failed_npm_global_prefix_resolution() {
        let cache = tokio::sync::OnceCell::const_new();
        let first = cached_npm_global_prefix_with(&cache, || async { None }).await;
        assert_eq!(first, None);

        let expected = PathBuf::from("npm-prefix");
        let second =
            cached_npm_global_prefix_with(&cache, || async { Some(expected.clone()) }).await;

        assert_eq!(second, Some(expected));
    }

    #[cfg(not(windows))]
    #[test]
    fn ignores_non_executable_npx_command_from_npm_prefix_bin_dir() {
        let prefix = unique_test_dir("npm-prefix-non-executable");
        let bin_dir = npm_prefix_bin_dir(&prefix);
        std::fs::create_dir_all(&bin_dir).expect("create npm prefix bin directory");
        let command_path = bin_dir.join("gemini");
        std::fs::write(&command_path, "").expect("write command shim");

        let resolved = resolve_npx_command_from_npm_prefix("gemini", &prefix);

        assert_eq!(resolved, None);
        let _ = std::fs::remove_dir_all(prefix);
    }

    fn write_skill_md(name: &str, body: &str) -> (PathBuf, PathBuf) {
        let dir = unique_test_dir(name);
        let path = dir.join("SKILL.md");
        std::fs::write(&path, body).expect("write skill markdown");
        (dir, path)
    }

    #[test]
    fn frontmatter_scalar_strips_quotes_and_rejects_blocks() {
        assert_eq!(
            parse_frontmatter_scalar(" \"hello world\"  ").as_deref(),
            Some("hello world")
        );
        assert_eq!(
            parse_frontmatter_scalar(" 'single quoted' ").as_deref(),
            Some("single quoted")
        );
        assert_eq!(
            parse_frontmatter_scalar("  unquoted value  ").as_deref(),
            Some("unquoted value")
        );
        assert_eq!(parse_frontmatter_scalar("   ").as_deref(), None);
        assert_eq!(parse_frontmatter_scalar(" |").as_deref(), None);
        assert_eq!(parse_frontmatter_scalar(" > folded").as_deref(), None);
    }

    #[test]
    fn skill_description_reads_top_level_description() {
        let (dir, path) = write_skill_md(
            "skill-top-desc",
            "---\nname: demo\ndescription: top level desc\n---\nbody\n",
        );
        assert_eq!(
            read_skill_description(&path).as_deref(),
            Some("top level desc")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn skill_description_prefers_nested_short_description() {
        let (dir, path) = write_skill_md(
            "skill-short-desc",
            "---\nname: demo\ndescription: long fallback\nmetadata:\n  short-description: pithy summary\n---\nbody\n",
        );
        assert_eq!(
            read_skill_description(&path).as_deref(),
            Some("pithy summary")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn skill_description_falls_back_when_no_short() {
        let (dir, path) = write_skill_md(
            "skill-fallback",
            "---\nname: demo\ndescription: \"quoted fallback\"\nmetadata:\n  other: value\n---\nbody\n",
        );
        assert_eq!(
            read_skill_description(&path).as_deref(),
            Some("quoted fallback")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn skill_description_ignores_nested_description_key() {
        // A nested `description:` (e.g. inside `metadata:` or a tool block)
        // must not be picked up as the top-level fallback.
        let (dir, path) = write_skill_md(
            "skill-nested-desc",
            "---\nname: demo\nmetadata:\n  description: nested only\n---\nbody\n",
        );
        assert_eq!(read_skill_description(&path), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn skill_description_requires_frontmatter_fence() {
        let (dir, path) = write_skill_md(
            "skill-no-fence",
            "name: demo\ndescription: not really frontmatter\n",
        );
        assert_eq!(read_skill_description(&path), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn skill_description_stops_at_closing_fence() {
        let (dir, path) = write_skill_md(
            "skill-closed",
            "---\nname: demo\n---\ndescription: in body, not frontmatter\n",
        );
        assert_eq!(read_skill_description(&path), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn skill_description_handles_utf8_content() {
        let (dir, path) = write_skill_md(
            "skill-utf8",
            "---\nname: demo\ndescription: 中文 描述 🚀\n---\nbody\n",
        );
        assert_eq!(
            read_skill_description(&path).as_deref(),
            Some("中文 描述 🚀")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn skill_description_returns_none_for_missing_file() {
        let dir = unique_test_dir("skill-missing");
        let path = dir.join("does-not-exist.md");
        assert_eq!(read_skill_description(&path), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    // ----- Hermes config helpers -----

    #[test]
    fn parse_env_file_ignores_comments_and_strips_quotes() {
        let raw = "# comment\n\nexport OPENROUTER_API_KEY=\"sk-or-123\"\nOPENAI_BASE_URL='https://x.test/v1'\nBARE=plain\n=novalue\n";
        let map = parse_env_file(raw);
        assert_eq!(map.get("OPENROUTER_API_KEY").map(String::as_str), Some("sk-or-123"));
        assert_eq!(map.get("OPENAI_BASE_URL").map(String::as_str), Some("https://x.test/v1"));
        assert_eq!(map.get("BARE").map(String::as_str), Some("plain"));
        assert!(!map.contains_key(""));
    }

    #[test]
    fn patch_env_text_replaces_in_place_and_preserves_rest() {
        let existing = "# secrets\nOPENROUTER_API_KEY=old\n\nOTHER_TOKEN=keep\n";
        let out = patch_env_text(existing, &[("OPENROUTER_API_KEY", "new")]);
        assert!(out.contains("# secrets"), "comment preserved: {out}");
        assert!(out.contains("OPENROUTER_API_KEY=new"), "key replaced: {out}");
        assert!(!out.contains("OPENROUTER_API_KEY=old"), "old value gone: {out}");
        assert!(out.contains("OTHER_TOKEN=keep"), "unrelated key preserved: {out}");
        // Replacement happens in place, not appended at the end.
        assert_eq!(out.matches("OPENROUTER_API_KEY=").count(), 1);
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn patch_env_text_drops_duplicate_keys() {
        // A pre-existing duplicate must not survive: parse_env_file is
        // last-occurrence-wins, so a stale second line would shadow the update.
        let existing = "OPENAI_API_KEY=old1\nKEEP=1\nOPENAI_API_KEY=old2\n";
        let out = patch_env_text(existing, &[("OPENAI_API_KEY", "new")]);
        assert_eq!(out.matches("OPENAI_API_KEY=").count(), 1, "single key: {out}");
        assert!(out.contains("OPENAI_API_KEY=new"));
        assert!(!out.contains("old1") && !out.contains("old2"), "stale gone: {out}");
        assert!(out.contains("KEEP=1"));
        // And a reader of the result sees the new value, not a stale shadow.
        assert_eq!(
            parse_env_file(&out).get("OPENAI_API_KEY").map(String::as_str),
            Some("new")
        );
    }

    #[test]
    fn patch_env_text_appends_missing_key() {
        let out = patch_env_text("EXISTING=1\n", &[("ANTHROPIC_API_KEY", "sk-ant")]);
        assert!(out.contains("EXISTING=1"));
        assert!(out.contains("ANTHROPIC_API_KEY=sk-ant"));
        let empty = patch_env_text("", &[("OPENAI_API_KEY", "k")]);
        assert_eq!(empty, "OPENAI_API_KEY=k\n");
    }

    #[test]
    fn patch_env_text_empty_value_clears_present_and_appends_to_mask() {
        // Clearing a PRESENT key rewrites it to `KEY=` in place.
        let cleared = patch_env_text("OPENAI_API_KEY=secret\nKEEP=1\n", &[("OPENAI_API_KEY", "")]);
        assert!(cleared.contains("OPENAI_API_KEY="));
        assert!(!cleared.contains("OPENAI_API_KEY=secret"));
        assert!(cleared.contains("KEEP=1"));
        // An ABSENT key is still appended as an explicit empty line — under
        // Hermes' dotenv override loading that is what masks a value of the same
        // name inherited from the process environment.
        let absent = patch_env_text("KEEP=1\n", &[("OPENAI_API_KEY", "")]);
        assert!(absent.contains("KEEP=1"));
        assert!(absent.contains("OPENAI_API_KEY="));
    }

    #[test]
    fn merge_hermes_model_config_sets_model_and_keeps_other_keys() {
        let existing = "terminal:\n  backend: local\nmodel:\n  default: old-model\n  provider: openai\n";
        let merged = merge_hermes_model_config(
            Some(existing),
            "openrouter",
            "moonshotai/kimi-k2",
            BaseUrlWrite::Preserve,
            InlineApiKeyWrite::Clear,
        )
        .expect("merge");
        let value: serde_yaml::Value = serde_yaml::from_str(&merged).expect("parse merged");
        let model = value.get("model").expect("model section");
        assert_eq!(model.get("provider").and_then(|v| v.as_str()), Some("openrouter"));
        assert_eq!(
            model.get("default").and_then(|v| v.as_str()),
            Some("moonshotai/kimi-k2")
        );
        // Unrelated top-level keys survive the targeted merge.
        assert_eq!(
            value.get("terminal").and_then(|t| t.get("backend")).and_then(|v| v.as_str()),
            Some("local")
        );
        // No base_url was requested, so none is written.
        assert!(model.get("base_url").is_none());
    }

    #[test]
    fn merge_hermes_model_config_set_writes_clears_and_preserve_keeps_base_url() {
        let with_base = merge_hermes_model_config(
            None,
            "openai-api",
            "my-model",
            BaseUrlWrite::Set("https://api.test/v1"),
            InlineApiKeyWrite::Clear,
        )
        .expect("merge with base");
        let value: serde_yaml::Value = serde_yaml::from_str(&with_base).expect("parse");
        assert_eq!(
            value.get("model").and_then(|m| m.get("base_url")).and_then(|v| v.as_str()),
            Some("https://api.test/v1")
        );
        // Set("") clears the field (user emptied the API URL input).
        let cleared = merge_hermes_model_config(
            Some(&with_base),
            "openai-api",
            "my-model",
            BaseUrlWrite::Set(""),
            InlineApiKeyWrite::Clear,
        )
        .expect("merge clear");
        let value: serde_yaml::Value = serde_yaml::from_str(&cleared).expect("parse");
        assert!(value.get("model").and_then(|m| m.get("base_url")).is_none());
        // Preserve leaves an existing endpoint untouched (provider whose base URL
        // is not user-editable in the panel must not lose an out-of-band value).
        let kept = merge_hermes_model_config(
            Some(&with_base),
            "anthropic",
            "my-model",
            BaseUrlWrite::Preserve,
            InlineApiKeyWrite::Clear,
        )
        .expect("merge preserve");
        let value: serde_yaml::Value = serde_yaml::from_str(&kept).expect("parse");
        assert_eq!(
            value.get("model").and_then(|m| m.get("base_url")).and_then(|v| v.as_str()),
            Some("https://api.test/v1")
        );
    }

    #[test]
    fn merge_hermes_model_config_custom_writes_and_clears_inline_key() {
        // custom writes the key inline in `model.api_key` (+ keeps base_url).
        let with_key = merge_hermes_model_config(
            None,
            "custom",
            "gpt-5.5",
            BaseUrlWrite::Set("https://endpoint.test/v1"),
            InlineApiKeyWrite::Set {
                key: "sk-abc",
                scrub_mode: true,
            },
        )
        .expect("merge custom");
        let value: serde_yaml::Value = serde_yaml::from_str(&with_key).expect("parse");
        let model = value.get("model").expect("model section");
        assert_eq!(model.get("provider").and_then(|v| v.as_str()), Some("custom"));
        assert_eq!(model.get("api_key").and_then(|v| v.as_str()), Some("sk-abc"));
        assert_eq!(
            model.get("base_url").and_then(|v| v.as_str()),
            Some("https://endpoint.test/v1")
        );

        // A blank inline key drops the field (keyless local server).
        let keyless = merge_hermes_model_config(
            Some(&with_key),
            "custom",
            "gpt-5.5",
            BaseUrlWrite::Set("https://endpoint.test/v1"),
            InlineApiKeyWrite::Set {
                key: "",
                scrub_mode: false,
            },
        )
        .expect("merge keyless");
        let value: serde_yaml::Value = serde_yaml::from_str(&keyless).expect("parse");
        assert!(value.get("model").and_then(|m| m.get("api_key")).is_none());

        // custom→custom re-save with scrub_mode=false preserves a raw-editor
        // `api_mode`; switching in with scrub_mode=true drops it.
        let with_mode = "model:\n  provider: custom\n  default: m\n  api_mode: anthropic_messages\n";
        let resaved = merge_hermes_model_config(
            Some(with_mode),
            "custom",
            "m",
            BaseUrlWrite::Set("https://e/v1"),
            InlineApiKeyWrite::Set {
                key: "sk-1",
                scrub_mode: false,
            },
        )
        .expect("merge resave");
        let value: serde_yaml::Value = serde_yaml::from_str(&resaved).expect("parse");
        assert_eq!(
            value
                .get("model")
                .and_then(|m| m.get("api_mode"))
                .and_then(|v| v.as_str()),
            Some("anthropic_messages"),
            "custom→custom re-save preserves api_mode"
        );
        let switched_in = merge_hermes_model_config(
            Some(with_mode),
            "custom",
            "m",
            BaseUrlWrite::Set("https://e/v1"),
            InlineApiKeyWrite::Set {
                key: "sk-1",
                scrub_mode: true,
            },
        )
        .expect("merge switch-in");
        let value: serde_yaml::Value = serde_yaml::from_str(&switched_in).expect("parse");
        assert!(
            value.get("model").and_then(|m| m.get("api_mode")).is_none(),
            "switching TO custom scrubs a stale api_mode"
        );

        // Switching to a keyed provider scrubs the stale inline key + api_mode.
        let stale = "model:\n  provider: custom\n  default: gpt-5.5\n  api_key: sk-old\n  api_mode: chat_completions\n";
        let switched = merge_hermes_model_config(
            Some(stale),
            "anthropic",
            "claude",
            BaseUrlWrite::Set(""),
            InlineApiKeyWrite::Clear,
        )
        .expect("merge switch");
        let value: serde_yaml::Value = serde_yaml::from_str(&switched).expect("parse");
        let model = value.get("model").expect("model section");
        assert!(model.get("api_key").is_none(), "stale inline key must be scrubbed");
        assert!(model.get("api_mode").is_none(), "stale api_mode must be scrubbed");
    }

    #[test]
    fn plan_hermes_write_preserves_base_url_for_fixed_endpoint_provider() {
        // Anthropic (needsBaseUrl: false) behind a proxy: a structured save that
        // doesn't touch the hidden API URL field must keep the existing endpoint.
        let existing = "model:\n  provider: anthropic\n  default: old\n  base_url: https://my-proxy/v1\n";
        let (yaml, env) = plan_hermes_write(
            "anthropic",
            Some("sk-ant"),
            "claude-x",
            None,
            None,
            Some(existing),
        )
        .expect("plan");
        let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
        assert_eq!(
            value.get("model").and_then(|m| m.get("base_url")).and_then(|v| v.as_str()),
            Some("https://my-proxy/v1"),
            "out-of-band base_url must survive a structured save"
        );
        // Only the API key is touched in `.env`; no base-URL var for anthropic.
        assert_eq!(env, vec![("ANTHROPIC_API_KEY", "sk-ant".to_string())]);
    }

    #[test]
    fn plan_hermes_write_clears_stale_base_url_on_provider_switch() {
        // Existing config is `openai-api` with a custom proxy endpoint; the user
        // switches to `anthropic` (fixed endpoint, field hidden). The stale OpenAI
        // base URL must NOT carry over to anthropic.
        let existing =
            "model:\n  provider: openai-api\n  default: gpt-x\n  base_url: https://openai-proxy/v1\n";
        let (yaml, _env) = plan_hermes_write(
            "anthropic",
            Some("sk-ant"),
            "claude-x",
            None,
            None,
            Some(existing),
        )
        .expect("plan");
        let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
        assert_eq!(
            value.get("model").and_then(|m| m.get("provider")).and_then(|v| v.as_str()),
            Some("anthropic")
        );
        assert!(
            value.get("model").and_then(|m| m.get("base_url")).is_none(),
            "stale base_url from the previous provider must be cleared on switch: {yaml}"
        );
    }

    #[test]
    fn plan_hermes_write_neutralizes_openrouter_openai_fallback() {
        // Saving openrouter ALWAYS writes empty OPENAI_API_KEY/OPENAI_BASE_URL —
        // hermes 0.16.0 openrouter resolution falls back to OPENAI_API_KEY (and
        // treats OPENAI_BASE_URL as an override). It runs regardless of the
        // previous provider, including legacy ids no longer in the table.
        for prev in ["openai-api", "openai", "custom", "anthropic"] {
            let existing = format!("model:\n  provider: {prev}\n  default: m\n");
            let (_, env) = plan_hermes_write("openrouter", None, "m", None, None, Some(&existing))
                .expect("→openrouter");
            assert!(
                env.contains(&("OPENAI_API_KEY", String::new())),
                "OPENAI_API_KEY must be neutralized (prev={prev}): {env:?}"
            );
            assert!(env.contains(&("OPENAI_BASE_URL", String::new())));
            // Blank openrouter key → its own var is left untouched.
            assert!(!env.iter().any(|(k, _)| *k == "OPENROUTER_API_KEY"));
        }
        // A provided key is written alongside the neutralization.
        let (_, env) = plan_hermes_write("openrouter", Some("sk-or"), "m", None, None, None)
            .expect("keyed");
        assert!(env.contains(&("OPENROUTER_API_KEY", "sk-or".to_string())));
        assert!(env.contains(&("OPENAI_API_KEY", String::new())));
    }

    #[test]
    fn plan_hermes_write_switch_preserves_unrelated_previous_credential() {
        // Switching anthropic → zai must NOT wipe the still-valid ANTHROPIC_API_KEY
        // (zai does not read it, so clearing it would only destroy a good
        // credential). Only zai's own key var is written.
        let existing = "model:\n  provider: anthropic\n  default: m\n";
        let (_, env) = plan_hermes_write("zai", Some("sk-glm"), "m", None, None, Some(existing))
            .expect("anthropic→zai");
        assert_eq!(env, vec![("GLM_API_KEY", "sk-glm".to_string())]);
        assert!(!env.iter().any(|(k, _)| *k == "ANTHROPIC_API_KEY"));
    }

    #[cfg(unix)]
    #[test]
    fn write_hermes_secret_file_secures_fresh_and_preserves_existing() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let mode_of = |p: &Path| fs::metadata(p).expect("metadata").permissions().mode() & 0o777;
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = tmp.path().join(".hermes");
        fs::create_dir_all(&home).expect("home");

        // A brand-new secret is created owner-only (0600) and round-trips.
        let env_path = home.join(".env");
        write_hermes_secret_file(&env_path, "OPENROUTER_API_KEY=sk-1\n", ".env")
            .expect("write env");
        assert_eq!(mode_of(&env_path), 0o600, "fresh .env must be 0600");
        assert_eq!(
            fs::read_to_string(&env_path).unwrap(),
            "OPENROUTER_API_KEY=sk-1\n"
        );
        let cfg_path = home.join("config.yaml");
        write_hermes_secret_file(&cfg_path, "model:\n  provider: openai-api\n", "config.yaml")
            .expect("write config.yaml");
        assert_eq!(mode_of(&cfg_path), 0o600, "fresh config.yaml must be 0600");

        // An existing file is written through IN PLACE: a managed group-readable
        // mode (0640) and the inode itself are preserved (so owner/group, ACL and
        // xattrs ride along), while the content updates.
        fs::set_permissions(&env_path, fs::Permissions::from_mode(0o640)).expect("loosen");
        let inode_before = fs::metadata(&env_path).unwrap().ino();
        write_hermes_secret_file(&env_path, "OPENROUTER_API_KEY=sk-2\n", ".env")
            .expect("rewrite env");
        assert_eq!(mode_of(&env_path), 0o640, "existing managed mode must be preserved");
        assert_eq!(
            fs::metadata(&env_path).unwrap().ino(),
            inode_before,
            "existing file must be rewritten in place (same inode), not replaced"
        );
        assert_eq!(
            fs::read_to_string(&env_path).unwrap(),
            "OPENROUTER_API_KEY=sk-2\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn write_hermes_secret_file_writes_through_symlink() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path();
        // A dotfile/secret-manager layout: config.yaml is a symlink to the real
        // file. Saving must update the real target and keep the symlink intact.
        let real = dir.join("real-config.yaml");
        fs::write(&real, "model:\n  provider: openai-api\n").unwrap();
        let link = dir.join("config.yaml");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        write_hermes_secret_file(&link, "model:\n  provider: anthropic\n", "config.yaml")
            .expect("write through symlink");
        assert!(
            fs::symlink_metadata(&link).unwrap().file_type().is_symlink(),
            "the symlink must be preserved, not replaced by a regular file"
        );
        assert_eq!(
            fs::read_to_string(&real).unwrap(),
            "model:\n  provider: anthropic\n",
            "the symlink's real target must be updated"
        );
    }

    #[cfg(unix)]
    #[test]
    fn write_hermes_secret_file_secures_dangling_symlink_target() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path();
        // A managed layout: `.env` symlinks to a target that doesn't exist yet.
        let real = dir.join("vault-hermes.env");
        let link = dir.join(".env");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(fs::metadata(&link).is_err(), "precondition: dangling symlink");

        write_hermes_secret_file(&link, "OPENROUTER_API_KEY=sk\n", ".env").expect("write");
        // The target is created THROUGH the symlink and is owner-only (0600), not
        // the umask default (0644) — a fresh secret must never be world-readable.
        assert_eq!(
            fs::metadata(&real).unwrap().permissions().mode() & 0o777,
            0o600,
            "a freshly created symlink target must be 0600"
        );
        assert_eq!(fs::read_to_string(&real).unwrap(), "OPENROUTER_API_KEY=sk\n");
        assert!(
            fs::symlink_metadata(&link).unwrap().file_type().is_symlink(),
            "the symlink itself must be preserved"
        );
    }

    #[cfg(unix)]
    #[test]
    fn write_hermes_secret_file_tightens_world_readable_existing_secret() {
        use std::os::unix::fs::PermissionsExt;
        // The tightening is honored only where Hermes would chmod (not a
        // container/managed opt-out, e.g. a Docker CI runner with /.dockerenv).
        if hermes_skip_chmod() {
            return;
        }
        let mode_of = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path();

        // A secret left world-readable (0644) by an older build is repaired to
        // owner-only 0600 on the next save (0640 would still expose it to a broad
        // group like staff); content updates.
        let env_path = dir.join(".env");
        fs::write(&env_path, "OPENROUTER_API_KEY=old\n").unwrap();
        fs::set_permissions(&env_path, fs::Permissions::from_mode(0o644)).unwrap();
        write_hermes_secret_file(&env_path, "OPENROUTER_API_KEY=new\n", ".env").unwrap();
        assert_eq!(mode_of(&env_path), 0o600, "a world-readable 0644 secret → 0600");
        assert_eq!(
            fs::read_to_string(&env_path).unwrap(),
            "OPENROUTER_API_KEY=new\n"
        );

        // A deliberately group-shared managed mode (0640, no world bits) survives.
        let managed = dir.join("managed.env");
        fs::write(&managed, "K=1\n").unwrap();
        fs::set_permissions(&managed, fs::Permissions::from_mode(0o640)).unwrap();
        write_hermes_secret_file(&managed, "K=2\n", ".env").unwrap();
        assert_eq!(mode_of(&managed), 0o640, "managed group-shared mode preserved");
    }

    #[cfg(unix)]
    #[test]
    fn ensure_hermes_home_secure_respects_existing_and_managed_dirs() {
        use std::os::unix::fs::PermissionsExt;
        let mode_of = |p: &Path| fs::metadata(p).expect("metadata").permissions().mode() & 0o777;
        let tmp = tempfile::tempdir().expect("tempdir");

        // Fresh home → 0700 by default (HERMES_HOME_MODE cleared so the assertion
        // is deterministic regardless of the ambient env; skipped when this env
        // opts out of chmod, like a Docker CI runner).
        temp_env::with_var("HERMES_HOME_MODE", None::<&str>, || {
            let fresh = tmp.path().join("fresh-hermes");
            ensure_hermes_home_secure(&fresh).expect("ensure fresh");
            if !hermes_skip_chmod() {
                assert_eq!(mode_of(&fresh), 0o700, "fresh hermes home must be 0700");
            }
        });

        // HERMES_HOME_MODE overrides the default for a freshly-created home (e.g.
        // 0750 for a web server that traverses HERMES_HOME).
        temp_env::with_var("HERMES_HOME_MODE", Some("0750"), || {
            let fresh = tmp.path().join("fresh-hermes-moded");
            ensure_hermes_home_secure(&fresh).expect("ensure fresh moded");
            if !hermes_skip_chmod() {
                assert_eq!(mode_of(&fresh), 0o750, "HERMES_HOME_MODE must be honored");
            }
        });

        // A pre-existing, group-accessible home (managed/NixOS layout) is left
        // untouched — revoking shared access would break other Hermes processes.
        let managed = tmp.path().join("managed-hermes");
        fs::create_dir_all(&managed).unwrap();
        fs::set_permissions(&managed, fs::Permissions::from_mode(0o755)).unwrap();
        ensure_hermes_home_secure(&managed).expect("ensure managed");
        assert_eq!(mode_of(&managed), 0o755, "existing hermes home mode preserved");
    }

    // ── Hermes base-URL reconcile (auxiliary/main endpoint parity) ──────────

    #[test]
    fn plan_hermes_base_url_reconcile_mirrors_yaml_when_env_absent() {
        // openai-api with config.yaml model.base_url but no .env OPENAI_BASE_URL
        // → write the var so the auxiliary path matches the main loop.
        assert_eq!(
            plan_hermes_base_url_reconcile("openai-api", Some("https://sub2api/v1"), None),
            Some(("OPENAI_BASE_URL", "https://sub2api/v1".to_string()))
        );
    }

    #[test]
    fn plan_hermes_base_url_reconcile_no_op_when_equal() {
        assert_eq!(
            plan_hermes_base_url_reconcile(
                "openai-api",
                Some("https://sub2api/v1"),
                Some("https://sub2api/v1"),
            ),
            None
        );
    }

    #[test]
    fn plan_hermes_base_url_reconcile_ignores_trailing_slash() {
        // Trailing-slash-only differences must not churn .env (both directions).
        assert_eq!(
            plan_hermes_base_url_reconcile("openai-api", Some("https://x/v1/"), Some("https://x/v1")),
            None
        );
        assert_eq!(
            plan_hermes_base_url_reconcile("openai-api", Some("https://x/v1"), Some("https://x/v1/")),
            None
        );
    }

    #[test]
    fn plan_hermes_base_url_reconcile_clears_stale_when_yaml_empty() {
        // config.yaml has no base_url but .env carries a stale override → clear it
        // (empty value) so it can't shadow the registry default in the aux path.
        assert_eq!(
            plan_hermes_base_url_reconcile("openai-api", None, Some("https://old/v1")),
            Some(("OPENAI_BASE_URL", String::new()))
        );
    }

    #[test]
    fn plan_hermes_base_url_reconcile_no_op_when_both_empty() {
        // Absent var and explicitly-empty var both → no-op (no redundant `KEY=`).
        assert_eq!(plan_hermes_base_url_reconcile("openai-api", None, None), None);
        assert_eq!(plan_hermes_base_url_reconcile("openai-api", None, Some("")), None);
        assert_eq!(plan_hermes_base_url_reconcile("openai-api", Some("  "), Some("")), None);
    }

    #[test]
    fn plan_hermes_base_url_reconcile_skips_unknown_provider() {
        for p in ["custom", "openai", "custom:my-proxy", "totally-unknown"] {
            assert_eq!(
                plan_hermes_base_url_reconcile(p, Some("https://x/v1"), None),
                None,
                "unknown provider {p} must be a no-op"
            );
        }
    }

    #[test]
    fn plan_hermes_base_url_reconcile_skips_providers_without_base_url_var() {
        // OAuth / AWS / kimi-coding-cn carry no base-URL env var → never written,
        // even when config.yaml has a base_url.
        for p in ["nous", "bedrock", "kimi-coding-cn"] {
            assert_eq!(
                plan_hermes_base_url_reconcile(p, Some("https://x/v1"), None),
                None,
                "provider {p} has no base_url env var"
            );
        }
    }

    #[test]
    fn plan_hermes_base_url_reconcile_openrouter_only_touches_its_own_var() {
        // openrouter never returns an OPENAI_BASE_URL write (that would re-pollute
        // the panel's neutralization); it only reconciles OPENROUTER_BASE_URL.
        assert_eq!(plan_hermes_base_url_reconcile("openrouter", None, None), None);
        assert_eq!(
            plan_hermes_base_url_reconcile("openrouter", Some("https://or/api/v1"), None),
            Some(("OPENROUTER_BASE_URL", "https://or/api/v1".to_string()))
        );
    }

    #[test]
    fn plan_hermes_base_url_reconcile_covers_non_needs_base_url_providers() {
        // The aux/main asymmetry is not limited to openai-api — a proxied anthropic
        // (base_url in YAML, not in .env) has the same divergence.
        assert_eq!(
            plan_hermes_base_url_reconcile("anthropic", Some("https://proxy/anthropic"), None),
            Some(("ANTHROPIC_BASE_URL", "https://proxy/anthropic".to_string()))
        );
    }

    #[test]
    fn plan_hermes_base_url_reconcile_writes_verbatim_not_normalized() {
        // When a write IS needed, the trailing slash is preserved in the value
        // (only the comparison normalizes it).
        assert_eq!(
            plan_hermes_base_url_reconcile(
                "openai-api",
                Some("https://x/v1/"),
                Some("https://x/other"),
            ),
            Some(("OPENAI_BASE_URL", "https://x/v1/".to_string()))
        );
    }

    #[test]
    fn plan_hermes_base_url_reconcile_rejects_embedded_newline() {
        // A base_url carrying a newline must never be mirrored — it would inject an
        // extra `.env` line (another provider's var) through patch_env_text.
        assert_eq!(
            plan_hermes_base_url_reconcile(
                "openai-api",
                Some("https://x/v1\nOPENROUTER_BASE_URL=https://evil"),
                None,
            ),
            None
        );
        assert_eq!(
            plan_hermes_base_url_reconcile(
                "openai-api",
                Some("https://x/v1\rFOO=bar"),
                Some("https://x/v1"),
            ),
            None
        );
    }

    #[test]
    fn reconcile_writes_env_and_is_idempotent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = tmp.path();
        fs::write(
            home.join("config.yaml"),
            "model:\n  provider: openai-api\n  default: gpt-5.5\n  base_url: https://sub2api/v1\n",
        )
        .unwrap();
        fs::write(home.join(".env"), "OPENAI_API_KEY=sk-secret\n").unwrap();

        reconcile_hermes_runtime_env_in(home).expect("reconcile");
        let env = fs::read_to_string(home.join(".env")).unwrap();
        assert!(
            env.contains("OPENAI_BASE_URL=https://sub2api/v1"),
            "base url mirrored: {env:?}"
        );
        assert!(
            env.contains("OPENAI_API_KEY=sk-secret"),
            "existing key preserved: {env:?}"
        );

        // Second run is a pure no-op: content AND mtime unchanged (the planner
        // returns None, so .env is never reopened for writing).
        let mtime1 = fs::metadata(home.join(".env")).unwrap().modified().unwrap();
        reconcile_hermes_runtime_env_in(home).expect("reconcile again");
        assert_eq!(
            fs::read_to_string(home.join(".env")).unwrap(),
            env,
            "idempotent content"
        );
        assert_eq!(
            fs::metadata(home.join(".env")).unwrap().modified().unwrap(),
            mtime1,
            "idempotent run must not rewrite .env"
        );
    }

    #[test]
    fn reconcile_no_op_without_config_yaml() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = tmp.path();
        fs::write(home.join(".env"), "OPENAI_API_KEY=sk\n").unwrap();
        reconcile_hermes_runtime_env_in(home).expect("reconcile");
        assert_eq!(
            fs::read_to_string(home.join(".env")).unwrap(),
            "OPENAI_API_KEY=sk\n",
            ".env must be byte-identical when there is no config.yaml"
        );
    }

    #[test]
    fn reconcile_preserves_openrouter_neutralization() {
        // openrouter with no model.base_url + the panel's empty OPENAI_* masks must
        // survive untouched (reconcile only ever considers OPENROUTER_BASE_URL).
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = tmp.path();
        fs::write(
            home.join("config.yaml"),
            "model:\n  provider: openrouter\n  default: x\n",
        )
        .unwrap();
        let env = "OPENROUTER_API_KEY=sk-or\nOPENAI_API_KEY=\nOPENAI_BASE_URL=\n";
        fs::write(home.join(".env"), env).unwrap();
        reconcile_hermes_runtime_env_in(home).expect("reconcile");
        assert_eq!(
            fs::read_to_string(home.join(".env")).unwrap(),
            env,
            "neutralization preserved"
        );
    }

    #[test]
    fn reconcile_clears_stale_base_url_on_disk() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = tmp.path();
        // openai-api with no base_url in config.yaml, but a stale OPENAI_BASE_URL.
        fs::write(
            home.join("config.yaml"),
            "model:\n  provider: openai-api\n  default: gpt-5.5\n",
        )
        .unwrap();
        fs::write(
            home.join(".env"),
            "OPENAI_API_KEY=sk\nOPENAI_BASE_URL=https://old/v1\n",
        )
        .unwrap();
        reconcile_hermes_runtime_env_in(home).expect("reconcile");
        let env = fs::read_to_string(home.join(".env")).unwrap();
        assert!(env.contains("OPENAI_BASE_URL=\n"), "stale base url cleared: {env:?}");
        assert!(env.contains("OPENAI_API_KEY=sk"), "key preserved: {env:?}");
    }

    #[test]
    fn reconcile_skips_unreadable_env_without_clobbering() {
        // An existing-but-unreadable `.env` (invalid UTF-8) must abort the
        // reconcile, not be rewritten from an empty baseline — otherwise the
        // user's API keys/comments would be dropped on launch.
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = tmp.path();
        fs::write(
            home.join("config.yaml"),
            "model:\n  provider: openai-api\n  base_url: https://sub2api/v1\n",
        )
        .unwrap();
        let raw: &[u8] = b"\xff\xfeOPENAI_API_KEY=sk-secret\n";
        fs::write(home.join(".env"), raw).unwrap();
        assert!(
            reconcile_hermes_runtime_env_in(home).is_err(),
            "an unreadable .env must surface an error, not silently patch from empty"
        );
        assert_eq!(
            fs::read(home.join(".env")).unwrap(),
            raw.to_vec(),
            "an unreadable .env must be left byte-identical, never clobbered"
        );
    }

    #[test]
    fn hermes_home_for_launch_matches_hermes_resolution() {
        // A non-empty override is used VERBATIM — Hermes' get_hermes_home does
        // `Path(val.strip())` with no `~` expansion, so reconcile must not expand
        // either (both an absolute path and a literal `~/…` path are passed as-is).
        let mut abs = BTreeMap::new();
        abs.insert("HERMES_HOME".to_string(), "/tmp/hermes-alt".to_string());
        assert_eq!(hermes_home_for_launch(&abs), PathBuf::from("/tmp/hermes-alt"));

        let mut tilde = BTreeMap::new();
        tilde.insert("HERMES_HOME".to_string(), "~/alt-hermes".to_string());
        assert_eq!(hermes_home_for_launch(&tilde), PathBuf::from("~/alt-hermes"));

        // A blank override REPLACES the parent value in the child, and Hermes then
        // falls back to the default `~/.hermes` — not the parent's HERMES_HOME.
        let mut blank = BTreeMap::new();
        blank.insert("HERMES_HOME".to_string(), "  ".to_string());
        assert_eq!(
            hermes_home_for_launch(&blank),
            home_dir_or_default().join(".hermes")
        );

        // No override → the child inherits the parent env (veryagent's resolution).
        assert_eq!(hermes_home_for_launch(&BTreeMap::new()), hermes_home_dir());
    }

    #[test]
    fn reconcile_wrapper_targets_runtime_env_home() {
        // End-to-end: the wrapper must patch the `.env` under the launch env's
        // HERMES_HOME, not the parent/default home.
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = tmp.path();
        fs::write(
            home.join("config.yaml"),
            "model:\n  provider: openai-api\n  base_url: https://sub2api/v1\n",
        )
        .unwrap();
        fs::write(home.join(".env"), "OPENAI_API_KEY=sk\n").unwrap();
        let mut runtime_env = BTreeMap::new();
        runtime_env.insert("HERMES_HOME".to_string(), home.display().to_string());

        reconcile_hermes_runtime_env(&runtime_env);
        let env = fs::read_to_string(home.join(".env")).unwrap();
        assert!(
            env.contains("OPENAI_BASE_URL=https://sub2api/v1"),
            "wrapper reconciled the runtime_env HERMES_HOME: {env:?}"
        );
        assert!(env.contains("OPENAI_API_KEY=sk"), "key preserved: {env:?}");
    }

    #[cfg(unix)]
    #[test]
    fn reconcile_writes_through_symlinked_env() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let home = tmp.path();
        fs::write(
            home.join("config.yaml"),
            "model:\n  provider: openai-api\n  base_url: https://sub2api/v1\n",
        )
        .unwrap();
        // .env is a symlink to a real target (dotfile-manager layout).
        let real = home.join("vault.env");
        fs::write(&real, "OPENAI_API_KEY=sk\n").unwrap();
        std::os::unix::fs::symlink(&real, home.join(".env")).unwrap();

        reconcile_hermes_runtime_env_in(home).expect("reconcile");
        assert!(
            fs::symlink_metadata(home.join(".env"))
                .unwrap()
                .file_type()
                .is_symlink(),
            "symlink preserved"
        );
        let env = fs::read_to_string(&real).unwrap();
        assert!(
            env.contains("OPENAI_BASE_URL=https://sub2api/v1"),
            "target updated: {env:?}"
        );
        assert!(env.contains("OPENAI_API_KEY=sk"), "key preserved: {env:?}");
    }

    #[cfg(unix)]
    #[test]
    fn hermes_skip_chmod_requires_a_non_empty_opt_out() {
        // A non-empty opt-out enables skip.
        temp_env::with_vars(
            [
                ("HERMES_SKIP_CHMOD", Some("1")),
                ("HERMES_CONTAINER", None),
            ],
            || assert!(hermes_skip_chmod(), "non-empty HERMES_SKIP_CHMOD skips"),
        );
        // An EMPTY opt-out must NOT skip (Hermes' Python truthiness treats `` as
        // falsy) — but only assert that on a host that isn't itself a container.
        let host_is_container = temp_env::with_vars(
            [
                ("HERMES_SKIP_CHMOD", None::<&str>),
                ("HERMES_CONTAINER", None),
            ],
            hermes_skip_chmod,
        );
        if !host_is_container {
            temp_env::with_vars(
                [
                    ("HERMES_SKIP_CHMOD", Some("")),
                    ("HERMES_CONTAINER", Some("")),
                ],
                || assert!(!hermes_skip_chmod(), "an empty opt-out must not skip"),
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn parse_hermes_home_mode_handles_octal_and_defaults() {
        assert_eq!(parse_hermes_home_mode(None), 0o700);
        assert_eq!(parse_hermes_home_mode(Some("")), 0o700);
        assert_eq!(parse_hermes_home_mode(Some("0701")), 0o701);
        assert_eq!(parse_hermes_home_mode(Some(" 750 ")), 0o750);
        assert_eq!(parse_hermes_home_mode(Some("0o700")), 0o700);
        assert_eq!(parse_hermes_home_mode(Some("nonsense")), 0o700);
    }

    #[test]
    fn hermes_provider_maps_key_var_and_base_url_flag() {
        let openrouter = hermes_provider("openrouter").expect("openrouter");
        assert_eq!(openrouter.key_env_var, "OPENROUTER_API_KEY");
        assert!(!openrouter.needs_base_url);
        // `openai-api` is the OpenAI-compatible path: OPENAI_API_KEY + a
        // user-supplied base URL.
        let openai_api = hermes_provider("openai-api").expect("openai-api");
        assert_eq!(openai_api.key_env_var, "OPENAI_API_KEY");
        assert!(openai_api.needs_base_url);
        // Hermes' first-priority key var per provider (auth.py PROVIDER_REGISTRY).
        assert_eq!(hermes_provider("zai").expect("zai").key_env_var, "GLM_API_KEY");
        assert_eq!(
            hermes_provider("kimi-coding").expect("kimi-coding").key_env_var,
            "KIMI_API_KEY"
        );
        // OAuth + AWS providers carry no API-key env var (set via terminal --setup
        // or the AWS SDK chain).
        assert_eq!(hermes_provider("nous").expect("nous").key_env_var, "");
        assert_eq!(hermes_provider("bedrock").expect("bedrock").key_env_var, "");
        // `custom` IS in the table — the OpenAI-compatible BYO endpoint. It has
        // no `.env` key/base-url var (both ride inline in config.yaml), but is
        // flagged user-editable so the API URL field renders.
        let custom = hermes_provider("custom").expect("custom");
        assert_eq!(custom.key_env_var, "");
        assert_eq!(custom.base_url_env_var, "");
        assert!(custom.needs_base_url);
        assert!(hermes_inlines_api_key("custom"));
        assert!(!hermes_inlines_api_key("openai-api"));
        // The legacy bare `openai` alias (which Hermes routes to OpenRouter) is
        // intentionally not in the table.
        assert!(hermes_provider("openai").is_none());
        assert!(hermes_provider("does-not-exist").is_none());
    }

    #[test]
    fn hermes_provider_key_env_vars_match_authoritative_registry() {
        // The full id → first api-key env var mapping from Hermes' own
        // `hermes_cli/auth.py` PROVIDER_REGISTRY (empty for OAuth/AWS providers).
        // Locks the table down so a wrong mapping (e.g. zai → ZAI_API_KEY instead
        // of GLM_API_KEY) fails CI rather than silently sending the wrong key var.
        let expected: &[(&str, &str)] = &[
            ("openrouter", "OPENROUTER_API_KEY"),
            ("openai-api", "OPENAI_API_KEY"),
            ("anthropic", "ANTHROPIC_API_KEY"),
            ("gemini", "GOOGLE_API_KEY"),
            ("deepseek", "DEEPSEEK_API_KEY"),
            ("xai", "XAI_API_KEY"),
            ("zai", "GLM_API_KEY"),
            ("minimax", "MINIMAX_API_KEY"),
            ("minimax-cn", "MINIMAX_CN_API_KEY"),
            ("kimi-coding", "KIMI_API_KEY"),
            ("kimi-coding-cn", "KIMI_CN_API_KEY"),
            ("nvidia", "NVIDIA_API_KEY"),
            ("alibaba", "DASHSCOPE_API_KEY"),
            ("alibaba-coding-plan", "ALIBABA_CODING_PLAN_API_KEY"),
            ("copilot", "COPILOT_GITHUB_TOKEN"),
            ("lmstudio", "LM_API_KEY"),
            ("azure-foundry", "AZURE_FOUNDRY_API_KEY"),
            ("stepfun", "STEPFUN_API_KEY"),
            ("arcee", "ARCEEAI_API_KEY"),
            ("gmi", "GMI_API_KEY"),
            ("huggingface", "HF_TOKEN"),
            ("kilocode", "KILOCODE_API_KEY"),
            ("opencode-zen", "OPENCODE_ZEN_API_KEY"),
            ("opencode-go", "OPENCODE_GO_API_KEY"),
            ("xiaomi", "XIAOMI_API_KEY"),
            ("tencent-tokenhub", "TOKENHUB_API_KEY"),
            ("ollama-cloud", "OLLAMA_API_KEY"),
            ("novita", "NOVITA_API_KEY"),
            // BYO OpenAI-compatible endpoint — key rides inline in config.yaml,
            // so it has no `.env` key var.
            ("custom", ""),
            ("nous", ""),
            ("openai-codex", ""),
            ("minimax-oauth", ""),
            ("xai-oauth", ""),
            ("qwen-oauth", ""),
            ("google-gemini-cli", ""),
            ("copilot-acp", ""),
            ("bedrock", ""),
        ];
        assert_eq!(
            expected.len(),
            HERMES_PROVIDERS.len(),
            "expected list must cover every table entry"
        );
        for (id, key) in expected {
            let p = hermes_provider(id).unwrap_or_else(|| panic!("missing provider {id}"));
            assert_eq!(p.key_env_var, *key, "{id} key_env_var");
        }
        // No table entry is left unverified.
        for p in HERMES_PROVIDERS {
            assert!(
                expected.iter().any(|(id, _)| *id == p.id),
                "untested provider {}",
                p.id
            );
        }
        // The base-URL env var for the three user-supplied-endpoint providers.
        assert_eq!(
            hermes_provider("openai-api").unwrap().base_url_env_var,
            "OPENAI_BASE_URL"
        );
        assert_eq!(
            hermes_provider("lmstudio").unwrap().base_url_env_var,
            "LM_BASE_URL"
        );
        assert_eq!(
            hermes_provider("azure-foundry").unwrap().base_url_env_var,
            "AZURE_FOUNDRY_BASE_URL"
        );
    }

    #[test]
    fn plan_hermes_write_structured_maps_key_and_config() {
        let (yaml, env) =
            plan_hermes_write("anthropic", Some("sk-ant-1"), "kimi", None, None, None)
                .expect("plan");
        assert_eq!(env, vec![("ANTHROPIC_API_KEY", "sk-ant-1".to_string())]);
        let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
        assert_eq!(
            value.get("model").and_then(|m| m.get("provider")).and_then(|v| v.as_str()),
            Some("anthropic")
        );
    }

    #[test]
    fn plan_hermes_write_custom_inlines_key_and_base_url_never_touching_env() {
        let (yaml, env) = plan_hermes_write(
            "custom",
            Some("sk-custom-1"),
            "gpt-5.5",
            Some("https://endpoint.test/v1"),
            None,
            None,
        )
        .expect("plan custom");
        // custom NEVER writes `.env` — key + endpoint live inline in config.yaml.
        assert!(env.is_empty(), "custom must not write any .env var");
        let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
        let model = value.get("model").expect("model section");
        assert_eq!(model.get("provider").and_then(|v| v.as_str()), Some("custom"));
        assert_eq!(model.get("default").and_then(|v| v.as_str()), Some("gpt-5.5"));
        assert_eq!(model.get("api_key").and_then(|v| v.as_str()), Some("sk-custom-1"));
        assert_eq!(
            model.get("base_url").and_then(|v| v.as_str()),
            Some("https://endpoint.test/v1")
        );
        // A newline in the inline key is rejected (same guard as the `.env` path).
        assert!(plan_hermes_write(
            "custom",
            Some("sk\nbad"),
            "m",
            Some("https://x/v1"),
            None,
            None
        )
        .is_err());

        // Switching TO custom from another provider that carried an `api_mode`
        // scrubs the stale mode (it must not bleed into the custom endpoint).
        let prior = "model:\n  provider: openai-api\n  default: gpt\n  api_mode: chat_completions\n";
        let (yaml, _env) = plan_hermes_write(
            "custom",
            Some("sk-2"),
            "gpt-5.5",
            Some("https://e/v1"),
            None,
            Some(prior),
        )
        .expect("plan switch-in");
        let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
        assert!(
            value.get("model").and_then(|m| m.get("api_mode")).is_none(),
            "stale api_mode must be scrubbed when switching to custom"
        );
    }

    #[test]
    fn plan_hermes_write_raw_mode_never_touches_env() {
        // Even if a caller sends an apiKey alongside rawConfigYaml, the .env must
        // not be updated (server-side contract, not payload-dependent).
        let (yaml, env) = plan_hermes_write(
            "openrouter",
            Some("sk-or-should-be-ignored"),
            "kimi",
            None,
            Some("model:\n  provider: anthropic\n"),
            None,
        )
        .expect("plan");
        assert!(env.is_empty(), "raw mode must not write .env");
        assert!(yaml.contains("anthropic"), "raw yaml written verbatim: {yaml}");
    }

    #[test]
    fn plan_hermes_write_oauth_and_blank_key_produce_no_env() {
        // OAuth provider (empty key var) → no .env update.
        let (_, env) = plan_hermes_write("nous", Some("ignored"), "m", None, None, None)
            .expect("oauth");
        assert!(env.is_empty());
        // Blank key on a keyed provider with no base-URL var → nothing touched.
        let (_, env) = plan_hermes_write("anthropic", Some("   "), "m", None, None, None)
            .expect("blank");
        assert!(env.is_empty());
        let (_, env) =
            plan_hermes_write("anthropic", None, "m", None, None, None).expect("none");
        assert!(env.is_empty());
    }

    #[test]
    fn plan_hermes_write_rejects_newline_key_and_invalid_yaml() {
        assert!(
            plan_hermes_write("openai-api", Some("a\nb"), "m", None, None, None).is_err(),
            "newline in key must be rejected"
        );
        assert!(
            plan_hermes_write("openai-api", None, "m", None, Some("model: [unterminated"), None)
                .is_err(),
            "invalid raw yaml must be rejected"
        );
    }

    #[test]
    fn plan_hermes_write_openai_api_provider_writes_base_url() {
        let (yaml, env) = plan_hermes_write(
            "openai-api",
            Some("sk-x"),
            "m",
            Some("https://api.test/v1"),
            None,
            None,
        )
        .expect("plan");
        // The endpoint is written to BOTH the key var's sibling base-URL var and
        // config.yaml model.base_url, so the two agree under either resolution path.
        assert_eq!(
            env,
            vec![
                ("OPENAI_API_KEY", "sk-x".to_string()),
                ("OPENAI_BASE_URL", "https://api.test/v1".to_string()),
            ]
        );
        let value: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("yaml");
        assert_eq!(
            value.get("model").and_then(|m| m.get("base_url")).and_then(|v| v.as_str()),
            Some("https://api.test/v1")
        );
        // Clearing the base URL writes an empty override so a stale `.env` value
        // can't shadow the default endpoint.
        let (_, env) = plan_hermes_write("openai-api", None, "m", None, None, None)
            .expect("clear base");
        assert_eq!(env, vec![("OPENAI_BASE_URL", String::new())]);
    }

    #[test]
    fn plan_hermes_write_structured_rejects_unknown_provider() {
        // Legacy/unknown ids can't be mapped to a credential layout → reject in
        // structured mode so we never write a provider with no credential.
        // (`custom` IS handled now — see `plan_hermes_write_custom_*`.)
        assert!(plan_hermes_write("openai", Some("k"), "m", None, None, None).is_err());
        assert!(plan_hermes_write("totally-made-up", None, "m", None, None, None).is_err());
        // Raw mode stays the escape hatch: any provider id is accepted verbatim.
        let (yaml, env) = plan_hermes_write(
            "custom:my-proxy",
            None,
            "m",
            None,
            Some("model:\n  provider: custom:my-proxy\n"),
            None,
        )
        .expect("raw mode accepts any provider");
        assert!(env.is_empty());
        assert!(yaml.contains("custom:my-proxy"));
    }

    #[test]
    fn project_hermes_key_and_base_falls_back_to_env_base_url() {
        let mut env = BTreeMap::new();
        env.insert("OPENAI_API_KEY".to_string(), "sk-1".to_string());
        env.insert("OPENAI_BASE_URL".to_string(), "https://proxy/v1".to_string());
        // No YAML base_url → the panel still sees the endpoint from `.env`, so a
        // later save won't clear it (regression guard for the dual-write change).
        let (key, base) = project_hermes_key_and_base("openai-api", &env, None, None);
        assert_eq!(key, Some("sk-1".to_string()));
        assert_eq!(base, Some("https://proxy/v1".to_string()));
        // YAML base_url wins over the env fallback.
        let (_, base) =
            project_hermes_key_and_base("openai-api", &env, Some("https://yaml/v1"), None);
        assert_eq!(base, Some("https://yaml/v1".to_string()));
        // A keyed provider with no base-URL var and no YAML base → no base URL.
        let mut env2 = BTreeMap::new();
        env2.insert("ANTHROPIC_API_KEY".to_string(), "sk-a".to_string());
        let (key, base) = project_hermes_key_and_base("anthropic", &env2, None, None);
        assert_eq!(key, Some("sk-a".to_string()));
        assert_eq!(base, None);
        // `custom` reads its key from config.yaml `model.api_key`, NOT `.env`.
        let (key, base) = project_hermes_key_and_base(
            "custom",
            &env,
            Some("https://endpoint/v1"),
            Some("sk-inline"),
        );
        assert_eq!(key, Some("sk-inline".to_string()));
        assert_eq!(base, Some("https://endpoint/v1".to_string()));
        // Unknown provider → nothing projected from `.env`.
        let (key, base) = project_hermes_key_and_base("custom:x", &env, None, None);
        assert_eq!(key, None);
        assert_eq!(base, None);
    }

    #[test]
    fn uvx_python_args_pins_interpreter_or_is_empty() {
        assert_eq!(
            uvx_python_args(Some("3.13")),
            vec!["--python".to_string(), "3.13".to_string()]
        );
        assert!(uvx_python_args(None).is_empty());
    }

    #[test]
    fn shell_quote_arg_leaves_spacefree_windows_paths_unquoted() {
        // A backslash path with no spaces must NOT be quoted on Windows. A
        // leading double-quoted string makes PowerShell parse the line as a
        // string expression and fail with "Unexpected token" instead of running
        // uvx; an unquoted bare path runs in both cmd and PowerShell.
        let path = r"C:\Users\Administrator\AppData\Local\app.veryagent\acp-binaries\uv-tool\windows-x86_64\uvx.exe";
        assert_eq!(shell_quote_arg_for(path, true), path);
        // On POSIX the backslash is the escape char, so it still forces quoting.
        assert_eq!(shell_quote_arg_for(path, false), format!("'{path}'"));
    }

    #[test]
    fn shell_quote_arg_still_quotes_when_required() {
        // Spaces force quoting on both platforms (this case is the known
        // PowerShell-incompatible residual: a quoted leading path needs `&`).
        assert_eq!(
            shell_quote_arg_for(r"C:\Program Files\uv-tool\uvx.exe", true),
            "\"C:\\Program Files\\uv-tool\\uvx.exe\""
        );
        // The pinned package's brackets and comma must stay quoted so PowerShell
        // does not split `[acp,mcp]` into an array argument.
        let pkg = "hermes-agent[acp,mcp]==0.16.0";
        assert_eq!(shell_quote_arg_for(pkg, true), format!("\"{pkg}\""));
        assert_eq!(shell_quote_arg_for(pkg, false), format!("'{pkg}'"));
        // Plain flag/value tokens are never quoted on either platform.
        for windows in [true, false] {
            assert_eq!(shell_quote_arg_for("--python", windows), "--python");
            assert_eq!(shell_quote_arg_for("3.13", windows), "3.13");
            assert_eq!(shell_quote_arg_for("hermes-acp", windows), "hermes-acp");
        }
    }

    #[test]
    fn hermes_setup_argvs_pin_python_before_from() {
        // hermes-agent's requires-python `<3.14` (and its win32 `pywinpty` dep)
        // means every uvx invocation must pin the interpreter, so a default
        // Python 3.14 never gets selected. Guard the assertion on the `--from`
        // branch: when a real `hermes` CLI is on PATH the recipe is the system
        // form (`hermes acp --setup` / `hermes model`) with no `--from`.
        let (setup, model) = hermes_setup_argvs();
        for argv in [&setup, &model] {
            if let Some(from_idx) = argv.iter().position(|a| a == "--from") {
                let py_idx = argv
                    .iter()
                    .position(|a| a == "--python")
                    .expect("uvx recipe must pin --python before --from");
                assert!(py_idx < from_idx, "--python must precede --from: {argv:?}");
                assert_eq!(argv.get(py_idx + 1).map(String::as_str), Some("3.13"));
            }
        }
    }

    #[test]
    fn kimi_parse_provider_model_uses_kimi_model_name() {
        let out = parse_provider_model(AgentType::KimiCode, Some("kimi-for-coding"));
        assert_eq!(
            out.get("KIMI_MODEL_NAME"),
            Some(&Some("kimi-for-coding".to_string()))
        );
        assert!(!out.contains_key("OPENAI_MODEL"));
    }

    #[test]
    fn kimi_managed_block_writes_provider_model_and_default() {
        let spec = KimiManagedSpec {
            interface_type: "anthropic".to_string(),
            base_url: Some("https://api.anthropic.com".to_string()),
            api_key: Some("sk-ant".to_string()),
            env: BTreeMap::new(),
            model: "claude-opus-4-7".to_string(),
            max_context_size: Some(200_000),
        };
        let mut doc = toml::Value::Table(toml::map::Map::new());
        // Pre-existing user content that must survive a managed-block write.
        doc.as_table_mut()
            .unwrap()
            .insert("telemetry".to_string(), toml::Value::Boolean(true));
        apply_kimi_managed_block(&mut doc, Some(&spec)).expect("write managed block");
        // Round-trip through the serializer the real writer uses.
        let serialized = toml::to_string_pretty(&doc).expect("serialize");
        let reparsed: toml::Value = serialized.parse().expect("valid toml");
        let t = reparsed.as_table().unwrap();
        assert_eq!(t.get("telemetry").and_then(toml::Value::as_bool), Some(true));
        assert_eq!(
            t.get("default_model").and_then(toml::Value::as_str),
            Some(KIMI_MANAGED_MODEL_ALIAS)
        );
        let provider = t
            .get("providers")
            .and_then(|p| p.get(KIMI_MANAGED_PROVIDER))
            .and_then(toml::Value::as_table)
            .expect("managed provider present");
        assert_eq!(
            provider.get("type").and_then(toml::Value::as_str),
            Some("anthropic")
        );
        assert_eq!(
            provider.get("api_key").and_then(toml::Value::as_str),
            Some("sk-ant")
        );
        let model = t
            .get("models")
            .and_then(|m| m.get(KIMI_MANAGED_MODEL_ALIAS))
            .and_then(toml::Value::as_table)
            .expect("managed model present");
        assert_eq!(
            model.get("provider").and_then(toml::Value::as_str),
            Some(KIMI_MANAGED_PROVIDER)
        );
        assert_eq!(
            model.get("model").and_then(toml::Value::as_str),
            Some("claude-opus-4-7")
        );
        assert_eq!(
            model.get("max_context_size").and_then(toml::Value::as_integer),
            Some(200_000)
        );
    }

    #[test]
    fn kimi_managed_block_always_writes_positive_max_context_size() {
        // Regression: kimi's schema requires `max_context_size` to be a positive
        // integer and silently discards the whole `[models.*]` block when it is
        // missing — leaving `default_model` dangling so every prompt ends with no
        // reply. A blank field MUST therefore still serialize a positive default.
        for ctx in [None, Some(0), Some(-5)] {
            let spec = KimiManagedSpec {
                interface_type: "kimi".to_string(),
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: Some("sk-test".to_string()),
                env: BTreeMap::new(),
                model: "kimi-k2.7-code".to_string(),
                max_context_size: ctx,
            };
            let mut doc = toml::Value::Table(toml::map::Map::new());
            apply_kimi_managed_block(&mut doc, Some(&spec)).expect("write managed block");
            let serialized = toml::to_string_pretty(&doc).expect("serialize");
            let reparsed: toml::Value = serialized.parse().expect("valid toml");
            let written = reparsed
                .get("models")
                .and_then(|m| m.get(KIMI_MANAGED_MODEL_ALIAS))
                .and_then(|m| m.get("max_context_size"))
                .and_then(toml::Value::as_integer)
                .expect("max_context_size present for ctx input");
            assert!(
                written > 0,
                "expected a positive max_context_size for input {ctx:?}, got {written}"
            );
            assert_eq!(written, KIMI_DEFAULT_MAX_CONTEXT_SIZE);
        }
    }

    #[test]
    fn kimi_managed_block_clear_preserves_user_sections() {
        let mut doc: toml::Value = r#"
default_model = "mine"
[providers.veryagent]
type = "openai"
api_key = "sk"
[providers.mine]
type = "openai"
api_key = "sk-user"
[models.veryagent-managed]
provider = "veryagent"
model = "x"
[models.mine]
provider = "mine"
model = "gpt"
"#
        .parse()
        .expect("valid toml");
        apply_kimi_managed_block(&mut doc, None).expect("clear managed block");
        let t = doc.as_table().unwrap();
        // A user-owned default_model (not our alias) survives untouched.
        assert_eq!(
            t.get("default_model").and_then(toml::Value::as_str),
            Some("mine")
        );
        let providers = t.get("providers").and_then(toml::Value::as_table).unwrap();
        assert!(!providers.contains_key(KIMI_MANAGED_PROVIDER));
        assert!(providers.contains_key("mine"));
        let models = t.get("models").and_then(toml::Value::as_table).unwrap();
        assert!(!models.contains_key(KIMI_MANAGED_MODEL_ALIAS));
        assert!(models.contains_key("mine"));
    }

    #[test]
    fn kimi_managed_block_clear_resets_our_default_and_empties() {
        let mut doc: toml::Value = r#"
default_model = "veryagent-managed"
[providers.veryagent]
type = "kimi"
[models.veryagent-managed]
provider = "veryagent"
model = "kimi-for-coding"
"#
        .parse()
        .expect("valid toml");
        apply_kimi_managed_block(&mut doc, None).expect("clear");
        let t = doc.as_table().unwrap();
        assert!(t.get("default_model").is_none());
        // Emptied tables are dropped entirely.
        assert!(t.get("providers").is_none());
        assert!(t.get("models").is_none());
    }

    #[test]
    fn kimi_build_spec_env_auth_writes_provider_key_var() {
        let update = KimiCodeConfigUpdate {
            mode: "apikey".to_string(),
            interface_type: Some("openai".to_string()),
            auth_type: Some("env".to_string()),
            base_url: Some("https://api.deepseek.com/v1".to_string()),
            api_key: Some("sk-deep".to_string()),
            model: Some("deepseek-chat".to_string()),
            max_context_size: None,
            vertex_project: None,
            vertex_location: None,
            raw_config_toml: None,
        };
        let spec = build_kimi_managed_spec(&update).expect("valid spec");
        // env auth → key lands in the provider env sub-table, NOT the inline field.
        assert!(spec.api_key.is_none());
        assert_eq!(spec.env.get("OPENAI_API_KEY"), Some(&"sk-deep".to_string()));
    }

    #[test]
    fn kimi_build_spec_vertex_uses_adc_not_api_key() {
        let update = KimiCodeConfigUpdate {
            mode: "apikey".to_string(),
            interface_type: Some("vertexai".to_string()),
            auth_type: None,
            base_url: None,
            api_key: Some("ignored".to_string()),
            model: Some("gemini-2.5-pro".to_string()),
            max_context_size: None,
            vertex_project: Some("my-proj".to_string()),
            vertex_location: Some("us-central1".to_string()),
            raw_config_toml: None,
        };
        let spec = build_kimi_managed_spec(&update).expect("valid vertex spec");
        assert!(spec.api_key.is_none());
        assert_eq!(
            spec.env.get("GOOGLE_CLOUD_PROJECT"),
            Some(&"my-proj".to_string())
        );
        assert_eq!(
            spec.env.get("GOOGLE_CLOUD_LOCATION"),
            Some(&"us-central1".to_string())
        );
    }

    #[test]
    fn kimi_build_spec_rejects_unknown_type_and_missing_model() {
        let base = KimiCodeConfigUpdate {
            mode: "apikey".to_string(),
            interface_type: Some("nope".to_string()),
            auth_type: None,
            base_url: None,
            api_key: None,
            model: Some("m".to_string()),
            max_context_size: None,
            vertex_project: None,
            vertex_location: None,
            raw_config_toml: None,
        };
        assert!(build_kimi_managed_spec(&base).is_err());
        let no_model = KimiCodeConfigUpdate {
            interface_type: Some("kimi".to_string()),
            model: None,
            ..base.clone()
        };
        assert!(build_kimi_managed_spec(&no_model).is_err());
    }

    #[test]
    fn kimi_project_managed_config_uses_non_colliding_keys() {
        // The projection MUST avoid AgentRuntimeConfig keys (apiKey / apiBaseUrl /
        // model / env); otherwise `build_runtime_env_from_setting` would mirror the
        // config.toml values back into the KIMI_MODEL_* runtime env, defeating the
        // single-source-of-truth between env override and config.toml.
        let value: toml::Value = r#"
default_model = "veryagent-managed"
[providers.veryagent]
type = "anthropic"
base_url = "https://api.anthropic.com"
api_key = "sk-ant"
[models.veryagent-managed]
provider = "veryagent"
model = "claude-opus-4-7"
max_context_size = 200000
"#
        .parse()
        .expect("valid toml");
        let proj = project_kimi_managed_config(&value);
        assert_eq!(
            proj.get("interfaceType").and_then(|v| v.as_str()),
            Some("anthropic")
        );
        assert_eq!(
            proj.get("baseUrl").and_then(|v| v.as_str()),
            Some("https://api.anthropic.com")
        );
        assert_eq!(proj.get("key").and_then(|v| v.as_str()), Some("sk-ant"));
        assert_eq!(proj.get("authType").and_then(|v| v.as_str()), Some("api_key"));
        assert_eq!(
            proj.get("modelId").and_then(|v| v.as_str()),
            Some("claude-opus-4-7")
        );
        assert_eq!(
            proj.get("maxContextSize").and_then(|v| v.as_i64()),
            Some(200000)
        );
        assert_eq!(proj.get("hasManagedBlock"), Some(&serde_json::Value::Bool(true)));
        for forbidden in [
            "apiKey",
            "apiBaseUrl",
            "api_key",
            "api_base_url",
            "model",
            "env",
        ] {
            assert!(
                !proj.contains_key(forbidden),
                "projection must not contain colliding key {forbidden}"
            );
        }
    }

    #[test]
    fn kimi_project_managed_config_env_subtable_surfaces_as_env_auth() {
        let value: toml::Value = r#"
[providers.veryagent]
type = "openai"
[providers.veryagent.env]
OPENAI_API_KEY = "sk-x"
[models.veryagent-managed]
provider = "veryagent"
model = "gpt"
"#
        .parse()
        .expect("valid toml");
        let proj = project_kimi_managed_config(&value);
        assert_eq!(proj.get("key").and_then(|v| v.as_str()), Some("sk-x"));
        assert_eq!(proj.get("authType").and_then(|v| v.as_str()), Some("env"));
    }

    #[test]
    fn kimi_seed_synthetic_credential_opens_gate() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("credentials").join("kimi-code.json");
        seed_kimi_synthetic_credential_at(&path).expect("seed");
        let token = read_kimi_token_at(&path).expect("token written");
        // A non-empty access_token is exactly what `kimi acp`'s session gate
        // (`harnessIsAuthed`) checks — and it must be flagged as ours.
        assert!(kimi_token_has_access(&token));
        assert!(kimi_token_is_synthetic(&token));
        assert_eq!(
            token.get("access_token").and_then(|v| v.as_str()),
            Some(KIMI_SYNTHETIC_TOKEN_ACCESS)
        );
    }

    #[test]
    fn kimi_seed_preserves_a_real_login_token() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("credentials").join("kimi-code.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        // A real OAuth login: non-empty access_token, no synthetic marker.
        std::fs::write(
            &path,
            r#"{"access_token":"real-oauth-abc","token_type":"Bearer"}"#,
        )
        .unwrap();
        seed_kimi_synthetic_credential_at(&path).expect("seed");
        let token = read_kimi_token_at(&path).expect("token");
        assert_eq!(
            token.get("access_token").and_then(|v| v.as_str()),
            Some("real-oauth-abc"),
            "a real login must never be clobbered by the synthetic seed"
        );
        assert!(!kimi_token_is_synthetic(&token));
    }

    #[test]
    fn kimi_remove_if_ours_deletes_synthetic_but_keeps_real() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("credentials").join("kimi-code.json");
        // Synthetic → removed.
        seed_kimi_synthetic_credential_at(&path).expect("seed");
        assert!(path.exists());
        remove_kimi_synthetic_credential_if_ours_at(&path).expect("remove");
        assert!(!path.exists());
        // Real login → preserved.
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"access_token":"real-oauth-abc"}"#).unwrap();
        remove_kimi_synthetic_credential_if_ours_at(&path).expect("remove");
        assert!(path.exists(), "a real login token must not be removed");
    }
}
