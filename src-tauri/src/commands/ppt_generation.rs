//! PPT generation from Markdown or HTML slide directories.
//!
//! Delegates to a Node.js subprocess that uses `pptxgenjs` to build editable
//! .pptx files. Two conversion modes:
//!
//! 1. **Markdown** — simple markdown → PPTX (no browser needed).
//! 2. **HTML slides** — headless WebView2 screenshot + DOM extraction → PPTX.
//!    Uses the system WebView2 runtime (already included in Tauri), no extra
//!    Chromium bundle needed.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::app_error::AppCommandError;
use crate::paths;

// ─── Types ───────────────────────────────────────────────────────────────

/// Request to generate a PPTX deck.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum PptxRequest {
    /// Generate from a list of markdown-formatted slide contents.
    #[serde(rename = "markdown")]
    Markdown {
        title: String,
        slides: Vec<SlideContent>,
        output_path: String,
        #[serde(default)]
        background_color: Option<String>,
        #[serde(default)]
        font_face: Option<String>,
    },

    /// Convert an HTML slide directory (one .html per slide, e.g. 01.html, 02.html).
    #[serde(rename = "html")]
    Html {
        /// Directory containing numbered HTML slide files.
        html_dir: String,
        /// Output .pptx path.
        output_path: String,
        /// Optional custom title for the deck.
        #[serde(default)]
        title: Option<String>,
        /// Whether to also produce a screenshot-only background layer.
        #[serde(default = "default_true")]
        include_screenshots: bool,
    },
}

/// Content for one markdown slide.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideContent {
    pub title: Option<String>,
    pub bullets: Vec<String>,
    pub images: Vec<ImageItem>,
    pub table: Option<TableContent>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageItem {
    pub url: String,
    pub caption: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableContent {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

fn default_true() -> bool {
    true
}

/// Result of PPTX generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PptxResult {
    pub output_path: String,
    pub slide_count: u32,
}

// ─── Core function (no Tauri dependency) ─────────────────────────────────

/// Run the Node.js PPTX generator via subprocess.
///
/// The node script lives inside VeryAgent's bundled assets (embedded as
/// an include_dir binary or shipped alongside the app). We invoke it through
/// `node` which is already guaranteed to be on PATH by `ensure_node_in_path`.
pub async fn generate_pptx(
    req: PptxRequest,
) -> Result<PptxResult, AppCommandError> {
    // Resolve the embedded node script path.
    // Strategy: ship the generator as a small self-contained Node script
    // bundled with the app resources.
    let script_path = get_generator_script_path()?;

    // Write request JSON to a temp file (avoids shell escaping issues).
    let tmp_dir = std::env::temp_dir().join("veryagent-pptx");
    std::fs::create_dir_all(&tmp_dir).ok();
    let req_file = tmp_dir.join("request.json");
    std::fs::write(&req_file, serde_json::to_string_pretty(&req).unwrap())
        .map_err(|e| AppCommandError::new(
            crate::app_error::AppErrorCode::TaskExecutionFailed,
            format!("failed to write request JSON: {e}"),
        ))?;

    let out = Command::new("node")
        .arg(script_path)
        .arg(&req_file)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppCommandError::new(
            crate::app_error::AppErrorCode::TaskExecutionFailed,
            format!("failed to spawn node: {e}"),
        ))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppCommandError::new(
            crate::app_error::AppErrorCode::TaskExecutionFailed,
            format!("pptx generation failed: {stderr}"),
        ));
    }

    let result_str = String::from_utf8_lossy(&out.stdout);
    let result: PptxResult = serde_json::from_str(&result_str).map_err(|e| {
        AppCommandError::new(
            crate::app_error::AppErrorCode::TaskExecutionFailed,
            format!("failed to parse generator output: {e}"),
        )
    })?;

    Ok(result)
}

/// Find the bundled generator script. Priority:
/// 1. App resource dir (packaged with release build)
/// 2. Fallback path near executable
fn get_generator_script_path() -> Result<PathBuf, AppCommandError> {
    // Look next to the app executable first (works for both debug & release).
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
    {
        let candidate = exe_dir.join("slide-generator.mjs");
        if candidate.exists() {
            return Ok(candidate);
        }
        // Also check ./resources/
        let res = exe_dir.join("resources");
        if res.is_dir() {
            let candidate = res.join("slide-generator.mjs");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // For development, look relative to Cargo target dir.
    let candidates = [
        "scripts/slide-generator.mjs",
        "src/slide-generator.mjs",
    ];

    for c in &candidates {
        if Path::new(c).exists() {
            return Ok(Path::new(c).to_path_buf());
        }
    }

    Err(AppCommandError::new(
        crate::app_error::AppErrorCode::TaskExecutionFailed,
        "pptx generator script not found.".into(),
    ))
}

// ─── Tauri command wrapper ────────────────────────────────────────────────

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn ppt_generation(
    req: PptxRequest,
) -> Result<PptxResult, String> {
    generate_pptx(req)
        .await
        .map_err(|e| e.to_string())
}
