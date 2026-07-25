//! Platform image-generation runtime + OpenAI-compatible API client.
//!
//! Mirrors [`crate::acp::vision_bridge`]: a hot-swappable enable flag for MCP
//! injection, plus a DB-backed service that posts to
//! `{base}/v1/images/generations` (and best-effort `/v1/images/edits`).

use std::sync::Arc;
use tokio::sync::RwLock;

/// Snapshot used at companion MCP injection time.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ImageGenerationRuntimeState {
    /// Whether platform image generation is enabled.
    pub enabled: bool,
}

/// Shared, hot-swappable handle to [`ImageGenerationRuntimeState`].
#[derive(Clone, Default)]
pub struct ImageGenerationRuntimeConfig {
    inner: Arc<RwLock<ImageGenerationRuntimeState>>,
}

impl ImageGenerationRuntimeConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn snapshot(&self) -> ImageGenerationRuntimeState {
        self.inner.read().await.clone()
    }

    pub async fn set(&self, state: ImageGenerationRuntimeState) {
        *self.inner.write().await = state;
    }

    pub async fn is_enabled(&self) -> bool {
        self.inner.read().await.enabled
    }
}

/// Trait for the listener to generate / modify images.
#[async_trait::async_trait]
pub trait ImageGenerationAccess: Send + Sync {
    /// Text-to-image. Returns `{ base64, mime, path }` or `{ error }`.
    async fn generate(
        &self,
        prompt: String,
        model: Option<String>,
        size: Option<String>,
        aspect_ratio: Option<String>,
        ref_urls: Option<Vec<String>>,
    ) -> serde_json::Value;

    /// Image-to-image / edit. Returns the same shape as [`Self::generate`].
    async fn modify(
        &self,
        prompt: String,
        model: Option<String>,
        ref_urls: Option<Vec<String>>,
    ) -> serde_json::Value;
}

/// Concrete implementation backed by DB config + reqwest.
pub struct ImageGenerationService {
    db: crate::db::AppDatabase,
    client: reqwest::Client,
}

impl ImageGenerationService {
    pub fn new(db: crate::db::AppDatabase) -> Self {
        Self {
            db,
            client: reqwest::Client::builder()
                // Image gateways often need 30–90s; keep headroom for slow CDN.
                .timeout(std::time::Duration::from_secs(300))
                .connect_timeout(std::time::Duration::from_secs(30))
                .pool_idle_timeout(std::time::Duration::from_secs(90))
                .user_agent("VeryAgent-ImageGen/1.0")
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }
}

#[async_trait::async_trait]
impl ImageGenerationAccess for ImageGenerationService {
    async fn generate(
        &self,
        prompt: String,
        model: Option<String>,
        size: Option<String>,
        aspect_ratio: Option<String>,
        ref_urls: Option<Vec<String>>,
    ) -> serde_json::Value {
        use crate::db::service::image_generation_service::{
            config_for_gateway, get_config, usable_gateways,
        };

        let config = get_config(&self.db.conn).await;
        if let Some(err) = validate_config(&config) {
            return serde_json::json!({ "error": err });
        }
        if prompt.trim().is_empty() {
            return serde_json::json!({ "error": "prompt is required" });
        }

        // Build ordered flat configs: multi-gateway first, else legacy row fields.
        let flats: Vec<_> = {
            let gws = usable_gateways(&config.gateways);
            if !gws.is_empty() {
                gws.into_iter()
                    .map(|gw| config_for_gateway(config.enabled, gw, config.updated_at))
                    .collect()
            } else {
                vec![config.clone()]
            }
        };

        let mut last_err = String::new();
        for flat in &flats {
            let model_name = resolve_model(&flat.model_name, model.as_deref());
            let size = resolve_size(
                size.as_deref(),
                aspect_ratio.as_deref(),
                &flat.default_size,
            );

            let result = if let Some(refs) = ref_urls.as_ref().filter(|r| !r.is_empty()) {
                self.call_edits(flat, &model_name, &prompt, refs, Some(&size))
                    .await
            } else {
                self.call_generations(flat, &model_name, &prompt, &size)
                    .await
            };

            if result.get("error").is_none() {
                return result;
            }
            last_err = result
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error")
                .to_string();
            tracing::warn!(
                api_url = %flat.api_url,
                model = %flat.model_name,
                "image gateway failed, trying next by priority: {last_err}"
            );
        }

        serde_json::json!({
            "error": format!(
                "All image gateways failed. Last error: {}",
                truncate_error(&last_err, 500)
            )
        })
    }

