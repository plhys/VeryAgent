pub mod acp;
pub use acp::{
    idle_sweep_task, idle_timeout_from_env, lifecycle_subscriber_task, SWEEP_INTERVAL_SECS,
};
pub use network::proxy::init_proxy_from_db;
mod app_error;
pub mod app_state;
pub mod automation;
pub mod chat_channel;
pub mod commands;
pub mod db;
pub mod git_credential;
pub mod git_repo;
pub mod keyring_store;
pub mod logging;
pub mod models;
mod network;
pub mod office_watch;
pub mod openwiki;
pub mod parsers;
pub mod paths;
pub mod pet_sessions;
pub mod pet_state_mapper;
pub mod pets;
#[cfg(feature = "tauri-runtime")]
pub mod preferences;
pub mod process;
pub mod supervise;
mod terminal;
pub mod update;
pub mod web;
pub mod workspace_state;
pub mod workspace_transfer;

/// Sweep stale ACP binary cache trash created by the rename-aside fallback in
/// `acp::binary_cache::clear_agent_cache`. Safe to call any time; intended to
/// be invoked once at startup from a detached OS thread. Does not block, does
/// not panic, errors are silently dropped.
pub fn sweep_acp_binary_trash() {
    crate::acp::binary_cache::sweep_trash();
}

#[cfg(feature = "tauri-runtime")]
mod tauri_setup;

#[cfg(feature = "tauri-runtime")]
pub use tauri_setup::run;
