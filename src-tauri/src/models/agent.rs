use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    ClaudeCode,
    Codex,
    OpenCode,
    Gemini,
    OpenClaw,
    Cline,
    Hermes,
    CodeBuddy,
    KimiCode,
    Pi,
    MimoCode,
    CommandCode,
}

impl fmt::Display for AgentType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentType::ClaudeCode => write!(f, "Claude Code"),
            AgentType::Codex => write!(f, "Codex CLI"),
            AgentType::OpenCode => write!(f, "OpenCode"),
            AgentType::Gemini => write!(f, "Gemini CLI"),
            AgentType::OpenClaw => write!(f, "OpenClaw"),
            AgentType::Cline => write!(f, "Cline"),
            AgentType::Hermes => write!(f, "Hermes Agent"),
            AgentType::CodeBuddy => write!(f, "CodeBuddy"),
            AgentType::KimiCode => write!(f, "Kimi Code"),
            AgentType::Pi => write!(f, "Pi"),
            AgentType::MimoCode => write!(f, "MiMo Code"),
            AgentType::CommandCode => write!(f, "Command Code"),
        }
    }
}

impl AgentType {
    /// Parse an agent type from its stored form. `team_slot.agent_type` holds a
    /// **bare** id (`pi`, `hermes`, ...) as plain text, while `AgentType`'s serde
    /// impl requires a JSON string literal (`"pi"`). Try the strict JSON parse
    /// first (compatible with any historical JSON-encoded rows), then fall back
    /// to wrapping the raw string as a JSON value — the same tolerant approach
    /// `delegation::listener::parse_agent_type` uses.
    pub fn from_stored_str(s: &str) -> Option<Self> {
        serde_json::from_str::<AgentType>(s)
            .ok()
            .or_else(|| serde_json::from_value(serde_json::Value::String(s.to_string())).ok())
    }
}
