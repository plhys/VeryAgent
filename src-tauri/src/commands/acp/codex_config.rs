use super::*;
use std::path::PathBuf;

use crate::acp::error::AcpError;


pub(crate) fn codex_home_dir() -> PathBuf {
    let configured = std::env::var("CODEX_HOME").ok().and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    });

    match configured {
        Some(value) => {
            if value == "~" {
                home_dir_or_default()
            } else if let Some(remain) = value.strip_prefix("~/") {
                home_dir_or_default().join(remain)
            } else {
                PathBuf::from(value)
            }
        }
        None => home_dir_or_default().join(".codex"),
    }
}

pub(crate) fn codex_config_toml_path() -> PathBuf {
    codex_home_dir().join("config.toml")
}

pub(crate) fn codex_auth_json_path() -> PathBuf {
    codex_home_dir().join("auth.json")
}

pub(crate) fn load_codex_auth_json_raw() -> Option<String> {
    fs::read_to_string(codex_auth_json_path()).ok()
}

pub(crate) fn load_codex_config_toml_raw() -> Option<String> {
    fs::read_to_string(codex_config_toml_path()).ok()
}

/// Project codex `config.toml` text into the launch-relevant config map shared
/// by the settings read-back and the staleness fingerprint. Pure (no I/O) so it
/// is unit-testable; [`load_codex_local_config_json`] is the on-disk wrapper
/// that also folds in the api key from `auth.json`.
///
/// `apiBaseUrl` / `model` / `env` mirror back into the codex runtime env via
/// [`build_runtime_env_from_setting`] (they map to `OPENAI_*`); `modelProvider`
/// deliberately does NOT (it is not an `AgentRuntimeConfig` field). It is still
/// included so a provider switch is visible to the fingerprint even when the
/// resolved `base_url` is unchanged — two providers can share one endpoint yet
/// differ in `wire_api` / auth. Before codex-acp 1.0.1 this was caught only
/// incidentally by the injected `MODEL_PROVIDER` launch env; that injection is
/// gone now that resume reads `model_provider` from config.toml (#224), so the
/// fingerprint must carry the name itself.
pub(crate) fn codex_config_projection_from_toml(raw_toml: &str) -> serde_json::Map<String, serde_json::Value> {
    let mut merged = serde_json::Map::new();
    let Ok(value) = raw_toml.parse::<toml::Value>() else {
        return merged;
    };

    if let Some(model) = value
        .get("model")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        merged.insert(
            "model".to_string(),
            serde_json::Value::String(model.to_string()),
        );
    }

    let model_provider = value
        .get("model_provider")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string);

    if let Some(provider) = &model_provider {
        merged.insert(
            "modelProvider".to_string(),
            serde_json::Value::String(provider.clone()),
        );
    }

    let mut api_base_url: Option<String> = None;
    if let Some(provider) = &model_provider {
        api_base_url = value
            .get("model_providers")
            .and_then(|table| table.get(provider.as_str()))
            .and_then(|table| table.get("base_url"))
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string);
    }
    if api_base_url.is_none() {
        api_base_url = value
            .get("model_providers")
            .and_then(|table| table.as_table())
            .and_then(|providers| {
                providers.values().find_map(|item| {
                    item.get("base_url")
                        .and_then(|base| base.as_str())
                        .map(str::trim)
                        .filter(|base| !base.is_empty())
                        .map(str::to_string)
                })
            });
    }
    if let Some(base_url) = api_base_url {
        merged.insert(
            "apiBaseUrl".to_string(),
            serde_json::Value::String(base_url),
        );
    }

    if let Some(env) = value.get("env").and_then(|item| item.as_table()) {
        let mut env_map = serde_json::Map::new();
        for (key, item) in env {
            let Some(raw) = item.as_str() else {
                continue;
            };
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                continue;
            }
            env_map.insert(
                key.to_string(),
                serde_json::Value::String(trimmed.to_string()),
            );
        }
        if !env_map.is_empty() {
            merged.insert("env".to_string(), serde_json::Value::Object(env_map));
        }
    }

    merged
}

