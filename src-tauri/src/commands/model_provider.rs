use std::path::Path;

use crate::acp::manager::ConnectionManager;
use crate::acp::types::ConfigStaleKind;
use crate::app_error::AppCommandError;
use crate::commands::acp;
use crate::db::service::{agent_setting_service, model_provider_service};
use crate::db::AppDatabase;
use crate::models::agent::AgentType;
use crate::models::model_provider::ModelProviderInfo;
use crate::web::event_bridge::EventEmitter;

// ---------------------------------------------------------------------------
// Shared core functions
// ---------------------------------------------------------------------------

fn validate_fields(
    name: Option<&str>,
    api_url: Option<&str>,
    api_key: Option<&str>,
) -> Result<(), AppCommandError> {
    if let Some(n) = name {
        if n.len() > 256 {
            return Err(AppCommandError::invalid_input("Name must be 256 characters or less"));
        }
    }
    if let Some(u) = api_url {
        if u.len() > 2048 {
            return Err(AppCommandError::invalid_input("API URL must be 2048 characters or less"));
        }
        if !u.starts_with("http://") && !u.starts_with("https://") {
            return Err(AppCommandError::invalid_input(
                "API URL must start with http:// or https://",
            ));
        }
    }
    if let Some(k) = api_key {
        if k.len() > 4096 {
            return Err(AppCommandError::invalid_input("API Key must be 4096 characters or less"));
        }
    }
    Ok(())
}

pub async fn list_model_providers_core(
    db: &AppDatabase,
) -> Result<Vec<ModelProviderInfo>, AppCommandError> {
    let rows = model_provider_service::list_all(&db.conn)
        .await
        .map_err(AppCommandError::from)?;
    Ok(rows.into_iter().map(ModelProviderInfo::from).collect())
}

pub async fn get_model_provider_core(
    db: &AppDatabase,
    id: i32,
) -> Result<ModelProviderInfo, AppCommandError> {
    let row = model_provider_service::get_by_id(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("model provider not found: {id}")))?;
    Ok(ModelProviderInfo::from(row))
}

pub async fn create_model_provider_core(
    db: &AppDatabase,
    name: String,
    api_url: String,
    api_key: String,
) -> Result<ModelProviderInfo, AppCommandError> {
    validate_fields(Some(&name), Some(&api_url), Some(&api_key))?;
    let row = model_provider_service::create(&db.conn, name, api_url, api_key)
        .await
        .map_err(AppCommandError::from)?;
    Ok(ModelProviderInfo::from(row))
}

/// Update a model provider.
pub async fn update_model_provider_core(
    db: &AppDatabase,
    id: i32,
    name: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    emitter: &EventEmitter,
) -> Result<ModelProviderInfo, AppCommandError> {
    validate_fields(name.as_deref(), api_url.as_deref(), api_key.as_deref())?;

    let old = model_provider_service::get_by_id(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("model provider not found: {id}")))?;

    let row = model_provider_service::update(
        &db.conn, id, name.clone(), api_url.clone(), api_key.clone(),
    )
    .await
    .map_err(AppCommandError::from)?;

    let url_changed = api_url.as_deref().is_some_and(|u| u != old.api_url);
    let key_changed = api_key.as_deref().is_some_and(|k| k != old.api_key);

    if url_changed || key_changed {
        let final_url = api_url.as_deref().unwrap_or(&old.api_url);
        let final_key = api_key.as_deref().unwrap_or(&old.api_key);
        acp::cascade_update_model_provider(
            db,
            id,
            final_url,
            final_key,
            old.model.as_deref(),
            emitter,
        )
        .await
        .map_err(|e| AppCommandError::invalid_input(e.to_string()))?;
    }

    Ok(ModelProviderInfo::from(row))
}

/// Result of `update_model_provider`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModelProviderResult {
    pub provider: ModelProviderInfo,
    pub affected_running_sessions: usize,
}

pub async fn update_model_provider_and_refresh(
    db: &AppDatabase,
    manager: &ConnectionManager,
    data_dir: &Path,
    id: i32,
    name: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    emitter: &EventEmitter,
) -> Result<UpdateModelProviderResult, AppCommandError> {
    let provider = update_model_provider_core(db, id, name, api_url, api_key, emitter).await?;

    let agent_types: Vec<AgentType> = agent_setting_service::find_by_model_provider_id(&db.conn, id)
        .await
        .unwrap_or_default()
        .iter()
        .filter_map(|s| serde_json::from_str(&s.agent_type).ok())
        .collect();
    let affected_running_sessions = acp::refresh_config_staleness(
        manager, db, data_dir, &agent_types, ConfigStaleKind::ModelProvider,
    )
    .await;

    Ok(UpdateModelProviderResult { provider, affected_running_sessions })
}

