use chrono::Utc;
use sea_orm::{DatabaseConnection, EntityTrait, Set};
use serde::Serialize;
use tauri::State;

use crate::db::entities::conversation;
use crate::db::service::app_metadata_service;
use crate::db::service::model_provider_service;
use crate::db::AppDatabase;
use crate::app_error::AppCommandError;
use crate::db::error::DbError;

/// Key used to store the pinned summary enabled toggle in `app_metadata`.
const META_KEY_PINNED_SUMMARY_ENABLED: &str = "pinned_summary_enabled";

// ── Settings ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_pinned_summary_enabled(
    db: State<'_, AppDatabase>,
) -> Result<bool, AppCommandError> {
    let val = app_metadata_service::get_value(&db.conn, META_KEY_PINNED_SUMMARY_ENABLED)
        .await
        .map_err(AppCommandError::from)?;
    Ok(val.as_deref() == Some("true"))
}

#[tauri::command]
pub async fn set_pinned_summary_enabled(
    db: State<'_, AppDatabase>,
    enabled: bool,
) -> Result<(), AppCommandError> {
    app_metadata_service::upsert_value(
        &db.conn,
        META_KEY_PINNED_SUMMARY_ENABLED,
        if enabled { "true" } else { "false" },
    )
    .await
    .map_err(AppCommandError::from)?;
    Ok(())
}

// ── Summary generation ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SummaryResult {
    pub summary: String,
    pub model: String,
}

/// Generate a structured AI summary for a pinned conversation.
///
/// Reads the conversation turns, builds a prompt asking the LLM to describe
/// what the conversation is about (not raw content), calls the model provider
/// that matches the given `agent_type` (the currently active agent), and
/// stores the result in the `summary` field of the conversation row.
#[tauri::command]
pub async fn generate_conversation_summary(
    db: State<'_, AppDatabase>,
    conversation_id: i32,
    agent_type: Option<String>,
) -> Result<SummaryResult, AppCommandError> {
    // 1. Load conversation turns.
    let (turns_text, conv_agent_type, conv_model) =
        load_conversation_turns(&db.conn, conversation_id).await?;

    if turns_text.is_empty() {
        return Err(AppCommandError::not_found(format!(
            "Conversation {conversation_id} has no messages"
        )));
    }

    // 2. Use active agent_type if provided, otherwise fall back to conversation's agent_type.
    let effective_agent_type = agent_type.unwrap_or_else(|| conv_agent_type.clone());

    // 3. Find the model provider for the effective agent type.
    let providers = model_provider_service::list_all(&db.conn)
        .await
        .map_err(AppCommandError::from)?;
    let provider = providers
        .into_iter()
        .find(|p| {
            !p.api_url.is_empty()
                && !p.api_key.is_empty()
                && (p.agent_type.is_empty()
                    || p.agent_type == effective_agent_type
                    || p.agent_types_json.contains(&effective_agent_type))
        })
        .ok_or_else(|| {
            AppCommandError::not_found(format!(
                "No model provider found for active agent type '{effective_agent_type}'. \
                 Please configure one in Settings -> Model Providers."
            ))
        })?;

    let model_name = resolve_model_name(
        conv_model.as_deref(),
        provider.model.as_deref(),
    );

    // 4. Build the prompt.
    let prompt = format!(
        r#"请用一句话总结这段对话是关于什么事情的。过滤掉寒暄废话，只概括实质性的任务、问题或目标。

对话内容（{} 轮）：

{}

请用中文简洁回答，不超过 50 字。"#,
        turns_text.lines().count(),
        turns_text,
    );

    // 5. Call the OpenAI-compatible API.
    let summary: String = call_llm(&provider.api_url, &provider.api_key, &model_name, &prompt).await?;

    // 6. Store the summary.
    store_summary(&db.conn, conversation_id, &summary).await?;

    Ok(SummaryResult {
        summary: summary.to_string(),
        model: model_name.to_string(),
    })
}

