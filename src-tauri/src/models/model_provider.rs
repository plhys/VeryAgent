use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProviderInfo {
    pub id: i32,
    pub name: String,
    pub api_url: String,
    pub api_key: String,
    pub api_key_masked: String,
    /// All agent types this provider is associated with (authoritative, from
    /// `agent_types_json`). A provider can serve multiple agents — each gets
    /// its own model value from the `model` JSON object.
    pub agent_types: Vec<String>,
    /// First element of `agent_types` for backward compat with older clients.
    pub agent_type: String,
    /// JSON object keyed by agent_type: `{"claude_code":"{...}","codex":"gpt-5"}`.
    /// Each agent reads its own model value with its own format.
    pub model: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn mask_api_key(key: &str) -> String {
    // Operate on Unicode scalar values, not bytes: an API key may contain a
    // multibyte character (e.g. a full-width char typed with a CJK IME), and
    // byte-slicing `&key[..4]` would panic on a non-char-boundary. Such a panic
    // in `From` propagates out of every `list_model_providers` call once the
    // row is persisted, permanently breaking the provider list.
    let chars: Vec<char> = key.chars().collect();
    let len = chars.len();
    if len <= 8 {
        "\u{2022}".repeat(len)
    } else {
        let prefix: String = chars[..4].iter().collect();
        let suffix: String = chars[len - 4..].iter().collect();
        format!("{}{}{}", prefix, "\u{2022}".repeat(len.min(20) - 8), suffix)
    }
}

/// Parse `agent_types_json` into a Vec<String>. Falls back to deriving from
/// `agent_type` for rows that haven't been migrated yet.
pub fn parse_agent_types_from_row(agent_types_json: &str, agent_type: &str) -> Vec<String> {
    if let Ok(list) = serde_json::from_str::<Vec<String>>(agent_types_json) {
        if !list.is_empty() {
            return list;
        }
    }
    // Fallback for rows backfilled with empty agent_types_json but set agent_type.
    if !agent_type.is_empty() {
        vec![agent_type.to_string()]
    } else {
        Vec::new()
    }
}

impl From<crate::db::entities::model_provider::Model> for ModelProviderInfo {
    fn from(m: crate::db::entities::model_provider::Model) -> Self {
        let agent_types = parse_agent_types_from_row(&m.agent_types_json, &m.agent_type);
        let agent_type = agent_types
            .first()
            .cloned()
            .unwrap_or_else(|| m.agent_type.clone());
        Self {
            id: m.id,
            name: m.name,
            api_url: m.api_url,
            api_key: m.api_key.clone(),
            api_key_masked: mask_api_key(&m.api_key),
            agent_types,
            agent_type,
            model: m.model,
            created_at: m.created_at.to_rfc3339(),
            updated_at: m.updated_at.to_rfc3339(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::mask_api_key;

    #[test]
    fn masks_short_ascii_key() {
        assert_eq!(mask_api_key("abc123"), "\u{2022}".repeat(6));
    }

    #[test]
    fn masks_long_ascii_key_keeping_edges() {
        assert_eq!(mask_api_key("sk-test-1234567890"), "sk-t\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}7890");
    }

    #[test]
    fn does_not_panic_on_multibyte_key() {
        // Byte index 4 falls inside '密' (bytes 3..6); a byte slice would panic.
        let masked = mask_api_key("sk-密钥abcd1234");
        assert!(masked.starts_with("sk-密"));
        assert!(masked.ends_with("1234"));
    }

    #[test]
    fn masks_short_multibyte_key_without_panic() {
        assert_eq!(mask_api_key("密钥abc"), "\u{2022}".repeat(5));
    }
}
