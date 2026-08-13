//! Team collaboration access for the veryagent-mcp companion tools.
//!
//! The leader (PM) agent gets three MCP tools — `team_get_members`,
//! `team_assign_task`, `team_get_tasks` — so it can decompose a boss's goal
//! into sub-tasks, assign them to members, and track results, instead of doing
//! everything itself. The listener resolves the team by the calling
//! connection's leader conversation id (from the token) and delegates to
//! [`TeamAccess`]; the production impl (`ConnectionManagerTeamLookup`) wraps
//! the `ConnectionManager` + `AppDatabase`.

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use tokio::sync::RwLock;

use crate::db::AppDatabase;

/// Serde-serialize a `TeamSlotStatus` to its snake_case wire string
/// (`idle`/`working`/`stuck`/`error`) — matching what the frontend + the
/// leader's `team_get_members` tool both consume. `format!("{:?}")` would
/// yield `Idle`/`Working`, which the LLM can't map to the documented states.
fn slot_status_str(s: &crate::db::entities::team_slot::TeamSlotStatus) -> String {
    serde_json::to_value(s)
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string())
}

/// Same for `TeamTaskStatus`: `pending`/`in_progress`/`completed`/`failed`.
fn task_status_str(s: &crate::db::entities::team_task::TeamTaskStatus) -> String {
    serde_json::to_value(s)
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string())
}

/// A team member as surfaced to the leader's `team_get_members` tool.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberInfo {
    pub slot_id: String,
    pub display_name: String,
    pub agent_type: String,
    pub roles: Vec<String>,
    pub status: String,
}

/// Team identity metadata surfaced alongside member/task listings so the
/// leader knows which team it leads and where that team works.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMetaInfo {
    pub team_id: String,
    pub name: String,
    pub workspace: String,
}

/// Outcome of `team_assign_task`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamAssignOutcome {
    pub task_id: String,
    pub conversation_id: Option<i32>,
    /// The spawned member agent connection id — the frontend attaches this
    /// connection (viewer-style) to stream the member's work live.
    pub connection_id: Option<String>,
    pub slot_id: String,
    pub subject: String,
    /// The member agent type, carried so the frontend can attach with the
    /// right agent (mirrors `DelegationStarted.agent_type`).
    pub agent_type: crate::models::AgentType,
    pub status: String,
}

/// A task row as surfaced to the leader's `team_get_tasks` tool.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamTaskInfoWire {
    pub id: String,
    pub subject: String,
    pub description: Option<String>,
    pub status: String,
    pub owner_slot_id: String,
    pub result: Option<String>,
    pub conversation_id: Option<i32>,
    pub created_at: String,
}

/// Listener-facing access to the calling agent's team. The production impl
/// resolves the team by the leader conversation of the calling connection.
#[async_trait]
pub trait TeamAccess: Send + Sync {
    /// Resolve the team id for a leader conversation (the calling connection).
    /// `None` when the conversation isn't a team leader chat.
    async fn team_id_for_leader_conversation(
        &self,
        leader_conversation_id: i32,
    ) -> Option<String>;

    /// Team identity metadata for the given team (name + workspace). Lets the
    /// `team_get_members` / `team_get_tasks` tools tell the leader WHICH team it
    /// is leading and WHERE it works — the "where am I" half of state awareness.
    async fn team_meta(&self, team_id: &str) -> Option<TeamMetaInfo>;

    /// List the team's members (excluding the leader slot itself).
    async fn list_members(&self, team_id: &str) -> Vec<TeamMemberInfo>;

    /// Assign a task to a member and make them start working. Returns the
    /// created task.
    async fn assign_task(
        &self,
        team_id: &str,
        slot_id: &str,
        subject: &str,
        description: Option<&str>,
    ) -> Result<TeamAssignOutcome, String>;

    /// Emit a `TeamMemberStarted` ACP event on the leader's connection stream
    /// after an auto-assign spawns a member. Lets the frontend attach the
    /// member connection and stream its work live. No-op when the leader
    /// connection isn't alive or the impl has no emitter (tests).
    async fn emit_member_started(
        &self,
        leader_connection_id: &str,
        team_id: &str,
        slot_id: &str,
        connection_id: &str,
        conversation_id: i32,
        agent_type: crate::models::AgentType,
    );

