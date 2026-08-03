//! Command Code conversation parser.
//!
//! Command Code persists its own transcripts under
//! `~/.commandcode/projects/<project-slug>/<session-id>.jsonl` (an append-only
//! JSONL tree). However, the VeryAgent integration drives Command Code through
//! the built-in ACP adapter, which is deliberately *session-less*: every
//! `chat.send` cold-starts a fresh headless `cmdc` run, and VeryAgent's own
//! database owns conversation history. There are therefore no Command Code
//! transcripts for VeryAgent to parse — this parser is an intentional no-op so
//! the conversation surface degrades gracefully (empty list, not-found
//! detail) instead of mis-parsing another agent's format.

use crate::models::{AgentType, ConversationDetail, ConversationSummary};
use crate::parsers::{AgentParser, ParseError};

pub struct CommandCodeParser;

impl Default for CommandCodeParser {
    fn default() -> Self {
        Self
    }
}

impl CommandCodeParser {
    pub fn new() -> Self {
        Self
    }

    pub fn agent_type(&self) -> AgentType {
        AgentType::CommandCode
    }
}

impl AgentParser for CommandCodeParser {
    fn list_conversations(&self) -> Result<Vec<ConversationSummary>, ParseError> {
        Ok(Vec::new())
    }

    fn get_conversation(&self, conversation_id: &str) -> Result<ConversationDetail, ParseError> {
        Err(ParseError::ConversationNotFound(conversation_id.to_string()))
    }
}
