//! Whitelisted OpenWiki CLI runner.
//!
//! Only fixed actions are accepted — arbitrary shell args are never forwarded.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::config::OpenWikiConfig;
use crate::app_error::AppCommandError;

/// Whitelisted OpenWiki actions for P0.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenWikiAction {
    /// `openwiki code --init`
    CodeInit,
    /// `openwiki code --update`
    CodeUpdate,
    /// Probe executable only (no wiki mutation).
    Status,
}

impl OpenWikiAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CodeInit => "code.init",
            Self::CodeUpdate => "code.update",
            Self::Status => "status",
        }
    }

    fn cli_args(self) -> Vec<&'static str> {
        match self {
            Self::CodeInit => vec!["code", "--init"],
            Self::CodeUpdate => vec!["code", "--update"],
            Self::Status => vec!["--help"],
        }
    }
}

/// Structured result of a runner invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWikiRunResult {
    pub action: String,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub executable: String,
    pub working_dir: String,
    pub duration_ms: u64,
}

/// Lightweight status snapshot for the settings page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWikiStatus {
    pub enabled: bool,
    pub executable_found: bool,
    pub executable_path: Option<String>,
    pub wiki_exists: bool,
    pub wiki_path: Option<String>,
    pub last_update_path: Option<String>,
    pub instructions_exists: bool,
    pub message: String,
}

/// Resolve the openwiki executable path from config (or PATH).
pub fn resolve_executable(config: &OpenWikiConfig) -> Result<PathBuf, AppCommandError> {
    let custom = config.paths.executable.trim();
    if !custom.is_empty() {
        let p = PathBuf::from(custom);
        if p.is_file() {
            return Ok(p);
        }
        return Err(AppCommandError::dependency_missing(format!(
            "openwiki executable not found at configured path: {custom}"
        )));
    }

    // Fall back to PATH lookup.
    which_binary("openwiki").ok_or_else(|| {
        AppCommandError::dependency_missing(
            "openwiki not found on PATH. Install it or set a custom executable path in settings."
                .to_string(),
        )
    })
}

fn which_binary(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        // Windows: also try .cmd / .exe / .bat
        #[cfg(windows)]
        {
            for ext in ["exe", "cmd", "bat"] {
                let with_ext = dir.join(format!("{name}.{ext}"));
                if with_ext.is_file() {
                    return Some(with_ext);
                }
            }
        }
    }
    None
}

/// Collect workspace status without running a long init/update.
pub fn collect_status(config: &OpenWikiConfig, workspace: Option<&Path>) -> OpenWikiStatus {
    let executable = resolve_executable(config).ok();
    let wiki_path = workspace.map(|ws| config.code_wiki_dir(ws));
    let wiki_exists = wiki_path
        .as_ref()
        .map(|p| p.is_dir())
        .unwrap_or(false);
    let last_update = wiki_path
        .as_ref()
        .map(|p| p.join(".last-update.json"))
        .filter(|p| p.is_file());
    let instructions = wiki_path
        .as_ref()
        .map(|p| p.join("INSTRUCTIONS.md"))
        .filter(|p| p.is_file());

    let message = if !config.enabled {
        "OpenWiki is disabled.".to_string()
    } else if executable.is_none() {
        "openwiki executable not found.".to_string()
    } else if workspace.is_none() {
        "No workspace selected.".to_string()
    } else if !wiki_exists {
        "Wiki not initialized in this workspace.".to_string()
    } else {
        "Wiki ready.".to_string()
    };

    OpenWikiStatus {
        enabled: config.enabled,
        executable_found: executable.is_some(),
        executable_path: executable.map(|p| p.display().to_string()),
        wiki_exists,
        wiki_path: wiki_path.map(|p| p.display().to_string()),
        last_update_path: last_update.map(|p| p.display().to_string()),
        instructions_exists: instructions.is_some(),
        message,
    }
}

