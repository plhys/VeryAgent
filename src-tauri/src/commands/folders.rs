// folders.rs (slimmed by T1): folder CRUD + file tree only.
// Git operations moved to commands/git/.

use std::collections::{hash_map::DefaultHasher, HashMap, HashSet};
use std::fs::OpenOptions;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;
use std::time::UNIX_EPOCH;
use base64::Engine as _;
use serde::Serialize;
use tokio::sync::Semaphore;
use walkdir::WalkDir;
#[cfg(feature = "tauri-runtime")]
use tauri::Manager;
use crate::app_error::AppCommandError;
use crate::db::error::DbError;
use crate::db::service::folder_service;
use crate::db::AppDatabase;
use crate::models::GitCredentials;
use crate::models::{FolderDetail, FolderHistoryEntry};
use crate::web::event_bridge::EventEmitter;
use crate::git_repo::ensure_git_repo;

// Git commands now live in commands/git/; folder code may call them.
use crate::commands::git::*;

























































































































































































/// Classify a git remote command error, detecting authentication failures.
pub fn classify_remote_git_error(operation: &str, stderr: &[u8]) -> AppCommandError {
    let msg = String::from_utf8_lossy(stderr).trim().to_string();
    tracing::error!("[GIT_CMD] {} failed, stderr: {}", operation, msg);
    let lower = msg.to_lowercase();

    if lower.contains("authentication failed")
        || lower.contains("invalid credentials")
        || lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("logon failed")
        || lower.contains("terminal prompts disabled")
        || lower.contains("the requested url returned error: 401")
        || lower.contains("the requested url returned error: 403")
        || lower.contains("http basic: access denied")
    {
        return AppCommandError::authentication_failed(format!(
            "git {operation}: authentication failed. Configure a GitHub account in Settings → Version Control."
        ))
        .with_detail(msg);
    }

    if lower.contains("could not resolve host")
        || lower.contains("unable to access")
        || lower.contains("connection refused")
        || lower.contains("network is unreachable")
    {
        return AppCommandError::network(format!("git {operation}: network error"))
            .with_detail(msg);
    }

    AppCommandError::external_command(format!("git {operation} failed"), msg)
}

/// Where a given branch is checked out, resolved against the registered folders.
/// `path` is the canonical filesystem path of the worktree (or main working
/// tree) hosting the branch — `None` when the branch is not checked out in any
/// worktree. `folder_id` is the registered folder whose canonicalized path
/// matches `path` — `None` for an external/unregistered worktree. Drives the
/// branch selector's "navigate vs checkout" decision.
#[derive(Debug, Serialize)]
pub struct WorktreeResolution {
    pub path: Option<String>,
    pub folder_id: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FileTreeNode {
    File {
        name: String,
        path: String,
    },
    Dir {
        name: String,
        path: String,
        children: Vec<FileTreeNode>,
    },
}

#[derive(Debug, Serialize)]
pub struct FilePreviewContent {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct FileEditContent {
    pub path: String,
    pub content: String,
    pub etag: String,
    pub mtime_ms: Option<i64>,
    pub readonly: bool,
    pub line_ending: String,
}

#[derive(Debug, Serialize)]
pub struct FileSaveResult {
    pub path: String,
    pub etag: String,
    pub mtime_ms: Option<i64>,
    pub readonly: bool,
    pub line_ending: String,
}

pub fn count_non_empty_lines(content: &str) -> usize {
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .count()
}

fn parse_count_from_output(stdout: &[u8]) -> Option<usize> {
    String::from_utf8_lossy(stdout).trim().parse::<usize>().ok()
}

pub async fn get_head_hash(path: &str) -> Result<Option<String>, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Ok(None);
    }

    let head = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if head.is_empty() {
        return Ok(None);
    }
    Ok(Some(head))
}

pub async fn count_changed_files_between(
    path: &str,
    base: &str,
    head: &str,
) -> Result<usize, AppCommandError> {
    let range = format!("{}..{}", base, head);
    let output = crate::process::tokio_command("git")
        .args(["diff", "--name-only", &range])
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("diff", &output.stderr));
    }

    Ok(count_non_empty_lines(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

pub async fn estimate_push_commit_count(path: &str) -> usize {
    let upstream_ahead = crate::process::tokio_command("git")
        .args(["rev-list", "--count", "@{push}..HEAD"])
        .current_dir(path)
        .output()
        .await;
    if let Ok(output) = upstream_ahead {
        if output.status.success() {
            if let Some(count) = parse_count_from_output(&output.stdout) {
                return count;
            }
        }
    }

    let branch_output = crate::process::tokio_command("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(path)
        .output()
        .await;
    let Ok(branch_output) = branch_output else {
        return 0;
    };
    if !branch_output.status.success() {
        return 0;
    }

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();
    if branch.is_empty() || branch == "HEAD" {
        return 0;
    }

    let remote_key = format!("branch.{}.remote", branch);
    let remote_output = crate::process::tokio_command("git")
        .args(["config", "--get", &remote_key])
        .current_dir(path)
        .output()
        .await;
    let remote = remote_output
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "origin".to_string());

    let remote_arg = format!("--remotes={}", remote);
    let output = crate::process::tokio_command("git")
        .args(["rev-list", "--count", "HEAD", "--not", &remote_arg])
        .current_dir(path)
        .output()
        .await;
    let Ok(output) = output else {
        return 0;
    };
    if !output.status.success() {
        return 0;
    }

    parse_count_from_output(&output.stdout).unwrap_or(0)
}

pub async fn get_folder_core(db: &AppDatabase, folder_id: i32) -> Result<FolderDetail, DbError> {
    folder_service::get_folder_by_id(&db.conn, folder_id)
        .await?
        .ok_or_else(|| DbError::Migration(format!("Folder {} not found", folder_id)))
}

/// Emit a `folder://changed` Upsert so every client inserts-or-replaces the
/// folder in its workspace list in real time. Used by headless producers — the
/// automation engine minting a per-run worktree — whose folders no client would
/// otherwise learn about until the next full `fetchFolders` (leaving any
/// conversation produced inside them unplaceable in the sidebar). Best-effort:
/// the folder is already persisted, so a dropped event reconciles on the next
/// refresh / WS reconnect.
///
/// Unlike [`open_folder_in_workspace_core`], this ONLY syncs the folder list — it
/// never opens or focuses a tab — so a background emitter can't steal focus.
pub(crate) fn emit_folder_upsert(emitter: &EventEmitter, detail: FolderDetail) {
    crate::web::event_bridge::emit_event(
        emitter,
        crate::web::event_bridge::FOLDER_CHANGED_EVENT,
        crate::web::event_bridge::FolderChange::Upsert {
            folder: Box::new(detail),
        },
    );
}

pub async fn load_folder_history_core(
    db: &AppDatabase,
) -> Result<Vec<FolderHistoryEntry>, AppCommandError> {
    folder_service::list_folders(&db.conn)
        .await
        .map_err(AppCommandError::from)
}

pub async fn add_folder_to_history_core(
    db: &AppDatabase,
    path: String,
) -> Result<FolderHistoryEntry, DbError> {
    folder_service::add_folder(&db.conn, &path).await
}

pub async fn remove_folder_from_history_core(
    db: &AppDatabase,
    path: String,
) -> Result<(), AppCommandError> {
    folder_service::remove_folder(&db.conn, &path)
        .await
        .map_err(AppCommandError::from)
}

pub async fn list_open_folders_core(
    db: &AppDatabase,
) -> Result<Vec<FolderHistoryEntry>, AppCommandError> {
    folder_service::list_open_folders(&db.conn)
        .await
        .map_err(AppCommandError::from)
}

pub async fn list_open_folder_details_core(
    db: &AppDatabase,
) -> Result<Vec<FolderDetail>, AppCommandError> {
    folder_service::list_open_folder_details(&db.conn)
        .await
        .map_err(AppCommandError::from)
}

pub async fn list_all_folder_details_core(
    db: &AppDatabase,
) -> Result<Vec<FolderDetail>, AppCommandError> {
    folder_service::list_all_folder_details(&db.conn)
        .await
        .map_err(AppCommandError::from)
}

pub async fn open_folder_core(
    db: &AppDatabase,
    path: String,
) -> Result<FolderDetail, AppCommandError> {
    let entry = folder_service::add_folder(&db.conn, &path)
        .await
        .map_err(AppCommandError::from)?;
    folder_service::get_folder_by_id(&db.conn, entry.id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found("Folder not found after add"))
}

/// Open a freshly created git worktree directory as a folder, recording the
/// *root* folder it descends from. Parents are flattened: a worktree created
/// from another worktree still records the original root, so every worktree of a
/// repo groups under that one repo folder. An unknown / non-positive
/// `source_folder_id` degrades to a top-level folder (`parent_id = None`) rather
/// than erroring.
pub async fn open_worktree_folder_core(
    db: &AppDatabase,
    path: String,
    source_folder_id: i32,
) -> Result<FolderDetail, AppCommandError> {
    let parent_id = if source_folder_id > 0 {
        folder_service::get_folder_by_id(&db.conn, source_folder_id)
            .await
            .map_err(AppCommandError::from)?
            .map(|src| src.parent_id.unwrap_or(src.id))
    } else {
        None
    };
    let entry = folder_service::add_folder_with_parent(&db.conn, &path, parent_id)
        .await
        .map_err(AppCommandError::from)?;
    folder_service::get_folder_by_id(&db.conn, entry.id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found("Folder not found after add"))
}

/// Open a folder into the workspace and announce it so the workspace window
/// can surface it. Used by the project launcher, which lives in its own
/// window/tab and can't reach the workspace's React state directly. Emitting
/// through the shared `EventEmitter` routes the signal correctly in every
/// runtime — Tauri events (desktop), the WebSocket broadcaster (server), and
/// the remote server's broadcaster (remote desktop) — so only windows talking
/// to this same backend react.
pub async fn open_folder_in_workspace_core(
    emitter: &EventEmitter,
    db: &AppDatabase,
    path: String,
) -> Result<FolderDetail, AppCommandError> {
    let detail = open_folder_core(db, path).await?;
    crate::web::event_bridge::emit_event(emitter, "folder://open-in-workspace", &detail);
    Ok(detail)
}

pub async fn open_folder_by_id_core(
    db: &AppDatabase,
    folder_id: i32,
) -> Result<FolderDetail, AppCommandError> {
    folder_service::set_folder_open(&db.conn, folder_id, true)
        .await
        .map_err(AppCommandError::from)?;
    folder_service::get_folder_by_id(&db.conn, folder_id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("Folder {folder_id} not found")))
}

pub async fn remove_folder_from_workspace_core(
    emitter: &EventEmitter,
    db: &AppDatabase,
    folder_id: i32,
) -> Result<(), AppCommandError> {
    use crate::db::service::tab_service;

    // Capture the folder path before flipping it closed, so we can stop any
    // office watch preview servers rooted under it — belt-and-suspenders over
    // the frontend's per-tab unmount teardown.
    let folder_path = folder_service::get_folder_by_id(&db.conn, folder_id)
        .await
        .ok()
        .flatten()
        .map(|f| f.path);

    folder_service::set_folder_open(&db.conn, folder_id, false)
        .await
        .map_err(AppCommandError::from)?;

    // Atomically drop this folder's open tabs + bump the version (always, as a
    // barrier so a concurrent stale save can't resurrect them) + snapshot, in one
    // transaction. Broadcast the new set only when a persisted tab actually
    // changed (sentinel origin "server" so every client applies it); a zero-row
    // removal just advances the barrier — an in-flight saver reconciles via its
    // rejected CAS.
    let inv = tab_service::delete_folder_tabs_and_bump(&db.conn, folder_id)
        .await
        .map_err(AppCommandError::from)?;
    if let Some(tabs) = inv.emit {
        crate::web::event_bridge::emit_event(
            emitter,
            crate::web::event_bridge::TABS_CHANGED_EVENT,
            crate::web::event_bridge::TabsChanged {
                version: inv.version,
                origin: "server".to_string(),
                tabs,
            },
        );
    }

    if let Some(path) = folder_path {
        crate::office_watch::stop_office_watches_under_root(&path);
    }
    Ok(())
}

pub async fn reorder_folders_core(db: &AppDatabase, ids: Vec<i32>) -> Result<(), AppCommandError> {
    folder_service::reorder_folders(&db.conn, ids)
        .await
        .map_err(AppCommandError::from)
}

pub async fn update_folder_name_core(
    db: &AppDatabase,
    folder_id: i32,
    name: String,
) -> Result<FolderDetail, AppCommandError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppCommandError::invalid_input("Folder name cannot be empty"));
    }

    folder_service::update_folder_name(&db.conn, folder_id, name)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found("Folder not found"))
}