pub async fn delete_model_provider_core(db: &AppDatabase, id: i32) -> Result<(), AppCommandError> {
    let dependents = agent_setting_service::find_by_model_provider_id(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?;

    if !dependents.is_empty() {
        let names: Vec<String> = dependents
            .iter()
            .filter_map(|row| {
                serde_json::from_str::<AgentType>(&row.agent_type)
                    .ok()
                    .map(|at| at.to_string())
            })
            .collect();
        return Err(AppCommandError::invalid_input(format!(
            "PROVIDER_IN_USE:{}",
            names.join(", ")
        )));
    }

    model_provider_service::delete(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelItem {
    pub id: String,
    pub name: String,
}

/// Normalize a provider API base URL into candidate `/models` endpoints.
///
/// Users commonly save any of:
/// - `https://api.openai.com/v1`
/// - `https://api.openai.com/v1/`
/// - `https://api.openai.com`
/// - `https://api.openai.com/v1/models`
/// - `https://gateway.example.com/v1/chat/completions` (chat endpoint pasted by mistake)
/// - `https://gateway.example.com/v1/images/generations` (image endpoint pasted by mistake)
/// Common suffixes that users may paste into the API URL field (e.g. from
/// OpenAI / Anthropic docs). Stripping them yields the base URL.
/// Longer paths first so `/v1/chat/completions` is matched before
/// `/chat/completions` (which would leave a bare `/v1`).
const API_PATH_SUFFIXES: &[&str] = &[
    "/v1/chat/completions",
    "/v1/messages",
    "/v1/images/generations",
    "/v1/images/edits",
    "/chat/completions",
    "/completions",
    "/messages",
    "/images/generations",
    "/images/edits",
];

/// Strip known API path suffixes from the user-provided URL, returning the
/// base URL (protocol + host + optional /v1). If the URL has no recognized
/// suffix, returns the original trimmed URL as-is.
fn strip_api_path_suffixes(raw: &str) -> String {
    let mut base = raw.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return base;
    }
    for suffix in API_PATH_SUFFIXES {
        if let Some(stripped) = base
            .strip_suffix(suffix)
            .map(|s| s.trim_end_matches('/').to_string())
        {
            if !stripped.is_empty() {
                base = stripped;
            }
            break;
        }
    }
    base
}

fn provider_models_url_candidates(api_url: &str) -> Vec<String> {
    let base = strip_api_path_suffixes(api_url);
    if base.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    let mut push = |url: String| {
        if !url.is_empty() && !candidates.iter().any(|x| x == &url) {
            candidates.push(url);
        }
    };

    if base.ends_with("/models") {
        push(base.clone());
        // Also try parent /v1/models if someone pasted .../something/models oddly.
    } else {
        push(format!("{base}/models"));
        // Many gateways only expose OpenAI-compatible routes under /v1.
        if !base.ends_with("/v1") && !base.contains("/v1/") {
            push(format!("{base}/v1/models"));
        }
    }

    candidates
}

/// Prefer env-proxy client first (user settings / HTTP_PROXY), then a no-proxy
/// client. Corporate TLS-intercept proxies often break OpenAI-compatible
/// gateways with BAD_DECRYPT / 502; the second client recovers direct access.
fn models_http_clients() -> Result<Vec<reqwest::Client>, AppCommandError> {
    let timeout = std::time::Duration::from_secs(20);
    let mut clients = Vec::with_capacity(2);

    let with_env = reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppCommandError::invalid_input(format!("HTTP client error: {e}")))?;
    clients.push(with_env);

    let direct = reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(std::time::Duration::from_secs(10))
        .no_proxy()
        .build()
        .map_err(|e| AppCommandError::invalid_input(format!("HTTP client error: {e}")))?;
    clients.push(direct);

    Ok(clients)
}

fn humanize_models_fetch_error(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("bad_decrypt")
        || lower.contains("certificate")
        || lower.contains("ssl")
        || lower.contains("tls")
        || lower.contains("proxy:")
    {
        return format!(
            "网关 HTTPS/代理握手失败（常见于系统代理 TLS 解密）。\
已自动尝试直连。请检查 API 地址与系统代理，或暂时关闭代理后重试。原始错误: {raw}"
        );
    }
    if lower.contains("http 502") || lower.contains("http 503") || lower.contains("http 504") {
        return format!(
            "网关暂时不可用（上游 5xx）。请确认 API 地址可访问、Key 有效，或稍后重试。原始错误: {raw}"
        );
    }
    raw.to_string()
}

fn parse_provider_models_body(body: &str) -> Result<Vec<ProviderModelItem>, String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err("Empty response body".to_string());
    }

    let parsed: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("Invalid JSON: {e}"))?;

    // Explicit API error payloads should not be reported as "empty list".
    if let Some(err) = parsed.get("error") {
        let msg = err
            .get("message")
            .and_then(|v| v.as_str())
            .or_else(|| err.as_str())
            .unwrap_or("gateway error");
        return Err(format!("Gateway error: {msg}"));
    }
    if parsed.get("success") == Some(&serde_json::Value::Bool(false)) {
        let msg = parsed
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("request failed");
        return Err(format!("Gateway error: {msg}"));
    }

    let extract_id = |item: &serde_json::Value| -> Option<String> {
        item.get("id")
            .or_else(|| item.get("model"))
            .or_else(|| item.get("model_name"))
            .or_else(|| item.get("modelName"))
            .or_else(|| item.get("name"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| {
                item.as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            })
    };

    let mut models: Vec<ProviderModelItem> = Vec::new();
    let push_item = |models: &mut Vec<ProviderModelItem>, id: String| {
        if !models.iter().any(|m| m.id == id) {
            models.push(ProviderModelItem {
                name: id.clone(),
                id,
            });
        }
    };

    let push_from_array = |models: &mut Vec<ProviderModelItem>, arr: &[serde_json::Value]| {
        for item in arr {
            if let Some(id) = extract_id(item) {
                push_item(models, id);
            }
        }
    };

    // OpenAI / NewAPI: { "object": "list", "data": [{ "id": "gpt-5", ... }] }
    if let Some(arr) = parsed.get("data").and_then(|d| d.as_array()) {
        push_from_array(&mut models, arr);
    }

    // Nested: { "data": { "data": [...] } } or { "data": { "models": [...] } }
    if models.is_empty() {
        if let Some(obj) = parsed.get("data").and_then(|d| d.as_object()) {
            for key in ["data", "models", "items", "list", "result"] {
                if let Some(arr) = obj.get(key).and_then(|v| v.as_array()) {
                    push_from_array(&mut models, arr);
                    if !models.is_empty() {
                        break;
                    }
                }
            }
            // Map form: { "data": { "gpt-4": {...}, "dall-e-3": {...} } }
            if models.is_empty() {
                for (k, v) in obj {
                    if let Some(id) = extract_id(v).or_else(|| {
                        let t = k.trim();
                        if t.is_empty() {
                            None
                        } else {
                            Some(t.to_string())
                        }
                    }) {
                        // Skip meta keys that are not model ids.
                        let lower = id.to_ascii_lowercase();
                        if matches!(
                            lower.as_str(),
                            "success" | "message" | "object" | "total" | "page" | "page_size"
                        ) {
                            continue;
                        }
                        push_item(&mut models, id);
                    }
                }
            }
        }
    }

    // Some gateways: { "models": ["a", "b"] } or { "models": [{ "id": ... }] }
    if models.is_empty() {
        if let Some(arr) = parsed.get("models").and_then(|d| d.as_array()) {
            push_from_array(&mut models, arr);
        }
    }

    // Rare: bare array
    if models.is_empty() {
        if let Some(arr) = parsed.as_array() {
            push_from_array(&mut models, arr);
        }
    }

    Ok(models)
}

