use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Lifecycle of a single task assigned to a team member. Step 1: created by the
/// user (manual assignment) as `pending`, flipped to `in_progress` when the
/// member's session is launched, and settled by the auto-report subscriber on
/// TurnComplete (`completed`/`failed`).
#[derive(Debug, Clone, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::None)")]
#[serde(rename_all = "snake_case")]
pub enum TeamTaskStatus {
    #[sea_orm(string_value = "pending")]
    Pending,
    #[sea_orm(string_value = "in_progress")]
    InProgress,
    #[sea_orm(string_value = "completed")]
    Completed,
    #[sea_orm(string_value = "failed")]
    Failed,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "team_task")]
pub struct Model {
    #[sea_orm(primary_key, string_len = 36)]
    pub id: String,
    pub team_id: String,
    pub subject: String,
    pub description: Option<String>,
    pub status: TeamTaskStatus,
    /// The team_slot id the task is assigned to.
    pub owner_slot_id: String,
    /// Result summary (from the member's final answer / auto-report).
    pub result: Option<String>,
    /// The member conversation minted for this task. SET NULL if deleted, so
    /// the task row survives. Used by the auto-report subscriber to correlate
    /// TurnComplete → task.
    pub conversation_id: Option<i32>,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::team::Entity",
        from = "Column::TeamId",
        to = "super::team::Column::Id"
    )]
    Team,
    #[sea_orm(
        belongs_to = "super::team_slot::Entity",
        from = "Column::OwnerSlotId",
        to = "super::team_slot::Column::Id"
    )]
    Owner,
}

impl Related<super::team::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Team.def()
    }
}

impl Related<super::team_slot::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Owner.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
