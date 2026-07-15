//! Resident (butler) agent lifecycle.
//!
//! Hermes and OpenClaw are process-level residents: VeryAgent starts them with
//! the app, keeps them out of the idle sweep, and reuses the warm connection
//! when the UI opens a chat. Durable memory stays in each agent's own home
//! (`~/.hermes`, `~/.openclaw`); VeryAgent is the entry/display host, not a
//! second memory store.
//!
//! Boot is best-effort: missing install, disabled settings, gateway down, or
//! spawn failure must never block app startup.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use crate::acp::error::AcpError;
use crate::acp::manager::ConnectionManager;
use crate::acp::registry::{self, is_resident_agent};
use crate::db::AppDatabase;
use crate::models::agent::AgentType;
use crate::web::event_bridge::EventEmitter;

/// Agents that auto-start with the host process.
pub fn resident_agent_types() -> Vec<AgentType> {
    registry::all_acp_agents()
        .into_iter()
        .filter(|at| is_resident_agent(*at))
        .collect()
}

/// Env opt-out: `VERYAGENT_RESIDENT_AGENTS=0` disables auto-start (idle-skip
/// and reuse still apply if the user connects manually).
fn resident_autostart_enabled() -> bool {
    match std::env::var("VERYAGENT_RESIDENT_AGENTS") {
        Ok(raw) => {
            let t = raw.trim();
            !(t == "0" || t.eq_ignore_ascii_case("false") || t.eq_ignore_ascii_case("off"))
        }
        Err(_) => true,
    }
}

/// Spawn resident agents in the background. Never panics; logs and continues.
pub async fn bootstrap_resident_agents(
    manager: ConnectionManager,
    db: AppDatabase,
    data_dir: std::path::PathBuf,
    emitter: EventEmitter,
    owner_window_label: String,
) {
    if !resident_autostart_enabled() {
        tracing::info!("[resident] auto-start disabled via VERYAGENT_RESIDENT_AGENTS");
        return;
    }

    for agent_type in resident_agent_types() {
        match ensure_resident_running(
            &manager,
            &db,
            &data_dir,
            agent_type,
            emitter.clone(),
            owner_window_label.clone(),
        )
        .await
        {
            Ok(conn_id) => {
                tracing::info!(
                    "[resident] {agent_type:?} ready connection_id={conn_id}"
                );
            }
            Err(err) => {
                // Soft-fail: app stays usable; user can still connect from UI.
                tracing::warn!("[resident] {agent_type:?} auto-start skipped: {err}");
            }
        }
    }
}

/// Ensure a single resident agent has a live connection. Reuses if already up.
pub async fn ensure_resident_running(
    manager: &ConnectionManager,
    db: &AppDatabase,
    data_dir: &Path,
    agent_type: AgentType,
    emitter: EventEmitter,
    owner_window_label: String,
) -> Result<String, AcpError> {
    if !is_resident_agent(agent_type) {
        return Err(AcpError::protocol(format!(
            "{agent_type:?} is not a resident agent"
        )));
    }

    if let Some(existing) = manager.find_live_resident_connection(agent_type).await {
        return Ok(existing);
    }

    // Same install gate as session-page connect — never trigger download here.
    crate::commands::acp::verify_agent_installed(agent_type).await?;

    // session_id = None: open a warm process-level session. Hermes still
    // persists history/memory under ~/.hermes on its own.
    let runtime_env =
        crate::commands::acp::build_session_runtime_env(db, agent_type, None, data_dir).await?;

    // Resident home cwd: prefer the agent home so its process cwd matches where
    // durable state lives. Falls back to user home if the dir is missing.
    let working_dir = resident_working_dir(agent_type);

    // Small settle delay so concurrent UI connect doesn't race the first spawn
    // before SessionStarted (dedup lock only keys on session_id today).
    let conn_id = manager
        .spawn_agent(
            agent_type,
            working_dir,
            None,
            runtime_env,
            owner_window_label,
            emitter,
            None,
            BTreeMap::new(),
        )
        .await?;

    // Best-effort wait so callers that immediately prompt see Connected.
    let _ = wait_until_connected(manager, &conn_id, Duration::from_secs(45)).await;
    Ok(conn_id)
}

fn resident_working_dir(agent_type: AgentType) -> Option<String> {
    match agent_type {
        AgentType::Hermes => {
            let home = crate::commands::acp::hermes_home_dir();
            let _ = std::fs::create_dir_all(&home);
            Some(home.display().to_string())
        }
        AgentType::OpenClaw => {
            let home = dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(".openclaw");
            let _ = std::fs::create_dir_all(&home);
            Some(home.display().to_string())
        }
        _ => dirs::home_dir().map(|h| h.display().to_string()),
    }
}

async fn wait_until_connected(
    manager: &ConnectionManager,
    conn_id: &str,
    budget: Duration,
) -> bool {
    use crate::acp::types::ConnectionStatus;
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        match manager.get_state(conn_id).await {
            Some(state_arc) => {
                let status = state_arc.read().await.status.clone();
                match status {
                    ConnectionStatus::Connected => return true,
                    ConnectionStatus::Disconnected | ConnectionStatus::Error => return false,
                    _ => {}
                }
            }
            None => return false,
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}
