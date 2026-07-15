//! Load/save the structured shared identity (`identity.json`).
//!
//! Also migrates the legacy free-form `profile.md` into `notes` when present.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::app_error::AppCommandError;

use super::location::effective_memory_root;
use super::write_file_atomic;

const IDENTITY_FILE_NAME: &str = "identity.json";
const LEGACY_PROFILE_FILE_NAME: &str = "profile.md";

/// Soft cap for free-form notes. Structured fields are short by nature.
pub const MAX_NOTES_CHARS: usize = 6_000;
pub const MAX_NAME_CHARS: usize = 80;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct SharedProfile {
    /// Display name for the body agent (e.g. "超人").
    #[serde(default)]
    pub agent_name: String,
    /// How the agent should address the user (e.g. "老板").
    #[serde(default)]
    pub user_address: String,
    /// Free-form preferences / notes (markdown allowed).
    #[serde(default)]
    pub notes: String,
    /// Absolute path of the identity file (informational for the UI).
    /// Empty when the file does not yet exist on disk.
    #[serde(default)]
    pub path: String,
    /// Effective memory root directory (where files are stored).
    #[serde(default)]
    pub storage_root: String,
    /// Factory default memory root (for "reset to default" UI).
    #[serde(default)]
    pub default_storage_root: String,
}

impl SharedProfile {
    /// True when any identity field has non-whitespace content.
    pub fn has_meaningful_content(&self) -> bool {
        !self.agent_name.trim().is_empty()
            || !self.user_address.trim().is_empty()
            || !self.notes.trim().is_empty()
    }

    /// Markdown body assembled for prompt injection.
    pub fn to_preamble_body(&self) -> String {
        let mut lines: Vec<String> = Vec::new();
        lines.push("# Shared Identity".into());
        lines.push(String::new());
        if !self.agent_name.trim().is_empty() {
            lines.push(format!("- Agent name: {}", self.agent_name.trim()));
        }
        if !self.user_address.trim().is_empty() {
            lines.push(format!(
                "- Address the user as: {}",
                self.user_address.trim()
            ));
        }
        let notes = self.notes.trim();
        if !notes.is_empty() {
            lines.push(String::new());
            lines.push("# Preferences".into());
            lines.push(String::new());
            lines.push(notes.to_string());
        }
        lines.join("\n")
    }
}

fn identity_path() -> PathBuf {
    effective_memory_root().join(IDENTITY_FILE_NAME)
}

fn legacy_profile_path() -> PathBuf {
    effective_memory_root().join(LEGACY_PROFILE_FILE_NAME)
}

fn clamp_field(s: String, max: usize) -> String {
    if s.chars().count() > max {
        s.chars().take(max).collect()
    } else {
        s
    }
}

fn with_paths(mut profile: SharedProfile) -> SharedProfile {
    let root = effective_memory_root();
    let path = root.join(IDENTITY_FILE_NAME);
    profile.storage_root = root.display().to_string();
    profile.default_storage_root = super::location::default_memory_root().display().to_string();
    profile.path = if path.exists() {
        path.display().to_string()
    } else {
        String::new()
    };
    profile
}

/// Read identity.json; migrate legacy profile.md notes when needed.
/// Soft-fail on corrupt JSON so the settings page still opens.
pub fn load_profile() -> Result<SharedProfile, AppCommandError> {
    let path = identity_path();
    if path.exists() {
        let raw = std::fs::read_to_string(&path).map_err(|e| {
            AppCommandError::io_error(format!(
                "failed to read identity {}: {e}",
                path.display()
            ))
        })?;
        let mut profile: SharedProfile = match serde_json::from_str(&raw) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(
                    "[memory] identity.json parse error at {}, falling back to empty: {e}",
                    path.display()
                );
                SharedProfile::default()
            }
        };
        // Soft-normalize empty path fields from disk; recompute below.
        profile.path.clear();
        return Ok(with_paths(profile));
    }

    // Legacy free-form markdown → notes.
    let legacy = legacy_profile_path();
    if legacy.exists() {
        if let Ok(raw) = std::fs::read_to_string(&legacy) {
            let notes = raw.trim().to_string();
            if !notes.is_empty() {
                let profile = SharedProfile {
                    notes,
                    ..Default::default()
                };
                // Best-effort migrate to identity.json so future loads are structured.
                let _ = save_profile(profile.clone());
                return Ok(with_paths(profile));
            }
        }
    }

    Ok(with_paths(SharedProfile::default()))
}

/// Overwrite identity.json with structured fields (clamped).
pub fn save_profile(mut profile: SharedProfile) -> Result<SharedProfile, AppCommandError> {
    profile.agent_name = clamp_field(profile.agent_name.trim().to_string(), MAX_NAME_CHARS);
    profile.user_address = clamp_field(profile.user_address.trim().to_string(), MAX_NAME_CHARS);
    profile.notes = clamp_field(profile.notes, MAX_NOTES_CHARS);

    // Don't persist computed path fields into the file body.
    let to_write = SharedProfile {
        agent_name: profile.agent_name.clone(),
        user_address: profile.user_address.clone(),
        notes: profile.notes.clone(),
        path: String::new(),
        storage_root: String::new(),
        default_storage_root: String::new(),
    };
    let path = identity_path();
    let raw = serde_json::to_string_pretty(&to_write).map_err(|e| {
        AppCommandError::configuration_invalid(format!("serialize identity.json: {e}"))
    })?;
    write_file_atomic(&path, format!("{raw}\n").as_bytes())?;
    Ok(with_paths(to_write))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn save_and_load_roundtrip() {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("VERYAGENT_MEMORY_ROOT", dir.path());

        let saved = save_profile(SharedProfile {
            agent_name: "超人".into(),
            user_address: "老板".into(),
            notes: "简洁".into(),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(saved.agent_name, "超人");
        assert!(saved.path.contains("identity.json"));

        let loaded = load_profile().unwrap();
        assert_eq!(loaded.agent_name, "超人");
        assert_eq!(loaded.user_address, "老板");
        assert_eq!(loaded.notes, "简洁");

        std::env::remove_var("VERYAGENT_MEMORY_ROOT");
    }

    #[test]
    fn meaningful_content_and_body() {
        let empty = SharedProfile::default();
        assert!(!empty.has_meaningful_content());

        let p = SharedProfile {
            agent_name: "超人".into(),
            user_address: "老板".into(),
            notes: "中文".into(),
            ..Default::default()
        };
        assert!(p.has_meaningful_content());
        let body = p.to_preamble_body();
        assert!(body.contains("超人"));
        assert!(body.contains("老板"));
        assert!(body.contains("中文"));
    }
}
