use super::*;
use std::path::PathBuf;

use crate::acp::error::AcpError;


// ---------------------------------------------------------------------------
// Kimi Code config helpers
//
// IMPORTANT — how `kimi acp` actually authenticates (reverse-engineered &
// empirically verified against @moonshot-ai/kimi-code 0.19.1):
//
// `kimi acp` gates EVERY `session/new` on an OAuth-style token: it calls
// `harnessIsAuthed`, which is true iff `~/.kimi-code/credentials/kimi-code.json`
// holds a token whose `access_token` is non-empty. It NEVER validates that token
// for the gate (no network, no signature check). API keys — whether injected via
// the `KIMI_MODEL_*` env family OR written into `config.toml` `[providers].api_key`
// — do NOT create this token, so on their own they yield `Authentication
// required`. The only advertised ACP auth method is a terminal device-code login
// (`kimi acp --login`), which requires a Kimi *subscription* account.
//
// To support plain API-key users, veryagent therefore manages BOTH halves:
//   1. `config.toml` — a veryagent-managed `[providers."veryagent"]` + `[models."veryagent-managed"]`
//      + `default_model` block that ROUTES INFERENCE to the user's API key
//      (any of the six native interface types: kimi / openai / openai_responses /
//      anthropic / google-genai / vertexai).
//   2. `credentials/kimi-code.json` — a synthetic gate token veryagent seeds so the
//      ACP session opens. It is purely local: because `default_model` points at
//      the API-key provider, the managed/OAuth endpoint is never called and this
//      token is never transmitted. It carries a `_veryagent_synthetic` marker so we
//      only ever remove OUR token, never a real login the user performed.
//
// The veryagent-managed block is keyed by the fixed names `veryagent` / `veryagent-managed`
// so it is recognizable and removable without disturbing any provider/model the
// user added by hand. The raw config.toml editor is the comment/format escape
// hatch. A stale `KIMI_MODEL_*` env override would silently win over config.toml,
// so every save also clears it.
// ---------------------------------------------------------------------------

pub(crate) const KIMI_MANAGED_PROVIDER: &str = "veryagent";
pub(crate) const KIMI_MANAGED_MODEL_ALIAS: &str = "veryagent-managed";
pub(crate) const KIMI_MODEL_API_KEY_ENV: &str = "KIMI_MODEL_API_KEY";
pub(crate) const KIMI_MODEL_BASE_URL_ENV: &str = "KIMI_MODEL_BASE_URL";
pub(crate) const KIMI_MODEL_NAME_ENV: &str = "KIMI_MODEL_NAME";
/// Sentinel `access_token` value (and `_veryagent_synthetic` marker) identifying the
/// gate token veryagent seeds, so we never clobber a real OAuth login.
pub(crate) const KIMI_SYNTHETIC_TOKEN_ACCESS: &str = "veryagent-local-gate";
/// Fallback context window for the managed model. Kimi's config schema **requires**
/// `[models.<alias>].max_context_size` to be a positive integer — omitting it makes
/// kimi discard the whole model block ("Ignored invalid config … models.veryagent-managed"),
/// which leaves `default_model` dangling and every prompt ends with no reply. So we
/// always write one, defaulting to the kimi-k2 256K window when the user leaves it blank.
pub(crate) const KIMI_DEFAULT_MAX_CONTEXT_SIZE: i64 = 262_144;
/// The six native provider `type` values Kimi accepts in `[providers.<name>]`.
pub(crate) const KIMI_INTERFACE_TYPES: &[&str] = &[
    "kimi",
    "openai",
    "openai_responses",
    "anthropic",
    "google-genai",
    "vertexai",
];

pub(crate) fn kimi_code_config_toml_path() -> PathBuf {
    crate::parsers::kimi_code::resolve_kimi_code_home_dir().join("config.toml")
}

/// The synthetic-gate-token file `kimi acp` checks to decide a session is
/// authenticated (`<KIMI_CODE_HOME>/credentials/kimi-code.json`).
pub(crate) fn kimi_code_credentials_token_path() -> PathBuf {
    crate::parsers::kimi_code::resolve_kimi_code_home_dir()
        .join("credentials")
        .join("kimi-code.json")
}

/// The `[providers.<name>].env` variable Kimi reads each interface type's API key
/// from when the user picks "env sub-table" auth. `None` for vertexai, whose
/// credentials come from GCP Application Default Credentials (no inline key).
pub(crate) fn kimi_provider_key_env_var(interface_type: &str) -> Option<&'static str> {
    match interface_type {
        "kimi" => Some("KIMI_API_KEY"),
        "openai" | "openai_responses" => Some("OPENAI_API_KEY"),
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "google-genai" => Some("GOOGLE_API_KEY"),
        _ => None,
    }
}

