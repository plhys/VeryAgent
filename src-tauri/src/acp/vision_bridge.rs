//! Vision bridge runtime configuration.
//!
//! Mirrors the [`crate::acp::feedback::FeedbackRuntimeConfig`] pattern: a
//! hot-swappable handle that `DelegationInjection` reads at MCP injection time
//! to decide whether to expose the `vision_analyze` tool to an agent. The
//! inner config also carries the agent-types filter so injection can be
//! scoped per agent.

use std::sync::Arc;
use tokio::sync::RwLock;

/// The persisted vision bridge configuration snapshot.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct VisionBridgeRuntimeState {
    /// Whether the vision bridge plugin is enabled at all.
    pub enabled: bool,
    /// Which agent_type strings should receive the `vision_analyze` MCP tool.
    /// Empty means no agent gets it (even if `enabled` is true).
    pub agent_types: Vec<String>,
}

/// Shared, hot-swappable handle to [`VisionBridgeRuntimeState`]. Cloned into
/// `DelegationInjection` (read at injection) and `AppState` (updated on save).
#[derive(Clone, Default)]
pub struct VisionBridgeRuntimeConfig {
    inner: Arc<RwLock<VisionBridgeRuntimeState>>,
}

impl VisionBridgeRuntimeConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn snapshot(&self) -> VisionBridgeRuntimeState {
        self.inner.read().await.clone()
    }

    pub async fn set(&self, state: VisionBridgeRuntimeState) {
        *self.inner.write().await = state;
    }

    /// Convenience read used at MCP injection time.
    pub async fn is_enabled(&self) -> bool {
        self.inner.read().await.enabled
    }

    /// Whether a specific agent type should receive the vision_analyze tool.
    pub async fn is_enabled_for_agent(&self, agent_type: &str) -> bool {
        let state = self.inner.read().await;
        state.enabled && state.agent_types.iter().any(|t| t == agent_type)
    }
}

/// Trait for the listener to call the vision model API. The implementation
/// holds a DB connection (to read vision_bridge config) and uses reqwest
/// to make the HTTP call.
#[async_trait::async_trait]
pub trait VisionBridgeAccess: Send + Sync {
    /// Call the configured vision model with the provided image and prompt.
    /// Returns a JSON value: `{ "description": "..." }` on success, or
    /// `{ "error": "..." }` on failure.
    async fn analyze(
        &self,
        image_data: Option<String>,
        image_path: Option<String>,
        mime_type: Option<String>,
        prompt: String,
    ) -> serde_json::Value;
}

/// Concrete implementation backed by the DB + a reused reqwest HTTP client.
pub struct VisionBridgeService {
    db: crate::db::AppDatabase,
    client: reqwest::Client,
}

