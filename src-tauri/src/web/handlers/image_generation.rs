//! HTTP handlers for platform image generation — web-mode mirror of
//! `commands::image_generation`.

use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::image_generation::{
    image_generation_fetch_models_core, image_generation_get_config_core,
    image_generation_save_config_and_refresh, ImageGenerationConfig,
    ImageGenerationConfigUpdate, ImageGenerationModelsResult, ImageGenerationSaveResult,
};

pub async fn get_image_generation_settings(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<ImageGenerationConfig>, AppCommandError> {
    Ok(Json(image_generation_get_config_core(&state.db).await))
}

#[derive(Deserialize)]
pub struct SetImageGenerationSettingsParams {
    pub settings: ImageGenerationConfigUpdate,
}

pub async fn set_image_generation_settings(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetImageGenerationSettingsParams>,
) -> Result<Json<ImageGenerationSaveResult>, AppCommandError> {
    let saved = image_generation_save_config_and_refresh(
        &state.db,
        &state.connection_manager,
        &state.data_dir,
        &state.image_generation_config,
        &state.emitter,
        params.settings,
    )
    .await?;
    Ok(Json(saved))
}

#[derive(Deserialize)]
pub struct FetchImageGenerationModelsParams {
    /// Accept both snake_case (web JSON) and camelCase (same as Tauri IPC).
    #[serde(alias = "apiUrl")]
    pub api_url: String,
    #[serde(alias = "apiKey")]
    pub api_key: String,
}

pub async fn fetch_image_generation_models(
    Json(params): Json<FetchImageGenerationModelsParams>,
) -> Result<Json<ImageGenerationModelsResult>, AppCommandError> {
    let result = image_generation_fetch_models_core(&params.api_url, &params.api_key).await?;
    Ok(Json(result))
}
