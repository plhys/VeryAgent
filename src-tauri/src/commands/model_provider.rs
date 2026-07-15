use std::path::Path;

use crate::acp::manager::ConnectionManager;
use crate::acp::types::ConfigStaleKind;
use crate::app_error::AppCommandError;
use crate::commands::acp;
use crate::db::service::{agent_setting_service, model_provider_service};
use crate::db::AppDatabase;
use crate::models::agent::AgentType;
use crate::models::model_provider::ModelProviderInfo;
use crate::web::event_bridge::EventEmitter;

// ---------------------------------------------------------------------------
// Shared core functions
// ---------------------------------------------------------------------------

fn validate_fields(
    name: Option<&str>,
    api_url: Option<&str>,
    api_key: Option<&str>,
) -> Result<(), AppCommandError> {
    if let Some(n) = name {
        if n.len() > 256 {
            return Err(AppCommandError::invalid_input("Name must be 256 characters or less"));
        }
    }
    if let Some(u) = api_url {
        if u.len() > 2048 {
            return Err(AppCommandError::invalid_input("API URL must be 2048 characters or less"));
        }
        if !u.starts_with("http://") && !u.starts_with("https://") {
            return Err(AppCommandError::invalid_input(
                "API URL must start with http:// or https://",
            ));
        }
    }
    if let Some(k) = api_key {
        if k.len() > 4096 {
            return Err(AppCommandError::invalid_input("API Key must be 4096 characters or less"));
        }
    }
    Ok(())
}

pub async fn list_model_providers_core(
    db: &AppDatabase,
) -> Result<Vec<ModelProviderInfo>, AppCommandError> {
    let rows = model_provider_service::list_all(&db.conn)
        .await
        .map_err(AppCommandError::from)?;
    Ok(rows.into_iter().map(ModelProviderInfo::from).collect())
}

pub async fn get_model_provider_core(
    db: &AppDatabase,
    id: i32,
) -> Result<ModelProviderInfo, AppCommandError> {
    let row = model_provider_service::get_by_id(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("model provider not found: {id}")))?;
    Ok(ModelProviderInfo::from(row))
}

pub async fn create_model_provider_core(
    db: &AppDatabase,
    name: String,
    api_url: String,
    api_key: String,
) -> Result<ModelProviderInfo, AppCommandError> {
    validate_fields(Some(&name), Some(&api_url), Some(&api_key))?;
    let row = model_provider_service::create(&db.conn, name, api_url, api_key)
        .await
        .map_err(AppCommandError::from)?;
    Ok(ModelProviderInfo::from(row))
}

/// Update a model provider.
pub async fn update_model_provider_core(
    db: &AppDatabase,
    id: i32,
    name: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    emitter: &EventEmitter,
) -> Result<ModelProviderInfo, AppCommandError> {
    validate_fields(name.as_deref(), api_url.as_deref(), api_key.as_deref())?;

    let old = model_provider_service::get_by_id(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("model provider not found: {id}")))?;

    let row = model_provider_service::update(
        &db.conn, id, name.clone(), api_url.clone(), api_key.clone(),
    )
    .await
    .map_err(AppCommandError::from)?;

    let url_changed = api_url.as_deref().is_some_and(|u| u != old.api_url);
    let key_changed = api_key.as_deref().is_some_and(|k| k != old.api_key);

    if url_changed || key_changed {
        let final_url = api_url.as_deref().unwrap_or(&old.api_url);
        let final_key = api_key.as_deref().unwrap_or(&old.api_key);
        acp::cascade_update_model_provider(
            db,
            id,
            final_url,
            final_key,
            old.model.as_deref(),
            emitter,
        )
        .await
        .map_err(|e| AppCommandError::invalid_input(e.to_string()))?;
    }

    Ok(ModelProviderInfo::from(row))
}

/// Result of `update_model_provider`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModelProviderResult {
    pub provider: ModelProviderInfo,
    pub affected_running_sessions: usize,
}

pub async fn update_model_provider_and_refresh(
    db: &AppDatabase,
    manager: &ConnectionManager,
    data_dir: &Path,
    id: i32,
    name: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    emitter: &EventEmitter,
) -> Result<UpdateModelProviderResult, AppCommandError> {
    let provider = update_model_provider_core(db, id, name, api_url, api_key, emitter).await?;

    let agent_types: Vec<AgentType> = agent_setting_service::find_by_model_provider_id(&db.conn, id)
        .await
        .unwrap_or_default()
        .iter()
        .filter_map(|s| serde_json::from_str(&s.agent_type).ok())
        .collect();
    let affected_running_sessions = acp::refresh_config_staleness(
        manager, db, data_dir, &agent_types, ConfigStaleKind::ModelProvider,
    )
    .await;

    Ok(UpdateModelProviderResult { provider, affected_running_sessions })
}

