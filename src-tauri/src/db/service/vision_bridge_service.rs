//! CRUD service for the `vision_bridge` configuration table.
//!
//! The table holds a single row (id = 1) that configures the multimodal
//! vision bridge plugin: which vision model to call, where, and for which
//! agent types.

use chrono::Utc;
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set};

use crate::db::entities::vision_bridge;

/// The well-known row id for the vision_bridge configuration singleton.
pub const VISION_BRIDGE_CONFIG_ID: i32 = 1;

/// Shape returned to the frontend / command layer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VisionBridgeConfig {
    pub enabled: bool,
    pub api_url: String,
    pub api_key: String,
    pub model_name: String,
    pub agent_types_list: Vec<String>,
    pub updated_at: chrono::DateTime<Utc>,
}

/// Shape accepted by the save command (no id or updated_at — those are
/// server-managed).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VisionBridgeConfigUpdate {
    pub enabled: bool,
    pub api_url: String,
    pub api_key: String,
    pub model_name: String,
    pub agent_types_list: Vec<String>,
}

/// Read the current vision_bridge configuration. Returns a default (disabled)
/// config if the row does not yet exist.
pub async fn get_config(conn: &DatabaseConnection) -> VisionBridgeConfig {
    let row = vision_bridge::Entity::find_by_id(VISION_BRIDGE_CONFIG_ID)
        .one(conn)
        .await
        .ok()
        .flatten();

    match row {
        Some(model) => VisionBridgeConfig {
            enabled: model.enabled,
            api_url: model.api_url,
            api_key: model.api_key,
            model_name: model.model_name,
            agent_types_list: serde_json::from_str(&model.agent_types_json)
                .unwrap_or_else(|_| Vec::new()),
            updated_at: model.updated_at,
        },
        None => VisionBridgeConfig {
            enabled: false,
            api_url: String::new(),
            api_key: String::new(),
            model_name: String::new(),
            agent_types_list: Vec::new(),
            updated_at: Utc::now(),
        },
    }
}

/// Create or update the vision_bridge configuration row.
/// Uses explicit insert/update (matching the project's other services)
/// instead of the unreliable `ActiveModel::save()` auto-detect.
pub async fn save_config(
    conn: &DatabaseConnection,
    update: VisionBridgeConfigUpdate,
) -> Result<VisionBridgeConfig, sea_orm::DbErr> {
    let agent_types_json =
        serde_json::to_string(&update.agent_types_list).unwrap_or_else(|_| "[]".to_string());
    let now = Utc::now();

    let existing = vision_bridge::Entity::find_by_id(VISION_BRIDGE_CONFIG_ID)
        .one(conn)
        .await?;

    let model = match existing {
        Some(row) => {
            // Row exists → UPDATE
            let mut active: vision_bridge::ActiveModel = row.into();
            active.enabled = Set(update.enabled);
            active.api_url = Set(update.api_url);
            active.api_key = Set(update.api_key);
            active.model_name = Set(update.model_name);
            active.agent_types_json = Set(agent_types_json);
            active.updated_at = Set(now);
            active.update(conn).await?
        }
        None => {
            // No row → INSERT
            let active = vision_bridge::ActiveModel {
                id: Set(VISION_BRIDGE_CONFIG_ID),
                enabled: Set(update.enabled),
                api_url: Set(update.api_url),
                api_key: Set(update.api_key),
                model_name: Set(update.model_name),
                agent_types_json: Set(agent_types_json),
                updated_at: Set(now),
            };
            active.insert(conn).await?
        }
    };

    Ok(VisionBridgeConfig {
        enabled: model.enabled,
        api_url: model.api_url,
        api_key: model.api_key,
        model_name: model.model_name,
        agent_types_list: serde_json::from_str(&model.agent_types_json)
            .unwrap_or_else(|_| Vec::new()),
        updated_at: model.updated_at,
    })
}
