// Codex adapter
use std::collections::BTreeMap;
use serde_json::Value;
use crate::app_error::AppCommandError;
use super::AgentConfigAdapter;

pub struct CodexAdapter;

impl AgentConfigAdapter for CodexAdapter {
    fn read_servers(&self) -> Result<BTreeMap<String, Value>, AppCommandError> {
        crate::commands::mcp::read_codex_servers()
    }
    fn upsert_server(&self, id: &str, spec: &Value) -> Result<(), AppCommandError> {
        crate::commands::mcp::upsert_codex_server(id, spec)
    }
    fn remove_server(&self, id: &str) -> Result<bool, AppCommandError> {
        crate::commands::mcp::remove_codex_server(id)
    }
}