/// List models from an OpenAI-compatible gateway using raw URL + API key.
/// Shared by model-provider settings and image-generation model picker.
pub async fn fetch_openai_compatible_models(
    api_url: &str,
    api_key: &str,
) -> Result<Vec<ProviderModelItem>, AppCommandError> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(AppCommandError::invalid_input(
            "API Key is empty; cannot list models",
        ));
    }

    let candidates = provider_models_url_candidates(api_url);
    if candidates.is_empty() {
        return Err(AppCommandError::invalid_input(
            "API URL is empty; cannot list models",
        ));
    }

    let clients = models_http_clients()?;
    let mut last_error = String::from("no candidate URL succeeded");

    // Outer: URL variants. Inner: proxy then direct. Auth failures short-circuit.
    for url in &candidates {
        for (client_idx, client) in clients.iter().enumerate() {
            let via = if client_idx == 0 {
                "proxy-env"
            } else {
                "direct"
            };
            let resp = match client
                .get(url)
                .header("Authorization", format!("Bearer {api_key}"))
                // Some OpenAI-compatible gateways accept either form.
                .header("api-key", api_key)
                .send()
                .await
            {
                Ok(resp) => resp,
                Err(e) => {
                    last_error = format!("Request failed for {url} ({via}): {e}");
                    continue;
                }
            };

            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();

            if !status.is_success() {
                let snippet = body.chars().take(300).collect::<String>();
                last_error = format!(
                    "Provider returned HTTP {} for {} ({}): {}",
                    status.as_u16(),
                    url,
                    via,
                    snippet
                );
                // Keep trying alternate candidates / direct client on 404/405/5xx.
                if status.as_u16() == 404 || status.as_u16() == 405 {
                    continue;
                }
                // Auth/permission errors are definitive (key wrong, not routing).
                if status.as_u16() == 401 || status.as_u16() == 403 {
                    return Err(AppCommandError::invalid_input(last_error));
                }
                continue;
            }

            match parse_provider_models_body(&body) {
                Ok(models) if !models.is_empty() => return Ok(models),
                Ok(_) => {
                    // 200 + empty list is common on NewAPI when the token has
                    // no models enabled / model scope is empty — not a routing bug.
                    let snippet = body.chars().take(180).collect::<String>();
                    last_error = format!(
                        "网关返回空模型列表（{url}, {via}）。\
常见原因：1) 令牌未勾选/开通任何模型 2) 令牌模型范围为空 3) 该 Key 无权列出模型。\
可在网关后台令牌设置里勾选模型后重试，或直接在下方手填模型名。\
响应片段: {snippet}"
                    );
                    // Empty list is definitive for this URL+auth; no point retrying
                    // other proxy modes for the same empty payload shape.
                    return Err(AppCommandError::invalid_input(last_error));
                }
                Err(e) => {
                    let snippet = body.chars().take(160).collect::<String>();
                    last_error = format!("{e} (url: {url}, {via}; body: {snippet})");
                    continue;
                }
            }
        }
    }

    Err(AppCommandError::invalid_input(humanize_models_fetch_error(
        &last_error,
    )))
}