/// Run a whitelisted action. `Status` only probes help and does not need a workspace.
pub async fn run_action(
    config: &OpenWikiConfig,
    action: OpenWikiAction,
    workspace: Option<&Path>,
) -> Result<OpenWikiRunResult, AppCommandError> {
    if !config.enabled && action != OpenWikiAction::Status {
        return Err(AppCommandError::permission_denied(
            "OpenWiki is disabled".to_string(),
        ));
    }

    match action {
        OpenWikiAction::CodeInit if !config.commands.allow_init => {
            return Err(AppCommandError::permission_denied(
                "code.init is disabled in settings".to_string(),
            ));
        }
        OpenWikiAction::CodeUpdate if !config.commands.allow_update => {
            return Err(AppCommandError::permission_denied(
                "code.update is disabled in settings".to_string(),
            ));
        }
        _ => {}
    }

    let executable = resolve_executable(config)?;
    let working_dir = match action {
        OpenWikiAction::Status => workspace
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))),
        OpenWikiAction::CodeInit | OpenWikiAction::CodeUpdate => {
            let ws = workspace.ok_or_else(|| {
                AppCommandError::invalid_input("workspace path is required for this action")
            })?;
            if !ws.is_dir() {
                return Err(AppCommandError::invalid_input(format!(
                    "workspace is not a directory: {}",
                    ws.display()
                )));
            }
            ws.to_path_buf()
        }
    };

    let args = action.cli_args();
    let started = std::time::Instant::now();

    let mut cmd = Command::new(&executable);
    cmd.args(&args)
        .current_dir(&working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Optional model overrides via env (do not log secrets).
    if !config.model.use_openwiki_env {
        if let Some(provider) = &config.model.provider {
            if !provider.is_empty() {
                cmd.env("OPENWIKI_PROVIDER", provider);
            }
        }
        if let Some(model_id) = &config.model.model_id {
            if !model_id.is_empty() {
                cmd.env("OPENWIKI_MODEL", model_id);
            }
        }
        if !config.model.api_key.is_empty() {
            cmd.env("OPENAI_API_KEY", &config.model.api_key);
            cmd.env("ANTHROPIC_API_KEY", &config.model.api_key);
        }
        if let Some(base) = &config.model.base_url {
            if !base.is_empty() {
                cmd.env("OPENAI_BASE_URL", base);
            }
        }
    }

    let child = cmd.spawn().map_err(|e| {
        AppCommandError::external_command(
            "failed to spawn openwiki",
            format!("{}: {e}", executable.display()),
        )
    })?;

    // Bound long-running init/update so a hung CLI cannot pin the runtime forever.
    let timeout = match action {
        OpenWikiAction::Status => Duration::from_secs(15),
        OpenWikiAction::CodeInit | OpenWikiAction::CodeUpdate => Duration::from_secs(60 * 30),
    };

    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            return Err(AppCommandError::external_command(
                "openwiki process failed",
                e.to_string(),
            ));
        }
        Err(_) => {
            return Err(AppCommandError::task_execution_failed(format!(
                "openwiki {} timed out after {}s",
                action.as_str(),
                timeout.as_secs()
            )));
        }
    };

    let duration_ms = started.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code();
    let success = output.status.success();

    // Truncate log tails so a chatty CLI cannot blow the response payload.
    const MAX_LOG: usize = 32_000;
    let stdout = truncate_chars(&stdout, MAX_LOG);
    let stderr = truncate_chars(&stderr, MAX_LOG);

    Ok(OpenWikiRunResult {
        action: action.as_str().to_string(),
        success,
        exit_code,
        stdout,
        stderr,
        executable: executable.display().to_string(),
        working_dir: working_dir.display().to_string(),
        duration_ms,
    })
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(20)).collect();
    out.push_str("\n…[truncated]\n");
    out
}

/// Read INSTRUCTIONS.md under the code wiki dir (creates empty if missing when writing).
pub fn read_instructions(
    config: &OpenWikiConfig,
    workspace: &Path,
) -> Result<String, AppCommandError> {
    let path = config.code_wiki_dir(workspace).join("INSTRUCTIONS.md");
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| {
        AppCommandError::io_error(format!("failed to read {}: {e}", path.display()))
    })
}

/// Write INSTRUCTIONS.md under the code wiki dir.
pub fn write_instructions(
    config: &OpenWikiConfig,
    workspace: &Path,
    content: &str,
) -> Result<(), AppCommandError> {
    let wiki = config.code_wiki_dir(workspace);
    std::fs::create_dir_all(&wiki).map_err(|e| {
        AppCommandError::io_error(format!("failed to create {}: {e}", wiki.display()))
    })?;
    let path = wiki.join("INSTRUCTIONS.md");
    std::fs::write(&path, content).map_err(|e| {
        AppCommandError::io_error(format!("failed to write {}: {e}", path.display()))
    })
}

/// Optionally maintain the OPENWIKI block in AGENTS.md / CLAUDE.md at workspace root.
pub fn maybe_update_agents_md(
    config: &OpenWikiConfig,
    workspace: &Path,
) -> Result<Vec<String>, AppCommandError> {
    if !config.inject.inject_agents_md {
        return Ok(Vec::new());
    }
    let wiki_rel = &config.paths.code_wiki_dirname;
    let body = format!(
        "This project has an OpenWiki knowledge base under `{wiki_rel}/`.\n\
         Prefer reading overview/index pages there before large exploratory searches.\n\
         Do not rewrite this block outside VeryAgent OpenWiki settings."
    );
    let mut touched = Vec::new();
    for name in ["AGENTS.md", "CLAUDE.md"] {
        let path = workspace.join(name);
        if !path.exists() {
            // Only create AGENTS.md; leave CLAUDE.md alone if missing.
            if name != "AGENTS.md" {
                continue;
            }
        }
        let existing = if path.exists() {
            std::fs::read_to_string(&path).map_err(|e| {
                AppCommandError::io_error(format!("failed to read {}: {e}", path.display()))
            })?
        } else {
            String::new()
        };
        let updated = super::agents_md::upsert_openwiki_block(&existing, &body);
        if updated != existing {
            std::fs::write(&path, updated).map_err(|e| {
                AppCommandError::io_error(format!("failed to write {}: {e}", path.display()))
            })?;
            touched.push(path.display().to_string());
        }
    }
    Ok(touched)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::openwiki::config::OpenWikiConfig;

    #[test]
    fn status_reports_missing_wiki() {
        let dir = tempfile::tempdir().unwrap();
        let mut cfg = OpenWikiConfig::default();
        cfg.enabled = true;
        let st = collect_status(&cfg, Some(dir.path()));
        assert!(st.enabled);
        assert!(!st.wiki_exists);
        assert!(st.message.contains("not initialized") || st.message.contains("not found"));
    }

    #[test]
    fn action_ids_are_stable() {
        assert_eq!(OpenWikiAction::CodeInit.as_str(), "code.init");
        assert_eq!(OpenWikiAction::CodeUpdate.as_str(), "code.update");
    }
}