impl VisionBridgeService {
    pub fn new(db: crate::db::AppDatabase) -> Self {
        Self {
            db,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }
}

#[async_trait::async_trait]
impl VisionBridgeAccess for VisionBridgeService {
    async fn analyze(
        &self,
        image_data: Option<String>,
        image_path: Option<String>,
        mime_type: Option<String>,
        prompt: String,
    ) -> serde_json::Value {
        use crate::db::service::vision_bridge_service::get_config;

        // 1. Read vision bridge config from DB.
        let config = get_config(&self.db.conn).await;
        if !config.enabled {
            return serde_json::json!({ "error": "Vision bridge is not enabled" });
        }
        if config.api_url.is_empty() || config.api_key.is_empty() || config.model_name.is_empty() {
            return serde_json::json!({ "error": "Vision bridge configuration is incomplete (api_url, api_key, or model_name is empty)" });
        }

        // 2. Resolve the image bytes.
        let (final_data, final_mime) = match resolve_image(image_data, image_path, mime_type).await {
            Ok(d) => d,
            Err(e) => return serde_json::json!({ "error": e }),
        };

        // 3. Build the OpenAI chat/completions request with vision content.
        let data_uri = format!("data:{};base64,{}", final_mime, final_data);
        let body = serde_json::json!({
            "model": config.model_name,
            "messages": [{
                "role": "user",
                "content": [
                    { "type": "text", "text": prompt },
                    { "type": "image_url", "image_url": { "url": data_uri } }
                ]
            }],
            "max_tokens": 2048
        });

        // 4. Ensure api_url has /v1 suffix for chat/completions path.
        let api_url = ensure_v1_suffix(&config.api_url);
        let full_url = format!("{}/chat/completions", api_url.trim_end_matches('/'));

        // 5. Make the HTTP call (using the reused client).
        let result = self.client
            .post(&full_url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&body)
            .send()
            .await;

        match result {
            Ok(resp) => {
                let status = resp.status();
                if !status.is_success() {
                    let status_code = status.as_u16();
                    let error_body = resp.text().await.unwrap_or_else(|_| "(no body)".to_string());
                    return serde_json::json!({
                        "error": format!("Vision model API returned HTTP {}: {}", status_code, truncate_error(&error_body, 500))
                    });
                }
                let resp_body: serde_json::Value = resp
                    .json()
                    .await
                    .unwrap_or_else(|_| serde_json::json!({ "error": "Failed to parse vision model response" }));

                // Extract the assistant text from choices[0].message.content
                let description = resp_body
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("message"))
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("(vision model returned no text content)");

                serde_json::json!({ "description": description })
            }
            Err(e) => serde_json::json!({
                "error": format!("Vision model API call failed: {}", truncate_error(&e.to_string(), 500))
            }),
        }
    }
}

/// Maximum image size allowed (10 MB). Images larger than this are rejected
/// to avoid OOM and excessive API payloads.
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

/// Read image bytes from either base64 data or a file path.
/// Returns (base64_data, mime_type).
/// Uses `tokio::fs::read` to avoid blocking the async runtime on disk I/O.
async fn resolve_image(
    image_data: Option<String>,
    image_path: Option<String>,
    mime_type: Option<String>,
) -> Result<(String, String), String> {
    if let Some(data) = image_data {
        // Validate decoded size for base64 input.
        let decoded_len = data.len() * 3 / 4; // approximate decoded length
        if decoded_len > MAX_IMAGE_BYTES {
            return Err(format!(
                "Image data too large: approximately {} bytes (limit: {} bytes)",
                decoded_len, MAX_IMAGE_BYTES
            ));
        }
        let mime = mime_type.unwrap_or_else(|| "image/png".to_string());
        Ok((data, mime))
    } else if let Some(path) = image_path {
        // Read the file asynchronously to avoid blocking the tokio runtime.
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("Cannot read image file {}: {}", path, e))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(format!(
                "Image file too large: {} bytes (limit: {} bytes)",
                bytes.len(), MAX_IMAGE_BYTES
            ));
        }
        let data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
        // Infer MIME type from extension.
        let mime = mime_type.unwrap_or_else(|| infer_mime_from_path(&path));
        Ok((data, mime))
    } else {
        Err("Either image_data or image_path must be provided".to_string())
    }
}

/// Infer MIME type from a file extension.
fn infer_mime_from_path(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "image/png" // default fallback
    }
    .to_string()
}

/// Ensure a URL ends with /v1 (matching the Hermes cascade pattern).
fn ensure_v1_suffix(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{}/v1", trimmed)
    }
}

/// Truncate an error string to `max_len` characters for wire compactness.
/// Uses char-boundary-safe truncation to avoid panicking on multi-byte UTF-8.
fn truncate_error(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        // Find the nearest char boundary ≤ max_len to avoid slicing mid-byte.
        let boundary = s.char_indices()
            .take_while(|(i, _)| *i <= max_len)
            .last()
            .map(|(i, _)| i)
            .unwrap_or(0);
        format!("{}…", &s[..boundary])
    }
}
