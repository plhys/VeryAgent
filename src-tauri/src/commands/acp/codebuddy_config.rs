use super::*;
use std::path::PathBuf;

use crate::acp::error::AcpError;


/// Managed custom-model vendor tag written by veryagent into CodeBuddy's
/// `~/.codebuddy/models.json`. CodeBuddy supports two independent paths:
///   1. Native Tencent models — `CODEBUDDY_API_KEY` + region
///      (`CODEBUDDY_INTERNET_ENVIRONMENT`: unset/overseas, `internal`, `ioa`)
///   2. Additive custom models — entries in `models.json` with their own
///      `url`/`apiKey` (OpenAI-compatible full `/chat/completions` path)
///
/// A计划 must use path (2) only. Hijacking `CODEBUDDY_BASE_URL` or setting
/// `CODEBUDDY_DISABLE_BUILTIN_MODELS` / `availableModels` would hide or break
/// the native China/overseas built-ins the user still needs.
pub(crate) const CODEBUDDY_MANAGED_MODEL_VENDOR: &str = "A计划";
pub(crate) const CODEBUDDY_MANAGED_MODEL_MAX_INPUT: u64 = 131_072;
pub(crate) const CODEBUDDY_MANAGED_MODEL_MAX_OUTPUT: u64 = 8_192;

pub(crate) fn codebuddy_models_json_path() -> PathBuf {
    crate::parsers::codebuddy::resolve_codebuddy_config_dir().join("models.json")
}

/// Build the full chat-completions URL CodeBuddy requires for custom models.
/// Docs require a complete path ending in `/chat/completions` (not a bare `/v1`).
pub(crate) fn codebuddy_chat_completions_url(api_url: &str) -> String {
    let base = normalize_openai_compatible_base_url(api_url);
    if base.is_empty() {
        return String::new();
    }
    format!("{base}/chat/completions")
}

/// Merge-write the agent-selected A计划 model into CodeBuddy's native
/// `~/.codebuddy/models.json` as an additive custom model.
///
/// Built-in Tencent models stay visible: we never write `availableModels` and
/// never set `CODEBUDDY_DISABLE_BUILTIN_MODELS`. Previous veryagent-managed
/// entries (vendor `A计划`) are replaced; other custom entries are preserved.
/// A stale `availableModels` key left by older builds is removed so native
/// models reappear in the picker.
pub(crate) fn write_codebuddy_managed_provider(
    api_url: &str,
    api_key: &str,
    model: &str,
    catalog: &[String],
) -> Result<(), AcpError> {
    let model = model.trim();
    let chat_url = codebuddy_chat_completions_url(api_url);
    if chat_url.is_empty() {
        return Ok(());
    }

    let mut ids: Vec<String> = catalog
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    if !model.is_empty() && !ids.iter().any(|id| id == model) {
        ids.push(model.to_string());
    }

    let path = codebuddy_models_json_path();
    let mut doc = read_json_object_or_empty(&path);

    // Keep non-managed custom models; drop previous veryagent-managed ones so
    // the list tracks only the currently configured selection.
    let mut models: Vec<serde_json::Value> = match doc.remove("models") {
        Some(serde_json::Value::Array(arr)) => arr
            .into_iter()
            .filter(|entry| {
                entry
                    .get("vendor")
                    .and_then(serde_json::Value::as_str)
                    != Some(CODEBUDDY_MANAGED_MODEL_VENDOR)
            })
            .collect(),
        _ => Vec::new(),
    };

    for id in &ids {
        // Replace same-id entries even if they were user-authored so bind wins.
        models.retain(|entry| entry.get("id").and_then(serde_json::Value::as_str) != Some(id.as_str()));
        let mut entry = serde_json::Map::new();
        entry.insert("id".to_string(), serde_json::Value::String(id.clone()));
        entry.insert("name".to_string(), serde_json::Value::String(id.clone()));
        entry.insert(
            "vendor".to_string(),
            serde_json::Value::String(CODEBUDDY_MANAGED_MODEL_VENDOR.to_string()),
        );
        entry.insert("url".to_string(), serde_json::Value::String(chat_url.clone()));
        if !api_key.trim().is_empty() {
            entry.insert(
                "apiKey".to_string(),
                serde_json::Value::String(api_key.to_string()),
            );
        }
        entry.insert(
            "maxInputTokens".to_string(),
            serde_json::Value::Number(CODEBUDDY_MANAGED_MODEL_MAX_INPUT.into()),
        );
        entry.insert(
            "maxOutputTokens".to_string(),
            serde_json::Value::Number(CODEBUDDY_MANAGED_MODEL_MAX_OUTPUT.into()),
        );
        entry.insert("supportsToolCall".to_string(), serde_json::Value::Bool(true));
        models.push(serde_json::Value::Object(entry));
    }

    if models.is_empty() {
        doc.remove("models");
    } else {
        doc.insert("models".to_string(), serde_json::Value::Array(models));
    }
    // Older builds wrote availableModels=[A计划 only], which hid every native
    // Tencent model. Clear it so the picker merges built-ins + customs again.
    doc.remove("availableModels");
    if doc.is_empty() {
        // Nothing left to keep — remove the file rather than write `{}`.
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    write_json_object_pretty(&path, &doc)?;
    Ok(())
}
