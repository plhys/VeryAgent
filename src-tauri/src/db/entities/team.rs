use sea_orm::entity::prelude::*;

/// A collaboration team: one leader slot + N member slots, all working in the
/// shared `workspace` folder. The leader conversation (opened lazily from the
/// team page) is the single place member progress reports are gathered.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "team")]
pub struct Model {
    #[sea_orm(primary_key, string_len = 36)]
    pub id: String,
    pub name: String,
    /// The team_slot id of the leader. A team has exactly one leader.
    pub leader_slot_id: String,
    /// Absolute path of the shared workspace folder members run in.
    pub workspace: String,
    /// The conversation the leader chats in (created on demand). NULL until the
    /// user first opens "Leader conversation".
    pub leader_conversation_id: Option<i32>,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::team_slot::Entity")]
    Slots,
    #[sea_orm(has_many = "super::team_task::Entity")]
    Tasks,
}

impl Related<super::team_slot::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Slots.def()
    }
}

impl Related<super::team_task::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Tasks.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
