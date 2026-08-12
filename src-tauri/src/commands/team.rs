//! Team commands. The `*_core` fns are mode-agnostic (plain references, no
//! `tauri::State`) and emit [`TEAM_CHANGED_EVENT`] so both the Tauri command
//! wrappers and the Axum handlers share one code path. The `#[tauri::command]`
//! wrappers are desktop-only and build an `EventEmitter::Tauri` from the
//! `AppHandle`.

use crate::db::error::DbError;
use crate::db::service::team_service;
use crate::db::AppDatabase;
use crate::models::{
    TeamDraft, TeamInfo, TeamSlotInfo, TeamSlotStatus, TeamSummaryInfo, TeamTaskInfo,
    TeamTaskStatus,
};
use crate::web::event_bridge::{emit_event, EventEmitter, TEAM_CHANGED_EVENT, TeamChange};

fn emit_team(emitter: &EventEmitter, id: &str) {
    emit_event(emitter, TEAM_CHANGED_EVENT, TeamChange::Upsert { id: id.to_string() });
}

// ── shared business logic (both modes) ─────────────────────────────────────

pub async fn team_list_core(db: &AppDatabase) -> Result<Vec<TeamSummaryInfo>, DbError> {
    team_service::list(&db.conn).await
}

pub async fn team_get_core(db: &AppDatabase, id: String) -> Result<TeamInfo, DbError> {
    team_service::get(&db.conn, &id).await
}

pub async fn team_create_core(
    emitter: &EventEmitter,
    db: &AppDatabase,
    draft: TeamDraft,
) -> Result<TeamInfo, DbError> {
    let info = team_service::create(&db.conn, draft).await?;
    emit_team(emitter, &info.id);
    Ok(info)
}

pub async fn team_delete_core(
    emitter: &EventEmitter,
    db: &AppDatabase,
    id: String,
) -> Result<(), DbError> {
    team_service::delete(&db.conn, &id).await?;
    emit_event(emitter, TEAM_CHANGED_EVENT, TeamChange::Deleted { id });
    Ok(())
}

pub async fn team_set_leader_conversation_core(
    db: &AppDatabase,
    id: String,
    conversation_id: i32,
) -> Result<(), DbError> {
    team_service::set_leader_conversation(&db.conn, &id, conversation_id).await
}

pub async fn team_list_slots_core(db: &AppDatabase, team_id: String) -> Result<Vec<TeamSlotInfo>, DbError> {
    team_service::list_slots(&db.conn, &team_id).await
}

pub async fn team_list_tasks_core(db: &AppDatabase, team_id: String) -> Result<Vec<TeamTaskInfo>, DbError> {
    team_service::list_tasks(&db.conn, &team_id).await
}

pub async fn team_assign_task_core(
    emitter: &EventEmitter,
    db: &AppDatabase,
    team_id: String,
    owner_slot_id: String,
    subject: String,
    description: Option<String>,
    conversation_id: Option<i32>,
) -> Result<TeamTaskInfo, DbError> {
    let task = team_service::assign_task(
        &db.conn,
        &team_id,
        &owner_slot_id,
        &subject,
        description.as_deref(),
        conversation_id,
    )
    .await?;
    emit_team(emitter, &team_id);
    Ok(task)
}

pub async fn team_set_slot_status_core(
    emitter: &EventEmitter,
    db: &AppDatabase,
    slot_id: String,
    status: TeamSlotStatus,
) -> Result<TeamSlotInfo, DbError> {
    let slot = team_service::set_slot_status(&db.conn, &slot_id, status).await?;
    emit_team(emitter, &slot.team_id);
    Ok(slot)
}

pub async fn team_set_task_status_core(
    emitter: &EventEmitter,
    db: &AppDatabase,
    task_id: String,
    status: TeamTaskStatus,
) -> Result<TeamTaskInfo, DbError> {
    let task = team_service::set_task_status(&db.conn, &task_id, status).await?;
    emit_team(emitter, &task.team_id);
    Ok(task)
}

// ── Tauri command wrappers (desktop only) ───────────────────────────────────

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_list(db: tauri::State<'_, AppDatabase>) -> Result<Vec<TeamSummaryInfo>, DbError> {
    team_list_core(&db).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_get(db: tauri::State<'_, AppDatabase>, id: String) -> Result<TeamInfo, DbError> {
    team_get_core(&db, id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_create(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    draft: TeamDraft,
) -> Result<TeamInfo, DbError> {
    team_create_core(&EventEmitter::Tauri(app), &db, draft).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_delete(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    id: String,
) -> Result<(), DbError> {
    team_delete_core(&EventEmitter::Tauri(app), &db, id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_set_leader_conversation(
    db: tauri::State<'_, AppDatabase>,
    id: String,
    conversation_id: i32,
) -> Result<(), DbError> {
    team_set_leader_conversation_core(&db, id, conversation_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_list_slots(
    db: tauri::State<'_, AppDatabase>,
    team_id: String,
) -> Result<Vec<TeamSlotInfo>, DbError> {
    team_list_slots_core(&db, team_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_list_tasks(
    db: tauri::State<'_, AppDatabase>,
    team_id: String,
) -> Result<Vec<TeamTaskInfo>, DbError> {
    team_list_tasks_core(&db, team_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_assign_task(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    team_id: String,
    owner_slot_id: String,
    subject: String,
    description: Option<String>,
    conversation_id: Option<i32>,
) -> Result<TeamTaskInfo, DbError> {
    team_assign_task_core(
        &EventEmitter::Tauri(app),
        &db,
        team_id,
        owner_slot_id,
        subject,
        description,
        conversation_id,
    )
    .await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_set_slot_status(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    slot_id: String,
    status: TeamSlotStatus,
) -> Result<TeamSlotInfo, DbError> {
    team_set_slot_status_core(&EventEmitter::Tauri(app), &db, slot_id, status).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_set_task_status(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    task_id: String,
    status: TeamTaskStatus,
) -> Result<TeamTaskInfo, DbError> {
    team_set_task_status_core(&EventEmitter::Tauri(app), &db, task_id, status).await
}
