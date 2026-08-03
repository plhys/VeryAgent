use super::*;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use crate::acp::error::AcpError;
use crate::models::agent::AgentType;
use crate::web::event_bridge::EventEmitter;


pub(crate) const ACP_AGENTS_UPDATED_EVENT: &str = "app://acp-agents-updated";
pub(crate) const NPM_PREFIX_TIMEOUT: Duration = Duration::from_millis(1500);

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub(crate) struct AcpAgentsUpdatedEventPayload {
    reason: &'static str,
    agent_type: Option<AgentType>,
}

pub(crate) fn emit_acp_agents_updated(
    emitter: &EventEmitter,
    reason: &'static str,
    agent_type: Option<AgentType>,
) {
    crate::web::event_bridge::emit_event(
        emitter,
        ACP_AGENTS_UPDATED_EVENT,
        AcpAgentsUpdatedEventPayload { reason, agent_type },
    );
}

pub(crate) const AGENT_INSTALL_EVENT: &str = "app://agent-install";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentInstallEventKind {
    Started,
    Log,
    Completed,
    Failed,
}

pub(crate) fn emit_agent_install_event(
    emitter: &EventEmitter,
    task_id: &str,
    kind: AgentInstallEventKind,
    payload: impl Into<String>,
) {
    crate::web::event_bridge::emit_event(
        emitter,
        AGENT_INSTALL_EVENT,
        AgentInstallEvent {
            task_id: task_id.to_string(),
            kind,
            payload: payload.into(),
        },
    );
}

pub(crate) fn package_name_from_spec(package: &str) -> String {
    let normalized = package.trim();
    if normalized.is_empty() {
        return String::new();
    }

    if let Some(index) = normalized.rfind('@') {
        if index > 0 {
            let version_part = normalized[index + 1..].trim();
            if !version_part.is_empty() {
                return normalized[..index].to_string();
            }
        }
    }

    normalized.to_string()
}

pub(crate) fn home_dir_or_default() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Read a JSON file into an owned object map, returning an empty map when the
/// file is absent, unreadable, or does not parse to a JSON object. Pi's native
/// files are small and veryagent-owned; corruption shouldn't abort a save (we
/// re-author the managed keys and preserve whatever else parses).
pub(crate) fn read_json_object_or_empty(path: &Path) -> serde_json::Map<String, serde_json::Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| match value {
            serde_json::Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

/// Pretty-print a JSON object (with a trailing newline) to `path`, creating the
/// parent directory if needed.
pub(crate) fn write_json_object_pretty(
    path: &Path,
    obj: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), AcpError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AcpError::protocol(format!("create pi config directory failed: {e}")))?;
    }
    let mut text = serde_json::to_string_pretty(&serde_json::Value::Object(obj.clone()))
        .map_err(|e| AcpError::protocol(format!("serialize pi config failed: {e}")))?;
    text.push('\n');
    fs::write(path, text)
        .map_err(|e| AcpError::protocol(format!("write pi config failed: {e}")))?;
    Ok(())
}

/// Best-effort strip of JSON5-ish features (line/block comments + trailing
/// commas) so OpenClaw's JSON5 configs still parse with `serde_json`.
pub(crate) fn strip_json5_noise(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let bytes = raw.as_bytes();
    let mut i = 0;
    let mut in_string = false;
    let mut escape = false;
    while i < bytes.len() {
        let b = bytes[i];
        if in_string {
            out.push(b as char);
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        // line comment
        if b == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
            i += 2;
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        // block comment
        if b == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            continue;
        }
        if b == b'"' {
            in_string = true;
            out.push('"');
            i += 1;
            continue;
        }
        // trailing comma before } or ]
        if b == b',' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < bytes.len() && (bytes[j] == b'}' || bytes[j] == b']') {
                i += 1;
                continue;
            }
        }
        out.push(b as char);
        i += 1;
    }
    out
}

