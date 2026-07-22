use super::*;
use std::path::PathBuf;

use crate::acp::error::AcpError;


/// Managed Pi custom provider id written by the unified model-provider cascade.
pub(crate) const PI_MANAGED_PROVIDER: &str = "veryagent";

/// Default context window / output budget for managed Pi models.
/// Pi rejects incomplete custom-model entries; match the schema used by a
/// working hand-authored `a-plan` provider and by OpenClaw's managed write.
pub(crate) const PI_MANAGED_MODEL_CONTEXT_WINDOW: u64 = 131_072;
pub(crate) const PI_MANAGED_MODEL_MAX_TOKENS: u64 = 8_192;

/// Build one Pi `models.json` model object with the fields pi requires.
pub(crate) fn pi_managed_model_object(id: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": id,
        "reasoning": false,
        "input": ["text"],
        "contextWindow": PI_MANAGED_MODEL_CONTEXT_WINDOW,
        "maxTokens": PI_MANAGED_MODEL_MAX_TOKENS,
        "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
        }
    })
}

/// Merge-write a custom `veryagent` provider into pi's native settings/auth/models.
///
/// `model` is the default selection written to settings.json. `catalog` is an
/// optional extra list of model ids the caller wants loaded; chat only shows
/// what pi actually loads, so callers should pass the agent-selected model
/// rather than the entire gateway `/models` dump.
pub(crate) fn write_pi_managed_provider(
    api_url: &str,
    api_key: &str,
    model: &str,
    catalog: &[String],
) -> Result<(), AcpError> {
    let model = model.trim();
    // settings.json — defaultProvider / defaultModel
    let settings_path = pi_settings_json_path();
    let mut settings = read_json_object_or_empty(&settings_path);
    settings.insert(
        "defaultProvider".to_string(),
        serde_json::Value::String(PI_MANAGED_PROVIDER.to_string()),
    );
    if !model.is_empty() {
        settings.insert(
            "defaultModel".to_string(),
            serde_json::Value::String(model.to_string()),
        );
    }
    write_json_object_pretty(&settings_path, &settings)?;

    // auth.json — provider credential
    if !api_key.trim().is_empty() {
        let auth_path = pi_auth_json_path();
        let mut auth = read_json_object_or_empty(&auth_path);
        let mut entry = serde_json::Map::new();
        entry.insert(
            "type".to_string(),
            serde_json::Value::String("api_key".to_string()),
        );
        entry.insert(
            "key".to_string(),
            serde_json::Value::String(api_key.to_string()),
        );
        auth.insert(
            PI_MANAGED_PROVIDER.to_string(),
            serde_json::Value::Object(entry),
        );
        write_json_object_pretty(&auth_path, &auth)?;
    }

    // models.json — custom provider definition (baseUrl + openai-completions)
    if !api_url.trim().is_empty() {
        let models_path = pi_models_json_path();
        let mut models_doc = read_json_object_or_empty(&models_path);
        let mut providers = match models_doc.remove("providers") {
            Some(serde_json::Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        };
        let mut entry = match providers.remove(PI_MANAGED_PROVIDER) {
            Some(serde_json::Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        };
        let normalized = normalize_openai_compatible_base_url(api_url);
        entry.insert(
            "baseUrl".to_string(),
            serde_json::Value::String(normalized),
        );
        entry.insert(
            "api".to_string(),
            serde_json::Value::String("openai-completions".to_string()),
        );
        // Display name for the managed provider in pi's model picker.
        entry.insert(
            "name".to_string(),
            serde_json::Value::String("A计划".to_string()),
        );
        // Pi's model-registry rejects non-built-in providers that define models
        // without an inline `apiKey` (auth.json alone is not enough). Without
        // this field the entire custom provider fails to load, and set_model
        // returns "Model not found: veryagent/<id>" even though models.json
        // lists the id. Match the working hand-authored a-plan provider.
        if !api_key.trim().is_empty() {
            entry.insert(
                "apiKey".to_string(),
                serde_json::Value::String(api_key.to_string()),
            );
        }
        // Gateway models rarely support OpenAI's developer role / reasoning
        // effort; match the working hand-authored a-plan provider.
        entry.insert(
            "compat".to_string(),
            serde_json::json!({
                "supportsDeveloperRole": false,
                "supportsReasoningEffort": false
            }),
        );

        // Only the configured selection (and any explicit extras). Rebuild the
        // array so stale gateway dump entries cannot linger in chat.
        // Always use the full pi schema — bare `{id,name}` entries are ignored.
        let mut models_arr: Vec<serde_json::Value> = Vec::new();
        let mut push_model = |id: &str| {
            let id = id.trim();
            if id.is_empty() {
                return;
            }
            let already = models_arr
                .iter()
                .any(|m| m.get("id").and_then(serde_json::Value::as_str) == Some(id));
            if !already {
                models_arr.push(pi_managed_model_object(id));
            }
        };
        for id in catalog {
            push_model(id);
        }
        if !model.is_empty() {
            push_model(model);
        }
        entry.insert("models".to_string(), serde_json::Value::Array(models_arr));
        providers.insert(
            PI_MANAGED_PROVIDER.to_string(),
            serde_json::Value::Object(entry),
        );
        models_doc.insert(
            "providers".to_string(),
            serde_json::Value::Object(providers),
        );
        write_json_object_pretty(&models_path, &models_doc)?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Pi config helpers
//
// pi (the self-extensible coding agent, reached over ACP via `pi-acp`) reads its
// model selection from `~/.pi/agent/settings.json` (`defaultProvider`,
// `defaultModel`, `defaultThinkingLevel` — plain strings) and its API keys from
// `~/.pi/agent/auth.json` (`{ "<provider>": { "type": "api_key", "key": ... } }`).
// veryagent manages both NATIVE files directly (merge-writes that preserve every
// other key), mirroring how it manages Codex's `auth.json`/`config.toml`. The
// agent dir honors `PI_CODING_AGENT_DIR` so a custom pi install can be targeted.
// ---------------------------------------------------------------------------

/// Resolve pi's coding-agent dir: `PI_CODING_AGENT_DIR` if set (trimmed,
/// non-empty), else `~/.pi/agent` (mirrors `codex_home_dir`/`resolve_kimi_*`).
pub(crate) fn pi_agent_dir() -> PathBuf {
    match std::env::var("PI_CODING_AGENT_DIR")
        .ok()
        .map(|raw| raw.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(value) => PathBuf::from(value),
        None => home_dir_or_default().join(".pi").join("agent"),
    }
}

pub(crate) fn pi_settings_json_path() -> PathBuf {
    pi_agent_dir().join("settings.json")
}

pub(crate) fn pi_auth_json_path() -> PathBuf {
    pi_agent_dir().join("auth.json")
}

pub(crate) fn pi_models_json_path() -> PathBuf {
    pi_agent_dir().join("models.json")
}

/// The npm package that ships the `pi` binary pi-acp spawns as `pi --mode rpc`.
/// Installed unpinned ("latest"): pi releases frequently and pi-acp resolves
/// `pi` from PATH, so the binary's version floats independently of the pinned
/// `pi-acp` adapter (which `acp_prepare_npx_agent` installs separately).
pub(crate) const PI_CODING_AGENT_PACKAGE: &str = "@earendil-works/pi-coding-agent";

/// Install the `pi` binary globally via npm, streaming progress on the shared
/// `app://agent-install` topic. This is the prerequisite the missing-pi launch
/// preflight (see [`crate::acp::connection`]) guards against. Reuses the same
/// EACCES user-prefix and EEXIST `--force` fallbacks as every other npm agent
/// install.
pub(crate) async fn acp_install_pi_binary_core(
    task_id: String,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    emit_agent_install_event(emitter, &task_id, AgentInstallEventKind::Started, "");

    let result =
        install_npm_global_package_streaming(PI_CODING_AGENT_PACKAGE, &task_id, emitter).await;

    match &result {
        Ok(()) => emit_agent_install_event(
            emitter,
            &task_id,
            AgentInstallEventKind::Completed,
            "pi installed successfully",
        ),
        Err(e) => emit_agent_install_event(
            emitter,
            &task_id,
            AgentInstallEventKind::Failed,
            e.to_string(),
        ),
    }
    result
}