/// Fetch available models from a model provider's OpenAI-compatible `/models` endpoint.
pub async fn fetch_provider_models_core(
    db: &AppDatabase,
    id: i32,
) -> Result<Vec<ProviderModelItem>, AppCommandError> {
    let provider = get_model_provider_core(db, id).await?;
    fetch_openai_compatible_models(&provider.api_url, &provider.api_key).await
}

// ---------------------------------------------------------------------------
// Provider connectivity test
// ---------------------------------------------------------------------------

/// Result of one protocol probe.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolProbeResult {
    /// Protocol name: "openai" | "anthropic" | "models"
    pub protocol: &'static str,
    /// Whether the probe succeeded.
    pub ok: bool,
    /// Human-readable detail (success info or error message).
    pub detail: String,
}

/// Full test result for a model provider.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderTestResult {
    /// True when every probe succeeded.
    pub ok: bool,
    pub probes: Vec<ProtocolProbeResult>,
}

fn probe_ok(protocol: &'static str, detail: String) -> ProtocolProbeResult {
    ProtocolProbeResult { protocol, ok: true, detail }
}

fn probe_fail(protocol: &'static str, detail: String) -> ProtocolProbeResult {
    ProtocolProbeResult { protocol, ok: false, detail }
}

/// Derive the base URL for a protocol path. Keeps the user's `/v1` if present,
/// otherwise appends `/v1` (the conventional OpenAI/Anthropic root).
/// Automatically strips common API path suffixes so the user can paste a full
/// endpoint URL (e.g. `https://gateway.com/v1/chat/completions`) and still get
/// the correct base.
fn base_v1(api_url: &str) -> String {
    let base = strip_api_path_suffixes(api_url);
    if base.is_empty() {
        return String::new();
    }
    if base.ends_with("/v1") {
        base
    } else {
        format!("{base}/v1")
    }
}

