use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::team as core;
use crate::models::{
    TeamDraft, TeamInfo, TeamSlotInfo, TeamSlotStatus, TeamSummaryInfo, TeamTaskInfo,
    TeamTaskStatus,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTeamParams {
    pub id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamParams {
    pub draft: TeamDraft,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTeamParams {
    pub id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLeaderConversationParams {
    pub id: String,
    pub conversation_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSlotsParams {
    pub team_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksParams {
    pub team_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignTaskParams {
    pub team_id: String,
    pub owner_slot_id: String,
    pub subject: String,
    pub description: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTaskStatusParams {
    pub task_id: String,
    pub status: TeamTaskStatus,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSlotStatusParams {
    pub slot_id: String,
    pub status: TeamSlotStatus,
}

pub async fn team_list(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<Vec<TeamSummaryInfo>>, AppCommandError> {
    let result = core::team_list_core(&state.db)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn team_get(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GetTeamParams>,
) -> Result<Json<TeamInfo>, AppCommandError> {
    let result = core::team_get_core(&state.db, params.id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn team_create(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<CreateTeamParams>,
) -> Result<Json<TeamInfo>, AppCommandError> {
    let result = core::team_create_core(&state.emitter, &state.db, params.draft)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn team_delete(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<DeleteTeamParams>,
) -> Result<Json<()>, AppCommandError> {
    core::team_delete_core(&state.emitter, &state.db, params.id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(()))
}

pub async fn team_set_leader_conversation(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetLeaderConversationParams>,
) -> Result<Json<()>, AppCommandError> {
    core::team_set_leader_conversation_core(&state.db, params.id, params.conversation_id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(()))
}

pub async fn team_list_slots(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ListSlotsParams>,
) -> Result<Json<Vec<TeamSlotInfo>>, AppCommandError> {
    let result = core::team_list_slots_core(&state.db, params.team_id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn team_list_tasks(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ListTasksParams>,
) -> Result<Json<Vec<TeamTaskInfo>>, AppCommandError> {
    let result = core::team_list_tasks_core(&state.db, params.team_id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn team_assign_task(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<AssignTaskParams>,
) -> Result<Json<TeamTaskInfo>, AppCommandError> {
    let result = core::team_assign_task_core(
        &state.emitter,
        &state.db,
        params.team_id,
        params.owner_slot_id,
        params.subject,
        params.description,
        params.conversation_id,
    )
    .await
    .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn team_set_slot_status(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetSlotStatusParams>,
) -> Result<Json<TeamSlotInfo>, AppCommandError> {
    let result = core::team_set_slot_status_core(
        &state.emitter,
        &state.db,
        params.slot_id,
        params.status,
    )
    .await
    .map_err(AppCommandError::from)?;
    Ok(Json(result))
}

pub async fn team_set_task_status(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetTaskStatusParams>,
) -> Result<Json<TeamTaskInfo>, AppCommandError> {
    let result = core::team_set_task_status_core(&state.emitter, &state.db, params.task_id, params.status)
        .await
        .map_err(AppCommandError::from)?;
    Ok(Json(result))
}
