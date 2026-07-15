//! OpenWiki configuration model + hot-swappable runtime handle.
//!
//! Mirrors the Vision Bridge / Feedback pattern: persisted settings live in
//! `app_metadata`, while [`OpenWikiRuntimeConfig`] is what injection and the
//! runner read at call time.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

/// Capability an agent may be granted for OpenWiki.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenWikiAgentCapability {
    ReadWiki,
    RequestUpdate,
    RequestInit,
    RequestChat,
}

impl OpenWikiAgentCapability {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReadWiki => "read_wiki",
            Self::RequestUpdate => "request_update",
            Self::RequestInit => "request_init",
            Self::RequestChat => "request_chat",
        }
    }
}

/// Per-agent capability grant.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenWikiAgentPermission {
    pub agent_type: String,
    pub capabilities: Vec<OpenWikiAgentCapability>,
}

/// Injection strategy for session start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OpenWikiInjectMode {
    #[default]
    SummaryAndPath,
    Summary,
    PathOnly,
}

/// Feature flags for command categories.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenWikiCommandFlags {
    pub allow_init: bool,
    pub allow_update: bool,
    pub allow_chat: bool,
    pub allow_ingest: bool,
    pub allow_cron: bool,
    pub allow_auth: bool,
    pub advanced_enabled: bool,
}

impl Default for OpenWikiCommandFlags {
    fn default() -> Self {
        Self {
            allow_init: true,
            allow_update: true,
            allow_chat: false,
            allow_ingest: false,
            allow_cron: false,
            allow_auth: false,
            advanced_enabled: false,
        }
    }
}

/// Mode toggles. P0 only uses `code`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenWikiModes {
    pub code: bool,
    pub personal: bool,
}

impl Default for OpenWikiModes {
    fn default() -> Self {
        Self {
            code: true,
            personal: false,
        }
    }
}

/// Session inject preferences.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenWikiInjectConfig {
    pub on_session_start: bool,
    pub inject_agents_md: bool,
    pub inject_mode: OpenWikiInjectMode,
}

impl Default for OpenWikiInjectConfig {
    fn default() -> Self {
        Self {
            on_session_start: true,
            inject_agents_md: false,
            inject_mode: OpenWikiInjectMode::SummaryAndPath,
        }
    }
}

/// Auto-update preferences (scheduler wiring is P1; flags are stored now).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenWikiAutoUpdate {
    pub enabled: bool,
    pub on_git_change: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule_cron: Option<String>,
}

impl Default for OpenWikiAutoUpdate {
    fn default() -> Self {
        Self {
            enabled: false,
            on_git_change: false,
            schedule_cron: None,
        }
    }
}

/// Model / provider settings for the openwiki CLI process.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenWikiModelConfig {
    pub use_openwiki_env: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// Optional API key override. Empty string means "use env / unset".
    #[serde(default)]
    pub api_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

impl Default for OpenWikiModelConfig {
    fn default() -> Self {
        Self {
            use_openwiki_env: true,
            provider: None,
            model_id: None,
            api_key: String::new(),
            base_url: None,
        }
    }
}

/// Path settings for code/personal wiki roots.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenWikiPaths {
    /// Directory name under the workspace for Code mode (default `openwiki`).
    pub code_wiki_dirname: String,
    /// Absolute path override for Personal mode (P1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub personal_wiki_root: Option<String>,
    /// Executable path. Empty = look up `openwiki` on PATH.
    #[serde(default)]
    pub executable: String,
}

impl Default for OpenWikiPaths {
    fn default() -> Self {
        Self {
            code_wiki_dirname: "openwiki".to_string(),
            personal_wiki_root: None,
            executable: String::new(),
        }
    }
}

/// Full OpenWiki configuration snapshot returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenWikiConfig {
    pub enabled: bool,
    pub modes: OpenWikiModes,
    /// Simple read-grant list (kept for Vision-Bridge-style UI).
    pub agent_types_list: Vec<String>,
    /// Fine-grained capabilities; takes precedence when non-empty for an agent.
    pub agent_permissions: Vec<OpenWikiAgentPermission>,
    pub inject: OpenWikiInjectConfig,
    pub auto_update: OpenWikiAutoUpdate,
    pub model: OpenWikiModelConfig,
    pub paths: OpenWikiPaths,
    pub commands: OpenWikiCommandFlags,
    pub ignore_patterns: Vec<String>,
}

impl Default for OpenWikiConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            modes: OpenWikiModes::default(),
            agent_types_list: Vec::new(),
            agent_permissions: Vec::new(),
            inject: OpenWikiInjectConfig::default(),
            auto_update: OpenWikiAutoUpdate::default(),
            model: OpenWikiModelConfig::default(),
            paths: OpenWikiPaths::default(),
            commands: OpenWikiCommandFlags::default(),
            ignore_patterns: Vec::new(),
        }
    }
}

