// Claude adapter — delegates to the Claude-specific helpers still living in
// `mcp.rs` while they are being extracted.  Once all agents are trait-ified
// those helpers will move here as private functions.

use std::collections::BTreeMap;
use serde_json::Value;
use crate::app_error::AppCommandError;
use super::AgentConfigAdapter;

pub struct ClaudeAdapter;

impl AgentConfigAdapter for ClaudeAdapter {
    fn read_servers(&self) -> Result<BTreeMap<String, Value>, AppCommandError> {
        crate::commands::mcp::read_claude_servers()
    }

    fn upsert_server(&self, id: &str, spec: &Value) -> Result<(), AppCommandError> {
        crate::commands::mcp::upsert_claude_server(id, spec)
    }

    fn remove_server(&self, id: &str) -> Result<bool, AppCommandError> {
        crate::commands::mcp::remove_claude_server(id)
    }

    fn enable_plugin(&self, id: &str) -> Result<(), AppCommandError> {
        crate::commands::mcp::enable_claude_local_plugin(id)
    }

    fn disable_plugin(&self, id: &str) -> Result<(), AppCommandError> {
        crate::commands::mcp::disable_claude_local_plugin(id)
    }
}
