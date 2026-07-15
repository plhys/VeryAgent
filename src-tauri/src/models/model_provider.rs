use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProviderInfo {
    pub id: i32,
    pub name: String,
    pub api_url: String,
    pub api_key: String,
    pub api_key_masked: String,
    /// Model name this provider serves (e.g. "gpt-5", "claude-sonnet-5").
    /// A simple string — any agent can use it.
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

impl From<crate::db::entities::model_provider::Model> for ModelProviderInfo {
    fn from(m: crate::db::entities::model_provider::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            api_url: m.api_url,
            api_key: m.api_key.clone(),
            api_key_masked: mask_api_key(&m.api_key),
            model: m.model,
            created_at: m.created_at.to_rfc3339(),
            updated_at: m.updated_at.to_rfc3339(),
        }
    }
}

/// Resolve which agent types a provider row is allowed to bind.
///
/// Preference order:
/// 1. non-empty `agent_types_json` array (legacy multi-agent)
/// 2. non-empty `agent_type` column (single-type migration)
/// 3. empty list → unrestricted / universal provider
pub fn parse_agent_types_from_row(
    agent_types_json: &str,
    agent_type: &str,
) -> Vec<String> {
    let trimmed_json = agent_types_json.trim();
    if !trimmed_json.is_empty() && trimmed_json != "[]" {
        if let Ok(list) = serde_json::from_str::<Vec<String>>(trimmed_json) {
            let cleaned: Vec<String> = list
                .into_iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !cleaned.is_empty() {
                return cleaned;
            }
        }
    }

    let single = agent_type.trim();
    if !single.is_empty() {
        return vec![single.to_string()];
    }

    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::{mask_api_key, parse_agent_types_from_row};

    #[test]
    fn masks_short_ascii_key() {
        assert_eq!(mask_api_key("abc123"), "\u{2022}".repeat(6));
    }

    #[test]
    fn masks_long_ascii_key_keeping_edges() {
        assert_eq!(
            mask_api_key("sk-test-1234567890"),
            "sk-t\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}7890"
        );
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

    #[test]
    fn parse_agent_types_prefers_json_array() {
        assert_eq!(
            parse_agent_types_from_row(r#"["hermes","open_claw"]"#, "codex"),
            vec!["hermes".to_string(), "open_claw".to_string()]
        );
    }

    #[test]
    fn parse_agent_types_falls_back_to_single_column() {
        assert_eq!(
            parse_agent_types_from_row("[]", "hermes"),
            vec!["hermes".to_string()]
        );
    }

    #[test]
    fn parse_agent_types_empty_means_unrestricted() {
        assert!(parse_agent_types_from_row("[]", "").is_empty());
        assert!(parse_agent_types_from_row("", "  ").is_empty());
    }
}