impl OpenWikiConfig {
    /// Normalize defaults and reconcile agent grants.
    ///
    /// Rules:
    /// - `agent_types_list` is authoritative when non-empty (UI checkbox path).
    /// - When the list is empty but `agent_permissions` is set, permissions are
    ///   authoritative (fine-grained / API path) and the list is derived.
    /// - When both are empty, all grants stay revoked.
    pub fn normalize(mut self) -> Self {
        self.paths.code_wiki_dirname =
            sanitize_code_wiki_dirname(&self.paths.code_wiki_dirname);

        let mut selected: BTreeMap<String, ()> = BTreeMap::new();
        for agent in self.agent_types_list.drain(..) {
            let key = agent.trim().to_string();
            if !key.is_empty() {
                selected.insert(key, ());
            }
        }

        let list_was_authoritative = !selected.is_empty();

        let mut by_agent: BTreeMap<String, OpenWikiAgentPermission> = self
            .agent_permissions
            .into_iter()
            .filter_map(|mut p| {
                p.agent_type = p.agent_type.trim().to_string();
                if p.agent_type.is_empty() {
                    return None;
                }
                // When the list is authoritative, drop agents not selected.
                if list_was_authoritative && !selected.contains_key(&p.agent_type) {
                    return None;
                }
                Some((p.agent_type.clone(), p))
            })
            .collect();

        if list_was_authoritative {
            // Ensure every listed agent has at least ReadWiki.
            for agent in selected.keys() {
                let entry = by_agent.entry(agent.clone()).or_insert_with(|| {
                    OpenWikiAgentPermission {
                        agent_type: agent.clone(),
                        capabilities: vec![OpenWikiAgentCapability::ReadWiki],
                    }
                });
                if !entry
                    .capabilities
                    .contains(&OpenWikiAgentCapability::ReadWiki)
                {
                    entry.capabilities.push(OpenWikiAgentCapability::ReadWiki);
                }
            }
        }

        let mut reads: Vec<String> = by_agent
            .values()
            .filter(|p| {
                p.capabilities
                    .contains(&OpenWikiAgentCapability::ReadWiki)
            })
            .map(|p| p.agent_type.clone())
            .collect();
        reads.sort();
        reads.dedup();
        self.agent_types_list = reads;
        self.agent_permissions = by_agent.into_values().collect();
        self
    }

    /// Whether the feature is enabled and the agent has the given capability.
    pub fn is_enabled_for_agent(&self, agent_type: &str, cap: OpenWikiAgentCapability) -> bool {
        if !self.enabled {
            return false;
        }
        if let Some(perm) = self
            .agent_permissions
            .iter()
            .find(|p| p.agent_type == agent_type)
        {
            return perm.capabilities.contains(&cap);
        }
        // Fallback: agent_types_list grants read only.
        cap == OpenWikiAgentCapability::ReadWiki
            && self.agent_types_list.iter().any(|t| t == agent_type)
    }

    pub fn code_wiki_dir(&self, workspace: &std::path::Path) -> std::path::PathBuf {
        workspace.join(&self.paths.code_wiki_dirname)
    }
}

/// Accept only a single relative directory name under the workspace.
/// Rejects empty, `.` / `..`, absolute paths, and any path separators.
pub fn sanitize_code_wiki_dirname(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "openwiki".to_string();
    }
    if trimmed == "." || trimmed == ".." {
        return "openwiki".to_string();
    }
    // Absolute paths (Unix `/...`, Windows `C:\...` or `\\server\share`).
    if trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || (trimmed.len() >= 2
            && trimmed.as_bytes()[0].is_ascii_alphabetic()
            && trimmed.as_bytes()[1] == b':')
    {
        return "openwiki".to_string();
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return "openwiki".to_string();
    }
    if trimmed.contains("..") {
        return "openwiki".to_string();
    }
    trimmed.to_string()
}

/// Compact runtime snapshot used at inject / permission check time.
#[derive(Debug, Clone, Default)]
pub struct OpenWikiRuntimeState {
    pub config: OpenWikiConfig,
}

/// Shared, hot-swappable handle to [`OpenWikiRuntimeState`].
#[derive(Clone, Default)]
pub struct OpenWikiRuntimeConfig {
    inner: Arc<RwLock<OpenWikiRuntimeState>>,
}

