//! Per-agent opt-in for shared identity injection (`sharing.json`).

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::app_error::AppCommandError;
use crate::models::agent::AgentType;

use super::location::effective_memory_root;
use super::write_file_atomic;

const SHARING_FILE_NAME: &str = "sharing.json";

/// Soft upper bound on preamble size sent to the agent (chars, not bytes).
pub const DEFAULT_MAX_CHARS: usize = 2_000;
pub const MIN_MAX_CHARS: usize = 200;
pub const MAX_MAX_CHARS: usize = 8_000;

/// Which brains receive the shared identity preamble.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SharingConfig {
    /// Master kill switch. When false, nothing is injected regardless of the map.
    pub enabled: bool,
    /// Per-agent opt-in. Missing keys are treated as `false`.
    pub agents: BTreeMap<String, bool>,
    /// Max characters of the assembled preamble (profile + wrapper).
    pub max_chars: usize,
}

impl Default for SharingConfig {
    fn default() -> Self {
        // All agents off by default — shared identity is opt-in per brain.
        let mut agents = BTreeMap::new();
        for at in ALL_AGENT_SNAKE {
            agents.insert((*at).to_string(), false);
        }
        Self {
            enabled: false,
            agents,
            max_chars: DEFAULT_MAX_CHARS,
        }
    }
}

/// Snake_case agent keys matching the frontend `ALL_AGENT_TYPES` list.
const ALL_AGENT_SNAKE: &[&str] = &[
    "claude_code",
    "codex",
    "open_code",
    "gemini",
    "open_claw",
    "cline",
    "hermes",
    "code_buddy",
    "kimi_code",
    "pi",
];

fn sharing_path() -> PathBuf {
    effective_memory_root().join(SHARING_FILE_NAME)
}

/// Snake_case wire form of an [`AgentType`].
pub fn agent_type_key(at: AgentType) -> String {
    serde_json::to_value(at)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| {
            tracing::warn!("[memory] agent_type_key serde failed for {at:?}");
            String::new()
        })
}

/// Read sharing.json, filling defaults for missing keys / file.
/// Soft-fail on corrupt/invalid JSON — return default config so the UI can
/// still open and the user can fix it. Matches feedback/delegation convention.
pub fn load_sharing() -> Result<SharingConfig, AppCommandError> {
    let path = sharing_path();
    if !path.exists() {
        return Ok(SharingConfig::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| {
        AppCommandError::io_error(format!(
            "failed to read sharing config {}: {e}",
            path.display()
        ))
    })?;
    let mut cfg: SharingConfig = match serde_json::from_str(&raw) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(
                "[memory] sharing.json parse error at {}, falling back to defaults: {e}",
                path.display()
            );
            return Ok(SharingConfig::default());
        }
    };
    // Normalize: clamp max_chars, ensure every known agent has an entry,
    // strip unknown agent keys that may have accumulated from manual edits.
    cfg.max_chars = cfg.max_chars.clamp(MIN_MAX_CHARS, MAX_MAX_CHARS);
    for key in ALL_AGENT_SNAKE {
        cfg.agents.entry((*key).to_string()).or_insert(false);
    }
    cfg.agents.retain(|k, _| ALL_AGENT_SNAKE.contains(&k.as_str()));
    Ok(cfg)
}

/// Persist sharing.json after validation (atomic write).
pub fn save_sharing(mut cfg: SharingConfig) -> Result<SharingConfig, AppCommandError> {
    cfg.max_chars = cfg.max_chars.clamp(MIN_MAX_CHARS, MAX_MAX_CHARS);
    for key in ALL_AGENT_SNAKE {
        cfg.agents.entry((*key).to_string()).or_insert(false);
    }
    cfg.agents.retain(|k, _| ALL_AGENT_SNAKE.contains(&k.as_str()));

    let path = sharing_path();
    let raw = serde_json::to_string_pretty(&cfg).map_err(|e| {
        AppCommandError::configuration_invalid(format!("serialize sharing.json: {e}"))
    })?;
    write_file_atomic(&path, raw.as_bytes())?;
    Ok(cfg)
}

/// Whether `agent` is opted in under the current sharing config.
pub fn is_agent_shared(cfg: &SharingConfig, agent: AgentType) -> bool {
    if !cfg.enabled {
        return false;
    }
    let key = agent_type_key(agent);
    if key.is_empty() {
        return false;
    }
    cfg.agents.get(&key).copied().unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn default_is_opt_in_off() {
        let cfg = SharingConfig::default();
        assert!(!cfg.enabled);
        assert!(!is_agent_shared(&cfg, AgentType::ClaudeCode));
    }

    #[test]
    fn save_load_roundtrip_and_agent_flag() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("VERYAGENT_HOME", dir.path());

        let mut cfg = SharingConfig::default();
        cfg.enabled = true;
        cfg.agents.insert("claude_code".into(), true);
        cfg.agents.insert("codex".into(), false);
        let saved = save_sharing(cfg).unwrap();
        assert!(is_agent_shared(&saved, AgentType::ClaudeCode));
        assert!(!is_agent_shared(&saved, AgentType::Codex));

        let loaded = load_sharing().unwrap();
        assert!(loaded.enabled);
        assert!(is_agent_shared(&loaded, AgentType::ClaudeCode));

        std::env::remove_var("VERYAGENT_HOME");
    }

    #[test]
    fn clamps_max_chars() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("VERYAGENT_HOME", dir.path());

        let mut cfg = SharingConfig::default();
        cfg.max_chars = 50; // below MIN
        let saved = save_sharing(cfg).unwrap();
        assert_eq!(saved.max_chars, MIN_MAX_CHARS);

        std::env::remove_var("VERYAGENT_HOME");
    }

    #[test]
    fn soft_fails_on_corrupt_json() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("VERYAGENT_HOME", dir.path());

        let path = sharing_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{not json").unwrap();

        let cfg = load_sharing().unwrap();
        assert!(!cfg.enabled);
        assert_eq!(cfg.max_chars, DEFAULT_MAX_CHARS);

        std::env::remove_var("VERYAGENT_HOME");
    }
}
