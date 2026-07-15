//! Shared identity + preferences for VeryAgent's body/brain model.
//!
//! VeryAgent is the stable "body": agent name, how to address the user, and
//! hand-written preferences. Each coding agent (Claude Code, Codex, Gemini, …)
//! is a swappable "brain". Private agent memory stays untouched; this layer
//! only injects a short preamble on the first user prompt of a conversation
//! for agents the user has opted in.
//!
//! Storage lives under the effective memory root (default `~/.veryagent/memory/`,
//! or a user-chosen directory pointed to by `~/.veryagent/memory_root.path`):
//! - `identity.json` — structured agent name / user address / notes
//! - `sharing.json` — which brains receive the preamble

use std::io::Write;
use std::path::Path;

use crate::app_error::AppCommandError;

pub mod inject;
pub mod location;
pub mod profile;
pub mod sharing;

pub use inject::{maybe_inject_shared_identity, prepend_preamble, InjectDecision};
pub use location::{
    default_memory_root, effective_memory_root, load_custom_root, migrate_memory_files,
    set_custom_root,
};
pub use profile::{load_profile, save_profile, SharedProfile};
pub use sharing::{load_sharing, save_sharing, SharingConfig};

/// Write `bytes` to `final_path` via temp file + fsync + rename.
/// Mirrors `pets::write_manifest_atomic` so a partial write never leaves a
/// half-updated profile/sharing file visible to readers mid-prompt.
pub(crate) fn write_file_atomic(final_path: &Path, bytes: &[u8]) -> Result<(), AppCommandError> {
    let parent = final_path.parent().ok_or_else(|| {
        AppCommandError::io_error(format!(
            "memory path has no parent: {}",
            final_path.display()
        ))
    })?;
    std::fs::create_dir_all(parent).map_err(|e| {
        AppCommandError::io_error(format!(
            "failed to create memory dir {}: {e}",
            parent.display()
        ))
    })?;

    let tmp_path = {
        let mut os = final_path.as_os_str().to_owned();
        os.push(".tmp");
        std::path::PathBuf::from(os)
    };
    let _ = std::fs::remove_file(&tmp_path);

    let write = (|| -> Result<(), AppCommandError> {
        let mut f = std::fs::File::create(&tmp_path).map_err(|e| {
            AppCommandError::io_error(format!(
                "failed to create temp file {}: {e}",
                tmp_path.display()
            ))
        })?;
        f.write_all(bytes).map_err(|e| {
            AppCommandError::io_error(format!(
                "failed to write temp file {}: {e}",
                tmp_path.display()
            ))
        })?;
        f.sync_all().map_err(|e| {
            AppCommandError::io_error(format!(
                "failed to fsync temp file {}: {e}",
                tmp_path.display()
            ))
        })?;
        std::fs::rename(&tmp_path, final_path).map_err(|e| {
            AppCommandError::io_error(format!(
                "failed to rename {} -> {}: {e}",
                tmp_path.display(),
                final_path.display()
            ))
        })?;
        Ok(())
    })();

    if write.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }
    write
}
