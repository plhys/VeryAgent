//! Image proxy — fetches an image from a URL and returns it as base64.
//!
//! Used by the gemini-image expert skill's workflow: the agent calls the
//! gemini-image API, receives an internal-network image URL, then invokes
//! `fetch_image_as_base64` to download and encode the image so it can be
//! displayed in the chat transcript or saved via `save_binary_file`.
//!
//! Also provides `write_image_to_clipboard` which decodes base64 image data
//! and writes it to the system clipboard as a PNG bitmap — the only reliable
//! way to copy images on Windows WebView2, where `navigator.clipboard.write()`
//! with `ClipboardItem` is not supported.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::header::HeaderValue;
use serde::Serialize;

use crate::app_error::AppCommandError;

/// Result of fetching an image URL and converting it to base64.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageFetchResult {
    /// MIME type detected from the response headers (e.g. `"image/png"`).
    /// Falls back to `"image/jpeg"` if the server doesn't provide one.
    pub mime_type: String,
    /// Base64-encoded image data (standard alphabet, no padding issues).
    pub base64_data: String,
    /// Suggested filename derived from the URL path or a generic fallback.
    pub filename: String,
}

/// Fetch an image from `url`, return its bytes as a base64-encoded string.
///
/// The caller (the agent skill workflow) can then:
/// 1. Use `save_binary_file` to write `base64_data` to a local file.
/// 2. Include the image in the agent's response for inline rendering.
///
/// Only `http` and `https` URLs are accepted. The maximum download size
/// is capped at 20 MiB to prevent memory exhaustion on very large images.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn fetch_image_as_base64(url: String) -> Result<ImageFetchResult, AppCommandError> {
    // Reject non-HTTP URLs early.
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppCommandError::invalid_input(
            "only http:// and https:// URLs are supported",
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppCommandError::network(format!("failed to build HTTP client: {e}")))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppCommandError::network(format!("failed to fetch image: {e}")))?;

    if !response.status().is_success() {
        return Err(AppCommandError::network(format!(
            "image server returned status {}",
            response.status()
        )));
    }

    // Extract MIME type from headers BEFORE consuming the response body.
    let mime_type = response
        .headers()
        .get("content-type")
        .and_then(|v: &HeaderValue| v.to_str().ok())
        .map(|s| {
            // Strip charset etc. — just the media type.
            s.split(';').next().unwrap_or(s).trim().to_string()
        })
        .filter(|s| s.starts_with("image/"))
        .unwrap_or_else(|| "image/jpeg".to_string());

    // Cap response body at 20 MiB.
    const MAX_SIZE: usize = 20 * 1024 * 1024;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppCommandError::network(format!("failed to read image body: {e}")))?;

    if bytes.len() > MAX_SIZE {
        return Err(AppCommandError::invalid_input(format!(
            "image too large: {} bytes (max {} bytes)",
            bytes.len(),
            MAX_SIZE
        )));
    }

    // Derive a filename from the URL path.
    let filename = extract_filename(&url, &mime_type);

    let base64_data = STANDARD.encode(bytes.as_ref());

    Ok(ImageFetchResult {
        mime_type,
        base64_data,
        filename,
    })
}

/// Extract a reasonable filename from the URL path, falling back to a
/// generic name based on the detected MIME type.
fn extract_filename(url: &str, mime_type: &str) -> String {
    // Try to get the last path segment.
    let path_segment = url
        .split('?')
        .next()
        .and_then(|u| u.rsplit('/').next())
        .filter(|s| !s.is_empty() && s.contains('.'));

    if let Some(name) = path_segment {
        return name.to_string();
    }

    // Fallback: generic name with the right extension.
    let ext = mime_type
        .strip_prefix("image/")
        .unwrap_or("jpeg");
    format!("gemini-output.{}", ext)
}

/// Write base64-encoded image data to the system clipboard as a bitmap.
///
/// This is the reliable clipboard-image path for the Windows WebView2
/// environment used by veryAgent: `navigator.clipboard.write()` with
/// `ClipboardItem` is not supported there, so the frontend invokes this
/// Tauri command instead.
///
/// The image bytes (any format the `image` crate can decode) are decoded to
/// RGBA8 pixels and written to the clipboard via `arboard`.
///
/// **Important:** the clipboard write is dispatched to the Tauri main thread
/// because Windows requires the calling thread to have a window message pump.
/// `spawn_blocking` thread-pool threads do not have one, so `arboard` would
/// fail with "线程没有打开的剪贴板" (os error 1418) there.
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn write_image_to_clipboard(
    app_handle: tauri::AppHandle,
    base64_data: String,
    mime_type: String,
) -> Result<(), AppCommandError> {
    // ── Decode on the current (command) thread ──────────────────────────
    let raw = STANDARD
        .decode(&base64_data)
        .map_err(|e| AppCommandError::invalid_input(format!("invalid base64: {e}")))?;

    let img = image::load_from_memory(&raw).map_err(|e| {
        AppCommandError::invalid_input(format!(
            "failed to decode image (mime={mime_type}): {e}"
        ))
    })?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let bytes: Vec<u8> = rgba.into_raw();

    // ── Dispatch clipboard write to the main thread ─────────────────────
    let (tx, rx) = tokio::sync::oneshot::channel();
    let _ = app_handle.run_on_main_thread(move || {
        let result = (|| -> Result<(), AppCommandError> {
            let mut clipboard = arboard::Clipboard::new()
                .map_err(|e| AppCommandError::io_error(format!("failed to open clipboard: {e}")))?;
            clipboard
                .set_image(arboard::ImageData {
                    width: w as usize,
                    height: h as usize,
                    bytes: bytes.into(),
                })
                .map_err(|e| AppCommandError::io_error(format!("failed to write image to clipboard: {e}")))?;
            Ok(())
        })();
        let _ = tx.send(result);
    });

    rx.await
        .map_err(|_| AppCommandError::io_error("main thread dropped clipboard channel"))?
}