impl OpenWikiRuntimeConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn snapshot(&self) -> OpenWikiConfig {
        self.inner.read().await.config.clone()
    }

    pub async fn set(&self, config: OpenWikiConfig) {
        self.inner.write().await.config = config.normalize();
    }

    pub async fn is_enabled(&self) -> bool {
        self.inner.read().await.config.enabled
    }

    pub async fn is_enabled_for_agent(
        &self,
        agent_type: &str,
        cap: OpenWikiAgentCapability,
    ) -> bool {
        self.inner
            .read()
            .await
            .config
            .is_enabled_for_agent(agent_type, cap)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_disabled_opt_in() {
        let cfg = OpenWikiConfig::default();
        assert!(!cfg.enabled);
        assert!(!cfg.is_enabled_for_agent("claude_code", OpenWikiAgentCapability::ReadWiki));
    }

    #[test]
    fn agent_types_list_grants_read_only() {
        let mut cfg = OpenWikiConfig::default();
        cfg.enabled = true;
        cfg.agent_types_list = vec!["claude_code".into()];
        let cfg = cfg.normalize();
        assert!(cfg.is_enabled_for_agent("claude_code", OpenWikiAgentCapability::ReadWiki));
        assert!(!cfg.is_enabled_for_agent("claude_code", OpenWikiAgentCapability::RequestUpdate));
        assert!(!cfg.is_enabled_for_agent("codex", OpenWikiAgentCapability::ReadWiki));
    }

    #[test]
    fn fine_grained_permissions_take_effect() {
        let mut cfg = OpenWikiConfig::default();
        cfg.enabled = true;
        cfg.agent_permissions = vec![OpenWikiAgentPermission {
            agent_type: "codex".into(),
            capabilities: vec![
                OpenWikiAgentCapability::ReadWiki,
                OpenWikiAgentCapability::RequestUpdate,
            ],
        }];
        let cfg = cfg.normalize();
        assert!(cfg.is_enabled_for_agent("codex", OpenWikiAgentCapability::RequestUpdate));
        assert!(cfg.agent_types_list.contains(&"codex".to_string()));
    }

    #[test]
    fn disabled_master_switch_blocks_all() {
        let mut cfg = OpenWikiConfig::default();
        cfg.enabled = false;
        cfg.agent_types_list = vec!["claude_code".into()];
        let cfg = cfg.normalize();
        assert!(!cfg.is_enabled_for_agent("claude_code", OpenWikiAgentCapability::ReadWiki));
    }

    #[test]
    fn unchecking_agent_revokes_permissions() {
        let mut cfg = OpenWikiConfig::default();
        cfg.enabled = true;
        cfg.agent_types_list = vec!["claude_code".into(), "codex".into()];
        cfg.agent_permissions = vec![
            OpenWikiAgentPermission {
                agent_type: "claude_code".into(),
                capabilities: vec![OpenWikiAgentCapability::ReadWiki],
            },
            OpenWikiAgentPermission {
                agent_type: "codex".into(),
                capabilities: vec![
                    OpenWikiAgentCapability::ReadWiki,
                    OpenWikiAgentCapability::RequestUpdate,
                ],
            },
        ];
        // UI unchecks codex: only list remains with claude_code.
        cfg.agent_types_list = vec!["claude_code".into()];
        let cfg = cfg.normalize();
        assert!(cfg.is_enabled_for_agent("claude_code", OpenWikiAgentCapability::ReadWiki));
        assert!(!cfg.is_enabled_for_agent("codex", OpenWikiAgentCapability::ReadWiki));
        assert!(!cfg.is_enabled_for_agent("codex", OpenWikiAgentCapability::RequestUpdate));
        assert!(!cfg.agent_types_list.contains(&"codex".to_string()));
        assert!(cfg
            .agent_permissions
            .iter()
            .all(|p| p.agent_type != "codex"));
    }

    #[test]
    fn empty_list_clears_all_grants() {
        let mut cfg = OpenWikiConfig::default();
        cfg.enabled = true;
        cfg.agent_types_list = vec![];
        cfg.agent_permissions = vec![OpenWikiAgentPermission {
            agent_type: "claude_code".into(),
            capabilities: vec![OpenWikiAgentCapability::ReadWiki],
        }];
        // When list is empty, permissions-only path is authoritative (fine-grained).
        // To fully revoke via UI, frontend clears both; simulate that.
        cfg.agent_permissions.clear();
        let cfg = cfg.normalize();
        assert!(cfg.agent_types_list.is_empty());
        assert!(cfg.agent_permissions.is_empty());
        assert!(!cfg.is_enabled_for_agent("claude_code", OpenWikiAgentCapability::ReadWiki));
    }

    #[test]
    fn sanitize_rejects_traversal_and_absolute_paths() {
        assert_eq!(sanitize_code_wiki_dirname(""), "openwiki");
        assert_eq!(sanitize_code_wiki_dirname(".."), "openwiki");
        assert_eq!(sanitize_code_wiki_dirname("../evil"), "openwiki");
        assert_eq!(sanitize_code_wiki_dirname("foo/bar"), "openwiki");
        assert_eq!(sanitize_code_wiki_dirname("foo\\bar"), "openwiki");
        assert_eq!(sanitize_code_wiki_dirname("/tmp/wiki"), "openwiki");
        assert_eq!(sanitize_code_wiki_dirname("C:\\evil"), "openwiki");
        assert_eq!(sanitize_code_wiki_dirname("  docs  "), "docs");
        assert_eq!(sanitize_code_wiki_dirname("openwiki"), "openwiki");
    }
}