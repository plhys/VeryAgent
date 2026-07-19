//! Tauri commands for platform image-generation configuration.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::acp::image_generation::ImageGenerationRuntimeConfig;
use crate::acp::manager::ConnectionManager;
use crate::acp::types::ConfigStaleKind;
use crate::app_error::{AppCommandError, AppErrorCode};
use crate::commands::acp::{all_agent_types, refresh_config_staleness};
use crate::commands::model_provider::{fetch_openai_compatible_models, ProviderModelItem};
use crate::db::service::image_generation_service::{get_config, save_config};
use crate::db::AppDatabase;
use crate::web::event_bridge::{emit_event, IMAGE_GENERATION_SETTINGS_CHANGED_EVENT};

pub use crate::db::service::image_generation_service::{
    ImageGenerationConfig, ImageGenerationConfigUpdate,
};

// ---------------------------------------------------------------------------
// Core functions (no Tauri dependency)
// ---------------------------------------------------------------------------

pub async fn image_generation_get_config_core(db: &AppDatabase) -> ImageGenerationConfig {
    get_config(&db.conn).await
}

/// Result of saving image-generation settings. Carries the number of running
/// sessions that now need reconnect so companion can re-inject `image`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationSaveResult {
    pub config: ImageGenerationConfig,
    pub affected_running_sessions: usize,
}

pub async fn image_generation_save_config_core(
    db: &AppDatabase,
    runtime_config: &ImageGenerationRuntimeConfig,
    emitter: &crate::web::event_bridge::EventEmitter,
    update: ImageGenerationConfigUpdate,
) -> Result<ImageGenerationConfig, AppCommandError> {
    let result = save_config(&db.conn, update)
        .await
        .map_err(|e| AppCommandError::new(AppErrorCode::TaskExecutionFailed, e.to_string()))?;
    runtime_config
        .set(crate::acp::image_generation::ImageGenerationRuntimeState {
            enabled: result.enabled,
        })
        .await;
    emit_event(emitter, IMAGE_GENERATION_SETTINGS_CHANGED_EVENT, &result);
    Ok(result)
}

/// Save + mark every running connection stale when the companion `image`
/// feature bit may have changed. Shared by Tauri and web handlers.
pub async fn image_generation_save_config_and_refresh(
    db: &AppDatabase,
    manager: &ConnectionManager,
    data_dir: &Path,
    runtime_config: &ImageGenerationRuntimeConfig,
    emitter: &crate::web::event_bridge::EventEmitter,
    update: ImageGenerationConfigUpdate,
) -> Result<ImageGenerationSaveResult, AppCommandError> {
    let config = image_generation_save_config_core(db, runtime_config, emitter, update).await?;
    // Platform-wide: every agent type may host a companion with/without `image`.
    let affected_running_sessions = refresh_config_staleness(
        manager,
        db,
        data_dir,
        all_agent_types(),
        ConfigStaleKind::ImageGeneration,
    )
    .await;
    Ok(ImageGenerationSaveResult {
        config,
        affected_running_sessions,
    })
}

/// Push the persisted DB row into the runtime config so MCP injection picks
/// up the current state before any companion launch.
pub async fn apply_persisted_image_generation_config(
    db_conn: &sea_orm::DatabaseConnection,
    runtime_config: &ImageGenerationRuntimeConfig,
) {
    let db = AppDatabase {
        conn: db_conn.clone(),
    };
    let config = image_generation_get_config_core(&db).await;
    runtime_config
        .set(crate::acp::image_generation::ImageGenerationRuntimeState {
            enabled: config.enabled,
        })
        .await;
}

/// Result of listing models for the image-generation settings picker.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationModelsResult {
    /// Models to show in the picker (filtered when possible).
    pub models: Vec<ProviderModelItem>,
    /// True when we could not confidently identify image models and fell back
    /// to the full gateway list (minus obvious non-image noise).
    pub used_fallback: bool,
}

