//! Build the OpenWiki preamble injected into the first user prompt for
//! authorized agents. Mirrors `memory::inject` but reads from the runtime
//! config + workspace wiki directory.

use std::path::{Path, PathBuf};

use crate::acp::types::PromptInputBlock;
use crate::models::agent::AgentType;

use super::config::{OpenWikiAgentCapability, OpenWikiConfig, OpenWikiInjectMode};

const PREAMBLE_HEADER: &str = "[VeryAgent OpenWiki]";
const PREAMBLE_FOOTER: &str = "[End OpenWiki — use the wiki as reference; user instructions override when they conflict]";

/// Outcome of the OpenWiki inject decision for one prompt send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenWikiInjectDecision {
    Inject { preamble: String },
    Skip,
}

/// Map AgentType to the snake_case key used in config.
pub fn agent_type_key(agent: AgentType) -> String {
    serde_json::to_value(agent)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default()
}

/// Read a short summary from the code wiki directory when present.
/// Prefers INDEX.md / overview.md / README.md under the wiki root.
pub fn read_wiki_summary(wiki_dir: &Path, max_chars: usize) -> Option<String> {
    if !wiki_dir.is_dir() {
        return None;
    }
    const CANDIDATES: &[&str] = &[
        "INDEX.md",
        "index.md",
        "OVERVIEW.md",
        "overview.md",
        "README.md",
        "readme.md",
    ];
    for name in CANDIDATES {
        let path = wiki_dir.join(name);
        if let Ok(raw) = std::fs::read_to_string(&path) {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                continue;
            }
            let text: String = trimmed.chars().take(max_chars).collect();
            return Some(text);
        }
    }
    // Fallback: list a few top-level markdown files as a TOC hint.
    let mut names: Vec<String> = std::fs::read_dir(wiki_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
        })
        .filter_map(|e| e.file_name().into_string().ok())
        .take(12)
        .collect();
    if names.is_empty() {
        return None;
    }
    names.sort();
    Some(format!("Wiki pages: {}", names.join(", ")))
}

/// Build the inject preamble text for a workspace + config snapshot.
pub fn build_preamble(
    config: &OpenWikiConfig,
    workspace: &Path,
    agent: AgentType,
    can_request_update: bool,
) -> Option<String> {
    if !config.inject.on_session_start {
        return None;
    }
    let wiki_dir = config.code_wiki_dir(workspace);
    let wiki_rel = config.paths.code_wiki_dirname.as_str();
    let summary = match config.inject.inject_mode {
        OpenWikiInjectMode::PathOnly => None,
        OpenWikiInjectMode::Summary | OpenWikiInjectMode::SummaryAndPath => {
            read_wiki_summary(&wiki_dir, 1200)
        }
    };

    let exists = wiki_dir.is_dir();
    let mut lines = vec![
        PREAMBLE_HEADER.to_string(),
        format!(
            "Code wiki root: `{wiki_rel}/` (absolute: `{}`).",
            wiki_dir.display()
        ),
    ];
    if !exists {
        lines.push(
            "The wiki directory does not exist yet. Ask the user before initializing.".into(),
        );
    } else {
        match config.inject.inject_mode {
            OpenWikiInjectMode::PathOnly => {
                lines.push("Read pages under this directory when you need project knowledge.".into());
            }
            OpenWikiInjectMode::Summary | OpenWikiInjectMode::SummaryAndPath => {
                if let Some(s) = summary {
                    lines.push(String::new());
                    lines.push("Wiki summary / index:".into());
                    lines.push(s);
                } else {
                    lines.push(
                        "Wiki directory exists but no index/overview was found. Browse the folder as needed.".into(),
                    );
                }
            }
        }
    }
    if can_request_update {
        lines.push(
            "You may request a wiki update when project knowledge is stale (user/tool path only)."
                .into(),
        );
    } else {
        lines.push("You may read the wiki; you are not authorized to request init/update.".into());
    }
    lines.push(String::new());
    lines.push(PREAMBLE_FOOTER.to_string());
    lines.push(String::new());

    let mut text = lines.join("\n");
    // Bound preamble size so it cannot dominate the user prompt.
    const MAX: usize = 2500;
    if text.chars().count() > MAX {
        text = text.chars().take(MAX.saturating_sub(20)).collect();
        text.push_str("\n…[truncated]\n\n");
    }
    // Keep agent name available for debugging without changing semantics.
    let _ = agent;
    Some(text)
}

