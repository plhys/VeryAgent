//! Team commands. The `*_core` fns are mode-agnostic (plain references, no
//! `tauri::State`) and emit [`TEAM_CHANGED_EVENT`] so both the Tauri command
//! wrappers and the Axum handlers share one code path. The `#[tauri::command]`
//! wrappers are desktop-only and build an `EventEmitter::Tauri` from the
//! `AppHandle`.

use crate::db::error::DbError;
use crate::db::service::{conversation_service, folder_service, team_service};
use crate::db::AppDatabase;
use crate::models::{
    AgentType, TeamDraft, TeamInfo, TeamSlotInfo, TeamSlotStatus, TeamSummaryInfo, TeamTaskInfo,
    TeamTaskStatus,
};
use crate::web::event_bridge::{emit_event, EventEmitter, TEAM_CHANGED_EVENT, TeamChange};
#[cfg(feature = "tauri-runtime")]
use tauri::Manager;

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

/// 派活并让成员真正开始干活（后端版「手动派活」handleAssign 的自动化）：
///
/// 1. 解析团队 workspace → folder（folder_service::add_folder）
/// 2. 为成员建一条专属会话（conversation_service::create）
/// 3. 写 team_task + 任务挂会话 + 成员 slot 挂会话 + slot 置 working
///    （team_service::assign_task）
/// 4. 通过 ConnectionManager spawn 成员智能体（working_dir = 团队 workspace）
/// 5. 用 `send_prompt_linked` 把任务作为首条消息发给成员（附带角色前缀）
///
/// 返回新会话 id 与成员连接 id。Tauri 模式直接调用；Web 模式目前由
/// 前端保持手动派活（成员会话已在浏览器侧 connect）。
#[cfg(feature = "tauri-runtime")]
pub async fn team_delegate_task_core(
    emitter: &EventEmitter,
    db: &AppDatabase,
    manager: &crate::acp::manager::ConnectionManager,
    app_data_dir: &std::path::Path,
    team_id: String,
    owner_slot_id: String,
    subject: String,
    description: Option<String>,
) -> Result<TeamDelegateResult, DbError> {
    let team = team_service::get(&db.conn, &team_id).await?;
    let slot = team
        .slots
        .iter()
        .find(|s| s.id == owner_slot_id)
        .ok_or_else(|| DbError::NotFound(format!("team slot {owner_slot_id}")))?;
    let agent_type: AgentType = serde_json::from_str(&slot.agent_type)
        .map_err(|e| DbError::Migration(format!("team slot agent_type invalid: {e}")))?;

    // 1. workspace → folder
    let folder = folder_service::add_folder(&db.conn, &team.workspace)
        .await
        .map_err(|e| DbError::from(e))?;

    // 2. 建成员会话
    let conv_id = conversation_service::create(
        &db.conn,
        folder.id,
        agent_type,
        Some(subject.clone()),
        None,
    )
    .await
    .map_err(DbError::from)?
    .id;

    // 3. 写任务 + 挂会话 + slot 置 working
    let _task = team_service::assign_task(
        &db.conn,
        &team_id,
        &owner_slot_id,
        &subject,
        description.as_deref(),
        Some(conv_id),
    )
    .await?;

    // 4. spawn 成员智能体
    let runtime_env = crate::commands::acp::build_session_runtime_env(
        db,
        agent_type,
        None,
        app_data_dir,
    )
    .await
    .map_err(|e| DbError::Migration(e.to_string()))?;
    let conn_id = manager
        .spawn_agent(
            agent_type,
            Some(team.workspace.clone()),
            None,
            runtime_env,
            "main".to_string(),
            emitter.clone(),
            None,
            std::collections::BTreeMap::new(),
        )
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    // 5. 发任务首条消息（角色前缀 + 任务正文）
    let blocks = vec![crate::acp::types::PromptInputBlock::Text {
        text: format!("你是团队「{}」的成员（角色：{}），在共享工作区 {} 中执行任务。\n\n任务：{}",
            team.name, slot.roles.join("/"), team.workspace, subject),
    }];
    manager
        .send_prompt_linked(
            db,
            &conn_id,
            blocks,
            Some(folder.id),
            Some(conv_id),
            None,
        )
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;

    emit_team(emitter, &team_id);
    Ok(TeamDelegateResult { conv_id, conn_id })
}

/// 派活结果：新会话 id + 成员连接 id。
#[cfg(feature = "tauri-runtime")]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamDelegateResult {
    pub conv_id: i32,
    pub conn_id: String,
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

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn team_delegate_task(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    manager: tauri::State<'_, crate::acp::manager::ConnectionManager>,
    team_id: String,
    owner_slot_id: String,
    subject: String,
    description: Option<String>,
) -> Result<TeamDelegateResult, DbError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    team_delegate_task_core(
        &EventEmitter::Tauri(app),
        &db,
        manager.inner(),
        &app_data_dir,
        team_id,
        owner_slot_id,
        subject,
        description,
    )
    .await
}
