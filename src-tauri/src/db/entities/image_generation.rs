use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "image_generation")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub enabled: bool,
    pub api_url: String,
    pub api_key: String,
    pub model_name: String,
    pub default_size: String,
    /// JSON array of gateway entries (note / priority / credentials).
    /// Empty string means "derive from legacy flat columns".
    pub gateways_json: String,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
