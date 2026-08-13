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
        .filter(team::Column::DisbandedAt.is_null())
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
        .filter(team::Column::DisbandedAt.is_null())
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team {id}")))?;
    let tasks = task_entity::Entity::find()
        .filter(task_entity::Column::TeamId.eq(&t.id))
        .order_by_asc(task_entity::Column::CreatedAt)
        .all(db)
        .await?
        .into_iter()
        .map(to_task)
        .collect();
    let slots = {
        let s = slot_entity::Entity::find()
            .filter(slot_entity::Column::TeamId.eq(&t.id))
            .order_by_asc(slot_entity::Column::CreatedAt)
            .all(db)
            .await?
            .into_iter()
            .map(to_slot)
            .collect::<Vec<_>>();
        s
    };
    // Lazy leader-prompt upgrade: teams created before the state-awareness
    // prompt carry a legacy snapshot. Regenerate from current team data (name,
    // workspace, member list) and persist so the leader's next connect sees
    // the new behavior. Detected by the version marker — idempotent.
    let mut leader_prompt = t.leader_prompt.clone();
    let needs_upgrade = leader_prompt
        .as_deref()
        .map(|p| !p.contains(LEADER_PROMPT_VERSION_MARKER))
        .unwrap_or(true);
    if needs_upgrade {
        let fresh = build_default_leader_prompt(
            &t.name,
            &t.workspace,
            &member_desc_lines(&slots),
        );
        if leader_prompt.as_deref() != Some(fresh.as_str()) {
            let mut active: team::ActiveModel = t.clone().into();
            active.leader_prompt = Set(Some(fresh.clone()));
            active.update(db).await?;
        }
        leader_prompt = Some(fresh);
    }
    Ok(TeamInfo {
        id: t.id,
        name: t.name,
        leader_slot_id: t.leader_slot_id,
        workspace: t.workspace,
        leader_conversation_id: t.leader_conversation_id,
        leader_prompt,
        slots,
        tasks,
        created_at: t.created_at,
    })
}

/// Resolve the leader conversation's team id + leader_prompt in one query.
/// Returns `None` when `conversation_id` isn't any team's leader chat. The
/// prompt is lazily upgraded (legacy → state-aware) like [`get`] does, so a
/// leader conversation that predates the new prompt gets the fresh behavior
/// without a team edit.
pub async fn find_leader_prompt_by_conversation(
    db: &DatabaseConnection,
    conversation_id: i32,
) -> Result<Option<(String, String)>, DbError> {
    let t = team::Entity::find()
        .filter(team::Column::LeaderConversationId.eq(Some(conversation_id)))
        .filter(team::Column::DisbandedAt.is_null())
        .one(db)
        .await?;
    let Some(t) = t else {
        return Ok(None);
    };
    let slots = slot_entity::Entity::find()
        .filter(slot_entity::Column::TeamId.eq(&t.id))
        .order_by_asc(slot_entity::Column::CreatedAt)
        .all(db)
        .await?
        .into_iter()
        .map(to_slot)
        .collect::<Vec<_>>();
    let prompt = match t.leader_prompt.as_deref() {
        Some(p) if p.contains(LEADER_PROMPT_VERSION_MARKER) => p.to_string(),
        _ => {
            // Legacy / missing prompt — regenerate from current team data and
            // persist (mirror of `get`'s lazy upgrade).
            let fresh = build_default_leader_prompt(
                &t.name,
                &t.workspace,
                &member_desc_lines(&slots),
            );
            if t.leader_prompt.as_deref() != Some(fresh.as_str()) {
                let mut active: team::ActiveModel = t.clone().into();
                active.leader_prompt = Set(Some(fresh.clone()));
                active.update(db).await?;
            }
            fresh
        }
    };
    Ok(Some((t.id, prompt)))
}

pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbError> {
    let t = team::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team {id}")))?;
    t.delete(db).await?;
    Ok(())
}

/// Soft-archive a team: mark it disbanded (hidden from the sidebar) while
/// keeping every record (slots/tasks/conversations) so re-creating a team on
/// the same workspace can restore it. Idempotent.
pub async fn disband(db: &DatabaseConnection, id: &str) -> Result<(), DbError> {
    let t = team::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("team {id}")))?;
    let mut active: team::ActiveModel = t.into();
    active.disbanded_at = Set(Some(Utc::now()));
    active.update(db).await?;
    Ok(())
}