pub async fn delete_model_provider_core(db: &AppDatabase, id: i32) -> Result<(), AppCommandError> {
    let dependents = agent_setting_service::find_by_model_provider_id(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?;

    if !dependents.is_empty() {
        let names: Vec<String> = dependents
            .iter()
            .filter_map(|row| {
                serde_json::from_str::<AgentType>(&row.agent_type)
                    .ok()
                    .map(|at| at.to_string())
            })
            .collect();
        return Err(AppCommandError::invalid_input(format!(
            "PROVIDER_IN_USE:{}",
            names.join(", ")
        )));
    }

    model_provider_service::delete(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn list_model_providers(
    db: tauri::State<'_, AppDatabase>,
) -> Result<Vec<ModelProviderInfo>, AppCommandError> {
    list_model_providers_core(&db).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn create_model_provider(
    db: tauri::State<'_, AppDatabase>,
    name: String,
    api_url: String,
    api_key: String,
) -> Result<ModelProviderInfo, AppCommandError> {
    create_model_provider_core(&db, name, api_url, api_key).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn update_model_provider(
    db: tauri::State<'_, AppDatabase>,
    manager: tauri::State<'_, ConnectionManager>,
    id: i32,
    name: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    app: tauri::AppHandle,
) -> Result<UpdateModelProviderResult, AppCommandError> {
    use tauri::Manager;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map(|p| crate::paths::resolve_effective_data_dir(&p))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let emitter = EventEmitter::Tauri(app);
    update_model_provider_and_refresh(
        &db, &manager, &app_data_dir, id, name, api_url, api_key, &emitter,
    )
    .await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn delete_model_provider(
    db: tauri::State<'_, AppDatabase>,
    id: i32,
) -> Result<(), AppCommandError> {
    delete_model_provider_core(&db, id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::fresh_in_memory_db;

    #[tokio::test]
    async fn create_and_list_tolerate_multibyte_api_key() {
        let db = fresh_in_memory_db().await;
        let created = create_model_provider_core(
            &db,
            "Provider".into(),
            "https://api.example.com".into(),
            "sk-密钥abcd1234".into(),
        )
        .await;
        assert!(created.is_ok());
        let rows = list_model_providers_core(&db).await.expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].api_key, "sk-密钥abcd1234");
        assert!(!rows[0].api_key_masked.is_empty());
    }

    #[tokio::test]
    async fn provider_credential_change_shifts_bound_agent_fingerprint() {
        use crate::db::entities::agent_setting;
        use crate::models::agent::AgentType;
        use sea_orm::{ActiveModelTrait, NotSet, Set};

        let db = fresh_in_memory_db().await;
        let data_dir = std::env::temp_dir();

        let provider = create_model_provider_core(
            &db, "Prov".into(), "https://api.example.com".into(), "sk-old-key".into(),
        )
        .await
        .expect("create");

        let now = chrono::Utc::now();
        agent_setting::ActiveModel {
            id: NotSet,
            agent_type: Set(serde_json::to_string(&AgentType::Codex).unwrap()),
            registry_id: Set("codex".into()),
            enabled: Set(true),
            sort_order: Set(0),
            installed_version: Set(None),
            env_json: Set(Some("{}".into())),
            model_provider_id: Set(Some(provider.id)),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&db.conn)
        .await
        .expect("insert");

        let fp_before = acp::compute_session_config_fingerprint(&db, AgentType::Codex, &data_dir)
            .await
            .expect("fp before");

        model_provider_service::update(
            &db.conn, provider.id, None, None, Some("sk-new-key".into()),
        )
        .await
        .expect("update key");

        let fp_after = acp::compute_session_config_fingerprint(&db, AgentType::Codex, &data_dir)
            .await
            .expect("fp after");
        assert_ne!(fp_before, fp_after);

        model_provider_service::update(
            &db.conn, provider.id, Some("Renamed".into()), None, None,
        )
        .await
        .expect("rename");

        let fp_rename = acp::compute_session_config_fingerprint(&db, AgentType::Codex, &data_dir)
            .await
            .expect("fp rename");
        assert_eq!(fp_after, fp_rename);
    }
}