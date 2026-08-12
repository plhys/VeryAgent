use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Live status of a team member slot, surfaced in the team page. Step 1 only
/// ever sets `idle`/`working`; `stuck`/`error` are reserved for the Step 2
/// heartbeat + stuck-detection work.
#[derive(Debug, Clone, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::None)")]
#[serde(rename_all = "snake_case")]
pub enum TeamSlotStatus {
    #[sea_orm(string_value = "idle")]
    Idle,
    #[sea_orm(string_value = "working")]
    Working,
    #[sea_orm(string_value = "stuck")]
    Stuck,
    #[sea_orm(string_value = "error")]
    Error,
}

/// One member of a team. A member is an existing agent (agent_type) that may
/// carry up to 3 roles (`roles` is a JSON array of role ids, e.g. `["dev"]`,
/// `["dev","test"]`). The leader is the slot whose roles contain `"leader"`.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "team_slot")]
pub struct Model {
    #[sea_orm(primary_key, string_len = 36)]
    pub id: String,
    pub team_id: String,
    pub agent_type: String,
    /// JSON array of role ids (leader/dev/test/doc/review). Kept as text — the
    /// wire form is a plain string array and nothing queries individual roles.
    #[sea_orm(column_type = "Text")]
    pub roles: String,
    pub display_name: String,
    pub status: TeamSlotStatus,
    /// The member's current working conversation (minted on task assign). The
    /// member mini-window streams it. None before the first task is assigned.
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
}

impl Related<super::team::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Team.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