/// POST a JSON body to `url` and return (status, body). Tries the env-proxy
/// client then a direct (no-proxy) client.
async fn post_json(
    url: &str,
    headers: &[(&str, &str)],
    body: &serde_json::Value,
) -> Result<(u16, String), String> {
    let clients = models_http_clients().map_err(|e| e.to_string())?;
    let mut last_err = String::from("no client attempted");
    for (idx, client) in clients.iter().enumerate() {
        let mut req = client.post(url);
        req = req.header("Content-Type", "application/json");
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        let resp = match req.json(body).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("request failed ({})", if idx == 0 { "proxy-env" } else { "direct" });
                let _ = &e;
                continue;
            }
        };
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Ok((status, text));
    }
    Err(last_err)
}

/// Probe the OpenAI-compatible `/v1/chat/completions` endpoint with a minimal
/// request. Confirms the gateway is reachable, the key works, and text
/// generation actually produces output. Uses `model` (a model the gateway
/// actually serves, from the /models probe) so the probe never 503s on a
/// hard-coded name the gateway doesn't have.
async fn probe_openai(
    api_url: &str,
    api_key: &str,
    model: &str,
) -> ProtocolProbeResult {
    let api_key = api_key.trim();
    let base = base_v1(api_url);
    let url = format!("{base}/chat/completions");
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4,
        "messages": [{ "role": "user", "content": "ping" }],
    });
    match post_json(
        &url,
        &[
            ("Authorization", &format!("Bearer {api_key}")),
            ("api-key", api_key),
        ],
        &body,
    )
    .await
    {
        Ok((status, text)) if status == 200 => {
            let ok = text.contains("\"choices\"");
            if ok {
                probe_ok("openai", format!("HTTP 200, chat completions reachable ({url})"))
            } else {
                probe_fail("openai", format!("HTTP 200 but unexpected body: {}", text.chars().take(200).collect::<String>()))
            }
        }
        Ok((status, text)) => {
            let snippet = text.chars().take(200).collect::<String>();
            probe_fail("openai", format!("HTTP {status}: {snippet}"))
        }
        Err(e) => probe_fail("openai", e),
    }
}

/// Probe the Anthropic-compatible `/v1/messages` endpoint WITH tools. This is
/// the exact shape Claude Code sends, so it surfaces the
/// "Anthropic tools not converted" gateway defect (Tools[0].Type invalid).
async fn probe_anthropic(
    api_url: &str,
    api_key: &str,
    model: &str,
) -> ProtocolProbeResult {
    let api_key = api_key.trim();
    let base = base_v1(api_url);
    let url = format!("{base}/messages");
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 4,
        "messages": [{ "role": "user", "content": "ping" }],
        "tools": [{
            "name": "ping",
            "description": "ping tool",
            "input_schema": { "type": "object", "properties": {} }
        }],
    });
    match post_json(
        &url,
        &[
            ("x-api-key", api_key),
            ("api-key", api_key),
            ("anthropic-version", "2023-06-01"),
            ("Authorization", &format!("Bearer {api_key}")),
        ],
        &body,
    )
    .await
    {
        Ok((status, _text)) if status == 200 => {
            probe_ok("anthropic", format!("HTTP 200, Anthropic messages reachable ({url})"))
        }
        Ok((status, text)) => {
            let snippet = text.chars().take(200).collect::<String>();
            probe_fail("anthropic", format!("HTTP {status}: {snippet}"))
        }
        Err(e) => probe_fail("anthropic", e),
    }
}

/// Probe the `/models` listing endpoint (reuses the existing model-fetch logic).
async fn probe_models(
    api_url: &str,
    api_key: &str,
) -> ProtocolProbeResult {
    match fetch_openai_compatible_models(api_url, api_key).await {
        Ok(models) => {
            probe_ok("models", format!("listed {} model(s)", models.len()))
        }
        Err(e) => probe_fail("models", e.to_string()),
    }
}

