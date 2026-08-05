//! Local HTTP proxy that transforms `developer` role to `system` role in
//! OpenAI-compatible API requests before forwarding to the real provider.
//!
//! Some agents (Codex, etc.) send messages with `role: "developer"` (the
//! newer Responses API convention), but many third-party model providers
//! only recognize `role: "system"`. This proxy sits between the agent and
//! the provider, rewriting the role before forwarding.
//!
//! # Lifecycle
//!
//! Call [`start_proxy`] to bind a listener on a random loopback port and
//! spawn the axum server. The returned `ShutdownGuard` keeps the proxy
//! alive; dropping it shuts down the server gracefully.
//!
//! The proxy is transparent to the user — veryagent sets the agent's
//! `OPENAI_BASE_URL` to point to the proxy instead of the real provider.

use std::sync::Arc;

use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use reqwest::Client;
use serde_json::Value;
use tokio::sync::oneshot;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Start a local HTTP proxy on a random loopback port.
///
/// `upstream_base` is the provider's base URL (e.g. `https://api.example.com/v1`).
/// The proxy forwards `/v1/chat/completions` → `{upstream_base}/chat/completions`.
/// `model_name` is the model name to advertise via `/v1/models` (e.g. `deepseek-v4-flash`).
/// `provider_model_id` is the model name to send to the provider (e.g. `deepseek-v4-flash`).
/// When set, the proxy renames the model in the request body to this value.
///
/// Returns a `ShutdownGuard` that keeps the proxy alive. When the guard is
/// dropped, the server is gracefully shut down.
pub async fn start_proxy(
    upstream_base: &str,
    api_key: &str,
    model_name: Option<&str>,
    provider_model_id: Option<&str>,
) -> Result<ShutdownGuard, String> {
    let state = Arc::new(ProxyState {
        client: Client::new(),
        upstream_base: upstream_base.trim_end_matches('/').to_string(),
        api_key: api_key.to_string(),
        model_name: model_name.map(|s| s.to_string()),
        provider_model_id: provider_model_id.map(|s| s.to_string()),
    });

    let app = Router::new()
        .route("/v1/chat/completions", post(handle_chat_completions))
        .route("/v1/responses", post(handle_responses))
        .route("/v1/models", get(handle_models))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("failed to bind proxy port: {e}"))?;

    let port = listener.local_addr().map_err(|e| format!("failed to get proxy port: {e}"))?.port();
    let (tx, rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async { rx.await.ok(); })
            .await
            .ok();
    });

    Ok(ShutdownGuard {
        port,
        sender: Some(tx),
    })
}

/// Keeps the proxy server alive. Drop to shut down.
pub struct ShutdownGuard {
    port: u16,
    sender: Option<oneshot::Sender<()>>,
}

impl ShutdownGuard {
    /// The loopback port the proxy is listening on.
    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for ShutdownGuard {
    fn drop(&mut self) {
        if let Some(tx) = self.sender.take() {
            let _ = tx.send(());
        }
    }
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

struct ProxyState {
    client: Client,
    upstream_base: String,
    api_key: String,
    model_name: Option<String>,
    /// When set, rename the `model` field in outgoing requests to this value.
    /// Used when Codex is configured with a known model name (e.g. `gpt-4o`)
    /// but the provider expects a different model ID (e.g. `deepseek-v4-flash`).
    provider_model_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async fn handle_chat_completions(
    State(state): State<Arc<ProxyState>>,
    headers: HeaderMap,
    body: Bytes,
) -> axum::response::Response {
    let mut value: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid JSON").into_response(),
    };
    transform_chat_completions(&mut value);
    apply_model_mapping(&state, &mut value);
    forward_request(&state, "chat/completions", &headers, &value).await
}

async fn handle_responses(
    State(state): State<Arc<ProxyState>>,
    headers: HeaderMap,
    body: Bytes,
) -> axum::response::Response {
    let mut value: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid JSON").into_response(),
    };
    transform_responses(&mut value);
    apply_model_mapping(&state, &mut value);
    forward_request(&state, "responses", &headers, &value).await
}

/// Handle GET /v1/models — return the configured model so Codex can discover
/// its metadata and suppress the "Model metadata not found" warning.
async fn handle_models(
    State(state): State<Arc<ProxyState>>,
) -> axum::response::Response {
    let models = match state.model_name {
        Some(ref name) => {
            serde_json::json!({
                "object": "list",
                "data": [{
                    "id": name,
                    "object": "model",
                    "created": 0,
                    "owned_by": "veryagent"
                }]
            })
        }
        None => {
            serde_json::json!({
                "object": "list",
                "data": []
            })
        }
    };
    (StatusCode::OK, [("Content-Type", "application/json")], axum::Json(models)).into_response()
}

// ---------------------------------------------------------------------------
// Role transformation
// ---------------------------------------------------------------------------

/// Transform `developer` → `system` in the `messages` array (Chat Completions).
fn transform_chat_completions(body: &mut Value) {
    if let Some(messages) = body.get_mut("messages").and_then(|m| m.as_array_mut()) {
        for msg in messages.iter_mut() {
            if let Some(role) = msg.get("role").and_then(|r| r.as_str()) {
                if role == "developer" {
                    msg["role"] = Value::String("system".to_string());
                }
            }
        }
    }
}

/// Transform `developer` → `system` in the `input` array (Responses API).
fn transform_responses(body: &mut Value) {
    if let Some(input) = body.get_mut("input").and_then(|i| i.as_array_mut()) {
        for item in input.iter_mut() {
            if let Some(role) = item.get("role").and_then(|r| r.as_str()) {
                if role == "developer" {
                    item["role"] = Value::String("system".to_string());
                }
            }
        }
    }
}

/// Rename the `model` field in the request body to the provider's model ID,
/// if one is configured. This lets Codex use a known model name (e.g. `gpt-4o`)
/// while the provider receives the actual model ID (e.g. `deepseek-v4-flash`).
fn apply_model_mapping(state: &ProxyState, body: &mut Value) {
    if let Some(ref mapped) = state.provider_model_id {
        if let Some(model) = body.get_mut("model") {
            if model.is_string() {
                *model = Value::String(mapped.clone());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Request forwarding
// ---------------------------------------------------------------------------

/// Forward the (transformed) request to the real provider.
async fn forward_request(
    state: &ProxyState,
    path: &str,
    _headers: &HeaderMap,
    body: &Value,
) -> axum::response::Response {
    let url = format!("{}/{}", state.upstream_base, path);

    let mut req = state.client.post(&url);
    req = req.header("Authorization", format!("Bearer {}", state.api_key));
    req = req.header("Content-Type", "application/json");
    req = req.json(body);

    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            let resp_headers = resp.headers().clone();
            let body_bytes = resp.bytes().await.unwrap_or_default();

            let mut builder = axum::response::Response::builder().status(status);
            for (name, value) in resp_headers.iter() {
                let name_lower = name.as_str().to_ascii_lowercase();
                if name_lower == "content-type" || name_lower == "content-length" {
                    builder = builder.header(name.as_str(), value.as_bytes());
                }
            }
            builder
                .body(Body::from(body_bytes))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("upstream error: {e}")).into_response(),
    }
}