/// Restore the most recently disbanded team for a workspace, if any. Used by
/// team create so re-creating a team on the same folder revives the original
/// team (members/tasks/history) instead of minting a fresh one. Returns the
/// restored team summary, or `None` when no disbanded team exists for `workspace`.
pub async fn restore_by_workspace(
    db: &DatabaseConnection,
    workspace: &str,
) -> Result<Option<TeamSummaryInfo>, DbError> {
    let t = team::Entity::find()
        .filter(team::Column::Workspace.eq(workspace))
        .filter(team::Column::DisbandedAt.is_not_null())
        .order_by_desc(team::Column::DisbandedAt)
        .one(db)
        .await?;
    let Some(t) = t else {
        return Ok(None);
    };
    let mut active: team::ActiveModel = t.clone().into();
    active.disbanded_at = Set(None);
    let updated = active.update(db).await?;
    let count = slot_entity::Entity::find()
        .filter(slot_entity::Column::TeamId.eq(&updated.id))
        .count(db)
        .await?;
    Ok(Some(to_summary(updated, count as usize)))
}

/// Disband every ACTIVE team on a workspace so a newly created team becomes the
/// single active team for that folder. Their leader/member conversations are
/// soft-deleted too — otherwise the old teams' chats linger as extra "untitled
/// session" rows in the shared folder. Returns nothing; the caller goes on to
/// mint the new team.
pub async fn disband_active_by_workspace(
    db: &DatabaseConnection,
    workspace: &str,
) -> Result<(), DbError> {
    let teams = team::Entity::find()
        .filter(team::Column::Workspace.eq(workspace))
        .filter(team::Column::DisbandedAt.is_null())
        .all(db)
        .await?;
    for t in teams {
        // Collect BEFORE soft-deleting conversations — slot/task rows carry the
        // conversation_id and stay (we only flip disbanded_at here, no cascade).
        let conv_ids = collect_team_conversation_ids(db, &t.id).await?;
        let mut active: team::ActiveModel = t.into();
        active.disbanded_at = Set(Some(Utc::now()));
        active.update(db).await?;
        for cid in conv_ids {
            let _ = crate::db::service::conversation_service::soft_delete(db, cid).await;
        }
    }
    Ok(())
}

