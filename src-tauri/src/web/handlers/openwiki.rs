//! HTTP handlers for OpenWiki — web-mode mirror of `commands::openwiki`.

use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::openwiki::{
    openwiki_get_config_core, openwiki_get_instructions_core, openwiki_run_core,
    openwiki_save_instructions_core, openwiki_status_core, set_openwiki_config_core,
    OpenWikiInstructions, OpenWikiInstructionsParams, OpenWikiInstructionsUpdate,
    OpenWikiRunParams,
};
use crate::openwiki::config::OpenWikiConfig;
use crate::openwiki::runner::{OpenWikiRunResult, OpenWikiStatus};

pub async fn get_openwiki_config(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<OpenWikiConfig>, AppCommandError> {
    Ok(Json(openwiki_get_config_core(&state.db.conn).await))
}

#[derive(Deserialize)]
pub struct SetOpenWikiConfigParams {
    pub settings: OpenWikiConfig,
}

pub async fn set_openwiki_config(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetOpenWikiConfigParams>,
) -> Result<Json<OpenWikiConfig>, AppCommandError> {
    let saved = set_openwiki_config_core(
        &state.db.conn,
        &state.openwiki_config,
        &state.emitter,
        params.settings,
    )
    .await?;
    Ok(Json(saved))
}

#[derive(Deserialize)]
pub struct OpenWikiStatusParams {
    pub workspace: Option<String>,
}

pub async fn get_openwiki_status(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<OpenWikiStatusParams>,
) -> Result<Json<OpenWikiStatus>, AppCommandError> {
    Ok(Json(
        openwiki_status_core(&state.db.conn, &state.openwiki_config, params.workspace).await,
    ))
}

/// Matches Tauri `openwiki_run({ params })` invoke shape so the frontend can
/// share one transport call body across desktop and web.
#[derive(Deserialize)]
pub struct RunOpenWikiBody {
    pub params: OpenWikiRunParams,
}

pub async fn run_openwiki(
    Extension(state): Extension<Arc<AppState>>,
    Json(body): Json<RunOpenWikiBody>,
) -> Result<Json<OpenWikiRunResult>, AppCommandError> {
    let result =
        openwiki_run_core(&state.db.conn, &state.openwiki_config, body.params).await?;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct GetOpenWikiInstructionsBody {
    pub params: OpenWikiInstructionsParams,
}

pub async fn get_openwiki_instructions(
    Extension(state): Extension<Arc<AppState>>,
    Json(body): Json<GetOpenWikiInstructionsBody>,
) -> Result<Json<OpenWikiInstructions>, AppCommandError> {
    let result =
        openwiki_get_instructions_core(&state.db.conn, &state.openwiki_config, body.params)
            .await?;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct SetOpenWikiInstructionsBody {
    pub update: OpenWikiInstructionsUpdate,
}

pub async fn set_openwiki_instructions(
    Extension(state): Extension<Arc<AppState>>,
    Json(body): Json<SetOpenWikiInstructionsBody>,
) -> Result<Json<OpenWikiInstructions>, AppCommandError> {
    let result =
        openwiki_save_instructions_core(&state.db.conn, &state.openwiki_config, body.update)
            .await?;
    Ok(Json(result))
}
