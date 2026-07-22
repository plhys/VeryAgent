use super::*;
use std::path::PathBuf;

use crate::acp::error::AcpError;


// ---------------------------------------------------------------------------
// Cline config helpers
// ---------------------------------------------------------------------------

pub(crate) fn cline_data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("CLINE_DIR") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    home_dir_or_default().join(".cline").join("data")
}

pub(crate) fn cline_global_state_path() -> PathBuf {
    cline_data_dir().join("globalState.json")
}

pub(crate) fn cline_secrets_path() -> PathBuf {
    cline_data_dir().join("secrets.json")
}

pub(crate) fn load_cline_secrets_json_raw() -> Option<String> {
    fs::read_to_string(cline_secrets_path()).ok()
}

/// Cline provider → secrets.json field name for the API key.
pub(crate) fn cline_api_key_field_for_provider(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "apiKey",
        "openrouter" => "openRouterApiKey",
        "openai-native" => "openAiNativeApiKey",
        "openai" => "openAiApiKey",
        "gemini" => "geminiApiKey",
        "deepseek" => "deepSeekApiKey",
        "mistral" => "mistralApiKey",
        "xai" => "xaiApiKey",
        _ => "openAiApiKey",
    }
}

/// Cline provider → globalState model ID key suffix.
/// Providers in ProviderKeyMap use `actMode{Suffix}` / `planMode{Suffix}`,
/// others use `actModeApiModelId` / `planModeApiModelId`.
pub(crate) fn cline_model_id_keys_for_provider(provider: &str) -> (&'static str, &'static str) {
    match provider {
        "openrouter" | "cline" => ("actModeOpenRouterModelId", "planModeOpenRouterModelId"),
        "openai" => ("actModeOpenAiModelId", "planModeOpenAiModelId"),
        "ollama" => ("actModeOllamaModelId", "planModeOllamaModelId"),
        "lmstudio" => ("actModeLmStudioModelId", "planModeLmStudioModelId"),
        "litellm" => ("actModeLiteLlmModelId", "planModeLiteLlmModelId"),
        "requesty" => ("actModeRequestyModelId", "planModeRequestyModelId"),
        "groq" => ("actModeGroqModelId", "planModeGroqModelId"),
        _ => ("actModeApiModelId", "planModeApiModelId"),
    }
}

/// Read globalState.json + secrets.json and merge into a unified config JSON
/// with keys: apiProvider, model, apiKey, apiBaseUrl.
pub(crate) fn load_cline_local_config_json() -> Option<String> {
    let mut merged = serde_json::Map::new();

    if let Ok(raw) = fs::read_to_string(cline_global_state_path()) {
        if let Ok(state) = serde_json::from_str::<serde_json::Value>(&raw) {
            // Cline uses actModeApiProvider / planModeApiProvider (prefer actMode)
            let provider = state
                .get("actModeApiProvider")
                .or_else(|| state.get("planModeApiProvider"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .unwrap_or("anthropic")
                .to_string();

            merged.insert(
                "apiProvider".to_string(),
                serde_json::Value::String(provider.clone()),
            );

            // Read model from provider-specific key
            let (act_key, _plan_key) = cline_model_id_keys_for_provider(&provider);
            if let Some(model_id) = state
                .get(act_key)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                merged.insert(
                    "model".to_string(),
                    serde_json::Value::String(model_id.to_string()),
                );
            }

            // Read provider-specific baseUrl key
            let base_url_key = match provider.as_str() {
                "anthropic" => "anthropicBaseUrl",
                "gemini" => "geminiBaseUrl",
                "ollama" => "ollamaBaseUrl",
                "lmstudio" => "lmStudioBaseUrl",
                "litellm" => "liteLlmBaseUrl",
                "requesty" => "requestyBaseUrl",
                _ => "openAiBaseUrl",
            };
            if let Some(base_url) = state
                .get(base_url_key)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                merged.insert(
                    "apiBaseUrl".to_string(),
                    serde_json::Value::String(base_url.to_string()),
                );
            }
        }
    }

    // Read API key from secrets.json based on provider
    if let Ok(raw) = fs::read_to_string(cline_secrets_path()) {
        if let Ok(secrets) = serde_json::from_str::<serde_json::Value>(&raw) {
            let provider = merged
                .get("apiProvider")
                .and_then(|v| v.as_str())
                .unwrap_or("anthropic");
            let key_field = cline_api_key_field_for_provider(provider);
            if let Some(api_key) = secrets
                .get(key_field)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|v| !v.is_empty())
            {
                merged.insert(
                    "apiKey".to_string(),
                    serde_json::Value::String(api_key.to_string()),
                );
            }
        }
    }

    if merged.is_empty() {
        return None;
    }
    serde_json::to_string_pretty(&serde_json::Value::Object(merged)).ok()
}

