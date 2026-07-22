//! MiMo Code conversation parser.
//!
//! MiMo Code is an OpenCode fork by Xiaomi. It uses the same SQLite schema
//! (session / message / part tables) but stores its database at
//! `~/.local/share/mimocode/mimocode.db` instead of `~/.local/share/opencode/opencode.db`.
//!
//! This parser delegates to [`OpenCodeParser`] with a custom base directory
//! and agent type, so all message parsing, turn grouping, and part extraction
//! logic is shared.

use std::path::PathBuf;

use crate::models::AgentType;
use crate::parsers::opencode::OpenCodeParser;
use crate::parsers::{AgentParser, ConversationDetail, ConversationSummary, ParseError};

pub struct MiMoCodeParser {
    inner: OpenCodeParser,
}

impl Default for MiMoCodeParser {
    fn default() -> Self {
        Self::new()
    }
}

impl MiMoCodeParser {
    pub fn new() -> Self {
        let base_dir = resolve_mimo_code_base_dir();
        Self {
            inner: OpenCodeParser::with_base_dir_and_agent_type(base_dir, AgentType::MimoCode),
        }
    }

    /// Test-only constructor.
    #[cfg(any(test, feature = "test-utils"))]
    pub fn with_base_dir(base_dir: PathBuf) -> Self {
        Self {
            inner: OpenCodeParser::with_base_dir_and_agent_type(base_dir, AgentType::MimoCode),
        }
    }
}

impl AgentParser for MiMoCodeParser {
    fn list_conversations(&self) -> Result<Vec<ConversationSummary>, ParseError> {
        self.inner.list_conversations()
    }

    fn get_conversation(&self, conversation_id: &str) -> Result<ConversationDetail, ParseError> {
        self.inner.get_conversation(conversation_id)
    }
}

/// Resolve the MiMo Code data directory: `~/.local/share/mimocode/`.
///
/// Honors `XDG_DATA_HOME` when set, falling back to `~/.local/share`.
pub fn resolve_mimo_code_base_dir() -> PathBuf {
    let xdg = std::env::var_os("XDG_DATA_HOME");
    let home = dirs::home_dir();

    let base = xdg
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.map(|h| h.join(".local").join("share")));

    match base {
        Some(b) => b.join("mimocode"),
        None => PathBuf::from("mimocode"),
    }
}
