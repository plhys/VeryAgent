// MCP Agent Config Adapters — one implementation per AI agent type.
// Each adapter knows how to read/write the agent's native MCP configuration
// format (JSON / TOML / …) and canonicalise it to veryagent's internal
// representation.

pub mod claude;
pub mod codex;
pub mod opencode;
pub mod gemini;
pub mod openclaw;
pub mod cline;
pub mod hermes;
pub mod codebuddy;
pub mod kimi_code;
pub mod mimo_code;

use std::collections::BTreeMap;
use serde_json::Value;
use crate::app_error::AppCommandError;

/// Abstraction over an AI agent's native MCP server configuration store.
pub trait AgentConfigAdapter {
    /// List every MCP server the agent currently knows about, keyed by server id,
    /// with each spec canonicalised to veryagent's normalised JSON form.
    fn read_servers(&self) -> Result<BTreeMap<String, Value>, AppCommandError>;

    /// Insert or update one MCP server entry.  `spec` is already canonicalised.
    fn upsert_server(&self, id: &str, spec: &Value) -> Result<(), AppCommandError>;

    /// Remove an MCP server entry.  Returns `true` when the entry existed.
    fn remove_server(&self, id: &str) -> Result<bool, AppCommandError>;

    /// Enable a native plugin / integration entry (Claude / CodeBuddy style).
    fn enable_plugin(&self, _id: &str) -> Result<(), AppCommandError> {
        Ok(())
    }

    /// Disable a native plugin / integration entry.
    fn disable_plugin(&self, _id: &str) -> Result<(), AppCommandError> {
        Ok(())
    }
}