/// Split merged config back into globalState.json + secrets.json.
/// Writes `actModeApiProvider`, `planModeApiProvider`, provider-specific model keys,
/// `openAiBaseUrl`, and `welcomeViewCompleted` to globalState.json,
/// and the provider-specific API key to secrets.json.
pub(crate) fn persist_cline_local_config(config_patch_json: Option<&str>) -> Result<(), AcpError> {
    let Some(raw_patch) = config_patch_json else {
        return Ok(());
    };
    let runtime = serde_json::from_str::<AgentRuntimeConfig>(raw_patch)
        .map_err(|e| AcpError::protocol(format!("invalid config_json: {e}")))?;
    let patch = serde_json::from_str::<serde_json::Value>(raw_patch)
        .map_err(|e| AcpError::protocol(format!("invalid config_json: {e}")))?;

    let provider = patch
        .get("apiProvider")
        .and_then(|v| v.as_str())
        .unwrap_or("anthropic")
        .to_string();

    // --- Update globalState.json (merge) ---
    let gs_path = cline_global_state_path();
    let mut gs = if gs_path.exists() {
        match fs::read_to_string(&gs_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        {
            Some(existing) if existing.is_object() => existing,
            _ => serde_json::json!({}),
        }
    } else {
        serde_json::json!({})
    };
    let gs_obj = gs
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("globalState root must be object"))?;

    // Cline checks welcomeViewCompleted first in isAuthConfigured()
    gs_obj.insert(
        "welcomeViewCompleted".to_string(),
        serde_json::Value::Bool(true),
    );

    // Set both act/plan mode providers
    gs_obj.insert(
        "actModeApiProvider".to_string(),
        serde_json::Value::String(provider.clone()),
    );
    gs_obj.insert(
        "planModeApiProvider".to_string(),
        serde_json::Value::String(provider.clone()),
    );

    // Set provider-specific model ID keys
    let (act_model_key, plan_model_key) = cline_model_id_keys_for_provider(&provider);
    match trim_non_empty(runtime.model) {
        Some(model) => {
            gs_obj.insert(
                act_model_key.to_string(),
                serde_json::Value::String(model.clone()),
            );
            gs_obj.insert(plan_model_key.to_string(), serde_json::Value::String(model));
        }
        None => {
            gs_obj.remove(act_model_key);
            gs_obj.remove(plan_model_key);
        }
    }

    // Each provider uses its own baseUrl key in globalState
    let base_url_key = match provider.as_str() {
        "anthropic" => "anthropicBaseUrl",
        "gemini" => "geminiBaseUrl",
        "ollama" => "ollamaBaseUrl",
        "lmstudio" => "lmStudioBaseUrl",
        "litellm" => "liteLlmBaseUrl",
        "requesty" => "requestyBaseUrl",
        _ => "openAiBaseUrl",
    };
    match trim_non_empty(runtime.api_base_url) {
        Some(base_url) => {
            gs_obj.insert(
                base_url_key.to_string(),
                serde_json::Value::String(base_url),
            );
        }
        None => {
            gs_obj.remove(base_url_key);
        }
    }

    if let Some(parent) = gs_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AcpError::protocol(format!("create cline data directory failed: {e}")))?;
    }
    let serialized_gs = serde_json::to_string_pretty(&gs)
        .map_err(|e| AcpError::protocol(format!("serialize cline globalState failed: {e}")))?;
    fs::write(&gs_path, format!("{serialized_gs}\n"))
        .map_err(|e| AcpError::protocol(format!("write cline globalState failed: {e}")))?;

    // --- Update secrets.json ---
    let secrets_path = cline_secrets_path();
    let mut secrets = if secrets_path.exists() {
        match fs::read_to_string(&secrets_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        {
            Some(existing) if existing.is_object() => existing,
            _ => serde_json::json!({}),
        }
    } else {
        serde_json::json!({})
    };
    let secrets_obj = secrets
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("secrets root must be object"))?;

    let key_field = cline_api_key_field_for_provider(&provider);
    match trim_non_empty(runtime.api_key) {
        Some(api_key) => {
            secrets_obj.insert(key_field.to_string(), serde_json::Value::String(api_key));
        }
        None => {
            secrets_obj.remove(key_field);
        }
    }

    if let Some(parent) = secrets_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AcpError::protocol(format!("create cline data directory failed: {e}")))?;
    }
    let serialized_secrets = serde_json::to_string_pretty(&secrets)
        .map_err(|e| AcpError::protocol(format!("serialize cline secrets failed: {e}")))?;
    fs::write(&secrets_path, format!("{serialized_secrets}\n"))
        .map_err(|e| AcpError::protocol(format!("write cline secrets failed: {e}")))?;

    Ok(())
}
