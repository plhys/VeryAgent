//! Desktop (Tauri) self-update commands.
//!
//! The download is driven from Rust through `tauri-plugin-updater` — not from
//! a renderer callback — so its progress lives in the shared
//! [`crate::update::state`] handle and survives the settings page unmounting,
//! a tab switch, or a reload. The renderer is a pure subscriber: it kicks off
//! `perform_app_update`, then reflects whatever the `app_update_state`
//! event/snapshot reports, exactly like the standalone-server path.
//!
//! Check also runs in Rust so the selected update source (GitHub vs Gitea) can
//! override the plugin endpoints — the JS `check()` API has no endpoints option.
//!
//! These mirror the server-mode axum handlers in
//! `web::handlers::app_update` (same command names, so the transport layer
//! routes `perform_app_update` / `restart_app` / `app_update_state` to the
//! right place per runtime), but drive the platform updater instead of the
//! in-place tarball swap.

use tauri_plugin_updater::UpdaterExt;

use crate::app_error::AppCommandError;
use crate::commands::system_settings::load_app_update_source;
use crate::db::AppDatabase;
use crate::update::source::AppUpdateSource;
use crate::update::state::{self as update_state, AppUpdateState, AppUpdateStateHandle};
use crate::web::event_bridge::EventEmitter;

/// Minimal update info returned to the renderer (matches server-mode shape so
/// the frontend can use one code path for both runtimes).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateInfo {
    pub version: String,
    pub body: String,
    pub date: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateCheckResult {
    pub current_version: String,
    pub update: Option<DesktopUpdateInfo>,
}

/// Build an updater that consults the user-selected release channel.
///
/// Gitea is plain HTTP on the LAN. `tauri.conf.json` enables
/// `dangerousInsecureTransportProtocol` so the plugin accepts that endpoint
/// when we override it here; GitHub stays HTTPS.
fn build_updater_for_source(
    app: &tauri::AppHandle,
    source: AppUpdateSource,
) -> Result<tauri_plugin_updater::Updater, AppCommandError> {
    let endpoint = url::Url::parse(source.manifest_url()).map_err(|e| {
        AppCommandError::configuration_invalid("Invalid update endpoint URL")
            .with_detail(format!("{}: {e}", source.manifest_url()))
    })?;

    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| {
            AppCommandError::configuration_invalid("Failed to set update endpoints")
                .with_detail(e.to_string())
        })?
        .build()
        .map_err(|e| {
            AppCommandError::configuration_invalid("Failed to build updater")
                .with_detail(e.to_string())
        })
}

/// Current update snapshot, for the renderer to re-sync on mount.
#[tauri::command]
pub fn app_update_state(state: tauri::State<'_, AppUpdateStateHandle>) -> AppUpdateState {
    update_state::snapshot(state.inner())
}

/// Check the selected release channel for a newer version. Does not download.
#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
) -> Result<DesktopUpdateCheckResult, AppCommandError> {
    let source = load_app_update_source(&db.conn).await.unwrap_or_default();
    let current_version = app.package_info().version.to_string();
    let updater = build_updater_for_source(&app, source)?;

    let update = match updater.check().await {
        Ok(Some(u)) => Some(DesktopUpdateInfo {
            version: u.version.clone(),
            body: u.body.clone().unwrap_or_default(),
            date: u.date.map(|d| d.to_string()),
        }),
        Ok(None) => None,
        Err(e) => {
            // Include the manifest URL in both message and detail so the
            // frontend can classify 404 / empty-channel as source_unreachable
            // even when only one field is shown.
            let detail = format!(
                "{} — {} ({})",
                e,
                source.label(),
                source.manifest_url()
            );
            return Err(AppCommandError::network(format!(
                "Failed to check for updates from {} (latest.json): {}",
                source.label(),
                source.manifest_url()
            ))
            .with_detail(detail));
        }
    };

    Ok(DesktopUpdateCheckResult {
        current_version,
        update,
    })
}

/// Begin (or attach to) a download+install of the available update. Returns
/// immediately with the current snapshot; the work runs detached and reports
/// progress via the `app_update_state` event.
#[tauri::command]
pub async fn perform_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppUpdateStateHandle>,
    db: tauri::State<'_, AppDatabase>,
) -> Result<AppUpdateState, AppCommandError> {
    let handle = state.inner().clone();
    let emitter = EventEmitter::Tauri(app.clone());

    let (started, snap) = update_state::try_begin(&handle, &emitter);
    if !started {
        // A download is already in flight (or staged) — attach to it.
        return Ok(snap);
    }

    let source = load_app_update_source(&db.conn).await.unwrap_or_default();

    tauri::async_runtime::spawn(async move {
        if let Err(message) = run_download(app, handle.clone(), emitter.clone(), source).await {
            update_state::set_error(&handle, &emitter, message);
        }
    });

    Ok(snap)
}

/// Re-check, download, and install the update, driving progress into the shared
/// handle. On success leaves the state at `ReadyToRestart`. Returns the error
/// message (already stringified) so the caller can record it.
async fn run_download(
    app: tauri::AppHandle,
    handle: AppUpdateStateHandle,
    emitter: EventEmitter,
    source: AppUpdateSource,
) -> Result<(), String> {
    let updater = build_updater_for_source(&app, source).map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        // The renderer only enables the button when a check found an update,
        // but a release could vanish between check and click.
        .ok_or_else(|| "No update available".to_string())?;
    let version = update.version.clone();

    let pe = std::sync::Arc::new(update_state::ProgressEmitter::new(
        handle.clone(),
        emitter.clone(),
    ));
    let pe_chunk = pe.clone();
    let pe_finish = pe.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk_len, content_len| {
                downloaded += chunk_len as u64;
                pe_chunk.downloading(downloaded, content_len);
            },
            move || {
                pe_finish.installing();
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // The desktop app relaunches itself, so there is no supervisor trial or
    // restart-delay metadata to carry (those are server-only).
    update_state::set_ready(&handle, &emitter, Some(version), None, None, None);
    Ok(())
}

/// Relaunch into the freshly-installed bytes. Flips the shared snapshot to
/// `Restarting` first so the UI (and any other window) reflects it, then
/// restarts after a short flush delay. `restart()` never returns.
#[tauri::command]
pub async fn restart_app(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppUpdateStateHandle>,
) -> Result<(), AppCommandError> {
    let handle = state.inner().clone();
    let emitter = EventEmitter::Tauri(app.clone());
    // Atomically claim the relaunch (flips to `Restarting`) only if an update is
    // genuinely staged — same authority check as the server `restart_impl`.
    // Guards a stale window / direct IPC call from relaunching during
    // idle/error/downloading/installing, and serializes concurrent clicks.
    if !update_state::try_claim_restart(&handle, &emitter) {
        return Err(AppCommandError::invalid_input(
            "No staged update to restart into",
        ));
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        app.restart();
    });
    Ok(())
}
