//! HTTP handlers for the vision-bridge plugin — the web-mode mirror of the
//! Tauri commands in `commands::vision_bridge`.

use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::vision_bridge::{
    vision_bridge_get_config_core, vision_bridge_save_config_core, VisionBridgeConfig,
    VisionBridgeConfigUpdate,
};

pub async fn get_vision_bridge_settings(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<VisionBridgeConfig>, AppCommandError> {
    Ok(Json(vision_bridge_get_config_core(&state.db).await))
}

#[derive(Deserialize)]
pub struct SetVisionBridgeSettingsParams {
    pub settings: VisionBridgeConfigUpdate,
}

pub async fn set_vision_bridge_settings(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetVisionBridgeSettingsParams>,
) -> Result<Json<VisionBridgeConfig>, AppCommandError> {
    let saved = vision_bridge_save_config_core(
        &state.db,
        &state.vision_bridge_config,
        &state.emitter,
        params.settings,
    )
    .await?;
    Ok(Json(saved))
}
