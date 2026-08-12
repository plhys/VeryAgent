//! Team CRUD + create-team validation. Mode-agnostic: every fn takes a plain
//! `&DatabaseConnection` so both the Tauri command and the Axum handler share
//! it. Slots' `roles` is stored as a JSON array string; wire form is a plain
//! string array.

use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait, PaginatorTrait,
    QueryFilter, QueryOrder, Set,
};
use uuid::Uuid;

use crate::db::entities::team_slot::{self, TeamSlotStatus};
use crate::db::entities::team_task::{self, TeamTaskStatus};
use crate::db::entities::{team, team_slot as slot_entity, team_task as task_entity};
use crate::db::error::DbError;
use crate::models::team::ROLE_LEADER;
use crate::models::{TeamDraft, TeamInfo, TeamSlotInfo, TeamSummaryInfo, TeamTaskInfo};

/// Team size limits. Slots are the members (each an existing agent); roles are
/// the sum of all slots' roles (one agent may carry up to 3).
const MIN_SLOTS: usize = 2;
const MAX_SLOTS: usize = 5;
const MIN_ROLES: usize = 3;
const MAX_ROLES: usize = 5;
const MAX_ROLES_PER_SLOT: usize = 3;

// ── entity → wire mappings ─────────────────────────────────────────────────

