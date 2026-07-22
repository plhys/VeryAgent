// Cline adapter
use std::collections::BTreeMap;
use serde_json::Value;
use crate::app_error::AppCommandError;
use super::AgentConfigAdapter;

pub struct ClineAdapter;

impl AgentConfigAdapter for ClineAdapter {
    fn read_servers(&self) -> Result<BTreeMap<String, Value>, AppCommandError> {
        crate::commands::mcp::read_cline_servers()
    }
    fn upsert_server(&self, id: &str, spec: &Value) -> Result<(), AppCommandError> {
        crate::commands::mcp::upsert_cline_server(id, spec)
    }
    fn remove_server(&self, id: &str) -> Result<bool, AppCommandError> {
        crate::commands::mcp::remove_cline_server(id)
    }
}
