use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub use crate::db::entities::team_slot::TeamSlotStatus;
pub use crate::db::entities::team_task::TeamTaskStatus;

/// Role ids shared with the frontend (mirror `src/lib/team.ts` ROLE ids).
pub const ROLE_LEADER: &str = "leader";
pub const ROLE_DEV: &str = "dev";
pub const ROLE_TEST: &str = "test";
pub const ROLE_DOC: &str = "doc";
pub const ROLE_REVIEW: &str = "review";

/// Team list row — the sidebar/team-list needs name + leader + member count,
/// not every slot and task. `leader_conversation_id` lets the frontend detect
/// "this conversation is a team leader chat" without fetching full detail.
#[derive(Debug, Clone, Serialize)]
pub struct TeamSummaryInfo {
    pub id: String,
    pub name: String,
    pub leader_slot_id: String,
    pub workspace: String,
    pub leader_conversation_id: Option<i32>,
    pub member_count: usize,
    pub created_at: DateTime<Utc>,
}

/// Full team detail: the team row plus its slots and tasks.
#[derive(Debug, Clone, Serialize)]
pub struct TeamInfo {
    pub id: String,
    pub name: String,
    pub leader_slot_id: String,
    pub workspace: String,
    pub leader_conversation_id: Option<i32>,
    pub slots: Vec<TeamSlotInfo>,
    pub tasks: Vec<TeamTaskInfo>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TeamSlotInfo {
    pub id: String,
    pub team_id: String,
    pub agent_type: String,
    pub roles: Vec<String>,
    pub display_name: String,
    pub status: TeamSlotStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TeamTaskInfo {
    pub id: String,
    pub team_id: String,
    pub subject: String,
    pub description: Option<String>,
    pub status: TeamTaskStatus,
    pub owner_slot_id: String,
    pub result: Option<String>,
    pub conversation_id: Option<i32>,
    pub created_at: DateTime<Utc>,
}

/// Create-team payload. One slot per member; the leader is the slot whose
/// `roles` contains `"leader"`.
#[derive(Debug, Clone, Deserialize)]
pub struct TeamDraft {
    pub name: String,
    pub workspace: String,
    pub slots: Vec<TeamSlotDraft>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TeamSlotDraft {
    pub agent_type: String,
    pub display_name: String,
    pub roles: Vec<String>,
}