/// Heuristic: model ids that look like image generation / edit models.
fn looks_like_image_model(id: &str) -> bool {
    let s = id.to_ascii_lowercase();
    // Obvious non-image noise from mixed gateways.
    const EXCLUDE: &[&str] = &[
        "embed",
        "whisper",
        "tts",
        "speech",
        "moderation",
        "transcri",
        "realtime",
        "audio",
        "rerank",
        "classifier",
    ];
    if EXCLUDE.iter().any(|x| s.contains(x)) {
        return false;
    }
    const HITS: &[&str] = &[
        "image",
        "dall-e",
        "dalle",
        "dall_e",
        "flux",
        "sdxl",
        "stable-diffusion",
        "stable_diffusion",
        "midjourney",
        "imagen",
        "seedream",
        "kolors",
        "cogview",
        "wanx",
        "wan2",
        "ideogram",
        "recraft",
        "gpt-image",
        "gpt_image",
        "black-forest",
        "bfl-",
        "playground",
        "kandinsky",
        "luma",
        "photon",
        "nova-canvas",
        "canvas",
        "draw",
        "paint",
        "picture",
        "img",
        "seededit",
        "qwen-image",
        "qwen_image",
        "doubao-seedream",
        "jimeng",
    ];
    HITS.iter().any(|h| s.contains(h))
}

fn is_obvious_non_image(id: &str) -> bool {
    let s = id.to_ascii_lowercase();
    const EXCLUDE: &[&str] = &[
        "embed",
        "whisper",
        "tts",
        "speech",
        "moderation",
        "transcri",
        "realtime",
        "audio",
        "rerank",
    ];
    EXCLUDE.iter().any(|x| s.contains(x))
}

/// GET `{api_url}/models` (with common base-url variants) and prefer image-like ids.
pub async fn image_generation_fetch_models_core(
    api_url: &str,
    api_key: &str,
) -> Result<ImageGenerationModelsResult, AppCommandError> {
    let all = fetch_openai_compatible_models(api_url, api_key).await?;
    let image_like: Vec<ProviderModelItem> = all
        .iter()
        .filter(|m| looks_like_image_model(&m.id))
        .cloned()
        .collect();

    if !image_like.is_empty() {
        return Ok(ImageGenerationModelsResult {
            models: image_like,
            used_fallback: false,
        });
    }

    // Gateway names may not match heuristics — still drop obvious non-image noise.
    let fallback: Vec<ProviderModelItem> = all
        .into_iter()
        .filter(|m| !is_obvious_non_image(&m.id))
        .collect();
    Ok(ImageGenerationModelsResult {
        models: fallback,
        used_fallback: true,
    })
}

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn image_generation_get_config(
    db: tauri::State<'_, AppDatabase>,
) -> Result<ImageGenerationConfig, String> {
    Ok(image_generation_get_config_core(&db).await)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn image_generation_save_config(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    manager: tauri::State<'_, ConnectionManager>,
    runtime_config: tauri::State<'_, ImageGenerationRuntimeConfig>,
    settings: ImageGenerationConfigUpdate,
) -> Result<ImageGenerationSaveResult, String> {
    use tauri::Manager;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let emitter = crate::web::event_bridge::EventEmitter::Tauri(app);
    image_generation_save_config_and_refresh(
        &db,
        &manager,
        &app_data_dir,
        &runtime_config,
        &emitter,
        settings,
    )
    .await
    .map_err(|e| e.to_string())
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn image_generation_fetch_models(
    api_url: String,
    api_key: String,
) -> Result<ImageGenerationModelsResult, String> {
    image_generation_fetch_models_core(&api_url, &api_key)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_model_heuristic_hits_common_ids() {
        assert!(looks_like_image_model("gpt-image-1"));
        assert!(looks_like_image_model("dall-e-3"));
        assert!(looks_like_image_model("flux-pro"));
        assert!(looks_like_image_model("doubao-seedream-3-0"));
        assert!(!looks_like_image_model("text-embedding-3-small"));
        assert!(!looks_like_image_model("whisper-1"));
        assert!(!looks_like_image_model("gpt-4o"));
    }
}