    async fn modify(
        &self,
        prompt: String,
        model: Option<String>,
        ref_urls: Option<Vec<String>>,
    ) -> serde_json::Value {
        use crate::db::service::image_generation_service::{
            config_for_gateway, get_config, usable_gateways,
        };

        let config = get_config(&self.db.conn).await;
        if let Some(err) = validate_config(&config) {
            return serde_json::json!({ "error": err });
        }
        if prompt.trim().is_empty() {
            return serde_json::json!({ "error": "prompt is required" });
        }

        let Some(refs) = ref_urls.filter(|r| !r.is_empty()) else {
            return serde_json::json!({
                "error": "modify_image requires at least one reference image (ref_urls)"
            });
        };

        let flats: Vec<_> = {
            let gws = usable_gateways(&config.gateways);
            if !gws.is_empty() {
                gws.into_iter()
                    .map(|gw| config_for_gateway(config.enabled, gw, config.updated_at))
                    .collect()
            } else {
                vec![config.clone()]
            }
        };

        let mut last_err = String::new();
        for flat in &flats {
            let model_name = resolve_model(&flat.model_name, model.as_deref());
            let result = self
                .call_edits(
                    flat,
                    &model_name,
                    &prompt,
                    &refs,
                    Some(&flat.default_size),
                )
                .await;
            if result.get("error").is_none() {
                return result;
            }
            last_err = result
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error")
                .to_string();
            tracing::warn!(
                api_url = %flat.api_url,
                model = %flat.model_name,
                "image edit gateway failed, trying next: {last_err}"
            );
        }

        serde_json::json!({
            "error": format!(
                "All image gateways failed. Last error: {}",
                truncate_error(&last_err, 500)
            )
        })
    }
}

impl ImageGenerationService {
    async fn call_generations(
        &self,
        config: &crate::db::service::image_generation_service::ImageGenerationConfig,
        model: &str,
        prompt: &str,
        size: &str,
    ) -> serde_json::Value {
        let api_url = ensure_v1_suffix(&config.api_url);
        let full_url = format!("{}/images/generations", api_url.trim_end_matches('/'));

        let body = serde_json::json!({
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": size,
            "response_format": "b64_json",
        });
        let fallback_body = serde_json::json!({
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": size,
        });

        // Transient transport errors (TLS reset, brief network blip) are common
        // on long image calls; retry a couple of times before failing the tool.
        let mut last_err = None;
        for attempt in 1..=3 {
            let result = self
                .client
                .post(&full_url)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", config.api_key))
                .json(&body)
                .send()
                .await;

            match result {
                Ok(resp) => {
                    let parsed = parse_images_response(resp, model).await;
                    if is_unsupported_response_format_error(&parsed) {
                        tracing::info!(
                            url = %full_url,
                            model = %model,
                            "image gateway rejected response_format; retrying without it"
                        );
                        let retry = self
                            .client
                            .post(&full_url)
                            .header("Content-Type", "application/json")
                            .header("Authorization", format!("Bearer {}", config.api_key))
                            .json(&fallback_body)
                            .send()
                            .await;
                        return match retry {
                            Ok(resp) => parse_images_response(resp, model).await,
                            Err(e) => serde_json::json!({
                                "error": format!(
                                    "Image generation API retry without response_format failed: {}",
                                    truncate_error(&e.to_string(), 500)
                                )
                            }),
                        };
                    }
                    return parsed;
                }
                Err(e) => {
                    let msg = e.to_string();
                    tracing::warn!(
                        attempt,
                        url = %full_url,
                        model = %model,
                        "image generations request failed: {msg}"
                    );
                    last_err = Some(msg);
                    if attempt < 3 {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            400 * attempt as u64,
                        ))
                        .await;
                    }
                }
            }
        }