pub(crate) fn persist_codex_local_config(config_patch_json: Option<&str>) -> Result<(), AcpError> {
    let Some(raw_patch) = config_patch_json else {
        return Ok(());
    };
    let runtime = serde_json::from_str::<AgentRuntimeConfig>(raw_patch)
        .map_err(|e| AcpError::protocol(format!("invalid config_json: {e}")))?;
    let AgentRuntimeConfig {
        api_base_url,
        api_key,
        model,
        env,
    } = runtime;

    let config_path = codex_config_toml_path();
    let mut toml_value = if config_path.exists() {
        match fs::read_to_string(&config_path)
            .ok()
            .and_then(|raw| raw.parse::<toml::Value>().ok())
        {
            Some(existing) if existing.is_table() => existing,
            _ => toml::Value::Table(toml::map::Map::new()),
        }
    } else {
        toml::Value::Table(toml::map::Map::new())
    };

    let table = toml_value
        .as_table_mut()
        .ok_or_else(|| AcpError::protocol("codex config root must be a TOML table"))?;

    match trim_non_empty(model) {
        Some(model) => {
            table.insert("model".to_string(), toml::Value::String(model));
        }
        None => {
            table.remove("model");
        }
    }

    let provider_name = table
        .get("model_provider")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "veryagent".to_string());
    table.insert(
        "model_provider".to_string(),
        toml::Value::String(provider_name.clone()),
    );

    let providers_item = table
        .entry("model_providers".to_string())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    if !providers_item.is_table() {
        *providers_item = toml::Value::Table(toml::map::Map::new());
    }
    let providers = providers_item
        .as_table_mut()
        .ok_or_else(|| AcpError::protocol("invalid model_providers table"))?;
    let provider_item = providers
        .entry(provider_name.clone())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
    if !provider_item.is_table() {
        *provider_item = toml::Value::Table(toml::map::Map::new());
    }
    let provider_table = provider_item
        .as_table_mut()
        .ok_or_else(|| AcpError::protocol("invalid model provider table"))?;
    match trim_non_empty(api_base_url) {
        Some(base_url) => {
            // Codex appends the wire path itself; force OpenAI-compatible `/v1`.
            let normalized = normalize_openai_compatible_base_url(&base_url);
            provider_table.insert("base_url".to_string(), toml::Value::String(normalized));
        }
        None => {
            provider_table.remove("base_url");
        }
    }
    if provider_name == "veryagent" {
        provider_table.insert("name".to_string(), toml::Value::String("veryagent".to_string()));
        // Current Codex rejects `wire_api = "chat"` at config load time; only
        // `responses` is accepted. The gateway must implement Responses API.
        provider_table.insert(
            "wire_api".to_string(),
            toml::Value::String("responses".to_string()),
        );
        provider_table.insert(
            "requires_openai_auth".to_string(),
            toml::Value::Boolean(true),
        );
    }

    if env.is_empty() {
        table.remove("env");
    } else {
        let mut env_table = toml::map::Map::new();
        for (key, value) in env {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                continue;
            }
            env_table.insert(key, toml::Value::String(trimmed.to_string()));
        }
        if env_table.is_empty() {
            table.remove("env");
        } else {
            table.insert("env".to_string(), toml::Value::Table(env_table));
        }
    }

    let serialized_toml = toml::to_string_pretty(&toml_value)
        .map_err(|e| AcpError::protocol(format!("serialize codex toml failed: {e}")))?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            AcpError::protocol(format!("create codex config directory failed: {e}"))
        })?;
    }
    fs::write(&config_path, format!("{serialized_toml}\n"))
        .map_err(|e| AcpError::protocol(format!("write codex config failed: {e}")))?;

    let auth_path = codex_auth_json_path();
    let mut auth_value = if auth_path.exists() {
        match fs::read_to_string(&auth_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        {
            Some(existing) if existing.is_object() => existing,
            _ => serde_json::json!({}),
        }
    } else {
        serde_json::json!({})
    };
    let auth_obj = auth_value
        .as_object_mut()
        .ok_or_else(|| AcpError::protocol("codex auth root must be object"))?;
    match trim_non_empty(api_key) {
        Some(api_key) => {
            auth_obj.insert(
                "OPENAI_API_KEY".to_string(),
                serde_json::Value::String(api_key),
            );
        }
        None => {
            auth_obj.remove("OPENAI_API_KEY");
        }
    }
    let serialized_auth = serde_json::to_string_pretty(&auth_value)
        .map_err(|e| AcpError::protocol(format!("serialize codex auth failed: {e}")))?;
    if let Some(parent) = auth_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AcpError::protocol(format!("create codex auth directory failed: {e}")))?;
    }
    fs::write(&auth_path, format!("{serialized_auth}\n"))
        .map_err(|e| AcpError::protocol(format!("write codex auth failed: {e}")))?;

    Ok(())
}

pub(crate) fn persist_codex_native_config_files(
    codex_auth_json: Option<&str>,
    codex_config_toml: Option<&str>,
) -> Result<(), AcpError> {
    if let Some(raw_toml) = codex_config_toml {
        toml::from_str::<toml::Table>(raw_toml)
            .map_err(|e| AcpError::protocol(format!("invalid codex config.toml: {e}")))?;
        let path = codex_config_toml_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AcpError::protocol(format!("create codex directory failed: {e}")))?;
        }
        fs::write(&path, raw_toml)
            .map_err(|e| AcpError::protocol(format!("write codex config.toml failed: {e}")))?;
    }

    if let Some(raw_auth) = codex_auth_json {
        let parsed = serde_json::from_str::<serde_json::Value>(raw_auth)
            .map_err(|e| AcpError::protocol(format!("invalid codex auth.json: {e}")))?;
        if !parsed.is_object() {
            return Err(AcpError::protocol(
                "invalid codex auth.json: root must be a JSON object",
            ));
        }
        let path = codex_auth_json_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AcpError::protocol(format!("create codex directory failed: {e}")))?;
        }
        fs::write(&path, raw_auth)
            .map_err(|e| AcpError::protocol(format!("write codex auth.json failed: {e}")))?;
    }

    Ok(())
}

