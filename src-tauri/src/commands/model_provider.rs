use std::collections::HashMap;
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
// Shared core functions (used by both Tauri commands and web handlers)
// ---------------------------------------------------------------------------

/// Validate a list of agent types — must be non-empty and all valid.
fn validate_agent_types(agent_types: &[String]) -> Result<(), AppCommandError> {
    if agent_types.is_empty() {
        return Err(AppCommandError::invalid_input(
            "At least one agent type is required",
        ));
    }
    // Deduplicate while preserving order.
    let mut seen = std::collections::HashSet::new();
    for at in agent_types {
        if !seen.insert(at.clone()) {
            return Err(AppCommandError::invalid_input(format!(
                "Duplicate agent type: {at}"
            )));
        }
        // Validate each individual agent type string.
        if at.trim().is_empty() {
            return Err(AppCommandError::invalid_input("Agent type is required"));
        }
        let _: AgentType = serde_json::from_value(serde_json::Value::String(at.clone()))
            .map_err(|_| AppCommandError::invalid_input(format!("Invalid agent type: {at}")))?;
    }
    Ok(())
}

fn validate_fields(
    name: Option<&str>,
    api_url: Option<&str>,
    api_key: Option<&str>,
) -> Result<(), AppCommandError> {
    if let Some(n) = name {
        if n.len() > 256 {
            return Err(AppCommandError::invalid_input(
                "Name must be 256 characters or less",
            ));
        }
    }
    if let Some(u) = api_url {
        if u.len() > 2048 {
            return Err(AppCommandError::invalid_input(
                "API URL must be 2048 characters or less",
            ));
        }
        if !u.starts_with("http://") && !u.starts_with("https://") {
            return Err(AppCommandError::invalid_input(
                "API URL must start with http:// or https://",
            ));
        }
    }
    if let Some(k) = api_key {
        if k.len() > 4096 {
            return Err(AppCommandError::invalid_input(
                "API Key must be 4096 characters or less",
            ));
        }
    }
    Ok(())
}

/// Validate model values for each agent type.
/// `models` is a map of agent_type -> model string. For claude_code the model
/// must be a JSON object; for others a plain string.
fn validate_models(
    models: &HashMap<String, String>,
) -> Result<(), AppCommandError> {
    for (agent_type, raw) in models {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.len() > 4096 {
            return Err(AppCommandError::invalid_input(
                "Model must be 4096 characters or less",
            ));
        }
        // ClaudeCode requires a JSON object; other agents accept a plain string.
        if agent_type == "claude_code" {
            let value: serde_json::Value = serde_json::from_str(trimmed).map_err(|e| {
                AppCommandError::invalid_input(format!("Invalid Claude model JSON: {e}"))
            })?;
            if !value.is_object() {
                return Err(AppCommandError::invalid_input(
                    "Claude model must be a JSON object",
                ));
            }
        }
    }
    Ok(())
}

/// Serialize a `models` map (agent_type -> model string) into a JSON object
/// string for storage. Empty/blank values are dropped. Returns None if the
/// result is an empty object.
fn serialize_models(models: &HashMap<String, String>) -> Option<String> {
    let mut obj = serde_json::Map::new();
    for (agent_type, raw) in models {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        // If the value is valid JSON, embed it as-is (preserves Claude's JSON
        // object); otherwise embed as a JSON string.
        let value = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
            parsed
        } else {
            serde_json::Value::String(trimmed.to_string())
        };
        obj.insert(agent_type.clone(), value);
    }
    if obj.is_empty() {
        return None;
    }
    Some(serde_json::Value::Object(obj).to_string())
}

pub async fn list_model_providers_core(
    db: &AppDatabase,
) -> Result<Vec<ModelProviderInfo>, AppCommandError> {
    let rows = model_provider_service::list_all(&db.conn)
        .await
        .map_err(AppCommandError::from)?;
    Ok(rows.into_iter().map(ModelProviderInfo::from).collect())
}