/// Collect every conversation the team owns, so the caller can delete them
/// together with the team row (true delete): the leader chat plus every member
/// working conversation and task-attached session. Call BEFORE deleting the
/// team — slot/task rows carry the `conversation_id` and vanish on cascade.
/// Returns ids in no particular order; dedupes (a slot and its task may share
/// one conversation).
pub async fn collect_team_conversation_ids(
    db: &DatabaseConnection,
    id: &str,
) -> Result<Vec<i32>, DbError> {
    let mut ids: Vec<i32> = Vec::new();
    let mut push = |id: Option<i32>| {
        if let Some(id) = id {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    };

    if let Some(t) = team::Entity::find_by_id(id).one(db).await? {
        push(t.leader_conversation_id);
    }
    for slot in slot_entity::Entity::find()
        .filter(slot_entity::Column::TeamId.eq(id))
        .all(db)
        .await?
    {
        push(slot.conversation_id);
    }
    for task in task_entity::Entity::find()
        .filter(task_entity::Column::TeamId.eq(id))
        .all(db)
        .await?
    {
        push(task.conversation_id);
    }
    Ok(ids)
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

/// Build the default role prompt for a team's leader (PM). Injected into the
/// leader conversation on connect so the leader knows it has a team to
/// decompose work for, who the members are, and how to delegate.
/// Member descriptors in the form `display_name（role1/role2）` for the
/// prompt's member hint. Works for both the draft slots (create) and the
/// stored `TeamSlotInfo` rows (lazy prompt upgrade in `get`).
fn member_desc_lines(
    slots: &[impl MemberDesc],
) -> String {
    let names = slots
        .iter()
        .filter(|s| !s.roles().iter().any(|r| r == ROLE_LEADER))
        .map(|s| format!("{}（{}）", s.display_name(), s.roles().join("/")))
        .collect::<Vec<_>>()
        .join("、");
    if names.is_empty() {
        "（创建团队时暂无成员，以 team_get_members 实时结果为准）".to_string()
    } else {
        format!("创建时的成员：{names}（以 team_get_members 实时结果为准）")
    }
}

/// Minimal accessor so [`member_desc_lines`] accepts both draft and stored
/// slot shapes without allocating.
trait MemberDesc {
    fn display_name(&self) -> &str;
    fn roles(&self) -> &[String];
}

impl MemberDesc for crate::models::TeamSlotDraft {
    fn display_name(&self) -> &str {
        &self.display_name
    }
    fn roles(&self) -> &[String] {
        &self.roles
    }
}

impl MemberDesc for crate::models::TeamSlotInfo {
    fn display_name(&self) -> &str {
        &self.display_name
    }
    fn roles(&self) -> &[String] {
        &self.roles
    }
}

/// Marker phrase present in the CURRENT leader prompt. Legacy prompts (the
/// pre-state-awareness version) lack it — `get` uses this to detect and
/// upgrade stored prompts in place so existing teams get the new behavior.
const LEADER_PROMPT_VERSION_MARKER: &str = "先认清自己的状态，再开口";

fn build_default_leader_prompt(name: &str, workspace: &str, member_hint: &str) -> String {
    format!(
        "你是团队「{}」的项目经理（领班）。\n\
         你的工作区：{}\n\
         {}\n\n\
         【先认清自己的状态，再开口】\n\
         老板（用户）每次给你发消息（哪怕只是打招呼），你先用工具刷新团队当前状态，再回应：\n\
         - 用 team_get_members 查看最新成员名单、角色和忙闲状态；\n\
         - 用 team_get_tasks 查看任务板上每项任务的状态和结果；\n\
         - 不要凭记忆或创建时的名单回答——状态以工具实时返回为准。\n\n\
         【老板打招呼 / 问你怎么用团队时】\n\
         如果老板说「你好」「你们团队怎么样」「你能做什么」之类：\n\
         1. 先介绍自己：你是这个团队的项目经理，负责把老板的目标拆解成任务并派给成员。\n\
         2. 用 team_get_members 拉取成员名单，把团队介绍给老板（谁是谁、什么角色）。\n\
         3. 简要说明协作方式：老板说清目标 → 你拆解成子任务 → 给出分配方案请老板确认 → 派给成员干活 → 你跟踪进度 → 完成后汇总汇报。\n\
         4. 最后问老板今天想做什么。不要长篇大论，两三句话讲清楚。\n\n\
         【老板布置任务时】\n\
         1. 用 team_get_members 确认有哪些成员可用，把目标拆解成清晰的子任务，规划谁做什么。\n\
         2. 派活前先向老板确认分配方案（说明把哪个子任务派给谁、为什么），用 ask_user_question 让老板确认。\n\
         3. 确认后用 team_assign_task 把任务派给成员。\n\
         4. 用 team_get_tasks 跟踪进度；成员完成后收集结果并汇总汇报给老板。\n\n\
         重要：你是项目经理，职责是拆解、分派、协调、汇总，而不是自己一个人把所有事做完。\n\
         如果任务很简单不需要分工，也要明确说明为什么不拆分，然后再动手。",
        name.trim(),
        workspace.trim(),
        member_hint,
    )
}

pub async fn create(db: &DatabaseConnection, draft: TeamDraft) -> Result<TeamInfo, DbError> {
    validate_draft(&draft)?;

    // Re-creating a team on a workspace that previously had a disbanded team
    // restores the original team (members/tasks/history all come back) instead
    // of minting a fresh one.
    if let Some(restored) = restore_by_workspace(db, draft.workspace.trim()).await? {
        return get(db, &restored.id).await;
    }

    // Take over any other ACTIVE teams on the same workspace: disband them and
    // soft-hide their leader/member conversations, so a re-created team is the
    // only active one and its folder shows a single conversation — not a pile
    // of leftover "untitled session" rows from earlier teams.
    disband_active_by_workspace(db, draft.workspace.trim()).await?;

    let team_id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let leader_prompt = build_default_leader_prompt(
        &draft.name,
        &draft.workspace,
        &member_desc_lines(&draft.slots),
    );

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
        leader_prompt: Set(Some(leader_prompt)),
        disbanded_at: Set(None),
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