    /// List the team's tasks (newest first).
    async fn list_tasks(&self, team_id: &str) -> Vec<TeamTaskInfoWire>;
}

/// Hot-swappable "is team collaboration enabled for this agent?" config, read
/// at MCP injection time. Team tools are injected when enabled (default on).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamConfig {
    pub enabled: bool,
}

impl Default for TeamConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

/// Shared, hot-swappable handle to [`TeamConfig`]. Mirrors
/// `FeedbackRuntimeConfig`; injected into `DelegationInjection` at startup.
#[derive(Clone, Default)]
pub struct TeamRuntimeConfig {
    inner: Arc<RwLock<TeamConfig>>,
}

impl TeamRuntimeConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn snapshot(&self) -> TeamConfig {
        self.inner.read().await.clone()
    }

    pub async fn set(&self, cfg: TeamConfig) {
        *self.inner.write().await = cfg;
    }

    /// Convenience read used at MCP injection time.
    pub async fn is_enabled(&self) -> bool {
        self.inner.read().await.enabled
    }
}

/// Production [`TeamAccess`] impl backed by the `ConnectionManager` (for
/// spawning member agents) and `AppDatabase` (for team/task rows).
#[derive(Clone)]
pub struct ConnectionManagerTeamLookup {
    pub manager: Arc<crate::acp::manager::ConnectionManager>,
    pub db: Arc<AppDatabase>,
    pub app_data_dir: std::path::PathBuf,
    /// Emitter for the `team://changed` side-channel. Auto-assign must notify
    /// the frontend so the task board refreshes (mirror of `emit_team` in the
    /// Tauri command path). Production uses Tauri / WebOnly; tests pass Noop.
    pub emitter: crate::web::event_bridge::EventEmitter,
}

#[async_trait]
impl TeamAccess for ConnectionManagerTeamLookup {
    async fn team_id_for_leader_conversation(
        &self,
        leader_conversation_id: i32,
    ) -> Option<String> {
        use crate::db::entities::team;
        let rows = team::Entity::find()
            .filter(team::Column::LeaderConversationId.eq(Some(leader_conversation_id)))
            .all(&self.db.conn)
            .await
            .ok()?;
        rows.into_iter().next().map(|t| t.id)
    }

    async fn team_meta(&self, team_id: &str) -> Option<TeamMetaInfo> {
        use crate::db::entities::team;
        let t = team::Entity::find_by_id(team_id).one(&self.db.conn).await.ok()?;
        t.map(|t| TeamMetaInfo {
            team_id: t.id,
            name: t.name,
            workspace: t.workspace,
        })
    }