/// Apply a `CodexModelAction` to the `model` field at the root of
/// `~/.codex/config.toml`, preserving everything else.
pub(crate) fn apply_codex_root_model_action(action: &CodexModelAction) -> Result<(), AcpError> {
    if matches!(action, CodexModelAction::NoOp) {
        return Ok(());
    }
    let config_path = codex_config_toml_path();
    let mut toml_value = if config_path.exists() {
        fs::read_to_string(&config_path)
            .ok()
            .and_then(|raw| raw.parse::<toml::Value>().ok())
            .filter(|v| v.is_table())
            .unwrap_or_else(|| toml::Value::Table(toml::map::Map::new()))
    } else {
        toml::Value::Table(toml::map::Map::new())
    };
    let table = toml_value
        .as_table_mut()
        .ok_or_else(|| AcpError::protocol("codex config root must be a TOML table"))?;
    match action {
        CodexModelAction::Set(model) => {
            table.insert("model".to_string(), toml::Value::String(model.clone()));
        }
        CodexModelAction::Clear => {
            table.remove("model");
        }
        CodexModelAction::NoOp => unreachable!(),
    }
    let toml_str =
        toml::to_string_pretty(&toml_value).map_err(|e| AcpError::protocol(e.to_string()))?;
    persist_codex_native_config_files(None, Some(&toml_str))?;
    Ok(())
}

/// Read the model name from `~/.codex/config.toml` (the `model` field at root).
pub(crate) fn read_codex_model_name() -> Option<String> {
    let config_path = codex_config_toml_path();
    let raw = fs::read_to_string(&config_path).ok()?;
    let value: toml::Value = raw.parse().ok()?;
    value
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Read a value from the `[env]` section of `~/.codex/config.toml`.
pub(crate) fn read_codex_env_value(key: &str) -> Option<String> {
    let config_path = codex_config_toml_path();
    let raw = fs::read_to_string(&config_path).ok()?;
    let value: toml::Value = raw.parse().ok()?;
    value
        .get("env")
        .and_then(|env| env.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Rewrite the `base_url` of the `veryagent` provider in `~/.codex/config.toml`
/// to point to the local role-conversion proxy. This is called during session
/// startup so Codex reads the proxy URL from its config file (Codex prefers
/// config.toml over the `OPENAI_BASE_URL` env var).
///
/// Also adds model metadata to the `[models]` section so Codex doesn't warn
/// about missing metadata for the configured model.
pub(crate) fn rewrite_codex_provider_base_url(proxy_url: &str) {
    let config_path = codex_config_toml_path();
    let mut toml_value = match config_path.exists() {
        true => fs::read_to_string(&config_path)
            .ok()
            .and_then(|raw| raw.parse::<toml::Value>().ok())
            .filter(|v| v.is_table())
            .unwrap_or_else(|| toml::Value::Table(toml::map::Map::new())),
        false => return,
    };
    let table = match toml_value.as_table_mut() {
        Some(t) => t,
        None => return,
    };
    // Navigate to model_providers.veryagent.base_url
    let providers = match table
        .get_mut("model_providers")
        .and_then(|v| v.as_table_mut())
    {
        Some(p) => p,
        None => return,
    };
    let veryagent = match providers.get_mut("veryagent").and_then(|v| v.as_table_mut()) {
        Some(v) => v,
        None => return,
    };
    let normalized = normalize_openai_compatible_base_url(proxy_url);
    veryagent.insert(
        "base_url".to_string(),
        toml::Value::String(normalized),
    );

    // Also add model metadata to suppress Codex's "Model metadata for ... not
    // found" warning. Read the model name first, then modify the table.
    let model_name = table
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(ref name) = model_name {
        let models = table
            .entry("models".to_string())
            .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
        if let Some(models_table) = models.as_table_mut() {
            if !models_table.contains_key(name.as_str()) {
                let mut meta = toml::map::Map::new();
                meta.insert(
                    "context_window".to_string(),
                    toml::Value::Integer(128_000),
                );
                meta.insert(
                    "max_output".to_string(),
                    toml::Value::Integer(16_384),
                );
                models_table.insert(name.clone(), toml::Value::Table(meta));
            }
        }
    }

    if let Ok(toml_str) = toml::to_string_pretty(&toml_value) {
        let _ = fs::write(&config_path, format!("{toml_str}\n"));
    }
}

// ─── Codex Device Code OAuth ───

pub(crate) const CODEX_OAUTH_ISSUER: &str = "https://auth.openai.com";
pub(crate) const CODEX_OAUTH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDeviceCodeResponse {
    pub user_code: String,
    pub verification_url: String,
    pub device_auth_id: String,
    pub interval: u64,
}