        serde_json::json!({
            "error": format!(
                "Image generation API call failed after retries: {}",
                truncate_error(&last_err.unwrap_or_else(|| "unknown transport error".into()), 500)
            )
        })
    }

    async fn call_edits(
        &self,
        config: &crate::db::service::image_generation_service::ImageGenerationConfig,
        model: &str,
        prompt: &str,
        ref_urls: &[String],
        size: Option<&str>,
    ) -> serde_json::Value {
        let first = match ref_urls.first() {
            Some(u) => u.as_str(),
            None => {
                return serde_json::json!({ "error": "no reference image URL provided" });
            }
        };

        let (bytes, mime) = match download_image_bytes(&self.client, first).await {
            Ok(v) => v,
            Err(e) => {
                return serde_json::json!({ "error": format!("failed to download reference image: {e}") });
            }
        };

        let api_url = ensure_v1_suffix(&config.api_url);
        let full_url = format!("{}/images/edits", api_url.trim_end_matches('/'));

        let filename = if mime.contains("png") {
            "image.png"
        } else if mime.contains("jpeg") || mime.contains("jpg") {
            "image.jpg"
        } else if mime.contains("webp") {
            "image.webp"
        } else {
            "image.bin"
        };

        let part = match reqwest::multipart::Part::bytes(bytes)
            .file_name(filename.to_string())
            .mime_str(&mime)
        {
            Ok(p) => p,
            Err(e) => {
                return serde_json::json!({ "error": format!("failed to build multipart image: {e}") });
            }
        };

        let mut form = reqwest::multipart::Form::new()
            .text("model", model.to_string())
            .text("prompt", prompt.to_string())
            .text("n", "1")
            .part("image", part);

        if let Some(s) = size.filter(|s| !s.is_empty()) {
            form = form.text("size", s.to_string());
        }

        let result = self
            .client
            .post(&full_url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .multipart(form)
            .send()
            .await;

        match result {
            Ok(resp) => parse_images_response(resp, model).await,
            Err(e) => serde_json::json!({
                "error": format!("Image edit API call failed: {}", truncate_error(&e.to_string(), 500))
            }),
        }
    }
}

fn validate_config(
    config: &crate::db::service::image_generation_service::ImageGenerationConfig,
) -> Option<String> {
    use crate::db::service::image_generation_service::usable_gateways;

    if !config.enabled {
        return Some(
            "Image generation is not enabled. Enable it in the VeryAgent Image skill settings."
                .into(),
        );
    }
    if usable_gateways(&config.gateways).is_empty() {
        // Fall back to legacy flat fields for partially migrated rows.
        if config.api_url.trim().is_empty()
            || config.api_key.trim().is_empty()
            || config.model_name.trim().is_empty()
        {
            return Some(
                "No usable image gateway. Add at least one gateway with API URL, Key, and model (priority 0 = highest)."
                    .into(),
            );
        }
    }
    None
}

/// Resolve the image model for the gateway.
///
/// Settings (`default_model`) are authoritative. Agents often pass their *chat*
/// model (e.g. `deepseek-v4-pro`, `step-3.7-flash`) into `generate_image`, which
/// the image gateway rejects (`model_not_found`). Only honor an override when it
/// looks like a real image model; otherwise fall back to settings.
fn resolve_model(default_model: &str, requested: Option<&str>) -> String {
    match requested.map(str::trim).filter(|s| !s.is_empty()) {
        Some(m) if is_usable_image_model(m) => m.to_string(),
        Some(m) => {
            tracing::info!(
                requested = %m,
                default = %default_model,
                "ignoring non-image model override on generate_image; using settings model"
            );
            default_model.to_string()
        }
        None => default_model.to_string(),
    }
}

fn is_legacy_model_alias(model: &str) -> bool {
    matches!(
        model.to_ascii_lowercase().as_str(),
        "gemini" | "doubao" | "gemini-image" | "doubao-image"
    )
}

/// True only for values that are safe to send to an OpenAI-compatible images API.
fn is_usable_image_model(model: &str) -> bool {
    let m = model.to_ascii_lowercase();
    if is_legacy_model_alias(&m) {
        return false;
    }
    // Explicit image / vision-gen family names.
    if m.contains("image")
        || m.contains("dall-e")
        || m.contains("dalle")
        || m.contains("flux")
        || m.contains("midjourney")
        || m.contains("stable-diffusion")
        || m.contains("sdxl")
        || m.contains("imagen")
        || m.contains("kolors")
        || m.contains("seedream")
    {
        return true;
    }
    // Everything else (chat models, provider ids, etc.) → reject override.
    false
}

