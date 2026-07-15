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
) -> Result<Json<()>, AppCommandError> {
    mp_commands::delete_model_provider_core(&state.db, params.id).await?;
    Ok(Json(()))
}

// ---------------------------------------------------------------------------
// Model listing proxy
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchProviderModelsParams {
    pub id: i32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelItem {
    pub id: String,
    pub name: String,
}

/// Fetch available models from a model provider's `/v1/models` endpoint.
pub async fn fetch_provider_models(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<FetchProviderModelsParams>,
) -> Result<Json<Vec<ProviderModelItem>>, AppCommandError> {
    let provider = mp_commands::get_model_provider_core(&state.db, params.id).await?;

    let url = format!("{}/models", provider.api_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppCommandError::invalid_input(format!("HTTP client error: {e}")))?;

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", provider.api_key))
        .send()
        .await
        .map_err(|e| AppCommandError::invalid_input(format!("Request failed: {e}")))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(AppCommandError::invalid_input(format!(
            "Provider returned HTTP {}: {}",
            status.as_u16(),
            body.chars().take(500).collect::<String>()
        )));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| AppCommandError::invalid_input(format!("Invalid JSON: {e}")))?;

    // OpenAI-compatible: { "object": "list", "data": [{ "id": "gpt-5", ... }] }
    let models: Vec<ProviderModelItem> = parsed
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let id = item.get("id")?.as_str()?.to_string();
                    Some(ProviderModelItem {
                        name: id.clone(),
                        id,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(Json(models))
}