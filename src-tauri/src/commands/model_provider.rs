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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelItem {
    pub id: String,
    pub name: String,
}

/// Normalize a provider API base URL into candidate `/models` endpoints.
///
/// Users commonly save any of:
/// - `https://api.openai.com/v1`
/// - `https://api.openai.com/v1/`
/// - `https://api.openai.com`
/// - `https://api.openai.com/v1/models`
/// - `https://gateway.example.com/v1/chat/completions` (chat endpoint pasted by mistake)
fn provider_models_url_candidates(api_url: &str) -> Vec<String> {
    let mut base = api_url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Vec::new();
    }

    // Strip accidental chat/completions suffix so we can recover a models list URL.
    for suffix in [
        "/chat/completions",
        "/completions",
        "/messages",
        "/v1/chat/completions",
        "/v1/messages",
    ] {
        if let Some(stripped) = base
            .strip_suffix(suffix)
            .map(|s| s.trim_end_matches('/').to_string())
        {
            if !stripped.is_empty() {
                base = stripped;
            }
            break;
        }
    }

    let mut candidates = Vec::new();
    let mut push = |url: String| {
        if !url.is_empty() && !candidates.iter().any(|x| x == &url) {
            candidates.push(url);
        }
    };

    if base.ends_with("/models") {
        push(base.clone());
    } else {
        push(format!("{base}/models"));
        // Many gateways only expose OpenAI-compatible routes under /v1.
        if !base.ends_with("/v1") && !base.contains("/v1/") {
            push(format!("{base}/v1/models"));
        }
    }

    candidates
}

fn parse_provider_models_body(body: &str) -> Result<Vec<ProviderModelItem>, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("Invalid JSON: {e}"))?;

    let extract_id = |item: &serde_json::Value| -> Option<String> {
        item.get("id")
            .or_else(|| item.get("model"))
            .or_else(|| item.get("name"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| {
                item.as_str()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            })
    };

    let mut models: Vec<ProviderModelItem> = Vec::new();
    let push_item = |models: &mut Vec<ProviderModelItem>, id: String| {
        if !models.iter().any(|m| m.id == id) {
            models.push(ProviderModelItem {
                name: id.clone(),
                id,
            });
        }
    };

    // OpenAI-compatible: { "object": "list", "data": [{ "id": "gpt-5", ... }] }
    if let Some(arr) = parsed.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(id) = extract_id(item) {
                push_item(&mut models, id);
            }
        }
    }

    // Some gateways: { "models": ["a", "b"] } or { "models": [{ "id": ... }] }
    if models.is_empty() {
        if let Some(arr) = parsed.get("models").and_then(|d| d.as_array()) {
            for item in arr {
                if let Some(id) = extract_id(item) {
                    push_item(&mut models, id);
                }
            }
        }
    }

    // Rare: bare array
    if models.is_empty() {
        if let Some(arr) = parsed.as_array() {
            for item in arr {
                if let Some(id) = extract_id(item) {
                    push_item(&mut models, id);
                }
            }
        }
    }

    Ok(models)
}

/// Fetch available models from a model provider's OpenAI-compatible `/models` endpoint.
pub async fn fetch_provider_models_core(
    db: &AppDatabase,
    id: i32,
) -> Result<Vec<ProviderModelItem>, AppCommandError> {
    let provider = get_model_provider_core(db, id).await?;
    let api_key = provider.api_key.trim();
    if api_key.is_empty() {
        return Err(AppCommandError::invalid_input(
            "API Key is empty; cannot list models",
        ));
    }

    let candidates = provider_models_url_candidates(&provider.api_url);
    if candidates.is_empty() {
        return Err(AppCommandError::invalid_input(
            "API URL is empty; cannot list models",
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppCommandError::invalid_input(format!("HTTP client error: {e}")))?;

    let mut last_error = String::from("no candidate URL succeeded");

    for url in candidates {
        let resp = match client
            .get(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            // Some OpenAI-compatible gateways accept either form.
            .header("api-key", api_key)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                last_error = format!("Request failed for {url}: {e}");
                continue;
            }
        };

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            let snippet = body.chars().take(300).collect::<String>();
            last_error = format!(
                "Provider returned HTTP {} for {}: {}",
                status.as_u16(),
                url,
                snippet
            );
            // Keep trying alternate candidates on 404/405.
            if status.as_u16() == 404 || status.as_u16() == 405 {
                continue;
            }
            // Auth/permission errors are definitive.
            if status.as_u16() == 401 || status.as_u16() == 403 {
                return Err(AppCommandError::invalid_input(last_error));
            }
            continue;
        }

        match parse_provider_models_body(&body) {
            Ok(models) => return Ok(models),
            Err(e) => {
                last_error = format!("{e} (url: {url})");
                continue;
            }
        }
    }

    Err(AppCommandError::invalid_input(last_error))
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

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn fetch_provider_models(
    db: tauri::State<'_, AppDatabase>,
    id: i32,
) -> Result<Vec<ProviderModelItem>, AppCommandError> {
    fetch_provider_models_core(&db, id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::fresh_in_memory_db;

    #[test]
    fn models_url_candidates_cover_common_user_inputs() {
        assert_eq!(
            provider_models_url_candidates("https://api.openai.com/v1"),
            vec!["https://api.openai.com/v1/models".to_string()]
        );
        assert_eq!(
            provider_models_url_candidates("https://api.openai.com/v1/"),
            vec!["https://api.openai.com/v1/models".to_string()]
        );
        assert_eq!(
            provider_models_url_candidates("https://api.openai.com"),
            vec![
                "https://api.openai.com/models".to_string(),
                "https://api.openai.com/v1/models".to_string(),
            ]
        );
        assert_eq!(
            provider_models_url_candidates("https://api.openai.com/v1/models"),
            vec!["https://api.openai.com/v1/models".to_string()]
        );
        assert_eq!(
            provider_models_url_candidates(
                "https://gateway.example.com/v1/chat/completions"
            ),
            vec![
                "https://gateway.example.com/models".to_string(),
                "https://gateway.example.com/v1/models".to_string(),
            ]
        );
    }

    #[test]
    fn parse_provider_models_body_accepts_common_shapes() {
        let openai = r#"{"object":"list","data":[{"id":"gpt-5"},{"id":"gpt-5-mini"}]}"#;
        let models = parse_provider_models_body(openai).expect("openai shape");
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "gpt-5");

        let alt = r#"{"models":["a","b"]}"#;
        let models = parse_provider_models_body(alt).expect("models array");
        assert_eq!(models.len(), 2);
        assert_eq!(models[1].id, "b");
    }

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