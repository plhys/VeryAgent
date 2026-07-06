//! Centralized resolution of veryagent-owned filesystem paths.
//!
//! Mirrors the conventions already used by `preferences.rs` (`~/.veryagent/`)
//! and `experts.rs` (`~/.veryagent/skills/`). New features that need a
//! user-scoped persistent directory should call into this module instead of
//! re-deriving `dirs::home_dir().join(".veryagent")` themselves.

use std::path::{Path, PathBuf};

const VERYAGENT_DIR_NAME: &str = ".veryagent";
const PETS_DIR_NAME: &str = "pets";
const UPLOADS_DIR_NAME: &str = "uploads";
const LOGS_DIR_NAME: &str = "logs";

/// `$VERYAGENT_HOME` if set (and non-empty), else `~/.veryagent/`.
///
/// Returns the relative `.veryagent` path when no home directory is available;
/// callers must still handle creation failures gracefully.
pub fn veryagent_home_dir() -> PathBuf {
    if let Some(custom) = std::env::var_os("VERYAGENT_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom);
    }
    dirs::home_dir()
        .map(|h| h.join(VERYAGENT_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(VERYAGENT_DIR_NAME))
}

/// Root directory for desktop-pet assets.
///
/// Resolution order:
/// 1. `$VERYAGENT_HOME/pets` (explicit override, used in tests and custom installs)
/// 2. `$VERYAGENT_DATA_DIR/pets` (server-mode data directory, populated by
///    `veryagent-server` from the corresponding env var)
/// 3. `~/.veryagent/pets` (default for the desktop app)
pub fn veryagent_pets_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("VERYAGENT_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom).join(PETS_DIR_NAME);
    }
    if let Some(data) = std::env::var_os("VERYAGENT_DATA_DIR").filter(|s| !s.is_empty()) {
        return PathBuf::from(data).join(PETS_DIR_NAME);
    }
    dirs::home_dir()
        .map(|h| h.join(VERYAGENT_DIR_NAME).join(PETS_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(VERYAGENT_DIR_NAME).join(PETS_DIR_NAME))
}

/// Root directory for attachments uploaded from the web client.
///
/// Resolution order matches `veryagent_pets_root()`:
/// 1. `$VERYAGENT_HOME/uploads`
/// 2. `$VERYAGENT_DATA_DIR/uploads` (server-mode data directory)
/// 3. `~/.veryagent/uploads` (desktop default)
///
/// Files in this directory are not garbage-collected by veryagent itself —
/// later conversations may still reference them via `file://` URIs
/// embedded in session history. To bound the long-term footprint on
/// shared / multi-tenant servers, operators can set
/// `VERYAGENT_UPLOAD_MAX_TOTAL_BYTES` (see `web::handlers::files`): new
/// uploads beyond the cap are rejected at the API boundary while
/// existing files stay readable.
///
/// **Concurrency contract:** the quota check uses a process-local
/// in-flight reservation counter to make `VERYAGENT_UPLOAD_MAX_TOTAL_BYTES`
/// a hard ceiling within one `veryagent-server` process. Multiple
/// `veryagent-server` processes sharing the same uploads root (e.g.
/// horizontally-scaled containers mounted on the same volume) will
/// each enforce the cap independently and can collectively exceed it.
/// veryagent is designed for single-process deployments; horizontal
/// scaling would require external coordination (file lock, Redis,
/// reverse-proxy quota) that this codebase does not provide.
pub fn veryagent_uploads_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("VERYAGENT_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom).join(UPLOADS_DIR_NAME);
    }
    if let Some(data) = std::env::var_os("VERYAGENT_DATA_DIR").filter(|s| !s.is_empty()) {
        return PathBuf::from(data).join(UPLOADS_DIR_NAME);
    }
    dirs::home_dir()
        .map(|h| h.join(VERYAGENT_DIR_NAME).join(UPLOADS_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(VERYAGENT_DIR_NAME).join(UPLOADS_DIR_NAME))
}

/// Root directory for application diagnostic logs (rotating files written by
/// the `tracing` file appender; see `crate::logging`).
///
/// Resolution mirrors [`veryagent_uploads_root`] exactly so logs land on the same
/// filesystem root as uploads/pets/the database:
/// 1. `$VERYAGENT_HOME/logs` (explicit override)
/// 2. `$VERYAGENT_DATA_DIR/logs` (server-mode data directory)
/// 3. `~/.veryagent/logs` (default for the desktop app)
///
/// Pure env + `dirs::home_dir()`, so it is callable at the very start of a
/// process — before the database (or, in `veryagent-server`, the tokio runtime)
/// exists — which is exactly when the subscriber must be installed.
pub fn veryagent_logs_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("VERYAGENT_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom).join(LOGS_DIR_NAME);
    }
    if let Some(data) = std::env::var_os("VERYAGENT_DATA_DIR").filter(|s| !s.is_empty()) {
        return PathBuf::from(data).join(LOGS_DIR_NAME);
    }
    dirs::home_dir()
        .map(|h| h.join(VERYAGENT_DIR_NAME).join(LOGS_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(VERYAGENT_DIR_NAME).join(LOGS_DIR_NAME))
}

/// Single source of truth for "where does the database live, and where
/// do `paths::*` resolve their roots against."
///
/// Resolution:
/// 1. If `VERYAGENT_DATA_DIR` is set and non-empty, return its absolutized
///    form. Honors the operator's choice even on desktop, where a
///    pre-set env var should override Tauri's identifier-derived path.
/// 2. Otherwise return the absolutized form of `tauri_fallback` —
///    typically `app.path().app_data_dir()` on desktop or the
///    server's default data dir.
///
/// Always returns an absolute path (`absolutize` re-bases against the
/// process CWD if needed). Callers should treat the result as
/// authoritative and not re-read `VERYAGENT_DATA_DIR` themselves; the
/// startup code in `lib.rs` / `bin/codeg_server.rs` writes the
/// resolved value back to the env so subprocess inheritance works,
/// but the in-process source of truth is this function.
///
/// This exists because Tauri's `app.path().app_data_dir()` does **not**
/// consult `VERYAGENT_DATA_DIR` — it returns the identifier-derived path
/// unconditionally. Call sites that pass `app_data_dir()` straight
/// into git credential helpers, ACP, terminal sessions, etc. would
/// otherwise generate scripts pointing at an empty DB when the
/// operator pre-set `VERYAGENT_DATA_DIR` to a custom location.
pub fn resolve_effective_data_dir(tauri_fallback: &Path) -> PathBuf {
    if let Some(custom) = std::env::var_os("VERYAGENT_DATA_DIR").filter(|s| !s.is_empty()) {
        return crate::git_credential::absolutize(Path::new(&custom));
    }
    crate::git_credential::absolutize(tauri_fallback)
}

// Path resolution depends on global env vars (`VERYAGENT_HOME`, `VERYAGENT_DATA_DIR`),
// so unit tests would need cross-test serialization to avoid races. The
// behaviour is covered end-to-end by `pets::*` tests which set `VERYAGENT_HOME`
// inside a serialized test mutex; we deliberately don't duplicate that here.