/// Best-effort restart so a running gateway reloads managed provider credentials.
pub(crate) async fn restart_openclaw_gateway_after_provider_write() {
    match run_openclaw_cli(&["gateway", "restart"], 45).await {
        Ok((ok, out)) if !ok => {
            tracing::warn!("[OpenClaw] gateway restart after provider write: {out}");
        }
        Err(e) => {
            tracing::warn!("[OpenClaw] gateway restart after provider write failed: {e}");
        }
        _ => {}
    }
}

pub(crate) fn openclaw_local_ws_url(port: u16) -> String {
    format!("ws://127.0.0.1:{port}")
}

pub(crate) fn load_hermes_local_config_json() -> Option<String> {
    let env_map = fs::read_to_string(hermes_env_path())
        .ok()
        .map(|raw| parse_env_file(&raw))
        .unwrap_or_default();

    let mut provider: Option<String> = None;
    let mut model: Option<String> = None;
    let mut yaml_base_url: Option<String> = None;
    let mut yaml_api_key: Option<String> = None;
    if let Ok(raw_yaml) = fs::read_to_string(hermes_config_yaml_path()) {
        if let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(&raw_yaml) {
            if let Some(model_section) = value.get("model") {
                provider = yaml_str(model_section, "provider");
                model = yaml_str(model_section, "default");
                yaml_base_url = yaml_str(model_section, "base_url");
                yaml_api_key = yaml_str(model_section, "api_key");
            }
        }
    }

    let (api_key, base_url) = match provider.as_deref() {
        Some(p) => project_hermes_key_and_base(
            p,
            &env_map,
            yaml_base_url.as_deref(),
            yaml_api_key.as_deref(),
        ),
        None => (None, yaml_base_url),
    };

    let (setup_command, model_command) = hermes_setup_commands();

    let mut merged = serde_json::Map::new();
    if let Some(value) = provider {
        merged.insert("provider".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = model {
        merged.insert("model".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = base_url {
        merged.insert("baseUrl".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = api_key {
        merged.insert("apiKey".to_string(), serde_json::Value::String(value));
    }
    merged.insert(
        "hermesHome".to_string(),
        serde_json::Value::String(hermes_home_dir().display().to_string()),
    );
    merged.insert(
        "setupCommand".to_string(),
        serde_json::Value::String(setup_command),
    );
    merged.insert(
        "modelCommand".to_string(),
        serde_json::Value::String(model_command),
    );

    serde_json::to_string_pretty(&serde_json::Value::Object(merged)).ok()
}

pub(crate) fn agent_local_config_path(agent_type: AgentType) -> Option<PathBuf> {
    match agent_type {
        AgentType::ClaudeCode => Some(home_dir_or_default().join(".claude").join("settings.json")),
        AgentType::Gemini => Some(home_dir_or_default().join(".gemini").join("settings.json")),
        AgentType::OpenCode => Some(resolve_opencode_config_path()),
        AgentType::Cline => Some(cline_global_state_path()),
        // Kimi Code's native config is `~/.kimi-code/config.toml`. Exposing the
        // path lights up "open config file" + staleness tracking; the actual
        // load/persist are special-cased below (TOML, not the generic JSON path).
        AgentType::KimiCode => Some(kimi_code_config_toml_path()),
        _ => None,
    }
}

pub(crate) fn merge_json_values(base: &mut serde_json::Value, patch: &serde_json::Value) {
    if let (Some(base_obj), Some(patch_obj)) = (base.as_object_mut(), patch.as_object()) {
        for (key, patch_value) in patch_obj {
            if patch_value.is_null() {
                // null in patch means "remove this key"
                base_obj.remove(key);
                continue;
            }
            match base_obj.get_mut(key) {
                Some(base_value) => merge_json_values(base_value, patch_value),
                None => {
                    base_obj.insert(key.clone(), patch_value.clone());
                }
            }
        }
        return;
    }

    *base = patch.clone();
}

pub(crate) fn persist_agent_local_config_json(
    agent_type: AgentType,
    config_patch_json: Option<&str>,
) -> Result<(), AcpError> {
    if agent_type == AgentType::Codex {
        return persist_codex_local_config(config_patch_json);
    }
    if agent_type == AgentType::Cline {
        return persist_cline_local_config(config_patch_json);
    }
    if agent_type == AgentType::KimiCode {
        // Kimi's config.toml is written exclusively through the dedicated
        // `acp_update_kimi_code_config` command (structured/raw modes). The
        // generic JSON-merge persist must never touch it (it would write JSON
        // into a TOML file).
        return Ok(());
    }

    let Some(path) = agent_local_config_path(agent_type) else {
        return Ok(());
    };
    let Some(raw_patch) = config_patch_json else {
        return Ok(());
    };

    let patch = serde_json::from_str::<serde_json::Value>(raw_patch)
        .map_err(|e| AcpError::protocol(format!("invalid config_json: {e}")))?;
    if !patch.is_object() {
        return Err(AcpError::protocol(
            "invalid config_json: root must be a JSON object",
        ));
    }

    if agent_type == AgentType::OpenCode {
        let serialized = serde_json::to_string_pretty(&patch)
            .map_err(|e| AcpError::protocol(format!("serialize config_json failed: {e}")))?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AcpError::protocol(format!("create config directory failed: {e}")))?;
        }
        fs::write(&path, format!("{serialized}\n"))
            .map_err(|e| AcpError::protocol(format!("write local config failed: {e}")))?;
        return Ok(());
    }

    let mut base = if path.exists() {
        match fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        {
            Some(existing) if existing.is_object() => existing,
            _ => serde_json::json!({}),
        }
    } else {
        serde_json::json!({})
    };

    merge_json_values(&mut base, &patch);
    let serialized = serde_json::to_string_pretty(&base)
        .map_err(|e| AcpError::protocol(format!("serialize config_json failed: {e}")))?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AcpError::protocol(format!("create config directory failed: {e}")))?;
    }
    fs::write(&path, format!("{serialized}\n"))
        .map_err(|e| AcpError::protocol(format!("write local config failed: {e}")))?;

    Ok(())
}

pub(crate) fn scope_rank(scope: AgentSkillScope) -> u8 {
    match scope {
        AgentSkillScope::Global => 0,
        AgentSkillScope::Project => 1,
    }
}

pub(crate) fn trim_non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

/// Primary env var keys for each agent type: (api_base_url, api_key, model).
/// Shared by runtime env resolution, model-provider cascade, and config patching.
pub(crate) fn agent_env_keys(agent_type: AgentType) -> (&'static str, &'static str, &'static str) {
    match agent_type {
        AgentType::ClaudeCode => (
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_MODEL",
        ),
        AgentType::Gemini => ("GOOGLE_GEMINI_BASE_URL", "GEMINI_API_KEY", "GEMINI_MODEL"),
        // Kimi Code does NOT read shell KIMI_API_KEY/OPENAI_API_KEY; the only
        // non-interactive credential path is the `KIMI_MODEL_*` family, which
        // also takes priority over `~/.kimi-code/config.toml`.
        AgentType::KimiCode => ("KIMI_MODEL_BASE_URL", "KIMI_MODEL_API_KEY", "KIMI_MODEL_NAME"),
        // CodeBuddy self-hosted / shared-provider path uses CODEBUDDY_BASE_URL +
        // CODEBUDDY_API_KEY. Hosted region is CODEBUDDY_INTERNET_ENVIRONMENT and
        // is cleared when a model provider is bound.
        AgentType::CodeBuddy => (
            "CODEBUDDY_BASE_URL",
            "CODEBUDDY_API_KEY",
            "CODEBUDDY_MODEL",
        ),
        _ => ("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"),
    }
}

/// Serialize a BTreeMap into env_json for database storage.
/// Returns `None` when the map is empty.
pub(crate) fn serialize_env_map(env: &BTreeMap<String, String>) -> Result<Option<String>, AcpError> {
    if env.is_empty() {
        Ok(None)
    } else {
        serde_json::to_string(env)
            .map(Some)
            .map_err(|e| AcpError::protocol(e.to_string()))
    }
}

/// Update on-disk config files for a single agent when model provider credentials change.
/// Uses `agent_env_keys` to determine the correct env var names per agent type.
///
/// For `model_env`: entries with `Some(value)` are written; entries with `None`
/// are explicitly cleared (overwritten with empty string in the env-patch, so
/// `persist_agent_local_config_json` removes them).
///
/// Async so Pi/OpenCode can best-effort fetch the shared provider's full model
/// catalog and inject it into the managed provider entry (chat model picker).
pub(crate) async fn cascade_update_agent_config(
    agent_type: AgentType,
    api_url: &str,
    api_key: &str,
    model_env: &BTreeMap<String, Option<String>>,
    codex_model: &CodexModelAction,
) -> Result<(), AcpError> {
    let (url_key, key_key, _) = agent_env_keys(agent_type);
    match agent_type {
        AgentType::ClaudeCode | AgentType::Gemini => {
            // Write into config.env (not root-level). For model entries, use
            // JSON-null for "clear" — `merge_json_values` interprets null as
            // "remove this key".
            let mut env = serde_json::Map::new();
            env.insert(
                url_key.to_string(),
                serde_json::Value::String(api_url.to_string()),
            );
            env.insert(
                key_key.to_string(),
                serde_json::Value::String(api_key.to_string()),
            );
            for (k, v) in model_env {
                let value = match v {
                    Some(s) => serde_json::Value::String(s.clone()),
                    None => serde_json::Value::Null,
                };
                env.insert(k.clone(), value);
            }
            let patch = serde_json::json!({ "env": env });
            let patch_str =
                serde_json::to_string(&patch).map_err(|e| AcpError::protocol(e.to_string()))?;
            persist_agent_local_config_json(agent_type, Some(&patch_str))?;
        }
        AgentType::OpenClaw => {
            // OpenClaw inference runs inside the local gateway process, not the
            // ACP client. Persist credentials + model into openclaw.json so the
            // gateway can actually call the shared provider.
            let model_name = model_env
                .get("OPENAI_MODEL")
                .and_then(|v| v.as_ref())
                .map(String::as_str);
            write_openclaw_managed_provider(api_url, api_key, model_name)?;
        }
        AgentType::Hermes => {
            // When a model_provider_id is set, cascade the provider's credentials
            // into Hermes's config.yaml and .env using the existing structured
            // write path. Use "custom" as the provider id (model providers expose
            // OpenAI-compatible endpoints).
            let model_name = model_env
                .get("OPENAI_MODEL")
                .and_then(|v| v.as_ref())
                .map(String::clone)
                .unwrap_or_default();
            // Hermes' custom provider treats model.base_url as an OpenAI-style base
            // and appends /chat/completions itself. The base_url therefore needs
            // the /v1 suffix so the final URL is …/v1/chat/completions. If the
            // model_provider's api_url already ends with /v1 (or /v1/), leave it;
            // otherwise append /v1.
            let hermes_base_url = {
                let trimmed = api_url.trim_end_matches('/');
                if trimmed.ends_with("/v1") {
                    trimmed.to_string()
                } else {
                    format!("{}/v1", trimmed)
                }
            };
            let home = hermes_home_dir();
            ensure_hermes_home_secure(&home)?;
            let config_path = hermes_config_yaml_path();
            let existing = fs::read_to_string(&config_path).ok();
            let (config_yaml, env_updates) = plan_hermes_write(
                "custom",
                Some(api_key),
                &model_name,
                Some(&hermes_base_url),
                None, // not raw mode
                existing.as_deref(),
            )?;
            write_hermes_secret_file(&config_path, &config_yaml, "config.yaml")?;
            if !env_updates.is_empty() {
                let env_path = hermes_env_path();
                let existing_env = fs::read_to_string(&env_path).unwrap_or_default();
                let updates: Vec<(&str, &str)> =
                    env_updates.iter().map(|(k, v)| (*k, v.as_str())).collect();
                let patched = patch_env_text(&existing_env, &updates);
                write_hermes_secret_file(&env_path, &patched, ".env")?;
            }
        }
        AgentType::Codex => {
            let auth_path = codex_auth_json_path();
            let mut auth_obj = if auth_path.exists() {
                fs::read_to_string(&auth_path)
                    .ok()
                    .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                    .filter(|v| v.is_object())
                    .unwrap_or_else(|| serde_json::json!({}))
            } else {
                serde_json::json!({})
            };
            if !api_key.trim().is_empty() {
                auth_obj[key_key] = serde_json::Value::String(api_key.to_string());
            }
            let auth_str = serde_json::to_string_pretty(&auth_obj)
                .map_err(|e| AcpError::protocol(e.to_string()))?;

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
            table.remove("api_base_url");

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
            if api_url.trim().is_empty() {
                provider_table.remove("base_url");
            } else {
                let normalized = normalize_openai_compatible_base_url(api_url);
                provider_table.insert(
                    "base_url".to_string(),
                    toml::Value::String(normalized),
                );
            }
            if provider_name == "veryagent" {
                provider_table.insert("name".to_string(), toml::Value::String("veryagent".to_string()));
                // Codex 2026+ only accepts `responses` (chat was removed).
                provider_table.insert(
                    "wire_api".to_string(),
                    toml::Value::String("responses".to_string()),
                );
                provider_table.insert(
                    "requires_openai_auth".to_string(),
                    toml::Value::Boolean(true),
                );
            }
            match codex_model {
                CodexModelAction::Set(model) => {
                    table.insert("model".to_string(), toml::Value::String(model.to_string()));
                }
                CodexModelAction::Clear => {
                    table.remove("model");
                }
                CodexModelAction::NoOp => {}
            }
            let toml_str = toml::to_string_pretty(&toml_value)
                .map_err(|e| AcpError::protocol(e.to_string()))?;

            persist_codex_native_config_files(Some(&auth_str), Some(&toml_str))?;
        }
        AgentType::OpenCode => {
            // OpenCode stores credentials per provider id in auth.json
            // (`{ type: "api", key }`) and non-secret provider defs in
            // opencode.json (`provider.<id>`). Write a managed `veryagent`
            // provider so the unified model-provider selector works the same
            // as Hermes/Cline/Kimi. Only the agent-selected model is loaded —
            // settings remains the place to pick from the full A计划 catalog.
            write_opencode_managed_provider(
                api_url,
                api_key,
                model_env
                    .get("OPENAI_MODEL")
                    .and_then(|v| v.as_ref())
                    .map(String::as_str),
                &[],
            )?;
        }
        AgentType::Cline => {
            // When a model_provider_id is set, cascade the provider's credentials
            // into Cline's globalState.json and secrets.json. Use "openai" as the
            // apiProvider (model providers expose OpenAI-compatible endpoints).
            let model_name = model_env
                .get("OPENAI_MODEL")
                .and_then(|v| v.as_ref())
                .map(String::clone)
                .unwrap_or_default();
            let config_patch = serde_json::json!({
                "apiProvider": "openai",
                "apiBaseUrl": api_url,
                "apiKey": api_key,
                "model": model_name,
            });
            let patch_str = serde_json::to_string(&config_patch)
                .map_err(|e| AcpError::protocol(e.to_string()))?;
            persist_cline_local_config(Some(&patch_str))?;
        }
        AgentType::CodeBuddy => {
            // A计划 is additive: write a custom model into models.json with its
            // own OpenAI-compatible url/apiKey. Do not touch CODEBUDDY_BASE_URL
            // / region / native API key — those own the Tencent built-in catalog
            // (China vs overseas).
            let model_name = model_env
                .get("CODEBUDDY_MODEL")
                .and_then(|v| v.as_ref())
                .map(String::as_str)
                .unwrap_or("");
            write_codebuddy_managed_provider(api_url, api_key, model_name, &[])?;
        }
        AgentType::KimiCode => {
            // When a model_provider_id is set, the cascade injects provider
            // credentials into kimi's config.toml using the veryagent-managed
            // provider block. The interface is `openai` (model providers expose
            // OpenAI-compatible endpoints). Also seed a synthetic gate token
            // so `kimi acp` can authenticate.
            let model_name = model_env
                .get("KIMI_MODEL_NAME")
                .and_then(|v| v.as_ref())
                .map(String::clone)
                .unwrap_or_default();
            let spec = KimiManagedSpec {
                interface_type: "openai".to_string(),
                // Kimi's openai transport appends `/chat/completions` to base_url.
                // Shared providers are often bare host roots; force `/v1`.
                base_url: if api_url.trim().is_empty() {
                    None
                } else {
                    Some(normalize_openai_compatible_base_url(api_url))
                },
                api_key: if api_key.trim().is_empty() {
                    None
                } else {
                    Some(api_key.to_string())
                },
                env: BTreeMap::new(),
                model: model_name,
                max_context_size: Some(KIMI_DEFAULT_MAX_CONTEXT_SIZE),
            };
            mutate_kimi_config_toml(Some(&spec))?;
            seed_kimi_synthetic_credential()?;
        }
        AgentType::Pi => {
            // Pi authenticates via `~/.pi/agent/{settings,auth,models}.json`.
            // When bound to a shared model provider, write a managed custom
            // provider (`veryagent`) so the agent uses the same credentials as
            // every other agent that selected "A计划"/model provider. Only the
            // agent-selected model is written — chat shows what pi loads, and
            // settings is where the full A计划 catalog is chosen.
            let model_name = model_env
                .get("OPENAI_MODEL")
                .and_then(|v| v.as_ref())
                .map(String::as_str)
                .unwrap_or("");
            write_pi_managed_provider(api_url, api_key, model_name, &[])?;
        }
        AgentType::MimoCode => {
            // MiMo Code (OpenCode fork) reads provider config from
            // ~/.config/mimocode/mimocode.jsonc and credentials from
            // ~/.local/share/mimocode/auth.json. Write a managed `veryagent`
            // provider so the agent uses the shared model provider credentials.
            let model_name = model_env
                .get("OPENAI_MODEL")
                .and_then(|v| v.as_ref())
                .map(String::as_str);
            write_mimo_managed_provider(api_url, api_key, model_name, &[])?;
        }
        AgentType::CommandCode => {
            // Command Code has no native provider config file; the bound
            // model-provider credentials already flow into the runtime env
            // (OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL) via
            // `apply_model_provider_env`, which the ACP adapter passes through
            // to the headless `cmdc` process. Nothing to cascade on disk.
        }
    }
    Ok(())
}

/// Per-launch env keys that vary by session/run but don't represent user
/// config, so they're excluded from the config fingerprint. Without this, a
/// session-id-derived value would flip the fingerprint the moment a real
/// session id is assigned and make every session look "stale". Currently only
/// OpenClaw's reset flag (set iff `session_id` is None at spawn).
pub(crate) fn is_volatile_fingerprint_key(key: &str) -> bool {
    key == "OPENCLAW_RESET_SESSION"
}

/// Persist OpenCode's native files (`auth.json` + `opencode.json`) for a
/// config/preferences save. Shared by both the config and preferences commands
/// so the empty-auth handling can't drift between the two exposed paths. An
/// explicitly empty auth payload truncates `auth.json` to `{}`; `None` leaves
/// each file untouched.
pub(crate) fn persist_opencode_native_config(
    opencode_auth_json: Option<&str>,
    config_json: Option<&str>,
) -> Result<(), AcpError> {
    if let Some(auth) = opencode_auth_payload_to_write(opencode_auth_json) {
        persist_opencode_auth_json(&auth)?;
    }
    if let Some(raw) = config_json {
        persist_agent_local_config_json(AgentType::OpenCode, Some(raw))?;
    }
    Ok(())
}

#[cfg(feature = "tauri-runtime")]
pub(crate) fn open_external_terminal_impl(command: &str, cwd: Option<&str>) -> Result<(), AcpError> {
    use std::process::Command;
    // Reject control characters: a newline breaks out of the macOS AppleScript
    // string literal (and would corrupt the cmd/shell line elsewhere), turning a
    // single command into multiple statements.
    if command.contains(['\n', '\r']) || cwd.is_some_and(|c| c.contains(['\n', '\r'])) {
        return Err(AcpError::protocol(
            "terminal command and cwd must not contain newlines",
        ));
    }
    let dir = cwd
        .map(|c| c.to_string())
        .unwrap_or_else(|| home_dir_or_default().display().to_string());

    #[cfg(target_os = "macos")]
    {
        // Hand `cd <dir> && <command>` to Terminal.app via AppleScript. Quote the
        // dir for the shell, then escape the whole string for the AppleScript
        // literal (backslashes first, then double-quotes).
        let shell_cmd = format!("cd {} && {}", shell_single_quote(&dir), command);
        let escaped = shell_cmd.replace('\\', "\\\\").replace('"', "\\\"");
        let osa = format!(
            "tell application \"Terminal\"\nactivate\ndo script \"{escaped}\"\nend tell"
        );
        Command::new("osascript")
            .arg("-e")
            .arg(osa)
            .spawn()
            .map_err(|e| AcpError::protocol(format!("open Terminal failed: {e}")))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // `start "" cmd /K <command>` opens a new console that stays open. The
        // empty "" is the window title `start` would otherwise eat.
        Command::new("cmd")
            .args(["/C", "start", "", "cmd", "/K", command])
            .current_dir(&dir)
            .spawn()
            .map_err(|e| AcpError::protocol(format!("open terminal failed: {e}")))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Probe common Linux terminal emulators in order; keep the window open
        // after the command by re-exec'ing the user's shell.
        let keep_open = format!("{command}; exec \"${{SHELL:-bash}}\"");
        let candidates: [(&str, [&str; 3]); 4] = [
            ("x-terminal-emulator", ["-e", "sh", "-c"]),
            ("gnome-terminal", ["--", "sh", "-c"]),
            ("konsole", ["-e", "sh", "-c"]),
            ("xterm", ["-e", "sh", "-c"]),
        ];
        for (term, args) in candidates {
            if resolve_command_on_path(term).is_some() {
                return Command::new(term)
                    .args(args)
                    .arg(&keep_open)
                    .current_dir(&dir)
                    .spawn()
                    .map(|_| ())
                    .map_err(|e| AcpError::protocol(format!("open {term} failed: {e}")));
            }
        }
        return Err(AcpError::protocol(
            "no supported terminal emulator found (tried x-terminal-emulator, gnome-terminal, konsole, xterm)",
        ));
    }

    #[allow(unreachable_code)]
    Err(AcpError::protocol("unsupported platform for terminal launch"))
}

pub(crate) fn default_interval() -> u64 {
    5
}

pub(crate) fn extract_jwt_account_id(jwt: &str) -> Option<String> {
    let payload = jwt.split('.').nth(1)?;
    let decoded =
        base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, payload).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    value
        .get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}
