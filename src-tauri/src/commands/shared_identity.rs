//! Shared identity + preferences settings surface.
//!
//! File-backed (not `app_metadata`): profile and sharing live under the
//! effective memory root so users can point them at a durable folder and keep
//! data across reinstalls. Both Tauri and HTTP handlers share the same core
//! helpers; on save a backend event is broadcast for multi-window clients.

use serde::{Deserialize, Serialize};

use crate::app_error::AppCommandError;
use crate::memory::{
    default_memory_root, effective_memory_root, load_profile, load_sharing, migrate_memory_files,
    save_profile, save_sharing, set_custom_root, SharedProfile, SharingConfig,
};
use crate::web::event_bridge::{
    emit_event, EventEmitter, SHARED_IDENTITY_SETTINGS_CHANGED_EVENT,
};

/// Combined payload for the settings UI (one round-trip load).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SharedIdentitySettings {
    pub profile: SharedProfile,
    pub sharing: SharingConfig,
    /// Effective storage directory currently in use.
    pub storage_root: String,
    /// Factory default directory (for reset UI).
    pub default_storage_root: String,
    /// True when a custom root pointer is active.
    pub storage_is_custom: bool,
}

/// Partial update payload — `None` fields are left unchanged on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedIdentityUpdate {
    /// When `Some`, overwrite structured identity fields.
    pub profile: Option<SharedProfile>,
    /// When `Some`, overwrite `sharing.json` with this config.
    pub sharing: Option<SharingConfig>,
    /// When `Some`, set/clear the custom memory root.
    /// - `Some("")` or whitespace → reset to default
    /// - `Some("/abs/path")` → use that directory (migrates missing files)
    /// - `None` → leave storage location unchanged
    pub storage_root: Option<String>,
}

/// Load profile + sharing + storage location for the settings page.
pub fn load_shared_identity_settings() -> Result<SharedIdentitySettings, AppCommandError> {
    let profile = load_profile()?;
    let sharing = load_sharing()?;
    let storage_root = effective_memory_root().display().to_string();
    let default_storage_root = default_memory_root().display().to_string();
    let storage_is_custom = crate::memory::load_custom_root().is_some();
    Ok(SharedIdentitySettings {
        profile,
        sharing,
        storage_root,
        default_storage_root,
        storage_is_custom,
    })
}

/// Persist identity / sharing / storage root, then broadcast the result.
pub fn set_shared_identity_settings_core(
    emitter: &EventEmitter,
    update: SharedIdentityUpdate,
) -> Result<SharedIdentitySettings, AppCommandError> {
    // Storage root first so subsequent profile/sharing writes land in the new place.
    if let Some(root) = update.storage_root {
        let previous = effective_memory_root();
        let next = set_custom_root(if root.trim().is_empty() {
            None
        } else {
            Some(root)
        })?;
        // Copy identity/sharing into the new root when the target is empty of them.
        if let Err(e) = migrate_memory_files(&previous, &next) {
            tracing::warn!("[memory] migrate after storage change failed: {e}");
        }
    }
    if let Some(profile) = update.profile {
        save_profile(profile)?;
    }
    if let Some(sharing) = update.sharing {
        save_sharing(sharing)?;
    }
    let settings = load_shared_identity_settings()?;
    emit_event(emitter, SHARED_IDENTITY_SETTINGS_CHANGED_EVENT, &settings);
    Ok(settings)
}

// -------- Tauri commands -----------------------------------------------------

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_shared_identity_settings() -> Result<SharedIdentitySettings, AppCommandError> {
    load_shared_identity_settings()
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn set_shared_identity_settings(
    #[cfg(feature = "tauri-runtime")] app: tauri::AppHandle,
    update: SharedIdentityUpdate,
) -> Result<SharedIdentitySettings, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        let emitter = EventEmitter::Tauri(app);
        set_shared_identity_settings_core(&emitter, update)
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = update;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}
