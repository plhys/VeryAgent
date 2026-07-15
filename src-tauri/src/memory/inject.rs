//! Build and gate the shared-identity preamble injected into the first prompt.

use crate::acp::types::PromptInputBlock;
use crate::models::agent::AgentType;

use super::profile::load_profile;
use super::sharing::{agent_type_key, is_agent_shared, load_sharing};

/// Outcome of the inject decision for one prompt send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InjectDecision {
    /// Prepend this preamble text (already truncated) to the wire prompt.
    Inject { preamble: String },
    /// Do not inject (disabled, not opted in, already injected, empty profile, etc.).
    Skip,
}

/// Marker lines wrap the profile so the model can tell body context from the
/// user's actual request. Kept short and stable.
const PREAMBLE_HEADER: &str = "[VeryAgent Shared Identity]";
const PREAMBLE_FOOTER: &str = "[End Shared Identity — follow the user's message below; \
user instructions override this block when they conflict]";

/// Build the markdown preamble for a given brain + profile body.
///
/// Includes the current brain name so the model knows which runtime it is.
pub fn build_preamble(agent: AgentType, profile_md: &str, max_chars: usize) -> String {
    let brain = agent.to_string();
    let key = agent_type_key(agent);
    let body = profile_md.trim();

    let mut text = format!(
        "{PREAMBLE_HEADER}\n\
         You are running inside VeryAgent as the \"body\". The current brain \
         (agent runtime) is **{brain}** (`{key}`).\n\
         The following identity and preferences are stable across brain switches. \
         Private memory belonging to this brain is separate and still applies.\n\
         Priority when instructions conflict: (1) the user's current message, \
         (2) this shared identity, (3) this brain's private memory, (4) model defaults.\n\n\
         {body}\n\n\
         {PREAMBLE_FOOTER}\n\n"
    );

    if text.chars().count() > max_chars {
        text = text.chars().take(max_chars.saturating_sub(20)).collect();
        text.push_str("\n…[truncated]\n\n");
    }
    text
}

/// Decide whether to inject, loading profile + sharing from disk.
///
/// `already_injected` is the per-connection SessionState flag — once true for
/// this conversation/connection, we never inject again.
///
/// Skips injection when the profile has no meaningful fields filled in.
pub fn maybe_inject_shared_identity(
    agent: AgentType,
    already_injected: bool,
) -> InjectDecision {
    if already_injected {
        return InjectDecision::Skip;
    }

    let sharing = match load_sharing() {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("[memory] load_sharing failed, skip inject: {e}");
            return InjectDecision::Skip;
        }
    };
    if !is_agent_shared(&sharing, agent) {
        return InjectDecision::Skip;
    }

    let profile = match load_profile() {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("[memory] load_profile failed, skip inject: {e}");
            return InjectDecision::Skip;
        }
    };
    if !profile.has_meaningful_content() {
        return InjectDecision::Skip;
    }

    let body = profile.to_preamble_body();
    if body.trim().is_empty() {
        return InjectDecision::Skip;
    }

    let preamble = build_preamble(agent, &body, sharing.max_chars);
    if preamble.trim().is_empty() {
        return InjectDecision::Skip;
    }
    InjectDecision::Inject { preamble }
}

/// Prepend a text preamble to the wire prompt blocks (mutates in place).
/// UI/history should keep the original blocks; only the agent-facing wire
/// payload uses the result.
pub fn prepend_preamble(blocks: &mut Vec<PromptInputBlock>, preamble: String) {
    if preamble.is_empty() {
        return;
    }
    blocks.insert(0, PromptInputBlock::Text { text: preamble });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::profile::{save_profile, SharedProfile};
    use crate::memory::sharing::{save_sharing, SharingConfig};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn build_preamble_includes_brain_and_body() {
        let text = build_preamble(AgentType::Codex, "- Agent name: 超人\n", 2000);
        assert!(text.contains("Codex"));
        assert!(text.contains("codex"));
        assert!(text.contains("超人"));
        assert!(text.contains(PREAMBLE_HEADER));
    }

    #[test]
    fn skip_when_empty_profile() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("VERYAGENT_MEMORY_ROOT", dir.path());

        let mut cfg = SharingConfig::default();
        cfg.enabled = true;
        cfg.agents.insert("claude_code".into(), true);
        save_sharing(cfg).unwrap();

        assert_eq!(
            maybe_inject_shared_identity(AgentType::ClaudeCode, false),
            InjectDecision::Skip
        );

        std::env::remove_var("VERYAGENT_MEMORY_ROOT");
    }

    #[test]
    fn inject_when_enabled_and_named() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("VERYAGENT_MEMORY_ROOT", dir.path());

        save_profile(SharedProfile {
            agent_name: "超人".into(),
            user_address: "老板".into(),
            notes: "中文".into(),
            ..Default::default()
        })
        .unwrap();
        let mut cfg = SharingConfig::default();
        cfg.enabled = true;
        cfg.agents.insert("claude_code".into(), true);
        save_sharing(cfg).unwrap();

        match maybe_inject_shared_identity(AgentType::ClaudeCode, false) {
            InjectDecision::Inject { preamble } => {
                assert!(preamble.contains("超人"));
                assert!(preamble.contains("老板"));
                assert!(preamble.contains("Claude Code"));
            }
            InjectDecision::Skip => panic!("expected inject"),
        }

        std::env::remove_var("VERYAGENT_MEMORY_ROOT");
    }
}