pub async fn create_model_provider_core(
    db: &AppDatabase,
    name: String,
    api_url: String,
    api_key: String,
    agent_types: Vec<String>,
    models: HashMap<String, String>,
) -> Result<ModelProviderInfo, AppCommandError> {
    validate_fields(Some(&name), Some(&api_url), Some(&api_key))?;
    validate_agent_types(&agent_types)?;
    validate_models(&models)?;

    let model = serialize_models(&models);
    let model_row =
        model_provider_service::create(&db.conn, name, api_url, api_key, agent_types, model)
            .await
            .map_err(AppCommandError::from)?;
    Ok(ModelProviderInfo::from(model_row))
}

/// Update a model provider. For the `models` parameter:
/// - `None` (omitted) means "don't change"
/// - `Some(map)` means "merge into the stored model JSON — new keys overwrite,
///   absent keys are left untouched"
#[allow(clippy::too_many_arguments)]
pub async fn update_model_provider_core(
    db: &AppDatabase,
    id: i32,
    name: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    agent_types: Option<Vec<String>>,
    models: Option<HashMap<String, String>>,
    emitter: &EventEmitter,
) -> Result<ModelProviderInfo, AppCommandError> {
    validate_fields(name.as_deref(), api_url.as_deref(), api_key.as_deref())?;
    if let Some(ref ats) = agent_types {
        validate_agent_types(ats)?;
    }
    if let Some(ref ms) = models {
        validate_models(ms)?;
    }

    // Fetch old provider to detect changes and merge model data.
    let old_provider = model_provider_service::get_by_id(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("model provider not found: {id}")))?;

    // Compute the final agent_types (for model merge & cascade).
    let final_agent_types = agent_types
        .as_ref()
        .cloned()
        .unwrap_or_else(|| {
            parse_agent_types_from_info(&old_provider)
        });

    // Compute the final model: merge the new models map into the existing stored model.
    let final_model = if let Some(ref new_models) = models {
        // Start from the existing model JSON, then overlay new entries.
        let mut existing_obj: serde_json::Map<String, serde_json::Value> = old_provider
            .model
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok())
            .and_then(|v: serde_json::Value| v.as_object().cloned())
            .unwrap_or_default();
        let new_serialized = serialize_models(new_models);
        if let Some(ref new_json) = new_serialized {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(new_json) {
                if let Some(obj) = parsed.as_object() {
                    for (k, v) in obj {
                        existing_obj.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        // Remove keys for agent_types that were dropped
        let at_set: std::collections::HashSet<&String> = final_agent_types.iter().collect();
        existing_obj.retain(|k, _v| at_set.contains(&k.to_string()));

        if existing_obj.is_empty() {
            None
        } else {
            Some(serde_json::Value::Object(existing_obj).to_string())
        }
    } else {
        old_provider.model.clone()
    };

    // Build the service-level model patch: Some(Some(value)) to set, Some(None) to clear.
    let model_patch: Option<Option<String>> = if models.is_some() {
        Some(final_model)
    } else {
        None
    };

    let model_row = model_provider_service::update(
        &db.conn,
        id,
        name,
        api_url.clone(),
        api_key.clone(),
        agent_types.clone(),
        model_patch.clone(),
    )
    .await
    .map_err(AppCommandError::from)?;

    // Cascade credential/model changes to all dependent agent settings and config files.
    let url_changed = api_url
        .as_deref()
        .is_some_and(|u| u != old_provider.api_url);
    let key_changed = api_key
        .as_deref()
        .is_some_and(|k| k != old_provider.api_key);
    let model_changed = model_patch
        .as_ref()
        .is_some_and(|new_value| new_value.as_deref() != old_provider.model.as_deref());
    let agent_types_changed = agent_types
        .as_ref()
        .is_some_and(|new_ats| {
            let old_ats = parse_agent_types_from_info(&old_provider);
            new_ats != &old_ats
        });

    if url_changed || key_changed || model_changed || agent_types_changed {
        let final_url = api_url.as_deref().unwrap_or(&old_provider.api_url);
        let final_key = api_key.as_deref().unwrap_or(&old_provider.api_key);
        acp::cascade_update_model_provider(
            db,
            id,
            final_url,
            final_key,
            model_patch.as_ref().and_then(|opt| opt.as_deref()),
            &final_agent_types,
            emitter,
        )
        .await
        .map_err(|e| AppCommandError::invalid_input(e.to_string()))?;
    }

    Ok(ModelProviderInfo::from(model_row))
}

/// Parse `agent_types` from an existing model_provider row, falling back the
/// same way `ModelProviderInfo::from` does.
fn parse_agent_types_from_info(row: &crate::db::entities::model_provider::Model) -> Vec<String> {
    crate::models::model_provider::parse_agent_types_from_row(&row.agent_types_json, &row.agent_type)
}

/// Result of `update_model_provider`: the updated provider row plus how many
/// running sessions the cascade left on stale (launch-time) config — for the
/// settings-side "N sessions need restart" toast.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModelProviderResult {
    pub provider: ModelProviderInfo,
    pub affected_running_sessions: usize,
}

/// `update_model_provider_core` followed by a staleness refresh for every agent
/// bound to this provider. Shared by the Tauri command and the web handler so
/// both surface how many running sessions need a restart to pick up the new
/// credentials/model. If the save didn't actually change url/key/model, the
/// cascade is skipped, fingerprints are unchanged, and the refresh is a silent
/// no-op returning 0.
#[allow(clippy::too_many_arguments)]
pub async fn update_model_provider_and_refresh(
    db: &AppDatabase,
    manager: &ConnectionManager,
    data_dir: &Path,
    id: i32,
    name: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    agent_types: Option<Vec<String>>,
    models: Option<HashMap<String, String>>,
    emitter: &EventEmitter,
) -> Result<UpdateModelProviderResult, AppCommandError> {
    let provider =
        update_model_provider_core(db, id, name, api_url, api_key, agent_types, models, emitter)
            .await?;

    // Every agent bound to this provider may now be on stale config (the cascade
    // rewrote their env_json + native config files). Recompute and notify.
    let agent_types: Vec<AgentType> = agent_setting_service::find_by_model_provider_id(&db.conn, id)
        .await
        .unwrap_or_default()
        .iter()
        .filter_map(|setting| serde_json::from_str(&setting.agent_type).ok())
        .collect();
    let affected_running_sessions = acp::refresh_config_staleness(
        manager,
        db,
        data_dir,
        &agent_types,
        ConfigStaleKind::ModelProvider,
    )
    .await;

    Ok(UpdateModelProviderResult {
        provider,
        affected_running_sessions,
    })
}

pub async fn delete_model_provider_core(db: &AppDatabase, id: i32) -> Result<(), AppCommandError> {
    // Check if any agent settings reference this provider.
    let dependents = agent_setting_service::find_by_model_provider_id(&db.conn, id)
        .await
        .map_err(AppCommandError::from)?;

    if !dependents.is_empty() {
        let agent_names: Vec<String> = dependents
            .iter()
            .filter_map(|row| {
                serde_json::from_str::<AgentType>(&row.agent_type)
                    .ok()
                    .map(|at| at.to_string())
            })
            .collect();
        let names_joined = agent_names.join(", ");
        return Err(AppCommandError::invalid_input(format!(
            "PROVIDER_IN_USE:{names_joined}"
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
    agent_types: Vec<String>,
    models: HashMap<String, String>,
) -> Result<ModelProviderInfo, AppCommandError> {
    create_model_provider_core(&db, name, api_url, api_key, agent_types, models).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_model_provider(
    db: tauri::State<'_, AppDatabase>,
    manager: tauri::State<'_, ConnectionManager>,
    id: i32,
    name: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    agent_types: Option<Vec<String>>,
    models: Option<HashMap<String, String>>,
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
        &db,
        &manager,
        &app_data_dir,
        id,
        name,
        api_url,
        api_key,
        agent_types,
        models,
        &emitter,
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

    /// Regression: an `api_key` containing a multibyte character (e.g. a
    /// full-width char typed under a CJK IME) must not panic the masking in
    /// `ModelProviderInfo::from`. Before the fix, `create` persisted the row
    /// and then panicked, after which every `list_model_providers` call
    /// panicked on that row — breaking the settings list and the agent
    /// management provider dropdown until the row was removed.
    #[tokio::test]
    async fn create_and_list_tolerate_multibyte_api_key() {
        let db = fresh_in_memory_db().await;

        let created = create_model_provider_core(
            &db,
            "Provider".to_string(),
            "https://api.example.com".to_string(),
            "sk-密钥abcd1234".to_string(),
            vec!["codex".to_string()],
            HashMap::new(),
        )
        .await;
        assert!(
            created.is_ok(),
            "create panicked/failed: {:?}",
            created.err()
        );

        let rows = list_model_providers_core(&db)
            .await
            .expect("list must not fail on a multibyte api_key");
        assert_eq!(rows.len(), 1);
        // The raw key round-trips; only the masked view is derived.
        assert_eq!(rows[0].api_key, "sk-密钥abcd1234");
        assert!(!rows[0].api_key_masked.is_empty());
    }

    /// Regression for the model-provider staleness path: editing a provider must
    /// flag the running sessions of agents bound to it. The mechanism is "the
    /// bound agent's config fingerprint shifts" — `refresh_connection_staleness`
    /// (tested in manager.rs) then flags any session whose spawn fingerprint no
    /// longer matches. This proves the shift actually happens for a credential
    /// change, and that a non-runtime edit (display name) does NOT shift it (so
    /// provider edits don't over-flag).
    ///
    /// DB-only: we mutate the provider row directly via the service rather than
    /// `update_model_provider_core`, so the on-disk config cascade never runs and
    /// the test can't touch a developer's real agent config files. The fingerprint
    /// also reads native config files, but only ever reads them and only between
    /// DB mutations, so that component stays constant across the comparisons.
    #[tokio::test]
    async fn provider_credential_change_shifts_bound_agent_fingerprint() {
        use crate::db::entities::agent_setting;
        use crate::models::agent::AgentType;
        use sea_orm::{ActiveModelTrait, NotSet, Set};

        let db = fresh_in_memory_db().await;
        let data_dir = std::env::temp_dir();

        let provider = create_model_provider_core(
            &db,
            "Prov".to_string(),
            "https://api.example.com".to_string(),
            "sk-old-key".to_string(),
            vec!["codex".to_string()],
            HashMap::new(),
        )
        .await
        .expect("create provider");

        // A Codex agent setting bound to that provider.
        let now = chrono::Utc::now();
        agent_setting::ActiveModel {
            id: NotSet,
            agent_type: Set(serde_json::to_string(&AgentType::Codex).unwrap()),
            registry_id: Set("codex".to_string()),
            enabled: Set(true),
            sort_order: Set(0),
            installed_version: Set(None),
            env_json: Set(Some("{}".to_string())),
            model_provider_id: Set(Some(provider.id)),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(&db.conn)
        .await
        .expect("insert codex agent setting");

        let fp_before = acp::compute_session_config_fingerprint(&db, AgentType::Codex, &data_dir)
            .await
            .expect("fingerprint before");

        // Changing the api_key (DB-only) must shift the bound agent's fingerprint:
        // `apply_model_provider_env` injects the provider's key into the env.
        model_provider_service::update(
            &db.conn,
            provider.id,
            None,
            None,
            Some("sk-new-key".to_string()),
            None,
            None,
        )
        .await
        .expect("update provider key");

        let fp_after_key =
            acp::compute_session_config_fingerprint(&db, AgentType::Codex, &data_dir)
                .await
                .expect("fingerprint after key change");
        assert_ne!(
            fp_before, fp_after_key,
            "changing the bound provider's api_key must shift the agent fingerprint"
        );

        // A non-runtime change (display name only) must NOT shift it.
        model_provider_service::update(
            &db.conn,
            provider.id,
            Some("Renamed".to_string()),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("rename provider");

        let fp_after_name =
            acp::compute_session_config_fingerprint(&db, AgentType::Codex, &data_dir)
                .await
                .expect("fingerprint after rename");
        assert_eq!(
            fp_after_key, fp_after_name,
            "renaming the provider must not shift the agent fingerprint"
        );
    }
}
