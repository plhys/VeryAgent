//! Custom storage root for the shared-identity layer.
//!
//! The pointer always lives under the default `~/.veryagent/` tree so the app
//! can rediscover a user-chosen folder after reinstall (as long as the pointer
//! file — or a restored copy of it — is present). Profile + sharing files live
//! inside the effective root returned by [`effective_memory_root`].

use std::path::{Path, PathBuf};

use crate::app_error::AppCommandError;
use crate::paths;

use super::write_file_atomic;

const POINTER_FILE_NAME: &str = "memory_root.path";
const ENV_MEMORY_ROOT: &str = "VERYAGENT_MEMORY_ROOT";

/// Absolute path of the small pointer file under the default home.
pub fn pointer_path() -> PathBuf {
    paths::veryagent_home_dir().join(POINTER_FILE_NAME)
}

/// Default memory directory when the user has not set a custom root.
pub fn default_memory_root() -> PathBuf {
    // Prefer the env/data-dir aware helper, but never follow a custom pointer
    // here — this is the factory default only.
    if let Some(custom) = std::env::var_os("VERYAGENT_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom).join("memory");
    }
    if let Some(data) = std::env::var_os("VERYAGENT_DATA_DIR").filter(|s| !s.is_empty()) {
        return PathBuf::from(data).join("memory");
    }
    dirs::home_dir()
        .map(|h| h.join(".veryagent").join("memory"))
        .unwrap_or_else(|| PathBuf::from(".veryagent").join("memory"))
}

/// Read the optional custom root from the pointer file (trimmed, non-empty).
pub fn load_custom_root() -> Option<PathBuf> {
    let path = pointer_path();
    let raw = std::fs::read_to_string(&path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

/// Effective directory for `identity.json` / `sharing.json`.
///
/// Resolution order:
/// 1. `$VERYAGENT_MEMORY_ROOT` (tests / operators)
/// 2. Custom path from `~/.veryagent/memory_root.path`
/// 3. Default `~/.veryagent/memory` (or data-dir equivalent)
pub fn effective_memory_root() -> PathBuf {
    if let Some(env) = std::env::var_os(ENV_MEMORY_ROOT).filter(|s| !s.is_empty()) {
        return PathBuf::from(env);
    }
    if let Some(custom) = load_custom_root() {
        return custom;
    }
    default_memory_root()
}

/// Persist a custom root (or clear it when `None` / empty).
/// Creates the target directory. Does not move existing files automatically —
/// callers may copy before switching.
pub fn set_custom_root(root: Option<String>) -> Result<PathBuf, AppCommandError> {
    let pointer = pointer_path();
    match root {
        None => {
            let _ = std::fs::remove_file(&pointer);
            let def = default_memory_root();
            std::fs::create_dir_all(&def).map_err(|e| {
                AppCommandError::io_error(format!(
                    "failed to create default memory dir {}: {e}",
                    def.display()
                ))
            })?;
            Ok(def)
        }
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return set_custom_root(None);
            }
            let path = PathBuf::from(trimmed);
            if !path.is_absolute() {
                return Err(AppCommandError::invalid_input(
                    "memory storage path must be absolute".to_string(),
                ));
            }
            std::fs::create_dir_all(&path).map_err(|e| {
                AppCommandError::io_error(format!(
                    "failed to create memory dir {}: {e}",
                    path.display()
                ))
            })?;
            // Ensure pointer parent exists.
            if let Some(parent) = pointer.parent() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    AppCommandError::io_error(format!(
                        "failed to create veryagent home {}: {e}",
                        parent.display()
                    ))
                })?;
            }
            write_file_atomic(&pointer, format!("{}\n", path.display()).as_bytes())?;
            Ok(path)
        }
    }
}

/// Copy known memory files from `from` to `to` when the destination is missing them.
pub fn migrate_memory_files(from: &Path, to: &Path) -> Result<(), AppCommandError> {
    if from == to {
        return Ok(());
    }
    std::fs::create_dir_all(to).map_err(|e| {
        AppCommandError::io_error(format!(
            "failed to create memory dir {}: {e}",
            to.display()
        ))
    })?;
    for name in ["identity.json", "profile.md", "sharing.json"] {
        let src = from.join(name);
        let dst = to.join(name);
        if src.is_file() && !dst.exists() {
            std::fs::copy(&src, &dst).map_err(|e| {
                AppCommandError::io_error(format!(
                    "failed to copy {} -> {}: {e}",
                    src.display(),
                    dst.display()
                ))
            })?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn custom_root_roundtrip() {
        let _g = ENV_LOCK.lock().unwrap();
        let home = tempfile::tempdir().unwrap();
        let custom = tempfile::tempdir().unwrap();
        std::env::set_var("VERYAGENT_HOME", home.path());
        std::env::remove_var("VERYAGENT_MEMORY_ROOT");

        let set = set_custom_root(Some(custom.path().display().to_string())).unwrap();
        assert_eq!(set, custom.path());
        assert_eq!(effective_memory_root(), custom.path());

        let cleared = set_custom_root(None).unwrap();
        assert_eq!(cleared, default_memory_root());

        std::env::remove_var("VERYAGENT_HOME");
    }
}