    async fn list_members(&self, team_id: &str) -> Vec<TeamMemberInfo> {
        use crate::db::entities::team_slot;
        let slots = match team_slot::Entity::find()
            .filter(team_slot::Column::TeamId.eq(team_id))
            .all(&self.db.conn)
            .await
        {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let mut members: Vec<TeamMemberInfo> = slots
            .into_iter()
            .filter(|s| {
                let roles: Vec<String> =
                    serde_json::from_str(&s.roles).unwrap_or_default();
                !roles.iter().any(|r| r == "leader")
            })
            .map(|s| {
                let roles: Vec<String> =
                    serde_json::from_str(&s.roles).unwrap_or_default();
                TeamMemberInfo {
                    slot_id: s.id,
                    display_name: s.display_name,
                    agent_type: s.agent_type,
                    roles,
                    status: slot_status_str(&s.status),
                }
            })
            .collect();
        members.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        members
    }

    async fn assign_task(
        &self,
        team_id: &str,
        slot_id: &str,
        subject: &str,
        description: Option<&str>,
    ) -> Result<TeamAssignOutcome, String> {
        let team = match crate::db::service::team_service::get(&self.db.conn, team_id).await {
            Ok(t) => t,
            Err(e) => return Err(format!("team not found: {e}")),
        };
        let slot = team
            .slots
            .iter()
            .find(|s| s.id == slot_id)
            .ok_or_else(|| format!("slot {slot_id} not found in team"))?;
        let agent_type: crate::models::AgentType = crate::models::AgentType::from_stored_str(
            &slot.agent_type,
        )
        .ok_or_else(|| format!("agent_type: unknown agent type {}", slot.agent_type))?;

        let folder = crate::db::service::folder_service::add_folder(
            &self.db.conn,
            &team.workspace,
        )
        .await
        .map_err(|e| format!("folder: {e}"))?;

        let conv_id = crate::db::service::conversation_service::create(
            &self.db.conn,
            folder.id,
            agent_type,
            Some(subject.to_string()),
            None,
        )
        .await
        .map_err(|e| format!("conv: {e}"))?
        .id;

        let task = crate::db::service::team_service::assign_task(
            &self.db.conn,
            team_id,
            slot_id,
            subject,
            description,
            Some(conv_id),
        )
        .await
        .map_err(|e| format!("assign: {e}"))?;

        let runtime_env = crate::commands::acp::build_session_runtime_env(
            &self.db,
            agent_type,
            None,
            &self.app_data_dir,
        )
        .await
        .map_err(|e| format!("env: {e}"))?;

        let conn_id = self
            .manager
            .spawn_agent(
                agent_type,
                Some(team.workspace.clone()),
                None,
                runtime_env,
                "main".to_string(),
                self.emitter.clone(),
                None,
                std::collections::BTreeMap::new(),
            )
            .await
            .map_err(|e| format!("spawn: {e}"))?;

        let block = crate::acp::types::PromptInputBlock::Text {
            text: format!(
                "你是团队「{}」的成员（角色：{}），在共享工作区 {} 中执行任务。\n\n任务：{}",
                team.name,
                slot.roles.join("/"),
                team.workspace,
                subject
            ),
        };
        let _ = self
            .manager
            .send_prompt_linked(
                &self.db,
                &conn_id,
                vec![block],
                Some(folder.id),
                Some(conv_id),
                None,
            )
            .await;

        // Notify the frontend so the task board + member strip refresh with
        // the new in_progress task (mirror of `emit_team` in commands/team.rs).
        crate::web::event_bridge::emit_event(
            &self.emitter,
            crate::web::event_bridge::TEAM_CHANGED_EVENT,
            crate::web::event_bridge::TeamChange::Upsert {
                id: team_id.to_string(),
            },
        );

        Ok(TeamAssignOutcome {
            task_id: task.id,
            conversation_id: Some(conv_id),
            connection_id: Some(conn_id),
            slot_id: slot_id.to_string(),
            subject: subject.to_string(),
            agent_type,
            status: task_status_str(&task.status),
        })
    }

    async fn emit_member_started(
        &self,
        leader_connection_id: &str,
        team_id: &str,
        slot_id: &str,
        connection_id: &str,
        conversation_id: i32,
        agent_type: crate::models::AgentType,
    ) {
        let Some((state, emitter)) = self.manager.get_state_and_emitter(leader_connection_id).await
        else {
            return;
        };
        crate::web::event_bridge::emit_with_state(
            &state,
            &emitter,
            crate::acp::AcpEvent::TeamMemberStarted {
                team_id: team_id.to_string(),
                slot_id: slot_id.to_string(),
                member_connection_id: connection_id.to_string(),
                conversation_id,
                agent_type,
            },
        )
        .await;
    }

    async fn list_tasks(&self, team_id: &str) -> Vec<TeamTaskInfoWire> {
        let tasks = match crate::db::service::team_service::list_tasks(
            &self.db.conn,
            team_id,
        )
        .await
        {
            Ok(t) => t,
            Err(_) => return vec![],
        };
        tasks
            .into_iter()
            .map(|t| TeamTaskInfoWire {
                id: t.id,
                subject: t.subject,
                description: t.description,
                status: task_status_str(&t.status),
                owner_slot_id: t.owner_slot_id,
                result: t.result,
                conversation_id: t.conversation_id,
                created_at: t.created_at.to_string(),
            })
            .collect()
    }
}