/// Run the full connectivity test for a model provider: OpenAI chat, Anthropic
/// messages (with tools), and the models list. Every probe is independent so a
/// failure in one protocol does not hide the others. The chat probes use the
/// first model the gateway actually serves (from the /models probe) so they
/// never 503 on a hard-coded model name the gateway lacks.
pub async fn test_model_provider_core(
    db: &AppDatabase,
    id: i32,
) -> Result<ModelProviderTestResult, AppCommandError> {
    let provider = get_model_provider_core(db, id).await?;
    let api_url = provider.api_url.clone();
    let api_key = provider.api_key.clone();

    // First: list models. This both probes the /models endpoint and gives us
    // model ids to drive the chat probes with.
    let models_probe = probe_models(&api_url, &api_key).await;
    let models = if models_probe.ok {
        fetch_openai_compatible_models(&api_url, &api_key)
            .await
            .ok()
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut probes = Vec::new();
    if models.is_empty() {
        probes.push(probe_fail(
            "openai",
            "skipped (no model id available from /models)".to_string(),
        ));
        probes.push(probe_fail(
            "anthropic",
            "skipped (no model id available from /models)".to_string(),
        ));
    } else {
        // Try each model from the list until one succeeds. The user's API key
        // may not have permission for every model the gateway lists (e.g. the
        // first model in the list might be one the key can't use), so we crawl
        // the list rather than blindly using the first entry.
        let mut openai_probe: Option<ProtocolProbeResult> = None;
        let mut anthropic_probe: Option<ProtocolProbeResult> = None;
        let mut last_error: Option<String> = None;
        for m in &models {
            if openai_probe.as_ref().map_or(false, |p| !p.ok) || openai_probe.is_none() {
                let r = probe_openai(&api_url, &api_key, &m.id).await;
                if r.ok || openai_probe.is_none() {
                    openai_probe = Some(r);
                }
            }
            if anthropic_probe.as_ref().map_or(false, |p| !p.ok) || anthropic_probe.is_none() {
                let r = probe_anthropic(&api_url, &api_key, &m.id).await;
                if r.ok || anthropic_probe.is_none() {
                    anthropic_probe = Some(r);
                }
            }
            if openai_probe.as_ref().map_or(false, |p| p.ok)
                && anthropic_probe.as_ref().map_or(false, |p| p.ok)
            {
                break;
            }
            last_error = Some(format!("tried model '{}': both probes failed", m.id));
        }
        probes.push(openai_probe.unwrap_or_else(|| {
            probe_fail("openai", last_error.clone().unwrap_or_else(|| "no model responded successfully".to_string()))
        }));
        probes.push(anthropic_probe.unwrap_or_else(|| {
            probe_fail("anthropic", last_error.unwrap_or_else(|| "no model responded successfully".to_string()))
        }));
    }
    probes.push(models_probe);

    let ok = probes.iter().all(|p| p.ok);
    Ok(ModelProviderTestResult { ok, probes })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn list_model_providers(
    db: tauri::State<'_, AppDatabase>,
) -> Result<Vec<ModelProviderInfo>, AppCommandError> {
    list_model_providers_core(&db).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn create_model_provider(
    db: tauri::State<'_, AppDatabase>,
    name: String,
    api_url: String,
    api_key: String,
) -> Result<ModelProviderInfo, AppCommandError> {
    create_model_provider_core(&db, name, api_url, api_key).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn update_model_provider(
    db: tauri::State<'_, AppDatabase>,
    manager: tauri::State<'_, ConnectionManager>,
    id: i32,
    name: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    app: tauri::AppHandle,
) -> Result<UpdateModelProviderResult, AppCommandError> {
    use tauri::Manager;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let emitter = EventEmitter::Tauri(app);
    update_model_provider_and_refresh(
        &db, &manager, &app_data_dir, id, name, api_url, api_key, &emitter,
    )
    .await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn delete_model_provider(
    db: tauri::State<'_, AppDatabase>,
    id: i32,
) -> Result<(), AppCommandError> {
    delete_model_provider_core(&db, id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn fetch_provider_models(
    db: tauri::State<'_, AppDatabase>,
    id: i32,
) -> Result<Vec<ProviderModelItem>, AppCommandError> {
    fetch_provider_models_core(&db, id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn test_model_provider(
    db: tauri::State<'_, AppDatabase>,
    id: i32,
) -> Result<ModelProviderTestResult, AppCommandError> {
    test_model_provider_core(&db, id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::fresh_in_memory_db;

    #[test]
    fn models_url_candidates_cover_common_user_inputs() {
        assert_eq!(
            provider_models_url_candidates("https://api.openai.com/v1"),
            vec!["https://api.openai.com/v1/models".to_string()]
        );
        assert_eq!(
            provider_models_url_candidates("https://api.openai.com/v1/"),
            vec!["https://api.openai.com/v1/models".to_string()]
        );
        assert_eq!(
            provider_models_url_candidates("https://api.openai.com"),
            vec![
                "https://api.openai.com/models".to_string(),
                "https://api.openai.com/v1/models".to_string(),
            ]
        );
        assert_eq!(
            provider_models_url_candidates("https://api.openai.com/v1/models"),
            vec!["https://api.openai.com/v1/models".to_string()]
        );
        assert_eq!(
            provider_models_url_candidates(
                "https://gateway.example.com/v1/chat/completions"
            ),
            vec![
                "https://gateway.example.com/models".to_string(),
                "https://gateway.example.com/v1/models".to_string(),
            ]
        );
        assert_eq!(
            provider_models_url_candidates(
                "https://gateway.example.com/v1/images/generations"
            ),
            vec![
                "https://gateway.example.com/models".to_string(),
                "https://gateway.example.com/v1/models".to_string(),
            ]
        );
    }

    #[test]
    fn parse_provider_models_body_accepts_common_shapes() {
        let openai = r#"{"object":"list","data":[{"id":"gpt-5"},{"id":"gpt-5-mini"}]}"#;
        let models = parse_provider_models_body(openai).expect("openai shape");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-5");

        let alt = r#"{"models":["a","b"]}"#;
        let models = parse_provider_models_body(alt).expect("models array");
        assert_eq!(models.len(), 2);
        assert_eq!(models[1].id, "b");

        let nested = r#"{"data":{"models":[{"model_name":"flux-pro"},{"id":"dall-e-3"}]}}"#;
        let models = parse_provider_models_body(nested).expect("nested models");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "flux-pro");

        let err = parse_provider_models_body(
            r#"{"error":{"message":"Invalid token","type":"new_api_error"}}"#,
        );
        assert!(err.unwrap_err().contains("Invalid token"));

        let empty = parse_provider_models_body(r#"{"object":"list","data":[]}"#)
            .expect("empty list is ok parse");
        assert!(empty.is_empty());
    }

    #[tokio::test]
    async fn create_and_list_tolerate_multibyte_api_key() {
        let db = fresh_in_memory_db().await;
        let created = create_model_provider_core(
            &db,
            "Provider".into(),
            "https://api.example.com".into(),
            "sk-密钥abcd1234".into(),
        )
        .await;
        assert!(created.is_ok());
        let rows = list_model_providers_core(&db).await.expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].api_key, "sk-密钥abcd1234");
        assert!(!rows[0].api_key_masked.is_empty());
    }

    #[tokio::test]
    async fn provider_credential_change_shifts_bound_agent_fingerprint() {
        use crate::db::entities::agent_setting;
        use crate::models::agent::AgentType;
        use sea_orm::{ActiveModelTrait, NotSet, Set};

        let db = fresh_in_memory_db().await;
        let data_dir = std::env::temp_dir();

        let provider = create_model_provider_core(
            &db, "Prov".into(), "https://api.example.com".into(), "sk-old-key".into(),
        )
        .await
        .expect("create");

        let now = chrono::Utc::now();
        agent_setting::ActiveModel {
            id: NotSet,
            agent_type: Set(serde_json::to_string(&AgentType::Codex).unwrap()),
            registry_id: Set("codex".into()),
            enabled: Set(true),
            sort_order: Set(0),
            installed_version: Set(None),
            env_json: Set(Some("{}".into())),
            model_provider_id: Set(Some(provider.id)),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&db.conn)
        .await
        .expect("insert");

        let fp_before = acp::compute_session_config_fingerprint(&db, AgentType::Codex, &data_dir)
            .await
            .expect("fp before");

        model_provider_service::update(
            &db.conn, provider.id, None, None, Some("sk-new-key".into()),
        )
        .await
        .expect("update key");

        let fp_after = acp::compute_session_config_fingerprint(&db, AgentType::Codex, &data_dir)
            .await
            .expect("fp after");
        assert_ne!(fp_before, fp_after);

        model_provider_service::update(
            &db.conn, provider.id, Some("Renamed".into()), None, None,
        )
        .await
        .expect("rename");

        let fp_rename = acp::compute_session_config_fingerprint(&db, AgentType::Codex, &data_dir)
            .await
            .expect("fp rename");
        assert_eq!(fp_after, fp_rename);
    }
}