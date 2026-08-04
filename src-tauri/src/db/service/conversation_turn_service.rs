use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, Set,
};

use crate::db::entities::conversation_turn;
use crate::db::error::DbError;
use crate::models::message::{MessageTurn, TurnRole, TurnUsage};

pub async fn list(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<Vec<MessageTurn>, DbError> {
    let rows = conversation_turn::Entity::find()
        .filter(conversation_turn::Column::ConversationId.eq(conversation_id))
        .order_by_asc(conversation_turn::Column::Sequence)
        .all(conn)
        .await?;

    rows.into_iter()
        .map(|row| {
            let blocks = serde_json::from_str(&row.blocks_json)
                .map_err(|e| DbError::Migration(format!("invalid conversation turn blocks: {e}")))?;
            let role = match row.role.as_str() {
                "user" => TurnRole::User,
                "assistant" => TurnRole::Assistant,
                "system" => TurnRole::System,
                other => {
                    return Err(DbError::Migration(format!(
                        "invalid conversation turn role: {other}"
                    )))
                }
            };
            let usage = row
                .usage_json
                .as_deref()
                .map(serde_json::from_str::<TurnUsage>)
                .transpose()
                .map_err(|e| DbError::Migration(format!("invalid conversation turn usage: {e}")))?;
            Ok(MessageTurn {
                id: row.turn_id,
                role,
                blocks,
                timestamp: row.timestamp,
                usage,
                duration_ms: row.duration_ms.map(|v| v as u64),
                model: row.model,
                completed_at: row.completed_at,
            })
        })
        .collect()
}

pub async fn insert_if_absent(
    conn: &DatabaseConnection,
    conversation_id: i32,
    turn: &MessageTurn,
) -> Result<bool, DbError> {
    let exists = conversation_turn::Entity::find()
        .filter(conversation_turn::Column::ConversationId.eq(conversation_id))
        .filter(conversation_turn::Column::TurnId.eq(&turn.id))
        .one(conn)
        .await?;
    if exists.is_some() {
        return Ok(false);
    }

    let role = match turn.role {
        TurnRole::User => "user",
        TurnRole::Assistant => "assistant",
        TurnRole::System => "system",
    };
    let blocks_json = serde_json::to_string(&turn.blocks)
        .map_err(|e| DbError::Migration(format!("serialize conversation turn blocks: {e}")))?;
    let usage_json = turn
        .usage
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| DbError::Migration(format!("serialize conversation turn usage: {e}")))?;
    let sequence = conversation_turn::Entity::find()
        .filter(conversation_turn::Column::ConversationId.eq(conversation_id))
        .count(conn)
        .await? as i32;

    let model = conversation_turn::ActiveModel {
        id: sea_orm::ActiveValue::NotSet,
        conversation_id: Set(conversation_id),
        turn_id: Set(turn.id.clone()),
        sequence: Set(sequence),
        role: Set(role.to_string()),
        blocks_json: Set(blocks_json),
        timestamp: Set(turn.timestamp),
        completed_at: Set(turn.completed_at),
        usage_json: Set(usage_json),
        duration_ms: Set(turn.duration_ms.map(|v| v as i64)),
        model: Set(turn.model.clone()),
    };

    match model.insert(conn).await {
        Ok(_) => Ok(true),
        Err(e) if e.to_string().contains("UNIQUE") => Ok(false),
        Err(e) => Err(e.into()),
    }
}

pub async fn count(conn: &DatabaseConnection, conversation_id: i32) -> Result<u64, DbError> {
    Ok(conversation_turn::Entity::find()
        .filter(conversation_turn::Column::ConversationId.eq(conversation_id))
        .count(conn)
        .await?)
}