/// Upsert (`Some`) or remove (`None`) the veryagent-managed `[providers.veryagent]` +
/// `[models.veryagent-managed]` block in a parsed config.toml document, preserving
/// every other section the user authored. Removal also resets `default_model`
/// only when it points at our managed alias.
pub(crate) fn apply_kimi_managed_block(
    toml_value: &mut toml::Value,
    spec: Option<&KimiManagedSpec>,
) -> Result<(), AcpError> {
    let table = toml_value
        .as_table_mut()
        .ok_or_else(|| AcpError::protocol("kimi config root must be a TOML table"))?;
    match spec {
        Some(spec) => {
            let providers = table
                .entry("providers".to_string())
                .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
            if !providers.is_table() {
                *providers = toml::Value::Table(toml::map::Map::new());
            }
            let providers = providers.as_table_mut().expect("providers set to table");
            let mut provider_table = toml::map::Map::new();
            provider_table.insert(
                "type".to_string(),
                toml::Value::String(spec.interface_type.clone()),
            );
            if let Some(url) = spec.base_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                provider_table.insert("base_url".to_string(), toml::Value::String(url.to_string()));
            }
            if let Some(key) = spec.api_key.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                provider_table.insert("api_key".to_string(), toml::Value::String(key.to_string()));
            }
            if !spec.env.is_empty() {
                let mut env_table = toml::map::Map::new();
                for (k, v) in &spec.env {
                    let trimmed = v.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    env_table.insert(k.clone(), toml::Value::String(trimmed.to_string()));
                }
                if !env_table.is_empty() {
                    provider_table.insert("env".to_string(), toml::Value::Table(env_table));
                }
            }
            providers.insert(
                KIMI_MANAGED_PROVIDER.to_string(),
                toml::Value::Table(provider_table),
            );

            let models = table
                .entry("models".to_string())
                .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
            if !models.is_table() {
                *models = toml::Value::Table(toml::map::Map::new());
            }
            let models = models.as_table_mut().expect("models set to table");
            let mut model_table = toml::map::Map::new();
            model_table.insert(
                "provider".to_string(),
                toml::Value::String(KIMI_MANAGED_PROVIDER.to_string()),
            );
            model_table.insert("model".to_string(), toml::Value::String(spec.model.clone()));
            // Always emit a positive `max_context_size`: kimi's schema requires it and
            // silently drops the entire model block otherwise (→ empty turns). Fall back
            // to the default window when the user did not specify one.
            let ctx = spec
                .max_context_size
                .filter(|c| *c > 0)
                .unwrap_or(KIMI_DEFAULT_MAX_CONTEXT_SIZE);
            model_table.insert("max_context_size".to_string(), toml::Value::Integer(ctx));
            models.insert(
                KIMI_MANAGED_MODEL_ALIAS.to_string(),
                toml::Value::Table(model_table),
            );

            table.insert(
                "default_model".to_string(),
                toml::Value::String(KIMI_MANAGED_MODEL_ALIAS.to_string()),
            );
        }
        None => {
            let providers_empty = if let Some(providers) =
                table.get_mut("providers").and_then(toml::Value::as_table_mut)
            {
                providers.remove(KIMI_MANAGED_PROVIDER);
                providers.is_empty()
            } else {
                false
            };
            if providers_empty {
                table.remove("providers");
            }
            let models_empty = if let Some(models) =
                table.get_mut("models").and_then(toml::Value::as_table_mut)
            {
                models.remove(KIMI_MANAGED_MODEL_ALIAS);
                models.is_empty()
            } else {
                false
            };
            if models_empty {
                table.remove("models");
            }
            if table.get("default_model").and_then(toml::Value::as_str) == Some(KIMI_MANAGED_MODEL_ALIAS)
            {
                table.remove("default_model");
            }
        }
    }
    Ok(())
}

