use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "vision_bridge")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub enabled: bool,
    pub api_url: String,
    pub api_key: String,
    pub model_name: String,
    pub agent_types_json: String,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