fn parse_roles(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn to_summary(m: team::Model, member_count: usize) -> TeamSummaryInfo {
    TeamSummaryInfo {
        id: m.id,
        name: m.name,
        leader_slot_id: m.leader_slot_id,
        workspace: m.workspace,
        leader_conversation_id: m.leader_conversation_id,
        member_count,
        created_at: m.created_at,
    }
}

fn to_slot(m: team_slot::Model) -> TeamSlotInfo {
    TeamSlotInfo {
        id: m.id,
        team_id: m.team_id,
        agent_type: m.agent_type,
        roles: parse_roles(&m.roles),
        display_name: m.display_name,
        status: m.status,
        conversation_id: m.conversation_id,
        created_at: m.created_at,
    }
}

fn to_task(m: team_task::Model) -> TeamTaskInfo {
    TeamTaskInfo {
        id: m.id,
        team_id: m.team_id,
        subject: m.subject,
        description: m.description,
        status: m.status,
        owner_slot_id: m.owner_slot_id,
        result: m.result,
        conversation_id: m.conversation_id,
        created_at: m.created_at,
    }
}

// ── CRUD ───────────────────────────────────────────────────────────────────

pub async fn list(db: &DatabaseConnection) -> Result<Vec<TeamSummaryInfo>, DbError> {
    let teams = team::Entity::find()
        .order_by_desc(team::Column::CreatedAt)
        .all(db)
        .await?;
    let mut out = Vec::with_capacity(teams.len());
    for t in teams {
        let count = slot_entity::Entity::find()
            .filter(slot_entity::Column::TeamId.eq(&t.id))
            .count(db)
            .await?;
        out.push(to_summary(t, count as usize));
    }
    Ok(out)
}

pub async fn get(db: &DatabaseConnection, id: &str) -> Result<TeamInfo, DbError> {
    let t = team::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team {id}")))?;
    let slots = slot_entity::Entity::find()
        .filter(slot_entity::Column::TeamId.eq(&t.id))
        .order_by_asc(slot_entity::Column::CreatedAt)
        .all(db)
        .await?
        .into_iter()
        .map(to_slot)
        .collect();
    let tasks = task_entity::Entity::find()
        .filter(task_entity::Column::TeamId.eq(&t.id))
        .order_by_asc(task_entity::Column::CreatedAt)
        .all(db)
        .await?
        .into_iter()
        .map(to_task)
        .collect();
    Ok(TeamInfo {
        id: t.id,
        name: t.name,
        leader_slot_id: t.leader_slot_id,
        workspace: t.workspace,
        leader_conversation_id: t.leader_conversation_id,
        slots,
        tasks,
        created_at: t.created_at,
    })
}

pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbError> {
    let t = team::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team {id}")))?;
    t.delete(db).await?;
    Ok(())
}

pub async fn set_leader_conversation(
    db: &DatabaseConnection,
    id: &str,
    conversation_id: i32,
) -> Result<(), DbError> {
    let t = team::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team {id}")))?;
    let mut active: team::ActiveModel = t.into();
    active.leader_conversation_id = Set(Some(conversation_id));
    active.update(db).await?;
    Ok(())
}

// ── create ─────────────────────────────────────────────────────────────────

fn validate_draft(draft: &TeamDraft) -> Result<(), DbError> {
    if draft.name.trim().is_empty() {
        return Err(DbError::Validation("team name is required".into()));
    }
    if draft.workspace.trim().is_empty() {
        return Err(DbError::Validation("team workspace is required".into()));
    }
    if draft.slots.len() < MIN_SLOTS || draft.slots.len() > MAX_SLOTS {
        return Err(DbError::Validation(format!(
            "team needs {MIN_SLOTS}..{MAX_SLOTS} members, got {}",
            draft.slots.len()
        )));
    }
    let mut leader_count = 0usize;
    let mut total_roles = 0usize;
    for s in &draft.slots {
        if s.roles.is_empty() || s.roles.len() > MAX_ROLES_PER_SLOT {
            return Err(DbError::Validation(format!(
                "member {} needs 1..{MAX_ROLES_PER_SLOT} roles",
                s.display_name
            )));
        }
        if s.roles.contains(&ROLE_LEADER.to_string()) {
            leader_count += 1;
        }
        total_roles += s.roles.len();
    }
    if leader_count != 1 {
        return Err(DbError::Validation(
            "exactly one leader is required".into(),
        ));
    }
    if total_roles < MIN_ROLES || total_roles > MAX_ROLES {
        return Err(DbError::Validation(format!(
            "team needs {MIN_ROLES}..{MAX_ROLES} roles total, got {total_roles}"
        )));
    }
    Ok(())
}

pub async fn create(db: &DatabaseConnection, draft: TeamDraft) -> Result<TeamInfo, DbError> {
    validate_draft(&draft)?;

    let team_id = Uuid::new_v4().to_string();
    let now = Utc::now();

    // Insert the team row first (slots FK onto it); leader_slot_id is backfilled
    // after the slots are created.
    //
    // NOTE: use `Entity::insert(...).exec(...)` (not `ActiveModel::insert(...)`)
    // for TEXT primary keys. On SQLite, `ActiveModelTrait::insert` tries to
    // round-trip the inserted row through `last_insert_rowid()` — a self-increment
    // rowid that has nothing to do with our UUID pk — and dies with
    // `RecordNotFound: Failed to find inserted item`. `exec` skips the read-back.
    team::Entity::insert(team::ActiveModel {
        id: Set(team_id.clone()),
        name: Set(draft.name.trim().to_string()),
        leader_slot_id: Set(String::new()),
        workspace: Set(draft.workspace.trim().to_string()),
        leader_conversation_id: Set(None),
        created_at: Set(now),
    })
    .exec(db)
    .await?;

    let mut leader_slot_id: Option<String> = None;
    for s in &draft.slots {
        let slot_id = Uuid::new_v4().to_string();
        if s.roles.contains(&ROLE_LEADER.to_string()) {
            leader_slot_id = Some(slot_id.clone());
        }
        slot_entity::Entity::insert(slot_entity::ActiveModel {
            id: Set(slot_id),
            team_id: Set(team_id.clone()),
            agent_type: Set(s.agent_type.clone()),
            roles: Set(serde_json::to_string(&s.roles).unwrap_or_else(|_| "[]".into())),
            display_name: Set(s.display_name.clone()),
            status: Set(TeamSlotStatus::Idle),
            conversation_id: Set(None),
            created_at: Set(now),
        })
        .exec(db)
        .await?;
    }

    // Backfill the leader slot id. `Entity::insert(...).exec(...)` returns no
    // model, so re-fetch the row we just wrote before updating.
    if let Some(leader_id) = leader_slot_id {
        let t = team::Entity::find_by_id(&team_id)
            .one(db)
            .await?
            .ok_or_else(|| DbError::NotFound(format!("team {team_id}")))?;
        let mut active: team::ActiveModel = t.into();
        active.leader_slot_id = Set(leader_id);
        active.update(db).await?;
    }

    get(db, &team_id).await
}

// ── slots ──────────────────────────────────────────────────────────────────

pub async fn list_slots(db: &DatabaseConnection, team_id: &str) -> Result<Vec<TeamSlotInfo>, DbError> {
    let slots = slot_entity::Entity::find()
        .filter(slot_entity::Column::TeamId.eq(team_id))
        .order_by_asc(slot_entity::Column::CreatedAt)
        .all(db)
        .await?
        .into_iter()
        .map(to_slot)
        .collect();
    Ok(slots)
}

pub async fn set_slot_status(
    db: &DatabaseConnection,
    slot_id: &str,
    status: TeamSlotStatus,
) -> Result<TeamSlotInfo, DbError> {
    let s = slot_entity::Entity::find_by_id(slot_id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team slot {slot_id}")))?;
    let mut active: slot_entity::ActiveModel = s.into();
    active.status = Set(status);
    let updated = active.update(db).await?;
    Ok(to_slot(updated))
}

/// Attach a working conversation to a member slot (minted on task assign).
pub async fn set_slot_conversation(
    db: &DatabaseConnection,
    slot_id: &str,
    conversation_id: i32,
) -> Result<TeamSlotInfo, DbError> {
    let s = slot_entity::Entity::find_by_id(slot_id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team slot {slot_id}")))?;
    let mut active: slot_entity::ActiveModel = s.into();
    active.conversation_id = Set(Some(conversation_id));
    let updated = active.update(db).await?;
    Ok(to_slot(updated))
}

// ── tasks ──────────────────────────────────────────────────────────────────

pub async fn list_tasks(db: &DatabaseConnection, team_id: &str) -> Result<Vec<TeamTaskInfo>, DbError> {
    let tasks = task_entity::Entity::find()
        .filter(task_entity::Column::TeamId.eq(team_id))
        .order_by_asc(task_entity::Column::CreatedAt)
        .all(db)
        .await?
        .into_iter()
        .map(to_task)
        .collect();
    Ok(tasks)
}

pub async fn assign_task(
    db: &DatabaseConnection,
    team_id: &str,
    owner_slot_id: &str,
    subject: &str,
    description: Option<&str>,
    conversation_id: Option<i32>,
) -> Result<TeamTaskInfo, DbError> {
    // The slot must belong to this team (guards against cross-team assignment).
    let slot = slot_entity::Entity::find_by_id(owner_slot_id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team slot {owner_slot_id}")))?;
    if slot.team_id != team_id {
        return Err(DbError::Validation(
            "slot does not belong to this team".into(),
        ));
    }
    if subject.trim().is_empty() {
        return Err(DbError::Validation("task subject is required".into()));
    }

    let id = Uuid::new_v4().to_string();
    task_entity::Entity::insert(task_entity::ActiveModel {
        id: Set(id.clone()),
        team_id: Set(team_id.to_string()),
        subject: Set(subject.trim().to_string()),
        description: Set(description.map(str::trim).map(String::from)),
        status: Set(TeamTaskStatus::Pending),
        owner_slot_id: Set(owner_slot_id.to_string()),
        result: Set(None),
        conversation_id: Set(conversation_id),
        created_at: Set(Utc::now()),
    })
    .exec(db)
    .await?;

    // The member's working conversation is minted together with the task: hang
    // it on the slot (the mini-window streams it) and flip the member to
    // "working" in the same assign call.
    if let Some(conv_id) = conversation_id {
        let mut active_slot: slot_entity::ActiveModel = slot.into();
        active_slot.conversation_id = Set(Some(conv_id));
        active_slot.status = Set(TeamSlotStatus::Working);
        active_slot.update(db).await?;
    }

    // `exec` returns no model; re-fetch the row (id is our own UUID).
    let m = task_entity::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound("team task after insert".into()))?;
    Ok(to_task(m))
}

pub async fn set_task_status(
    db: &DatabaseConnection,
    task_id: &str,
    status: TeamTaskStatus,
) -> Result<TeamTaskInfo, DbError> {
    let t = task_entity::Entity::find_by_id(task_id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team task {task_id}")))?;
    let mut active: task_entity::ActiveModel = t.into();
    active.status = Set(status);
    let updated = active.update(db).await?;
    Ok(to_task(updated))
}

pub async fn settle_task(
    db: &DatabaseConnection,
    task_id: &str,
    succeeded: bool,
    result: Option<&str>,
) -> Result<TeamTaskInfo, DbError> {
    let t = task_entity::Entity::find_by_id(task_id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team task {task_id}")))?;
    let mut active: task_entity::ActiveModel = t.into();
    active.status = Set(if succeeded {
        TeamTaskStatus::Completed
    } else {
        TeamTaskStatus::Failed
    });
    active.result = Set(result.map(String::from));
    let updated = active.update(db).await?;
    Ok(to_task(updated))
}

/// Attach the produced conversation to a task (set by the member-launch path).
pub async fn attach_task_conversation(
    db: &DatabaseConnection,
    task_id: &str,
    conversation_id: i32,
) -> Result<TeamTaskInfo, DbError> {
    let t = task_entity::Entity::find_by_id(task_id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team task {task_id}")))?;
    let mut active: task_entity::ActiveModel = t.into();
    active.conversation_id = Set(Some(conversation_id));
    let updated = active.update(db).await?;
    Ok(to_task(updated))
}

/// Look up a task by its member conversation id (auto-report correlation).
pub async fn find_task_by_conversation(
    db: &DatabaseConnection,
    conversation_id: i32,
) -> Result<Option<TeamTaskInfo>, DbError> {
    let m = task_entity::Entity::find()
        .filter(task_entity::Column::ConversationId.eq(Some(conversation_id)))
        .one(db)
        .await?;
    Ok(m.map(to_task))
}
