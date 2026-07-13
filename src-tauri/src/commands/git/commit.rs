// git/commit.rs
use crate::app_error::AppCommandError;
use crate::db::AppDatabase;
use crate::web::event_bridge::EventEmitter;
use crate::git_repo::ensure_git_repo;
use std::collections::HashSet;
use super::*;

pub(crate) async fn git_commit_core(
    emitter: &EventEmitter,
    folder_id: Option<i32>,
    conn: &sea_orm::DatabaseConnection,
    path: &str,
    message: &str,
    files: &[String],
) -> Result<GitCommitResult, AppCommandError> {
    // Find files already staged for deletion — git add would fail on these
    // because they no longer exist in either the working tree or the index.
    let staged_deletions: std::collections::HashSet<String> = crate::process::tokio_command("git")
        .args(["diff", "--cached", "--name-only", "--diff-filter=D", "-z"])
        .current_dir(path)
        .output()
        .await
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .split('\0')
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    // Stage only files that aren't already staged deletions
    let files_to_add: Vec<_> = files
        .iter()
        .filter(|f| !staged_deletions.contains(f.as_str()))
        .collect();

    if !files_to_add.is_empty() {
        let mut add_args = vec!["add".to_string(), "--".to_string()];
        add_args.extend(
            files_to_add
                .iter()
                .map(|file| to_git_literal_pathspec(file)),
        );

        let add_output = crate::process::tokio_command("git")
            .args(&add_args)
            .current_dir(path)
            .output()
            .await
            .map_err(AppCommandError::io)?;

        if !add_output.status.success() {
            return Err(git_command_error("add", &add_output.stderr));
        }
    }

    // Resolve commit author from matching account (e.g. GitHub username)
    let author_override = crate::git_credential::resolve_commit_author(path, conn).await;

    // Commit
    let mut commit_cmd = crate::process::tokio_command("git");
    if let Some((ref name, ref email)) = author_override {
        commit_cmd.args([
            "-c",
            &format!("user.name={name}"),
            "-c",
            &format!("user.email={email}"),
        ]);
    }
    commit_cmd.args(["commit", "-m", message]).current_dir(path);

    let commit_output = commit_cmd.output().await.map_err(AppCommandError::io)?;

    if !commit_output.status.success() {
        return Err(git_command_error("commit", &commit_output.stderr));
    }

    let committed_files = count_files_in_commit(path, "HEAD")
        .await
        .unwrap_or(files.len());

    if let Some(folder_id) = folder_id {
        crate::web::event_bridge::emit_event(
            emitter,
            "folder://git-commit-succeeded",
            GitCommitSucceededEvent {
                folder_id,
                committed_files,
            },
        );
    }

    Ok(GitCommitResult { committed_files })
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_commit(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    db: tauri::State<'_, AppDatabase>,
    path: String,
    message: String,
    files: Vec<String>,
    folder_id: Option<i32>,
) -> Result<GitCommitResult, AppCommandError> {
    let folder_id = folder_id.or_else(|| {
        window
            .label()
            .strip_prefix("commit-")
            .and_then(|value| value.parse::<i32>().ok())
    });
    let emitter = EventEmitter::Tauri(app.clone());
    git_commit_core(&emitter, folder_id, &db.conn, &path, &message, &files).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_commit_branches(
    path: String,
    commit: String,
) -> Result<Vec<String>, AppCommandError> {
    ensure_git_repo(&path)?;

    let contains_arg = format!("--contains={commit}");
    let output = crate::process::tokio_command("git")
        .args([
            "for-each-ref",
            &contains_arg,
            "--format=%(refname:short)",
            "refs/heads",
            "refs/remotes",
        ])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("for-each-ref", &output.stderr));
    }

    let mut seen = HashSet::new();
    let mut branches = Vec::new();

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let branch = line.trim();
        if branch.is_empty() || branch.ends_with("/HEAD") {
            continue;
        }

        if seen.insert(branch.to_string()) {
            branches.push(branch.to_string());
        }
    }

    branches.sort();
    Ok(branches)
}
