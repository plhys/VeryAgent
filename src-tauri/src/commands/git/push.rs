// git/push.rs
#[cfg(feature = "tauri-runtime")]
use tauri::Manager;
use crate::app_error::AppCommandError;
use crate::db::AppDatabase;
use crate::models::GitCredentials;
use crate::web::event_bridge::EventEmitter;
use crate::git_repo::ensure_git_repo;
use super::*;

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_push_info(path: String) -> Result<GitPushInfo, AppCommandError> {
    ensure_git_repo(&path)?;

    // Get current branch name
    let branch_output = crate::process::tokio_command("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;
    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    // Get tracking remote for current branch
    let remote_key = format!("branch.{}.remote", branch);
    let remote_output = crate::process::tokio_command("git")
        .args(["config", "--get", &remote_key])
        .current_dir(&path)
        .output()
        .await;
    let tracking_remote = remote_output
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|v| !v.is_empty());

    // Get all remotes
    let remotes = git_list_remotes(path).await?;

    Ok(GitPushInfo {
        branch,
        remotes,
        tracking_remote,
    })
}

pub(crate) async fn git_push_core(
    data_dir: &std::path::Path,
    emitter: &EventEmitter,
    folder_id: Option<i32>,
    path: &str,
    remote: Option<&str>,
    credentials: Option<&GitCredentials>,
    db: &AppDatabase,
) -> Result<GitPushResult, AppCommandError> {
    let pushed_commits = estimate_push_commit_count(path).await;

    let target_remote = remote.filter(|s| !s.is_empty()).unwrap_or("origin");

    let branch_output = crate::process::tokio_command("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)?;
    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    let upstream_check = crate::process::tokio_command("git")
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    let current_upstream = if upstream_check.status.success() {
        Some(
            String::from_utf8_lossy(&upstream_check.stdout)
                .trim()
                .to_string(),
        )
    } else {
        None
    };

    let needs_set_upstream = match &current_upstream {
        None => true,
        Some(upstream) => !upstream.starts_with(&format!("{}/", target_remote)),
    };

    let output = if needs_set_upstream {
        let mut cmd = crate::process::tokio_command("git");
        cmd.args(["push", "--set-upstream", target_remote, &branch])
            .current_dir(path);
        GitOps::new(path, data_dir, db).prepare_for_remote(&mut cmd, Some(target_remote), credentials).await;
        cmd.output().await.map_err(AppCommandError::io)?
    } else {
        let mut cmd = crate::process::tokio_command("git");
        cmd.args(["push", target_remote, &branch]).current_dir(path);
        GitOps::new(path, data_dir, db).prepare_for_remote(&mut cmd, Some(target_remote), credentials).await;
        cmd.output().await.map_err(AppCommandError::io)?
    };

    if !output.status.success() {
        return Err(classify_remote_git_error("push", &output.stderr));
    }

    let upstream_set = needs_set_upstream;

    if let Some(folder_id) = folder_id {
        crate::web::event_bridge::emit_event(
            emitter,
            "folder://git-push-succeeded",
            GitPushSucceededEvent {
                folder_id,
                pushed_commits,
                upstream_set,
            },
        );
    }

    Ok(GitPushResult {
        pushed_commits,
        upstream_set,
    })
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_push(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: String,
    remote: Option<String>,
    credentials: Option<GitCredentials>,
    folder_id: Option<i32>,
    db: tauri::State<'_, AppDatabase>,
) -> Result<GitPushResult, AppCommandError> {
    let folder_id = folder_id.or_else(|| {
        window
            .label()
            .strip_prefix("push-")
            .and_then(|value| value.parse::<i32>().ok())
    });
    let data_dir = app.path().app_data_dir().map_err(|e| {
        AppCommandError::external_command("Failed to resolve app data dir", e.to_string())
    })?;
    // Resolve through the effective data dir so a custom
    // `VERYAGENT_DATA_DIR` reaches the git credential helper invoked by
    // this subprocess.
    let data_dir = crate::paths::resolve_effective_data_dir(&data_dir);
    let emitter = EventEmitter::Tauri(app.clone());
    git_push_core(
        &data_dir,
        &emitter,
        folder_id,
        &path,
        remote.as_deref(),
        credentials.as_ref(),
        &db,
    )
    .await
}

pub(crate) async fn git_delete_remote_branch_core(
    path: &str,
    remote: &str,
    branch: &str,
    credentials: Option<&GitCredentials>,
    db: &AppDatabase,
    data_dir: &std::path::Path,
) -> Result<String, AppCommandError> {
    let mut cmd = crate::process::tokio_command("git");
    cmd.args(["push", remote, "--delete", branch])
        .current_dir(path);
    GitOps::new(path, data_dir, db).prepare_for_remote(&mut cmd, Some(remote), credentials).await;

    let output = cmd.output().await.map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(classify_remote_git_error("push --delete", &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_delete_remote_branch(
    path: String,
    remote: String,
    branch: String,
    credentials: Option<GitCredentials>,
    db: tauri::State<'_, AppDatabase>,
    app_handle: tauri::AppHandle,
) -> Result<String, AppCommandError> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| {
        AppCommandError::external_command("Failed to resolve app data dir", e.to_string())
    })?;
    // Resolve through the effective data dir so a custom
    // `VERYAGENT_DATA_DIR` reaches the git credential helper invoked by
    // this subprocess.
    let data_dir = crate::paths::resolve_effective_data_dir(&data_dir);
    git_delete_remote_branch_core(
        &path,
        &remote,
        &branch,
        credentials.as_ref(),
        &db,
        &data_dir,
    )
    .await
}
