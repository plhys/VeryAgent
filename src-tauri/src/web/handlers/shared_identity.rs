//! HTTP handlers for shared identity + preferences — web-mode mirror of
//! `commands::shared_identity`.

use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::shared_identity::{
    load_shared_identity_settings, set_shared_identity_settings_core, SharedIdentitySettings,
    SharedIdentityUpdate,
};

pub async fn get_shared_identity_settings(
) -> Result<Json<SharedIdentitySettings>, AppCommandError> {
    Ok(Json(load_shared_identity_settings()?))
}

#[derive(Deserialize)]
pub struct SetSharedIdentityParams {
    pub update: SharedIdentityUpdate,
}

pub async fn set_shared_identity_settings(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetSharedIdentityParams>,
) -> Result<Json<SharedIdentitySettings>, AppCommandError> {
    let saved = set_shared_identity_settings_core(&state.emitter, params.update)?;
    Ok(Json(saved))
}