/// Read conversation turns and format them as plain text for the LLM prompt.
async fn load_conversation_turns(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<(String, String, Option<String>), AppCommandError> {
    use crate::commands::conversations::get_folder_conversation_core;

    let (detail, _parsed_title) =
        get_folder_conversation_core(conn, conversation_id).await?;

    let agent_type = detail.summary.agent_type.to_string();
    let conv_model = detail.summary.model.clone();

    let mut lines: Vec<String> = Vec::new();
    for turn in &detail.turns {
        let role = match turn.role {
            crate::models::message::TurnRole::User => "用户",
            crate::models::message::TurnRole::Assistant => "助手",
            crate::models::message::TurnRole::System => "系统",
        };
        let mut turn_texts: Vec<String> = Vec::new();
        for block in &turn.blocks {
            if let crate::models::message::ContentBlock::Text { text } = block {
                turn_texts.push(text.clone());
            }
        }
        if !turn_texts.is_empty() {
            lines.push(format!("[{}]\n{}", role, turn_texts.join("\n")));
        }
    }

    Ok((lines.join("\n\n"), agent_type, conv_model))
}

/// Call an OpenAI-compatible chat completions API.
async fn call_llm(
    api_url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, AppCommandError> {
    let base = ensure_v1_suffix(api_url);
    let full_url = format!("{}/chat/completions", base.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "你是一个对话总结助手。请用中文回答，简洁、清晰。"
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "max_tokens": 1024,
        "temperature": 0.3,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| {
            AppCommandError::task_execution_failed("Failed to create HTTP client")
                .with_detail(e.to_string())
        })?;

    let resp = client
        .post(&full_url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            AppCommandError::task_execution_failed("Failed to call LLM API")
                .with_detail(e.to_string())
        })?;

    let status = resp.status();
    if !status.is_success() {
        let error_body = resp
            .text()
            .await
            .unwrap_or_else(|_| "(no body)".to_string());
        return Err(AppCommandError::task_execution_failed(format!(
            "LLM API returned HTTP {}: {}",
            status.as_u16(),
            truncate_error(&error_body, 500)
        )));
    }

    let resp_body: serde_json::Value = resp.json().await.map_err(|e| {
        AppCommandError::task_execution_failed("Failed to parse LLM API response")
            .with_detail(e.to_string())
    })?;

    let content = resp_body
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| {
            AppCommandError::task_execution_failed(
                "LLM API response did not contain expected content",
            )
        })?;

    Ok(content.to_string())
}

/// Persist the summary text to the conversation row.
async fn store_summary(
    conn: &DatabaseConnection,
    conversation_id: i32,
    summary: &str,
) -> Result<(), AppCommandError> {
    use sea_orm::ActiveModelTrait;

    let conv = conversation::Entity::find_by_id(conversation_id)
        .one(conn)
        .await
        .map_err(|e| AppCommandError::from(DbError::from(e)))?
        .ok_or_else(|| {
            AppCommandError::not_found(format!("Conversation {conversation_id} not found"))
        })?;

    let mut active: conversation::ActiveModel = conv.into();
    active.summary = Set(Some(summary.to_string()));
    active.updated_at = Set(Utc::now());
    active
        .update(conn)
        .await
        .map_err(|e| AppCommandError::from(DbError::from(e)))?;

    Ok(())
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// Resolve the model name from conversation model or provider model config.
///
/// The `provider_model` may be:
/// - `None` / empty string → use fallback
/// - A plain model name like `"deepseek-v4-flash"` → use as-is
/// - A JSON object like `{"main":"deepseek-v4-flash"}` → extract `main` field
fn resolve_model_name(conv_model: Option<&str>, provider_model: Option<&str>) -> String {
    // 1. Try the conversation's stored model first.
    if let Some(m) = conv_model {
        let m = m.trim();
        if !m.is_empty() {
            return m.to_string();
        }
    }

    // 2. Try the provider's model config (may be a JSON object).
    if let Some(m) = provider_model {
        let m = m.trim();
        if !m.is_empty() {
            // Try to parse as JSON object with a "main" field.
            if let Ok(obj) = serde_json::from_str::<serde_json::Value>(m) {
                if let Some(main) = obj.get("main").and_then(|v| v.as_str()) {
                    let main = main.trim();
                    if !main.is_empty() {
                        return main.to_string();
                    }
                }
                // If JSON but no "main", try to extract any string value.
                if let Some(obj) = obj.as_object() {
                    for (_, v) in obj.iter() {
                        if let Some(s) = v.as_str() {
                            let s = s.trim();
                            if !s.is_empty() {
                                return s.to_string();
                            }
                        }
                    }
                }
            } else {
                // Plain string, use as-is.
                return m.to_string();
            }
        }
    }

    // 3. Fallback.
    "deepseek-v4-flash".to_string()
}

fn ensure_v1_suffix(url: &str) -> String {
    let url = url.trim_end_matches('/');
    if url.ends_with("/v1") {
        url.to_string()
    } else {
        format!("{}/v1", url)
    }
}

fn truncate_error(msg: &str, max_len: usize) -> String {
    if msg.len() > max_len {
        format!("{}... (truncated)", &msg[..max_len])
    } else {
        msg.to_string()
    }
}



