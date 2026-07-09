use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, DatabaseConnection, EntityTrait, IntoActiveModel,
    QueryOrder, Set,
};

use crate::db::entities::model_provider;
use crate::db::error::DbError;

pub async fn create(
    conn: &DatabaseConnection,
    name: String,
    api_url: String,
    api_key: String,
    agent_types: Vec<String>,
    model: Option<String>,
) -> Result<model_provider::Model, DbError> {
    let now = Utc::now();
    let agent_types_json = serde_json::to_string(&agent_types).unwrap_or_else(|_| "[]".to_string());
    // Keep agent_type (legacy single-value column) in sync with the first
    // element of agent_types for backward compat with any code that still
    // reads it directly.
    let agent_type = agent_types.first().cloned().unwrap_or_default();
    let active = model_provider::ActiveModel {
        id: NotSet,
        name: Set(name),
        api_url: Set(api_url),
        api_key: Set(api_key),
        agent_types_json: Set(agent_types_json),
        agent_type: Set(agent_type),
        model: Set(model),
        created_at: Set(now),
        updated_at: Set(now),
    };
    Ok(active.insert(conn).await?)
}

pub async fn update(
    conn: &DatabaseConnection,
    id: i32,
    name: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    agent_types: Option<Vec<String>>,
    model: Option<Option<String>>,
) -> Result<model_provider::Model, DbError> {
    let model_row = model_provider::Entity::find_by_id(id)
        .one(conn)
        .await?
        .ok_or_else(|| DbError::Migration(format!("model provider not found: {id}")))?;

    let mut active = model_row.into_active_model();
    if let Some(v) = name {
        active.name = Set(v);
    }
    if let Some(v) = api_url {
        active.api_url = Set(v);
    }
    if let Some(v) = api_key {
        active.api_key = Set(v);
    }
    if let Some(v) = agent_types {
        let agent_types_json =
            serde_json::to_string(&v).unwrap_or_else(|_| "[]".to_string());
        active.agent_types_json = Set(agent_types_json);
        // Keep legacy column in sync.
        active.agent_type = Set(v.first().cloned().unwrap_or_default());
    }
    if let Some(v) = model {
        active.model = Set(v);
    }
    active.updated_at = Set(Utc::now());
    Ok(active.update(conn).await?)
}

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError> {
    model_provider::Entity::delete_by_id(id).exec(conn).await?;
    Ok(())
}

pub async fn get_by_id(
    conn: &DatabaseConnection,
    id: i32,
) -> Result<Option<model_provider::Model>, DbError> {
    Ok(model_provider::Entity::find_by_id(id).one(conn).await?)
}

pub async fn list_all(conn: &DatabaseConnection) -> Result<Vec<model_provider::Model>, DbError> {
    Ok(model_provider::Entity::find()
        .order_by_asc(model_provider::Column::Id)
        .all(conn)
        .await?)
}