/// Decide whether to inject OpenWiki context for this prompt.
pub fn maybe_inject_openwiki(
    config: &OpenWikiConfig,
    agent: AgentType,
    already_injected: bool,
    workspace: Option<&Path>,
) -> OpenWikiInjectDecision {
    if already_injected {
        return OpenWikiInjectDecision::Skip;
    }
    let key = agent_type_key(agent);
    if !config.is_enabled_for_agent(&key, OpenWikiAgentCapability::ReadWiki) {
        return OpenWikiInjectDecision::Skip;
    }
    if !config.modes.code {
        return OpenWikiInjectDecision::Skip;
    }
    let Some(ws) = workspace else {
        return OpenWikiInjectDecision::Skip;
    };
    if ws.as_os_str().is_empty() {
        return OpenWikiInjectDecision::Skip;
    }
    let can_update =
        config.is_enabled_for_agent(&key, OpenWikiAgentCapability::RequestUpdate);
    match build_preamble(config, ws, agent, can_update) {
        Some(preamble) if !preamble.trim().is_empty() => {
            OpenWikiInjectDecision::Inject { preamble }
        }
        _ => OpenWikiInjectDecision::Skip,
    }
}

/// Prepend a text preamble to wire prompt blocks (mutates in place).
pub fn prepend_preamble(blocks: &mut Vec<PromptInputBlock>, preamble: String) {
    if preamble.is_empty() {
        return;
    }
    blocks.insert(
        0,
        PromptInputBlock::Text {
            text: preamble,
        },
    );
}

/// Resolve workspace path from optional string.
pub fn workspace_path(working_dir: Option<&PathBuf>) -> Option<&Path> {
    working_dir.map(|p| p.as_path())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::openwiki::config::{OpenWikiAgentPermission, OpenWikiConfig};

    #[test]
    fn skip_when_disabled() {
        let cfg = OpenWikiConfig::default();
        let d = maybe_inject_openwiki(
            &cfg,
            AgentType::ClaudeCode,
            false,
            Some(Path::new("/tmp/ws")),
        );
        assert_eq!(d, OpenWikiInjectDecision::Skip);
    }

    #[test]
    fn skip_when_already_injected() {
        let mut cfg = OpenWikiConfig::default();
        cfg.enabled = true;
        cfg.agent_types_list = vec!["claude_code".into()];
        let cfg = cfg.normalize();
        let d = maybe_inject_openwiki(
            &cfg,
            AgentType::ClaudeCode,
            true,
            Some(Path::new("/tmp/ws")),
        );
        assert_eq!(d, OpenWikiInjectDecision::Skip);
    }

    #[test]
    fn inject_for_authorized_agent() {
        let dir = tempfile::tempdir().unwrap();
        let wiki = dir.path().join("openwiki");
        std::fs::create_dir_all(&wiki).unwrap();
        std::fs::write(wiki.join("INDEX.md"), "# Overview\n\nProject brain.").unwrap();

        let mut cfg = OpenWikiConfig::default();
        cfg.enabled = true;
        cfg.agent_permissions = vec![OpenWikiAgentPermission {
            agent_type: "claude_code".into(),
            capabilities: vec![OpenWikiAgentCapability::ReadWiki],
        }];
        let cfg = cfg.normalize();
        match maybe_inject_openwiki(&cfg, AgentType::ClaudeCode, false, Some(dir.path())) {
            OpenWikiInjectDecision::Inject { preamble } => {
                assert!(preamble.contains("OpenWiki"));
                assert!(preamble.contains("openwiki"));
                assert!(preamble.contains("Project brain"));
            }
            OpenWikiInjectDecision::Skip => panic!("expected inject"),
        }
    }

    #[test]
    fn unauthorized_agent_skipped() {
        let mut cfg = OpenWikiConfig::default();
        cfg.enabled = true;
        cfg.agent_types_list = vec!["claude_code".into()];
        let cfg = cfg.normalize();
        let d = maybe_inject_openwiki(&cfg, AgentType::Codex, false, Some(Path::new("/tmp/ws")));
        assert_eq!(d, OpenWikiInjectDecision::Skip);
    }
}