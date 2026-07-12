//! Tauri commands for the multimodal vision bridge plugin configuration.

use crate::acp::vision_bridge::VisionBridgeRuntimeConfig;
use crate::app_error::{AppCommandError, AppErrorCode};
use crate::db::service::vision_bridge_service::{get_config, save_config};
use crate::db::AppDatabase;
use crate::web::event_bridge::{emit_event, VISION_BRIDGE_SETTINGS_CHANGED_EVENT};

// Re-export so HTTP handlers and Tauri command wrappers can use the same type.
pub use crate::db::service::vision_bridge_service::{VisionBridgeConfig, VisionBridgeConfigUpdate};

// ---------------------------------------------------------------------------
// Core functions (no Tauri dependency)
// ---------------------------------------------------------------------------

pub async fn vision_bridge_get_config_core(db: &AppDatabase) -> VisionBridgeConfig {
    get_config(&db.conn).await
}

pub async fn vision_bridge_save_config_core(
    db: &AppDatabase,
    runtime_config: &VisionBridgeRuntimeConfig,
    emitter: &crate::web::event_bridge::EventEmitter,
    update: VisionBridgeConfigUpdate,
) -> Result<VisionBridgeConfig, AppCommandError> {
    let result = save_config(&db.conn, update)
        .await
        .map_err(|e| AppCommandError::new(AppErrorCode::TaskExecutionFailed, e.to_string()))?;
    // Hot-swap the runtime config so MCP injection reads the updated state.
    runtime_config
        .set(crate::acp::vision_bridge::VisionBridgeRuntimeState {
            enabled: result.enabled,
            agent_types: result.agent_types_list.clone(),
        })
        .await;
    // Broadcast to all windows so the conversation indicator updates live.
    emit_event(emitter, VISION_BRIDGE_SETTINGS_CHANGED_EVENT, &result);
    Ok(result)
}

/// Push the persisted vision_bridge DB row into the runtime config so MCP
/// injection picks up the current state before any listener accept.
pub async fn apply_persisted_vision_bridge_config(
    db_conn: &sea_orm::DatabaseConnection,
    runtime_config: &VisionBridgeRuntimeConfig,
) {
    let db = AppDatabase { conn: db_conn.clone() };
    let config = vision_bridge_get_config_core(&db).await;
    runtime_config
        .set(crate::acp::vision_bridge::VisionBridgeRuntimeState {
            enabled: config.enabled,
            agent_types: config.agent_types_list,
        })
        .await;
}

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn vision_bridge_get_config(
    db: tauri::State<'_, AppDatabase>,
) -> Result<VisionBridgeConfig, String> {
    Ok(vision_bridge_get_config_core(&db).await)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn vision_bridge_save_config(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    runtime_config: tauri::State<'_, VisionBridgeRuntimeConfig>,
    settings: VisionBridgeConfigUpdate,
) -> Result<VisionBridgeConfig, String> {
    let emitter = crate::web::event_bridge::EventEmitter::Tauri(app);
    vision_bridge_save_config_core(&db, &runtime_config, &emitter, settings)
        .await
        .map_err(|e| e.to_string())
}