/// Read and parse a token file, if present and valid JSON.
pub(crate) fn read_kimi_token_at(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

pub(crate) fn read_kimi_token() -> Option<serde_json::Value> {
    read_kimi_token_at(&kimi_code_credentials_token_path())
}

/// Whether a token document is veryagent's synthetic gate token (vs a real OAuth
/// login the user performed via `kimi login`). Matches either the sentinel
/// `access_token` or the explicit `_veryagent_synthetic` marker.
pub(crate) fn kimi_token_is_synthetic(token: &serde_json::Value) -> bool {
    token
        .get("_veryagent_synthetic")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
        || token.get("access_token").and_then(serde_json::Value::as_str)
            == Some(KIMI_SYNTHETIC_TOKEN_ACCESS)
}

/// Whether a token document carries a non-empty `access_token` — i.e. would pass
/// `kimi acp`'s session gate.
pub(crate) fn kimi_token_has_access(token: &serde_json::Value) -> bool {
    token
        .get("access_token")
        .and_then(serde_json::Value::as_str)
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

/// Seed veryagent's synthetic gate token at `path` so `kimi acp` treats the session
/// as authenticated. No-op (preserves) when a REAL OAuth login token is already
/// present — that already satisfies the gate and must never be clobbered.
pub(crate) fn seed_kimi_synthetic_credential_at(path: &Path) -> Result<(), AcpError> {
    if let Some(existing) = read_kimi_token_at(path) {
        if kimi_token_has_access(&existing) && !kimi_token_is_synthetic(&existing) {
            return Ok(());
        }
    }
    let token = serde_json::json!({
        "access_token": KIMI_SYNTHETIC_TOKEN_ACCESS,
        "refresh_token": "",
        "expires_at": 9_999_999_999i64,
        "expires_in": 9_999_999i64,
        "scope": "",
        "token_type": "Bearer",
        "_veryagent_synthetic": true,
    });
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            AcpError::protocol(format!("create kimi credentials directory failed: {e}"))
        })?;
    }
    let body = serde_json::to_string_pretty(&token)
        .map_err(|e| AcpError::protocol(format!("serialize kimi credential failed: {e}")))?;
    fs::write(path, format!("{body}\n"))
        .map_err(|e| AcpError::protocol(format!("write kimi credential failed: {e}")))?;
    Ok(())
}

pub(crate) fn seed_kimi_synthetic_credential() -> Result<(), AcpError> {
    seed_kimi_synthetic_credential_at(&kimi_code_credentials_token_path())
}

/// Remove the gate token at `path` ONLY when it is veryagent's synthetic one —
/// leaving any real OAuth login the user performed untouched.
pub(crate) fn remove_kimi_synthetic_credential_if_ours_at(path: &Path) -> Result<(), AcpError> {
    match read_kimi_token_at(path) {
        Some(token) if kimi_token_is_synthetic(&token) => fs::remove_file(path)
            .map_err(|e| AcpError::protocol(format!("remove kimi credential failed: {e}"))),
        _ => Ok(()),
    }
}

pub(crate) fn remove_kimi_synthetic_credential_if_ours() -> Result<(), AcpError> {
    remove_kimi_synthetic_credential_if_ours_at(&kimi_code_credentials_token_path())
}

/// Project the veryagent-managed config.toml block into a flat JSON object for the
/// settings panel, plus the raw file text for the advanced editor. Uses keys
/// (`baseUrl` / `key` / `modelId`, never `apiBaseUrl` / `apiKey` / `model` /
/// `env`) that do NOT match `AgentRuntimeConfig`, so `build_runtime_env_from_setting`
/// never mirrors these file values back into the `KIMI_MODEL_*` runtime env.
pub(crate) fn project_kimi_managed_config(value: &toml::Value) -> serde_json::Map<String, serde_json::Value> {
    let mut merged = serde_json::Map::new();

    if let Some(provider) = value
        .get("providers")
        .and_then(|t| t.get(KIMI_MANAGED_PROVIDER))
        .and_then(toml::Value::as_table)
    {
        let interface_type = provider
            .get("type")
            .and_then(toml::Value::as_str)
            .map(str::to_string);
        if let Some(itype) = &interface_type {
            merged.insert(
                "interfaceType".to_string(),
                serde_json::Value::String(itype.clone()),
            );
        }
        if let Some(url) = provider
            .get("base_url")
            .and_then(toml::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            merged.insert(
                "baseUrl".to_string(),
                serde_json::Value::String(url.to_string()),
            );
        }
        if let Some(key) = provider
            .get("api_key")
            .and_then(toml::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            merged.insert("key".to_string(), serde_json::Value::String(key.to_string()));
            merged.insert(
                "authType".to_string(),
                serde_json::Value::String("api_key".to_string()),
            );
        }
        if let Some(env) = provider.get("env").and_then(toml::Value::as_table) {
            if let Some(project) = env.get("GOOGLE_CLOUD_PROJECT").and_then(toml::Value::as_str) {
                merged.insert(
                    "vertexProject".to_string(),
                    serde_json::Value::String(project.to_string()),
                );
            }
            if let Some(location) = env.get("GOOGLE_CLOUD_LOCATION").and_then(toml::Value::as_str) {
                merged.insert(
                    "vertexLocation".to_string(),
                    serde_json::Value::String(location.to_string()),
                );
            }
            if let Some(var) = interface_type.as_deref().and_then(kimi_provider_key_env_var) {
                if let Some(key) = env
                    .get(var)
                    .and_then(toml::Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    merged.insert("key".to_string(), serde_json::Value::String(key.to_string()));
                    merged.insert(
                        "authType".to_string(),
                        serde_json::Value::String("env".to_string()),
                    );
                }
            }
        }
    }
    if let Some(model) = value
        .get("models")
        .and_then(|t| t.get(KIMI_MANAGED_MODEL_ALIAS))
        .and_then(toml::Value::as_table)
    {
        if let Some(model_id) = model
            .get("model")
            .and_then(toml::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            merged.insert(
                "modelId".to_string(),
                serde_json::Value::String(model_id.to_string()),
            );
        }
        if let Some(ctx) = model.get("max_context_size").and_then(toml::Value::as_integer) {
            merged.insert(
                "maxContextSize".to_string(),
                serde_json::Value::Number(ctx.into()),
            );
        }
    }

    let has_managed = merged.contains_key("interfaceType");
    merged.insert("hasManagedBlock".to_string(), serde_json::Value::Bool(has_managed));
    merged
}