/// Map tool-facing size / aspect_ratio into OpenAI `size` values.
fn resolve_size(
    image_size: Option<&str>,
    aspect_ratio: Option<&str>,
    default_size: &str,
) -> String {
    if let Some(raw) = image_size.map(str::trim).filter(|s| !s.is_empty()) {
        if raw.contains('x') || raw.contains('X') {
            return raw.to_ascii_lowercase();
        }
        // Legacy "1K" / "2K" / "4K" labels → square defaults.
        return match raw.to_ascii_uppercase().as_str() {
            "1K" => "1024x1024".to_string(),
            "2K" => "1024x1024".to_string(),
            "4K" => "1792x1024".to_string(),
            _ => raw.to_string(),
        };
    }

    if let Some(ar) = aspect_ratio.map(str::trim).filter(|s| !s.is_empty()) {
        return match ar {
            "1:1" => "1024x1024".to_string(),
            "16:9" | "3:2" => "1792x1024".to_string(),
            "9:16" | "2:3" => "1024x1792".to_string(),
            "4:3" => "1024x1024".to_string(),
            "3:4" => "1024x1792".to_string(),
            _ => default_size.to_string(),
        };
    }

    if default_size.trim().is_empty() {
        "1024x1024".to_string()
    } else {
        default_size.to_string()
    }
}

fn ensure_v1_suffix(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{}/v1", trimmed)
    }
}

async fn parse_images_response(resp: reqwest::Response, model: &str) -> serde_json::Value {
    let status = resp.status();
    if !status.is_success() {
        let status_code = status.as_u16();
        let error_body = resp.text().await.unwrap_or_else(|_| "(no body)".to_string());
        return serde_json::json!({
            "error": format!(
                "Image API returned HTTP {}: {}",
                status_code,
                truncate_error(&error_body, 500)
            )
        });
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return serde_json::json!({
                "error": format!("Failed to parse image API response: {e}")
            });
        }
    };

    let item = body
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|arr| arr.first());

    let Some(item) = item else {
        return serde_json::json!({
            "error": format!(
                "Image API returned no data: {}",
                truncate_error(&body.to_string(), 400)
            )
        });
    };

    if let Some(b64) = item.get("b64_json").and_then(|v| v.as_str()) {
        return persist_base64_image(b64, "image/png", model);
    }

    if let Some(url) = item.get("url").and_then(|v| v.as_str()) {
        match download_image_bytes_simple(url).await {
            Ok((bytes, mime)) => {
                let b64 =
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
                return persist_decoded_image(&b64, &bytes, &mime, model);
            }
            Err(e) => {
                return serde_json::json!({
                    "error": format!("Image API returned URL but download failed: {e}"),
                    "url": url,
                });
            }
        }
    }

    serde_json::json!({
        "error": format!(
            "Image API data item has neither b64_json nor url: {}",
            truncate_error(&item.to_string(), 400)
        )
    })
}

fn is_unsupported_response_format_error(value: &serde_json::Value) -> bool {
    let Some(error) = value.get("error").and_then(|v| v.as_str()) else {
        return false;
    };
    let lower = error.to_ascii_lowercase();
    lower.contains("response_format")
        && (lower.contains("not support")
            || lower.contains("unsupported")
            || lower.contains("unrecognized")
            || lower.contains("unknown parameter")
            || lower.contains("invalid parameter"))
}

fn persist_base64_image(b64: &str, mime: &str, model: &str) -> serde_json::Value {
    let (mime, b64_clean) = strip_data_url(b64, mime);
    let data = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &b64_clean,
    ) {
        Ok(d) => d,
        Err(e) => {
            return serde_json::json!({ "error": format!("base64 decode failed: {e}") });
        }
    };
    persist_decoded_image(&b64_clean, &data, &mime, model)
}

fn persist_decoded_image(b64: &str, data: &[u8], mime: &str, model: &str) -> serde_json::Value {
    let ext = if mime.contains("png") {
        "png"
    } else if mime.contains("jpeg") || mime.contains("jpg") {
        "jpg"
    } else if mime.contains("webp") {
        "webp"
    } else {
        "bin"
    };
    let dir = std::env::temp_dir().join("veryagent-images");
    let _ = std::fs::create_dir_all(&dir);
    let filename = format!(
        "{}_{}.{}",
        model.replace(|c: char| !c.is_ascii_alphanumeric(), "_"),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        ext
    );
    let path = dir.join(&filename);
    if let Err(e) = std::fs::write(&path, data) {
        return serde_json::json!({ "error": format!("failed to save image: {e}") });
    }
    serde_json::json!({
        "base64": b64,
        "mime": mime,
        "path": path.to_string_lossy(),
    })
}