pub async fn update_folder_color_core(
    db: &AppDatabase,
    folder_id: i32,
    color: String,
) -> Result<FolderDetail, AppCommandError> {
    folder_service::update_folder_color(&db.conn, folder_id, &color)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found("Folder not found"))
}

pub async fn update_folder_default_agent_core(
    db: &AppDatabase,
    folder_id: i32,
    default_agent_type: Option<crate::models::agent::AgentType>,
) -> Result<FolderDetail, AppCommandError> {
    folder_service::update_folder_default_agent(&db.conn, folder_id, default_agent_type)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found("Folder not found"))
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_folder(
    db: tauri::State<'_, AppDatabase>,
    folder_id: i32,
) -> Result<FolderDetail, DbError> {
    get_folder_core(&db, folder_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn load_folder_history(
    db: tauri::State<'_, AppDatabase>,
) -> Result<Vec<FolderHistoryEntry>, AppCommandError> {
    load_folder_history_core(&db).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn add_folder_to_history(
    db: tauri::State<'_, AppDatabase>,
    path: String,
) -> Result<FolderHistoryEntry, DbError> {
    add_folder_to_history_core(&db, path).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn remove_folder_from_history(
    db: tauri::State<'_, AppDatabase>,
    path: String,
) -> Result<(), AppCommandError> {
    remove_folder_from_history_core(&db, path).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_open_folder_details(
    db: tauri::State<'_, AppDatabase>,
) -> Result<Vec<FolderDetail>, AppCommandError> {
    list_open_folder_details_core(&db).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_all_folder_details(
    db: tauri::State<'_, AppDatabase>,
) -> Result<Vec<FolderDetail>, AppCommandError> {
    list_all_folder_details_core(&db).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn open_folder(
    db: tauri::State<'_, AppDatabase>,
    path: String,
) -> Result<FolderDetail, AppCommandError> {
    open_folder_core(&db, path).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn open_worktree_folder(
    db: tauri::State<'_, AppDatabase>,
    path: String,
    source_folder_id: i32,
) -> Result<FolderDetail, AppCommandError> {
    open_worktree_folder_core(&db, path, source_folder_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn open_folder_in_workspace(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    path: String,
) -> Result<FolderDetail, AppCommandError> {
    let emitter = EventEmitter::Tauri(app);
    open_folder_in_workspace_core(&emitter, &db, path).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn open_folder_by_id(
    db: tauri::State<'_, AppDatabase>,
    folder_id: i32,
) -> Result<FolderDetail, AppCommandError> {
    open_folder_by_id_core(&db, folder_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn remove_folder_from_workspace(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    folder_id: i32,
) -> Result<(), AppCommandError> {
    remove_folder_from_workspace_core(&EventEmitter::Tauri(app), &db, folder_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn reorder_folders(
    db: tauri::State<'_, AppDatabase>,
    ids: Vec<i32>,
) -> Result<(), AppCommandError> {
    reorder_folders_core(&db, ids).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn update_folder_name(
    db: tauri::State<'_, AppDatabase>,
    folder_id: i32,
    name: String,
) -> Result<FolderDetail, AppCommandError> {
    update_folder_name_core(&db, folder_id, name).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn update_folder_color(
    db: tauri::State<'_, AppDatabase>,
    folder_id: i32,
    color: String,
) -> Result<FolderDetail, AppCommandError> {
    update_folder_color_core(&db, folder_id, color).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn update_folder_default_agent(
    db: tauri::State<'_, AppDatabase>,
    folder_id: i32,
    default_agent_type: Option<crate::models::agent::AgentType>,
) -> Result<FolderDetail, AppCommandError> {
    update_folder_default_agent_core(&db, folder_id, default_agent_type).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn create_folder_directory(path: String) -> Result<(), AppCommandError> {
    std::fs::create_dir_all(&path).map_err(AppCommandError::io)
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn clone_repository(
    url: String,
    target_dir: String,
    credentials: Option<GitCredentials>,
    db: tauri::State<'_, AppDatabase>,
    app_handle: tauri::AppHandle,
) -> Result<(), AppCommandError> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| {
        AppCommandError::external_command("Failed to resolve app data dir", e.to_string())
    })?;
    // Resolve through the effective data dir so a custom
    // `VERYAGENT_DATA_DIR` reaches the git credential helper invoked by
    // this subprocess.
    let data_dir = crate::paths::resolve_effective_data_dir(&data_dir);
    clone_repository_core(&url, &target_dir, credentials.as_ref(), &db, &data_dir).await
}

pub fn classify_git_clone_error(stderr: &str) -> AppCommandError {
    let normalized = stderr.to_lowercase();

    if normalized.contains("already exists and is not an empty directory") {
        return AppCommandError::already_exists("Target directory already exists and is not empty")
            .with_detail(stderr.to_string());
    }

    if normalized.contains("repository not found") {
        return AppCommandError::not_found(
            "Repository not found. Check URL and access permissions.",
        )
        .with_detail(stderr.to_string());
    }

    if normalized.contains("could not resolve host")
        || normalized.contains("network is unreachable")
        || normalized.contains("connection timed out")
        || normalized.contains("failed to connect")
    {
        return AppCommandError::network("Network is unavailable while cloning repository")
            .with_detail(stderr.to_string());
    }

    if normalized.contains("authentication failed")
        || normalized.contains("could not read username")
        || normalized.contains("could not read password")
        || normalized.contains("logon failed")
        || normalized.contains("terminal prompts disabled")
        || normalized.contains("the requested url returned error: 401")
        || normalized.contains("the requested url returned error: 403")
        || normalized.contains("http basic: access denied")
        || normalized.contains("permission denied (publickey)")
    {
        return AppCommandError::authentication_failed(
            "Authentication failed while cloning repository",
        )
        .with_detail(stderr.to_string());
    }

    if normalized.contains("permission denied") {
        return AppCommandError::permission_denied("Permission denied while cloning repository")
            .with_detail(stderr.to_string());
    }

    AppCommandError::external_command("Git clone failed", stderr.to_string())
}

/// Resolve where `branch` is checked out and which registered folder owns that
/// directory. Canonicalizes both the worktree path (from git) and every folder
/// path (from the DB) so symlinked / non-canonical paths still match — this
/// can only be done on the host that runs git, which is why it lives in the
/// backend rather than the webview.
pub async fn resolve_worktree_folder_core(
    db: &AppDatabase,
    repo_path: String,
    branch: String,
) -> Result<WorktreeResolution, AppCommandError> {
    ensure_git_repo(&repo_path)?;

    let output = crate::process::tokio_command("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(AppCommandError::io)?;
    if !output.status.success() {
        return Err(git_command_error("worktree list", &output.stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let wt_path = parse_worktrees(&stdout)
        .into_iter()
        .find(|(_, b)| b.as_deref() == Some(branch.as_str()))
        .map(|(p, _)| p);

    let Some(wt_path) = wt_path else {
        // Branch is not checked out in any worktree → caller checks it out in root.
        return Ok(WorktreeResolution {
            path: None,
            folder_id: None,
        });
    };

    let canonical_wt = std::fs::canonicalize(&wt_path).unwrap_or_else(|_| PathBuf::from(&wt_path));

    let folders = folder_service::list_all_folder_details(&db.conn)
        .await
        .map_err(AppCommandError::from)?;
    let folder_id = folders
        .into_iter()
        .find(|f| {
            let canon =
                std::fs::canonicalize(&f.path).unwrap_or_else(|_| PathBuf::from(&f.path));
            canon == canonical_wt
        })
        .map(|f| f.id);

    Ok(WorktreeResolution {
        path: Some(canonical_wt.to_string_lossy().to_string()),
        folder_id,
    })
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn resolve_worktree_folder(
    db: tauri::State<'_, AppDatabase>,
    repo_path: String,
    branch: String,
) -> Result<WorktreeResolution, AppCommandError> {
    resolve_worktree_folder_core(&db, repo_path, branch).await
}

const FILE_TREE_IGNORED_DIRS: &[&str] = &[".git", "__pycache__"];

/// Hard limit: refuse to open files larger than 50 MB in the text editor.
const FILE_OPEN_HARD_LIMIT: usize = 50_000_000;

/// Save limit: refuse to save content larger than 50 MB.
const FILE_SAVE_HARD_LIMIT: usize = 50_000_000;

const FILE_BASE64_DEFAULT_MAX_BYTES: usize = 20_000_000;

const FILE_BASE64_MAX_BYTES: usize = 100_000_000;

const FILE_IO_MAX_CONCURRENT_OPS: usize = 8;

static FILE_IO_SEMAPHORE: LazyLock<Semaphore> =
    LazyLock::new(|| Semaphore::new(FILE_IO_MAX_CONCURRENT_OPS));

pub fn to_git_literal_pathspec(path: &str) -> String {
    format!(":(literal){path}")
}

pub(crate) fn resolve_tree_path(
    root: &Path,
    rel_path: &str,
) -> Result<PathBuf, AppCommandError> {
    let rel = Path::new(rel_path);
    if rel.is_absolute() {
        return Err(AppCommandError::invalid_input("Path must be relative"));
    }

    for component in rel.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppCommandError::invalid_input("Path cannot contain '..'"));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppCommandError::invalid_input("Invalid path component"));
            }
        }
    }

    Ok(root.join(rel))
}

fn validate_new_name(new_name: &str) -> Result<&str, AppCommandError> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err(AppCommandError::invalid_input("New name cannot be empty"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(AppCommandError::invalid_input("Invalid file name"));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppCommandError::invalid_input(
            "New name cannot contain path separators",
        ));
    }
    Ok(trimmed)
}

fn file_mtime_ms(metadata: &std::fs::Metadata) -> Option<i64> {
    let modified = metadata.modified().ok()?;
    let elapsed = modified.duration_since(UNIX_EPOCH).ok()?;
    let millis = elapsed.as_millis();
    if millis > i64::MAX as u128 {
        return Some(i64::MAX);
    }
    Some(millis as i64)
}

fn detect_line_ending(content: &[u8]) -> String {
    let mut has_lf = false;
    let mut has_crlf = false;

    for index in 0..content.len() {
        if content[index] != b'\n' {
            continue;
        }

        if index > 0 && content[index - 1] == b'\r' {
            has_crlf = true;
        } else {
            has_lf = true;
        }

        if has_lf && has_crlf {
            return "mixed".to_string();
        }
    }

    if has_crlf {
        "crlf".to_string()
    } else if has_lf {
        "lf".to_string()
    } else {
        "none".to_string()
    }
}

fn compute_etag(content: &[u8], metadata: &std::fs::Metadata) -> String {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    if let Some(mtime_ms) = file_mtime_ms(metadata) {
        mtime_ms.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

fn ensure_path_in_workspace(root: &Path, target: &Path) -> Result<(), AppCommandError> {
    let canonical_root = std::fs::canonicalize(root).map_err(AppCommandError::io)?;
    let canonical_target = std::fs::canonicalize(target).map_err(AppCommandError::io)?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(AppCommandError::invalid_input(
            "Path is outside workspace root",
        ));
    }
    Ok(())
}

fn read_text_full(target: &Path, hard_limit: usize) -> Result<String, AppCommandError> {
    let metadata = std::fs::metadata(target).map_err(AppCommandError::io)?;
    if metadata.len() > hard_limit as u64 {
        return Err(
            AppCommandError::invalid_input("File is too large to open in editor")
                .with_detail(format!("size={}, limit={}", metadata.len(), hard_limit)),
        );
    }

    let bytes = std::fs::read(target).map_err(AppCommandError::io)?;

    if bytes.iter().take(2_048).any(|b| *b == 0) {
        return Err(AppCommandError::invalid_input(
            "Binary files are not supported in preview",
        ));
    }

    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn atomic_write_text(path: &Path, bytes: &[u8]) -> Result<(), AppCommandError> {
    let parent = path.parent().ok_or_else(|| {
        AppCommandError::invalid_input("Cannot determine parent directory for target file")
            .with_detail(path.display().to_string())
    })?;
    if !parent.exists() {
        return Err(
            AppCommandError::not_found("Parent directory does not exist")
                .with_detail(parent.display().to_string()),
        );
    }

    let temp_path = parent.join(format!(
        ".veryagent-edit-{}.{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    let existing_permissions = std::fs::metadata(path).ok().map(|m| m.permissions());

    let write_result = (|| -> Result<(), AppCommandError> {
        let mut temp = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .map_err(AppCommandError::io)?;

        temp.write_all(bytes).map_err(AppCommandError::io)?;
        temp.sync_all().map_err(AppCommandError::io)?;

        if let Some(permissions) = existing_permissions {
            std::fs::set_permissions(&temp_path, permissions).map_err(AppCommandError::io)?;
        }

        replace_file(&temp_path, path)?;
        sync_directory(parent)?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }

    write_result
}

#[cfg(unix)]
fn replace_file(temp_path: &Path, target_path: &Path) -> Result<(), AppCommandError> {
    std::fs::rename(temp_path, target_path).map_err(AppCommandError::io)
}

#[cfg(target_os = "windows")]
fn replace_file(temp_path: &Path, target_path: &Path) -> Result<(), AppCommandError> {
    use std::os::windows::ffi::OsStrExt;

    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    fn to_wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let src = to_wide(temp_path);
    let dst = to_wide(target_path);

    // SAFETY: pointers are valid and UTF-16 null-terminated for the duration of the call.
    let ok = unsafe {
        MoveFileExW(
            src.as_ptr(),
            dst.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if ok == 0 {
        return Err(
            AppCommandError::io_error("Failed to atomically replace file")
                .with_detail(std::io::Error::last_os_error().to_string()),
        );
    }

    Ok(())
}

#[cfg(not(any(unix, target_os = "windows")))]
fn replace_file(temp_path: &Path, target_path: &Path) -> Result<(), AppCommandError> {
    std::fs::rename(temp_path, target_path).map_err(AppCommandError::io)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), AppCommandError> {
    let dir = std::fs::File::open(path).map_err(AppCommandError::io)?;
    dir.sync_all().map_err(AppCommandError::io)
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), AppCommandError> {
    Ok(())
}

async fn run_file_io<T, F>(f: F) -> Result<T, AppCommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppCommandError> + Send + 'static,
{
    let _permit = FILE_IO_SEMAPHORE
        .acquire()
        .await
        .map_err(|_| AppCommandError::task_execution_failed("File I/O runtime is unavailable"))?;

    tokio::task::spawn_blocking(f).await.map_err(|e| {
        AppCommandError::task_execution_failed("File I/O task failed").with_detail(e.to_string())
    })?
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_home_directory() -> Result<String, AppCommandError> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| AppCommandError::io_error("Could not determine home directory"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub has_children: bool,
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_directory_entries(path: String) -> Result<Vec<DirectoryEntry>, AppCommandError> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(AppCommandError::io_error("Path is not a directory").with_detail(path));
    }

    let mut entries: Vec<DirectoryEntry> = Vec::new();
    let read_dir = std::fs::read_dir(&root).map_err(|e| {
        AppCommandError::io_error("Failed to read directory").with_detail(e.to_string())
    })?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        // Follow symlinks: check if the resolved path is a directory
        let is_dir = if file_type.is_symlink() {
            entry.path().is_dir()
        } else {
            file_type.is_dir()
        };
        if !is_dir {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden directories (starting with '.')
        if name.starts_with('.') {
            continue;
        }
        let abs_path = entry.path().to_string_lossy().to_string();

        // Peek into subdirectory to check if it has child directories
        let has_children = match std::fs::read_dir(entry.path()) {
            Ok(sub) => sub.filter_map(|e| e.ok()).any(|e| {
                let ft = e.file_type().ok();
                let is_sub_dir = ft.is_some_and(|ft| {
                    if ft.is_symlink() {
                        e.path().is_dir()
                    } else {
                        ft.is_dir()
                    }
                });
                if !is_sub_dir {
                    return false;
                }
                let sub_name = e.file_name().to_string_lossy().to_string();
                !sub_name.starts_with('.')
            }),
            Err(_) => false,
        };

        entries.push(DirectoryEntry {
            name,
            path: abs_path,
            has_children,
        });
    }

    // Sort by name, case-insensitive
    entries.sort_by_key(|a| a.name.to_lowercase());

    Ok(entries)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// Only meaningful when `is_dir` is true.
    pub has_children: bool,
    /// File size in bytes; `None` for directories.
    pub size: Option<u64>,
}

/// List immediate children of `path`, returning both directories and files.
/// Mirrors `list_directory_entries` but does not filter out files, used by the
/// "attach server file" picker.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_directory_with_files(
    path: String,
) -> Result<Vec<DirectoryItem>, AppCommandError> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(AppCommandError::io_error("Path is not a directory").with_detail(path));
    }

    let mut items: Vec<DirectoryItem> = Vec::new();
    let read_dir = std::fs::read_dir(&root).map_err(|e| {
        AppCommandError::io_error("Failed to read directory").with_detail(e.to_string())
    })?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        // Follow symlinks for the dir/file classification.
        let is_dir = if file_type.is_symlink() {
            entry.path().is_dir()
        } else {
            file_type.is_dir()
        };
        let abs_path = entry.path().to_string_lossy().to_string();

        let (has_children, size) = if is_dir {
            let has = match std::fs::read_dir(entry.path()) {
                Ok(sub) => sub.filter_map(|e| e.ok()).any(|e| {
                    let sub_name = e.file_name().to_string_lossy().to_string();
                    !sub_name.starts_with('.')
                }),
                Err(_) => false,
            };
            (has, None)
        } else {
            let size = entry.metadata().ok().map(|m| m.len());
            (false, size)
        };

        items.push(DirectoryItem {
            name,
            path: abs_path,
            is_dir,
            has_children,
            size,
        });
    }

    // Sort: directories first, then files; each group by name case-insensitive.
    items.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(items)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_file_tree(
    path: String,
    max_depth: Option<usize>,
) -> Result<Vec<FileTreeNode>, AppCommandError> {
    let root = PathBuf::from(&path);
    let depth = max_depth.unwrap_or(usize::MAX);

    // Collect all entries, skipping ignored directories
    let mut dir_children: HashMap<PathBuf, Vec<FileTreeNode>> = HashMap::new();
    let mut dir_order: Vec<PathBuf> = Vec::new();
    let mut dir_paths_by_rel: HashMap<String, PathBuf> = HashMap::new();

    for entry in WalkDir::new(&root)
        .max_depth(depth)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() {
                !FILE_TREE_IGNORED_DIRS.contains(&name.as_ref())
            } else {
                name != ".DS_Store"
            }
        })
    {
        let entry = entry.map_err(|e| {
            AppCommandError::io_error("Failed to walk file tree").with_detail(e.to_string())
        })?;
        let entry_path = entry.path().to_path_buf();

        // Skip the root itself
        if entry_path == root {
            dir_children.entry(root.clone()).or_default();
            dir_order.push(root.clone());
            continue;
        }

        let parent = entry_path.parent().unwrap_or(&root).to_path_buf();
        let name = entry.file_name().to_string_lossy().to_string();
        let rel_path = entry_path
            .strip_prefix(&root)
            .unwrap_or(&entry_path)
            .to_string_lossy()
            .replace('\\', "/");

        if entry.file_type().is_dir() {
            dir_paths_by_rel.insert(rel_path.clone(), entry_path.clone());
            dir_children.entry(entry_path.clone()).or_default();
            dir_order.push(entry_path);
            // Add a placeholder Dir node to parent (children filled later)
            dir_children
                .entry(parent)
                .or_default()
                .push(FileTreeNode::Dir {
                    name,
                    path: rel_path,
                    children: vec![],
                });
        } else {
            dir_children
                .entry(parent)
                .or_default()
                .push(FileTreeNode::File {
                    name,
                    path: rel_path,
                });
        }
    }

    // Build tree bottom-up: process dirs in reverse order so children are ready
    for dir_path in dir_order.iter().rev() {
        let children = dir_children.remove(dir_path).unwrap_or_default();

        // Sort: dirs first, then files, alphabetically within each group
        let mut dirs: Vec<FileTreeNode> = Vec::new();
        let mut files: Vec<FileTreeNode> = Vec::new();
        for child in children {
            match &child {
                FileTreeNode::Dir { .. } => dirs.push(child),
                FileTreeNode::File { .. } => files.push(child),
            }
        }
        dirs.sort_by(|a, b| {
            let a_name = match a {
                FileTreeNode::Dir { name, .. } => name,
                _ => unreachable!(),
            };
            let b_name = match b {
                FileTreeNode::Dir { name, .. } => name,
                _ => unreachable!(),
            };
            a_name.to_lowercase().cmp(&b_name.to_lowercase())
        });
        files.sort_by(|a, b| {
            let a_name = match a {
                FileTreeNode::File { name, .. } => name,
                _ => unreachable!(),
            };
            let b_name = match b {
                FileTreeNode::File { name, .. } => name,
                _ => unreachable!(),
            };
            a_name.to_lowercase().cmp(&b_name.to_lowercase())
        });

        let mut sorted: Vec<FileTreeNode> = Vec::with_capacity(dirs.len() + files.len());

        // Fill dir children from the map
        for d in dirs {
            if let FileTreeNode::Dir {
                name,
                path: rel_path,
                ..
            } = d
            {
                let full_path = dir_paths_by_rel
                    .get(&rel_path)
                    .cloned()
                    .unwrap_or_else(|| root.join(Path::new(&rel_path)));
                let sub_children = dir_children.remove(&full_path).unwrap_or_default();
                sorted.push(FileTreeNode::Dir {
                    name,
                    path: rel_path,
                    children: sub_children,
                });
            }
        }
        sorted.extend(files);

        dir_children.insert(dir_path.clone(), sorted);
    }

    Ok(dir_children.remove(&root).unwrap_or_default())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn read_file_base64(
    path: String,
    max_bytes: Option<usize>,
) -> Result<String, AppCommandError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppCommandError::invalid_input("Path cannot be empty"));
    }
    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err(AppCommandError::not_found("File does not exist"));
    }
    if !target.is_file() {
        return Err(AppCommandError::invalid_input("Path is not a file"));
    }

    let limit = max_bytes
        .unwrap_or(FILE_BASE64_DEFAULT_MAX_BYTES)
        .clamp(4_096, FILE_BASE64_MAX_BYTES);

    run_file_io(move || {
        let metadata = std::fs::metadata(&target).map_err(AppCommandError::io)?;
        if metadata.len() > limit as u64 {
            return Err(
                AppCommandError::invalid_input("File is too large to attach")
                    .with_detail(format!("max_bytes={limit}")),
            );
        }
        let bytes = std::fs::read(&target).map_err(AppCommandError::io)?;
        if bytes.len() > limit {
            return Err(
                AppCommandError::invalid_input("File is too large to attach")
                    .with_detail(format!("max_bytes={limit}")),
            );
        }
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
}

/// Open a file for reading, refusing a final-component symlink (unix) so a
/// path validated by canonicalization cannot be redirected through a symlink
/// swapped in afterward.
#[cfg(unix)]
fn open_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(windows)]
fn open_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    // FILE_FLAG_OPEN_REPARSE_POINT opens the reparse point itself instead of
    // following it, so a symlink/junction swapped in after validation is opened
    // (and then rejected by the is_file() check) rather than followed outside
    // the workspace root.
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

#[cfg(not(any(unix, windows)))]
fn open_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::File::open(path)
}

/// Like `read_file_base64`, but confined to a workspace root: the path is
/// relative to `root_path` and is canonicalized (resolving symlinks) so it can
/// never read outside the workspace. Used by the HTML preview to inline local
/// sub-resources without exposing the unconfined `read_file_base64` to crafted
/// markup (e.g. a symlink pointing at `/etc/passwd`).
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn read_workspace_file_base64(
    root_path: String,
    path: String,
    max_bytes: Option<usize>,
) -> Result<String, AppCommandError> {
    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(AppCommandError::not_found("Folder does not exist"));
    }

    let target = resolve_tree_path(&root, &path)?;
    if !target.exists() {
        return Err(AppCommandError::not_found("File does not exist"));
    }
    if !target.is_file() {
        return Err(AppCommandError::invalid_input("Path is not a file"));
    }

    let limit = max_bytes
        .unwrap_or(FILE_BASE64_DEFAULT_MAX_BYTES)
        .clamp(4_096, FILE_BASE64_MAX_BYTES);

    run_file_io(move || {
        use std::io::Read;
        // Canonicalize and confine, then open a single handle (O_NOFOLLOW on
        // unix) and do metadata + read on the fd. This closes the check-then-
        // read race: the original `target` symlink can't be re-resolved (we use
        // the canonical path), a final-component symlink swapped in after the
        // check makes the open fail, and metadata/read never re-look-up the path.
        let canonical_root =
            std::fs::canonicalize(&root).map_err(AppCommandError::io)?;
        let canonical_target =
            std::fs::canonicalize(&target).map_err(AppCommandError::io)?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err(AppCommandError::invalid_input(
                "Path is outside workspace root",
            ));
        }
        let mut file =
            open_no_follow(&canonical_target).map_err(AppCommandError::io)?;
        let metadata = file.metadata().map_err(AppCommandError::io)?;
        if !metadata.is_file() {
            return Err(AppCommandError::invalid_input("Path is not a file"));
        }
        if metadata.len() > limit as u64 {
            return Err(
                AppCommandError::invalid_input("File is too large to attach")
                    .with_detail(format!("max_bytes={limit}")),
            );
        }
        // take(limit + 1) bounds the read even if the file grows after fstat.
        let mut bytes = Vec::new();
        Read::take(&mut file, limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(AppCommandError::io)?;
        if bytes.len() > limit {
            return Err(
                AppCommandError::invalid_input("File is too large to attach")
                    .with_detail(format!("max_bytes={limit}")),
            );
        }
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn read_file_preview(
    root_path: String,
    path: String,
) -> Result<FilePreviewContent, AppCommandError> {
    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(AppCommandError::not_found("Folder does not exist"));
    }

    let target = resolve_tree_path(&root, &path)?;
    if !target.exists() {
        return Err(AppCommandError::not_found("File does not exist"));
    }
    if !target.is_file() {
        return Err(AppCommandError::invalid_input("Path is not a file"));
    }
    let path_for_response = path.clone();

    run_file_io(move || {
        ensure_path_in_workspace(&root, &target)?;
        let content = read_text_full(&target, FILE_OPEN_HARD_LIMIT)?;
        Ok(FilePreviewContent {
            path: path_for_response,
            content,
        })
    })
    .await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn read_file_for_edit(
    root_path: String,
    path: String,
) -> Result<FileEditContent, AppCommandError> {
    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(AppCommandError::not_found("Folder does not exist"));
    }

    let target = resolve_tree_path(&root, &path)?;
    if !target.exists() {
        return Err(AppCommandError::not_found("File does not exist"));
    }
    if !target.is_file() {
        return Err(AppCommandError::invalid_input("Path is not a file"));
    }

    let path_for_response = path.clone();

    run_file_io(move || {
        ensure_path_in_workspace(&root, &target)?;
        let metadata = std::fs::metadata(&target).map_err(AppCommandError::io)?;
        let content = read_text_full(&target, FILE_OPEN_HARD_LIMIT)?;
        let readonly = metadata.permissions().readonly();
        let mtime_ms = file_mtime_ms(&metadata);
        let etag = compute_etag(content.as_bytes(), &metadata);
        let line_ending = detect_line_ending(content.as_bytes());

        Ok(FileEditContent {
            path: path_for_response,
            content,
            etag,
            mtime_ms,
            readonly,
            line_ending,
        })
    })
    .await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn save_file_content(
    root_path: String,
    path: String,
    content: String,
    expected_etag: Option<String>,
) -> Result<FileSaveResult, AppCommandError> {
    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(AppCommandError::not_found("Folder does not exist"));
    }
    if content.len() > FILE_SAVE_HARD_LIMIT {
        return Err(
            AppCommandError::invalid_input("File is too large to save in editor")
                .with_detail(format!("max_bytes={FILE_SAVE_HARD_LIMIT}")),
        );
    }

    let target = resolve_tree_path(&root, &path)?;
    if !target.exists() {
        return Err(AppCommandError::not_found("File does not exist"));
    }
    if !target.is_file() {
        return Err(AppCommandError::invalid_input("Path is not a file"));
    }
    let path_for_response = path.clone();

    run_file_io(move || {
        ensure_path_in_workspace(&root, &target)?;

        let link_meta = std::fs::symlink_metadata(&target).map_err(AppCommandError::io)?;
        if link_meta.file_type().is_symlink() {
            return Err(AppCommandError::invalid_input(
                "Saving symlink targets is not supported",
            ));
        }

        let before_meta = std::fs::metadata(&target).map_err(AppCommandError::io)?;
        if before_meta.permissions().readonly() {
            return Err(AppCommandError::permission_denied("File is read-only"));
        }

        let current_bytes = std::fs::read(&target).map_err(AppCommandError::io)?;
        if current_bytes.iter().take(2_048).any(|b| *b == 0) {
            return Err(AppCommandError::invalid_input(
                "Binary files are not supported in editor",
            ));
        }
        let current_etag = compute_etag(&current_bytes, &before_meta);
        if let Some(expected) = expected_etag {
            if expected != current_etag {
                return Err(AppCommandError::invalid_input(
                    "File has changed on disk. Reload the file before saving.",
                ));
            }
        }

        atomic_write_text(&target, content.as_bytes())?;

        let after_meta = std::fs::metadata(&target).map_err(AppCommandError::io)?;
        let etag = compute_etag(content.as_bytes(), &after_meta);
        let mtime_ms = file_mtime_ms(&after_meta);
        let readonly = after_meta.permissions().readonly();
        let line_ending = detect_line_ending(content.as_bytes());

        Ok(FileSaveResult {
            path: path_for_response,
            etag,
            mtime_ms,
            readonly,
            line_ending,
        })
    })
    .await
}

fn build_local_copy_file_name(original_name: &str, attempt: usize) -> String {
    let original = Path::new(original_name);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(original_name);
    let extension = original
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty());

    let suffix = if attempt <= 1 {
        ".local".to_string()
    } else {
        format!(".local.{}", attempt)
    };

    match extension {
        Some(ext) => format!("{stem}{suffix}.{ext}"),
        None => format!("{stem}{suffix}"),
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn save_file_copy(
    root_path: String,
    path: String,
    content: String,
) -> Result<FileSaveResult, AppCommandError> {
    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(AppCommandError::not_found("Folder does not exist"));
    }
    if content.len() > FILE_SAVE_HARD_LIMIT {
        return Err(
            AppCommandError::invalid_input("File is too large to save in editor")
                .with_detail(format!("max_bytes={FILE_SAVE_HARD_LIMIT}")),
        );
    }

    let source = resolve_tree_path(&root, &path)?;
    if !source.exists() {
        return Err(AppCommandError::not_found("File does not exist"));
    }
    if !source.is_file() {
        return Err(AppCommandError::invalid_input("Path is not a file"));
    }

    run_file_io(move || {
        ensure_path_in_workspace(&root, &source)?;

        let source_meta = std::fs::symlink_metadata(&source).map_err(AppCommandError::io)?;
        if source_meta.file_type().is_symlink() {
            return Err(AppCommandError::invalid_input(
                "Saving symlink targets is not supported",
            ));
        }

        let parent = source
            .parent()
            .ok_or_else(|| {
                AppCommandError::invalid_input("Cannot determine parent directory for source file")
            })?
            .to_path_buf();
        ensure_path_in_workspace(&root, &parent)?;

        let source_name = source
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .ok_or_else(|| AppCommandError::invalid_input("Cannot determine source file name"))?;

        let mut created_path: Option<PathBuf> = None;
        for attempt in 1..=9_999 {
            let candidate_name = build_local_copy_file_name(&source_name, attempt);
            let candidate_path = parent.join(candidate_name);
            if candidate_path.exists() {
                continue;
            }
            created_path = Some(candidate_path);
            break;
        }

        let created_path = created_path.ok_or_else(|| {
            AppCommandError::already_exists(
                "Unable to create copy file: too many existing local copies",
            )
        })?;
        atomic_write_text(&created_path, content.as_bytes())?;

        let metadata = std::fs::metadata(&created_path).map_err(AppCommandError::io)?;
        let etag = compute_etag(content.as_bytes(), &metadata);
        let mtime_ms = file_mtime_ms(&metadata);
        let readonly = metadata.permissions().readonly();
        let line_ending = detect_line_ending(content.as_bytes());
        let rel_path = created_path
            .strip_prefix(&root)
            .map_err(|e| {
                AppCommandError::invalid_input("Failed to compute relative path for copy")
                    .with_detail(e.to_string())
            })?
            .to_string_lossy()
            .replace('\\', "/");

        Ok(FileSaveResult {
            path: rel_path,
            etag,
            mtime_ms,
            readonly,
            line_ending,
        })
    })
    .await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn rename_file_tree_entry(
    root_path: String,
    path: String,
    new_name: String,
) -> Result<String, AppCommandError> {
    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(AppCommandError::not_found("Folder does not exist"));
    }

    let target = resolve_tree_path(&root, &path)?;
    if !target.exists() {
        return Err(AppCommandError::not_found("Target file does not exist"));
    }
    if target == root {
        return Err(AppCommandError::invalid_input(
            "Cannot rename workspace root",
        ));
    }

    let parent = target
        .parent()
        .ok_or_else(|| AppCommandError::invalid_input("Cannot rename path without parent"))?;
    let validated_name = validate_new_name(&new_name)?;
    let next_path = parent.join(validated_name);

    if next_path == target {
        return Ok(path);
    }
    if next_path.exists() {
        return Err(AppCommandError::already_exists(
            "A file with this name already exists",
        ));
    }

    std::fs::rename(&target, &next_path).map_err(AppCommandError::io)?;

    let rel = next_path
        .strip_prefix(&root)
        .map_err(|e| {
            AppCommandError::invalid_input("Failed to compute relative path")
                .with_detail(e.to_string())
        })?
        .to_string_lossy()
        .to_string();
    Ok(rel)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn delete_file_tree_entry(
    root_path: String,
    path: String,
) -> Result<(), AppCommandError> {
    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(AppCommandError::not_found("Folder does not exist"));
    }

    let target = resolve_tree_path(&root, &path)?;
    // `Path::exists` follows symlinks and silently returns false on a
    // dangling link or any I/O error along the resolve chain, which gave
    // us "Target file does not exist" toasts even for files that were
    // physically present (case-only mismatches against a case-preserving
    // FS, NFD/NFC mismatches on macOS, files under a non-traversable
    // ancestor). `symlink_metadata` only stats the leaf and surfaces the
    // real OS error code in `detail`, which is what we want to diagnose
    // those reports.
    let meta = match std::fs::symlink_metadata(&target) {
        Ok(m) => m,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppCommandError::not_found("Target file does not exist")
                .with_detail(format!("resolved={} relative={}", target.display(), path)));
        }
        Err(err) => {
            return Err(
                AppCommandError::io_error("Failed to stat target").with_detail(format!(
                    "resolved={} relative={} error={}",
                    target.display(),
                    path,
                    err
                )),
            );
        }
    };
    if target == root {
        return Err(AppCommandError::invalid_input(
            "Cannot delete workspace root",
        ));
    }
    if meta.is_dir() {
        std::fs::remove_dir_all(&target).map_err(AppCommandError::io)?;
    } else {
        std::fs::remove_file(&target).map_err(AppCommandError::io)?;
    }

    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn create_file_tree_entry(
    root_path: String,
    path: String,
    name: String,
    kind: String,
) -> Result<String, AppCommandError> {
    let root = PathBuf::from(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err(AppCommandError::not_found("Folder does not exist"));
    }

    let validated_name = validate_new_name(&name)?;

    let parent_dir = if path.is_empty() {
        root.clone()
    } else {
        let resolved = resolve_tree_path(&root, &path)?;
        if !resolved.exists() {
            return Err(AppCommandError::not_found("Parent path does not exist"));
        }
        if resolved.is_file() {
            resolved.parent().map(|p| p.to_path_buf()).ok_or_else(|| {
                AppCommandError::invalid_input("Cannot determine parent directory")
            })?
        } else {
            resolved
        }
    };

    let target = parent_dir.join(validated_name);
    if target.exists() {
        return Err(AppCommandError::already_exists(
            "A file or directory with this name already exists",
        ));
    }

    match kind.as_str() {
        "file" => {
            std::fs::File::create(&target).map_err(AppCommandError::io)?;
        }
        "dir" => {
            std::fs::create_dir(&target).map_err(AppCommandError::io)?;
        }
        _ => {
            return Err(AppCommandError::invalid_input(
                "Kind must be 'file' or 'dir'",
            ));
        }
    }

    let rel = target
        .strip_prefix(&root)
        .map_err(|e| {
            AppCommandError::invalid_input("Failed to compute relative path")
                .with_detail(e.to_string())
        })?
        .to_string_lossy()
        .to_string();
    Ok(rel)
}

pub fn parse_raw_file_line(line: &str) -> Option<(String, String)> {
    let mut parts = line.split('\t');
    let meta = parts.next()?;
    let file_path = unquote_git_path(parts.next()?);
    let status = meta
        .split_whitespace()
        .last()
        .and_then(|v| v.chars().next())
        .unwrap_or('M')
        .to_string();
    Some((status, file_path))
}

pub fn parse_numstat_file_line(line: &str) -> Option<(u32, u32, String)> {
    let mut parts = line.splitn(3, '\t');
    let additions = parse_numstat_count(parts.next()?);
    let deletions = parse_numstat_count(parts.next()?);
    let file_path = unquote_git_path(parts.next()?);
    Some((additions, deletions, file_path))
}

fn parse_numstat_count(value: &str) -> u32 {
    if value == "-" {
        return 0;
    }

    value.parse::<u32>().unwrap_or(0)
}

/// Returns (unpushed_hashes, has_upstream).
pub async fn get_unpushed_hashes(
    path: &str,
    limit: u32,
    remote_override: Option<&str>,
    branch: Option<&str>,
) -> Result<(Option<HashSet<String>>, bool), AppCommandError> {
    let limit_arg = format!("-{}", limit);

    // If viewing a remote branch (e.g. "origin/main"), all commits are pushed
    if let Some(b) = branch {
        let is_remote = crate::process::tokio_command("git")
            .args([
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/remotes/{}", b),
            ])
            .current_dir(path)
            .output()
            .await
            .is_ok_and(|o| o.status.success());
        if is_remote {
            return Ok((Some(HashSet::new()), true));
        }
    }

    // The local ref to compare: specified branch or HEAD
    let local_ref = branch.unwrap_or("HEAD");

    // Check upstream for the target branch
    let upstream_arg = if branch.is_some() {
        format!("{}@{{upstream}}", local_ref)
    } else {
        "@{upstream}".to_string()
    };

    let upstream_output = crate::process::tokio_command("git")
        .args([
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            &upstream_arg,
        ])
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    let has_upstream = upstream_output.status.success()
        && !String::from_utf8_lossy(&upstream_output.stdout)
            .trim()
            .is_empty();

    // Determine the comparison target for unpushed commits.
    // We compare against <remote>/<branch> specifically rather than all remote
    // branches, so that commits shared with other remote branches still appear.
    let rev_list_output = if has_upstream && remote_override.is_none() {
        // Fast path: branch has an upstream tracking ref, use it directly
        let upstream = String::from_utf8_lossy(&upstream_output.stdout)
            .trim()
            .to_string();
        let range = format!("{upstream}..{local_ref}");
        crate::process::tokio_command("git")
            .args(["rev-list", &limit_arg, &range])
            .current_dir(path)
            .output()
            .await
            .map_err(AppCommandError::io)?
    } else {
        // Either remote_override is specified or no upstream exists.
        // Resolve the branch name and the target remote.
        let branch_name = if let Some(b) = branch {
            b.to_string()
        } else {
            let branch_output = crate::process::tokio_command("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .current_dir(path)
                .output()
                .await
                .map_err(AppCommandError::io)?;
            if !branch_output.status.success() {
                return Ok((None, has_upstream));
            }
            let name = String::from_utf8_lossy(&branch_output.stdout)
                .trim()
                .to_string();
            if name.is_empty() || name == "HEAD" {
                return Ok((None, has_upstream));
            }
            name
        };

        let remote = if let Some(r) = remote_override {
            r.to_string()
        } else {
            let remote_key = format!("branch.{}.remote", branch_name);
            let remote_output = crate::process::tokio_command("git")
                .args(["config", "--get", &remote_key])
                .current_dir(path)
                .output()
                .await;
            remote_output
                .ok()
                .filter(|output| output.status.success())
                .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "origin".to_string())
        };

        // Try comparing against <remote>/<branch> directly
        let remote_branch_ref = format!("refs/remotes/{}/{}", remote, branch_name);
        let verify_output = crate::process::tokio_command("git")
            .args(["rev-parse", "--verify", "--quiet", &remote_branch_ref])
            .current_dir(path)
            .output()
            .await;
        let remote_branch_exists = verify_output.is_ok_and(|o| o.status.success());

        if remote_branch_exists {
            let range = format!("{}/{}..{}", remote, branch_name, local_ref);
            crate::process::tokio_command("git")
                .args(["rev-list", &limit_arg, &range])
                .current_dir(path)
                .output()
                .await
                .map_err(AppCommandError::io)?
        } else {
            // Branch doesn't exist on remote yet (new branch).
            // Try merge-base with the remote's default branch to show
            // the meaningful divergence point.
            let remote_head = format!("{}/HEAD", remote);
            let mb_output = crate::process::tokio_command("git")
                .args(["merge-base", local_ref, &remote_head])
                .current_dir(path)
                .output()
                .await;
            let merge_base = mb_output
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty());

            if let Some(base) = merge_base {
                let range = format!("{}..{}", base, local_ref);
                crate::process::tokio_command("git")
                    .args(["rev-list", &limit_arg, &range])
                    .current_dir(path)
                    .output()
                    .await
                    .map_err(AppCommandError::io)?
            } else {
                // Last resort: compare against all branches on the remote
                let remote_arg = format!("--remotes={}", remote);
                crate::process::tokio_command("git")
                    .args(["rev-list", &limit_arg, local_ref, "--not", &remote_arg])
                    .current_dir(path)
                    .output()
                    .await
                    .map_err(AppCommandError::io)?
            }
        }
    };

    if !rev_list_output.status.success() {
        return Ok((None, has_upstream));
    }

    let hashes = String::from_utf8_lossy(&rev_list_output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect::<HashSet<_>>();

    Ok((Some(hashes), has_upstream))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_helpers::fresh_in_memory_db;
    use crate::models::agent::AgentType;

    #[test]
    fn emit_folder_upsert_broadcasts_on_folder_channel() {
        // A headlessly-created folder must reach every client on
        // `folder://changed` carrying its full detail, so the sidebar can place a
        // conversation produced inside it without a re-fetch.
        use crate::db::entities::folder::FolderKind;
        use crate::web::event_bridge::{WebEventBroadcaster, FOLDER_CHANGED_EVENT};
        use std::sync::Arc;

        let broadcaster = Arc::new(WebEventBroadcaster::new());
        let mut rx = broadcaster.subscribe();
        let emitter = EventEmitter::test_web_only(broadcaster.clone());

        emit_folder_upsert(
            &emitter,
            FolderDetail {
                id: 7,
                name: "repo-automation-3-run-9".to_string(),
                path: "/home/me/repo-automation-3-run-9".to_string(),
                git_branch: Some("automation/3/run-9".to_string()),
                default_agent_type: None,
                last_opened_at: chrono::Utc::now(),
                sort_order: 0,
                color: "inherit".to_string(),
                parent_id: Some(1),
                kind: FolderKind::Regular,
            },
        );

        let evt = rx.try_recv().expect("folder upsert should broadcast");
        let p = &*evt.payload;
        assert_eq!(evt.channel, FOLDER_CHANGED_EVENT);
        assert_eq!(p["kind"], "upsert");
        assert_eq!(p["folder"]["id"], 7);
        assert_eq!(p["folder"]["parent_id"], 1);
    }

    /// Run a git command in `dir`, supplying identity via env so the test does
    /// not depend on (or mutate) the developer's global git config.
    fn git_run(dir: &std::path::Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@example.com")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@example.com")
            .output()
            .expect("spawn git");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[tokio::test]
    async fn resolve_git_head_reports_branch_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        git_run(dir.path(), &["init", "-q"]);
        git_run(dir.path(), &["commit", "-q", "--allow-empty", "-m", "c1"]);
        git_run(dir.path(), &["checkout", "-q", "-b", "feature"]);

        let info = resolve_git_head(dir.path().to_str().unwrap())
            .await
            .expect("resolve");
        assert_eq!(
            info,
            GitHeadInfo {
                is_repo: true,
                branch: Some("feature".into()),
                detached: false,
                short_sha: None,
            }
        );
    }

    #[tokio::test]
    async fn resolve_git_head_detects_detached_head() {
        let dir = tempfile::tempdir().expect("tempdir");
        git_run(dir.path(), &["init", "-q"]);
        git_run(dir.path(), &["commit", "-q", "--allow-empty", "-m", "c1"]);
        git_run(dir.path(), &["commit", "-q", "--allow-empty", "-m", "c2"]);
        git_run(dir.path(), &["checkout", "-q", "HEAD~1"]);

        let info = resolve_git_head(dir.path().to_str().unwrap())
            .await
            .expect("resolve");
        assert!(info.is_repo, "detached HEAD is still a repo");
        assert!(info.detached, "must be flagged detached");
        assert_eq!(info.branch, None, "no branch when detached");
        assert!(
            info.short_sha.as_deref().is_some_and(|s| !s.is_empty()),
            "detached HEAD should expose a short sha, got {:?}",
            info.short_sha
        );
    }

    #[tokio::test]
    async fn resolve_git_head_handles_non_repo() {
        let dir = tempfile::tempdir().expect("tempdir");
        let info = resolve_git_head(dir.path().to_str().unwrap())
            .await
            .expect("resolve");
        assert_eq!(
            info,
            GitHeadInfo {
                is_repo: false,
                branch: None,
                detached: false,
                short_sha: None,
            }
        );
    }

    #[tokio::test]
    async fn resolve_git_head_handles_unborn_branch() {
        let dir = tempfile::tempdir().expect("tempdir");
        git_run(dir.path(), &["init", "-q"]);

        let info = resolve_git_head(dir.path().to_str().unwrap())
            .await
            .expect("resolve");
        assert!(info.is_repo, "freshly-initialized repo is a repo");
        assert!(!info.detached, "unborn branch is not detached");
        assert!(
            info.branch.is_some(),
            "unborn branch should resolve a name, got {:?}",
            info.branch
        );
    }

    #[tokio::test]
    async fn get_git_branch_stays_none_on_detached_head() {
        let dir = tempfile::tempdir().expect("tempdir");
        git_run(dir.path(), &["init", "-q"]);
        git_run(dir.path(), &["commit", "-q", "--allow-empty", "-m", "c1"]);
        git_run(dir.path(), &["commit", "-q", "--allow-empty", "-m", "c2"]);
        git_run(dir.path(), &["checkout", "-q", "HEAD~1"]);

        // The legacy `Option<String>` contract intentionally reports no branch
        // for a detached HEAD; git-log default selection and compare rely on it.
        assert_eq!(
            get_git_branch(dir.path().to_str().unwrap().to_string())
                .await
                .expect("branch"),
            None
        );
    }

    #[tokio::test]
    async fn add_folder_to_history_core_derives_name_from_path() {
        let db = fresh_in_memory_db().await;
        let entry = add_folder_to_history_core(&db, "/tmp/veryagent-test-project".into())
            .await
            .expect("add folder");
        assert_eq!(entry.name, "veryagent-test-project");
        assert_eq!(entry.path, "/tmp/veryagent-test-project");
    }

    #[tokio::test]
    async fn add_folder_to_history_core_upserts_on_duplicate_path() {
        let db = fresh_in_memory_db().await;
        let path = "/tmp/veryagent-dup-test".to_string();
        let first = add_folder_to_history_core(&db, path.clone())
            .await
            .expect("add 1st");
        let second = add_folder_to_history_core(&db, path.clone())
            .await
            .expect("add 2nd");
        assert_eq!(first.id, second.id, "duplicate path must reuse id");

        let history = load_folder_history_core(&db).await.expect("history");
        assert_eq!(
            history.iter().filter(|f| f.path == path).count(),
            1,
            "no duplicate rows for same path"
        );
    }

    #[tokio::test]
    async fn remove_folder_from_history_core_soft_deletes() {
        let db = fresh_in_memory_db().await;
        let path = "/tmp/veryagent-remove-test".to_string();
        add_folder_to_history_core(&db, path.clone())
            .await
            .expect("add");
        remove_folder_from_history_core(&db, path.clone())
            .await
            .expect("remove");
        let history = load_folder_history_core(&db).await.expect("history");
        assert!(
            history.iter().all(|f| f.path != path),
            "soft-deleted folder must not appear in list"
        );
    }

    #[tokio::test]
    async fn open_folder_by_id_core_errors_when_missing() {
        let db = fresh_in_memory_db().await;
        let err = open_folder_by_id_core(&db, 99_999)
            .await
            .expect_err("missing id should error");
        // Either the not_found wrapper (when set_folder_open returns Ok(()) on no-op)
        // or the underlying DbError propagates — both are acceptable for "missing".
        let msg = format!("{err:?}");
        assert!(
            msg.to_lowercase().contains("not found") || msg.to_lowercase().contains("99999"),
            "expected not-found-ish error, got: {msg}"
        );
    }

    #[tokio::test]
    async fn open_worktree_folder_core_records_parent_as_root() {
        let db = fresh_in_memory_db().await;
        let root = open_folder_core(&db, "/tmp/veryagent-wt-root".into())
            .await
            .expect("open root");
        assert_eq!(root.parent_id, None, "root folder has no parent");

        let wt = open_worktree_folder_core(&db, "/tmp/veryagent-wt-a".into(), root.id)
            .await
            .expect("open worktree");
        assert_eq!(
            wt.parent_id,
            Some(root.id),
            "worktree records its source root folder"
        );
    }

    #[tokio::test]
    async fn open_worktree_folder_core_flattens_nested_worktrees() {
        let db = fresh_in_memory_db().await;
        let root = open_folder_core(&db, "/tmp/veryagent-wt-flat-root".into())
            .await
            .expect("open root");
        let child = open_worktree_folder_core(&db, "/tmp/veryagent-wt-flat-1".into(), root.id)
            .await
            .expect("open child worktree");
        // A worktree created *from* the child must still point at the root, not
        // the intermediate child.
        let grandchild = open_worktree_folder_core(&db, "/tmp/veryagent-wt-flat-2".into(), child.id)
            .await
            .expect("open grandchild worktree");
        assert_eq!(child.parent_id, Some(root.id));
        assert_eq!(
            grandchild.parent_id,
            Some(root.id),
            "worktree of a worktree flattens to the original root"
        );
    }

    #[tokio::test]
    async fn open_worktree_folder_core_unknown_source_is_root() {
        let db = fresh_in_memory_db().await;
        let wt = open_worktree_folder_core(&db, "/tmp/veryagent-wt-orphan".into(), 0)
            .await
            .expect("open worktree with no source");
        assert_eq!(
            wt.parent_id, None,
            "non-positive / unknown source degrades to a top-level folder"
        );
    }

    #[test]
    fn parse_worktrees_extracts_path_branch_pairs() {
        // Main tree + a linked worktree + a detached worktree, trailing blank line.
        let stdout = "\
worktree /repo/main
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /repo/wt-feature
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/feature-x

worktree /repo/wt-detached
HEAD cccccccccccccccccccccccccccccccccccccccc
detached

";
        let entries = parse_worktrees(stdout);
        assert_eq!(
            entries,
            vec![
                ("/repo/main".to_string(), Some("main".to_string())),
                (
                    "/repo/wt-feature".to_string(),
                    Some("feature-x".to_string())
                ),
                ("/repo/wt-detached".to_string(), None),
            ]
        );
    }

    #[test]
    fn parse_worktrees_flushes_trailing_block_without_blank_line() {
        // No terminating blank line on the last block (git omits it at EOF here).
        let stdout = "\
worktree /repo/main
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main";
        let entries = parse_worktrees(stdout);
        assert_eq!(
            entries,
            vec![("/repo/main".to_string(), Some("main".to_string()))]
        );
    }

    #[test]
    fn parse_worktrees_handles_empty_and_bare() {
        assert!(parse_worktrees("").is_empty());
        // A bare repo entry carries no branch.
        let entries = parse_worktrees("worktree /repo/bare\nbare\n\n");
        assert_eq!(entries, vec![("/repo/bare".to_string(), None)]);
    }

    #[tokio::test]
    async fn open_folder_core_preserves_existing_worktree_parent() {
        let db = fresh_in_memory_db().await;
        let root = open_folder_core(&db, "/tmp/veryagent-wt-preserve-root".into())
            .await
            .expect("open root");
        let wt = open_worktree_folder_core(&db, "/tmp/veryagent-wt-preserve".into(), root.id)
            .await
            .expect("open worktree");
        assert_eq!(wt.parent_id, Some(root.id));
        // A plain reopen of the same path must not clear the recorded parent.
        let reopened = open_folder_core(&db, "/tmp/veryagent-wt-preserve".into())
            .await
            .expect("reopen plain");
        assert_eq!(
            reopened.parent_id,
            Some(root.id),
            "plain open_folder must preserve an existing worktree parent"
        );
    }

    #[tokio::test]
    async fn open_worktree_folder_core_unknown_source_demotes_existing_to_root() {
        let db = fresh_in_memory_db().await;
        let root = open_folder_core(&db, "/tmp/veryagent-wt-demote-root".into())
            .await
            .expect("open root");
        let path = "/tmp/veryagent-wt-demote".to_string();
        let wt = open_worktree_folder_core(&db, path.clone(), root.id)
            .await
            .expect("open worktree");
        assert_eq!(wt.parent_id, Some(root.id));
        // Reopening the same path as a worktree with an unknown source writes the
        // authoritative value (top-level) rather than keeping the stale parent.
        let demoted = open_worktree_folder_core(&db, path, 0)
            .await
            .expect("reopen worktree with no source");
        assert_eq!(
            demoted.parent_id, None,
            "explicit worktree open with unknown source demotes to top-level"
        );
    }

    #[tokio::test]
    async fn update_folder_color_core_roundtrips() {
        let db = fresh_in_memory_db().await;
        let entry = add_folder_to_history_core(&db, "/tmp/veryagent-color-test".into())
            .await
            .expect("add");
        let updated = update_folder_color_core(&db, entry.id, "#ff8800".into())
            .await
            .expect("update color");
        assert_eq!(updated.color, "#ff8800");
        let read_back = get_folder_core(&db, entry.id).await.expect("get");
        assert_eq!(read_back.color, "#ff8800");
    }

    #[tokio::test]
    async fn update_folder_default_agent_core_set_then_clear() {
        let db = fresh_in_memory_db().await;
        let entry = add_folder_to_history_core(&db, "/tmp/veryagent-agent-test".into())
            .await
            .expect("add");
        let set = update_folder_default_agent_core(&db, entry.id, Some(AgentType::ClaudeCode))
            .await
            .expect("set agent");
        assert_eq!(set.default_agent_type, Some(AgentType::ClaudeCode));
        let cleared = update_folder_default_agent_core(&db, entry.id, None)
            .await
            .expect("clear agent");
        assert_eq!(cleared.default_agent_type, None);
    }
}

// Symlink confinement that `read_workspace_file_base64` relies on. Unix-only
// because it uses real filesystem symlinks.
#[cfg(all(test, unix))]
mod workspace_confinement_tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[tokio::test]
    async fn reads_in_root_file() {
        let root = tempfile::tempdir().expect("root");
        std::fs::write(root.path().join("a.txt"), b"hello").expect("write");
        let b64 = read_workspace_file_base64(
            root.path().to_string_lossy().into_owned(),
            "a.txt".to_string(),
            None,
        )
        .await
        .expect("should read in-root file");
        assert_eq!(b64, "aGVsbG8="); // base64("hello")
    }

    #[tokio::test]
    async fn rejects_symlink_escaping_root() {
        let root = tempfile::tempdir().expect("root");
        let outside = tempfile::tempdir().expect("outside");
        std::fs::write(outside.path().join("secret"), b"top").expect("write");
        symlink(outside.path().join("secret"), root.path().join("link"))
            .expect("symlink");
        // The canonical target resolves outside the root, so the read is denied
        // even though `root/link` is lexically inside the workspace.
        let res = read_workspace_file_base64(
            root.path().to_string_lossy().into_owned(),
            "link".to_string(),
            None,
        )
        .await;
        assert!(res.is_err(), "symlink escaping the workspace must be rejected");
    }

    #[test]
    fn ensure_path_in_workspace_rejects_symlink() {
        let root = tempfile::tempdir().expect("root");
        let outside = tempfile::tempdir().expect("outside");
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, b"x").expect("write");
        let link = root.path().join("asset.txt");
        symlink(&secret, &link).expect("symlink");
        assert!(ensure_path_in_workspace(root.path(), &link).is_err());
    }
}