/// Validate + resolve a `native`-mode update into the managed block to write.
pub(crate) fn build_kimi_managed_spec(update: &KimiCodeConfigUpdate) -> Result<KimiManagedSpec, AcpError> {
    let interface_type = update.interface_type.as_deref().map(str::trim).unwrap_or("");
    if !KIMI_INTERFACE_TYPES.contains(&interface_type) {
        return Err(AcpError::protocol(format!(
            "unknown kimi interface type: '{interface_type}'"
        )));
    }
    let model = update
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AcpError::protocol("kimi native config requires a model id"))?
        .to_string();
    let base_url = update
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if let Some(url) = &base_url {
        if url.contains(['\n', '\r']) {
            return Err(AcpError::protocol("kimi base url must not contain newlines"));
        }
    }

    let mut env: BTreeMap<String, String> = BTreeMap::new();
    let mut api_key: Option<String> = None;

    if interface_type == "vertexai" {
        // Vertex AI: no API key (GCP Application Default Credentials). Persist the
        // project/location into the provider env sub-table.
        if let Some(project) = update
            .vertex_project
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            env.insert("GOOGLE_CLOUD_PROJECT".to_string(), project.to_string());
        }
        if let Some(location) = update
            .vertex_location
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            env.insert("GOOGLE_CLOUD_LOCATION".to_string(), location.to_string());
        }
    } else if let Some(key) = update
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if key.contains(['\n', '\r']) {
            return Err(AcpError::protocol("kimi api key must not contain newlines"));
        }
        // "env" auth writes the key into the provider env sub-table under the
        // interface's canonical key var; otherwise it goes in the inline `api_key`.
        if update.auth_type.as_deref() == Some("env") {
            match kimi_provider_key_env_var(interface_type) {
                Some(var) => {
                    env.insert(var.to_string(), key.to_string());
                }
                None => api_key = Some(key.to_string()),
            }
        } else {
            api_key = Some(key.to_string());
        }
    }

    Ok(KimiManagedSpec {
        interface_type: interface_type.to_string(),
        base_url,
        api_key,
        env,
        model,
        max_context_size: update.max_context_size.filter(|c| *c > 0),
    })
}

/// Seed an empty `local.toml` in the project's `.kimi-code` directory so Kimi
/// Code does not fail with a `readTextFile` error when it tries to read the
/// project-local config on startup. Creates the `.kimi-code` directory if it
/// does not exist, and writes an empty `local.toml` if one is not already
/// present. Best-effort: a failure here is non-fatal (Kimi Code will still
/// start, just with a warning).
pub(crate) fn seed_kimi_project_config(cwd: &std::path::Path) {
    let kimi_dir = cwd.join(".kimi-code");
    if let Err(e) = std::fs::create_dir_all(&kimi_dir) {
        tracing::warn!("[KimiCode] failed to create .kimi-code directory: {e}");
        return;
    }
    let local_toml = kimi_dir.join("local.toml");
    if local_toml.exists() {
        return;
    }
    if let Err(e) = std::fs::write(&local_toml, "") {
        tracing::warn!("[KimiCode] failed to create local.toml: {e}");
    }
}
