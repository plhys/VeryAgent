use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::model_provider as mp_commands;
use crate::models::model_provider::ModelProviderInfo;

// ---------------------------------------------------------------------------
// Param structs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateModelProviderParams {
    pub name: String,
    pub api_url: String,
    pub api_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModelProviderParams {
    pub id: i32,
    pub name: Option<String>,
    pub api_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderIdParams {
    pub id: i32,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub async fn list_model_providers(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<Vec<ModelProviderInfo>>, AppCommandError> {
    let result = mp_commands::list_model_providers_core(&state.db).await?;
    Ok(Json(result))
}

pub async fn create_model_provider(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<CreateModelProviderParams>,
) -> Result<Json<ModelProviderInfo>, AppCommandError> {
    let result = mp_commands::create_model_provider_core(
        &state.db,
        params.name,
        params.api_url,
        params.api_key,
    )
    .await?;
    Ok(Json(result))
}

pub async fn update_model_provider(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UpdateModelProviderParams>,
) -> Result<Json<mp_commands::UpdateModelProviderResult>, AppCommandError> {
    let result = mp_commands::update_model_provider_and_refresh(
        &state.db,
        &state.connection_manager,
        &state.data_dir,
        params.id,
        params.name,
        params.api_url,
        params.api_key,
        &state.emitter,
    )
    .await?;
    Ok(Json(result))
}

pub async fn delete_model_provider(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ModelProviderIdParams>,
) -> Result<Json<mp_commands::DeleteModelProviderResult>, AppCommandError> {
    let result = mp_commands::delete_model_provider_core(&state.db, params.id).await?;
    Ok(Json(result))
}

// ---------------------------------------------------------------------------
// Model listing proxy
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchProviderModelsParams {
    pub id: i32,
}

/// Fetch available models from a model provider's `/models` endpoint.
pub async fn fetch_provider_models(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<FetchProviderModelsParams>,
) -> Result<Json<Vec<mp_commands::ProviderModelItem>>, AppCommandError> {
    let models = mp_commands::fetch_provider_models_core(&state.db, params.id).await?;
    Ok(Json(models))
}

/// Run the full connectivity test for a model provider (OpenAI + Anthropic +
/// models probes). Surfaces gateway defects like missing Anthropic-tools
/// conversion before the user wastes time configuring an agent.
pub async fn test_model_provider(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<FetchProviderModelsParams>,
) -> Result<Json<mp_commands::ModelProviderTestResult>, AppCommandError> {
    let result = mp_commands::test_model_provider_core(&state.db, params.id).await?;
    Ok(Json(result))
}