fn strip_data_url(b64: &str, default_mime: &str) -> (String, String) {
    if let Some(comma_pos) = b64.find(',') {
        if b64[..comma_pos].contains("data:") {
            let header = &b64[..comma_pos];
            let mime = header
                .strip_prefix("data:")
                .and_then(|h| h.split(';').next())
                .unwrap_or(default_mime);
            return (mime.to_string(), b64[comma_pos + 1..].to_string());
        }
    }
    (default_mime.to_string(), b64.to_string())
}

async fn download_image_bytes(
    client: &reqwest::Client,
    url: &str,
) -> Result<(Vec<u8>, String), String> {
    // data: URLs
    if let Some(rest) = url.strip_prefix("data:") {
        let (header, data) = rest
            .split_once(',')
            .ok_or_else(|| "invalid data URL".to_string())?;
        let mime = header
            .split(';')
            .next()
            .unwrap_or("image/png")
            .to_string();
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
            .map_err(|e| format!("data URL base64 decode failed: {e}"))?;
        return Ok((bytes, mime));
    }

    // file:// or bare path
    if let Some(path) = url.strip_prefix("file://") {
        let bytes = tokio::fs::read(path)
            .await
            .map_err(|e| format!("cannot read file {path}: {e}"))?;
        return Ok((bytes, infer_mime_from_path(path)));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        let bytes = tokio::fs::read(url)
            .await
            .map_err(|e| format!("cannot read file {url}: {e}"))?;
        return Ok((bytes, infer_mime_from_path(url)));
    }

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download HTTP {}", resp.status().as_u16()));
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).to_string())
        .unwrap_or_else(|| "image/png".to_string());
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read body failed: {e}"))?
        .to_vec();
    if bytes.len() > 20 * 1024 * 1024 {
        return Err(format!("image too large: {} bytes", bytes.len()));
    }
    Ok((bytes, mime))
}

async fn download_image_bytes_simple(url: &str) -> Result<(Vec<u8>, String), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    download_image_bytes(&client, url).await
}

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
    } else {
        "image/png"
    }
    .to_string()
}

fn truncate_error(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        let boundary = s
            .char_indices()
            .take_while(|(i, _)| *i <= max_len)
            .last()
            .map(|(i, _)| i)
            .unwrap_or(0);
        format!("{}…", &s[..boundary])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_model_ignores_legacy_aliases() {
        assert_eq!(
            resolve_model("gpt-image-2", Some("gemini")),
            "gpt-image-2"
        );
        assert_eq!(resolve_model("gpt-image-2", None), "gpt-image-2");
    }

    #[test]
    fn resolve_model_ignores_chat_models() {
        // Agents often pass the conversation model by mistake.
        assert_eq!(
            resolve_model("gpt-image-2", Some("deepseek-v4-pro")),
            "gpt-image-2"
        );
        assert_eq!(
            resolve_model("gpt-image-2", Some("step-3.7-flash")),
            "gpt-image-2"
        );
        assert_eq!(
            resolve_model("gpt-image-2", Some("gpt-4o")),
            "gpt-image-2"
        );
    }

    #[test]
    fn resolve_model_accepts_image_family_overrides() {
        assert_eq!(
            resolve_model("gpt-image-2", Some("dall-e-3")),
            "dall-e-3"
        );
        assert_eq!(
            resolve_model("gpt-image-2", Some("flux-pro")),
            "flux-pro"
        );
        assert_eq!(
            resolve_model("gpt-image-2", Some("my-custom-image-v2")),
            "my-custom-image-v2"
        );
    }

    #[test]
    fn resolve_size_maps_aspect_and_legacy() {
        assert_eq!(
            resolve_size(Some("2K"), None, "1024x1024"),
            "1024x1024"
        );
        assert_eq!(
            resolve_size(None, Some("16:9"), "1024x1024"),
            "1792x1024"
        );
        assert_eq!(
            resolve_size(Some("512x512"), Some("16:9"), "1024x1024"),
            "512x512"
        );
    }

    #[test]
    fn ensure_v1_suffix_idempotent() {
        assert_eq!(ensure_v1_suffix("https://x.com"), "https://x.com/v1");
        assert_eq!(ensure_v1_suffix("https://x.com/v1"), "https://x.com/v1");
        assert_eq!(ensure_v1_suffix("https://x.com/v1/"), "https://x.com/v1");
    }
}
