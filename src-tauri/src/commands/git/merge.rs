// git/merge.rs
use crate::app_error::AppCommandError;
use super::*;

/// Start a merge with the upstream branch (used by merge workspace after pull conflict detection).
/// This recreates the conflict state so that :1:, :2:, :3: stage entries are available.
/// If `upstream_commit` is provided, merge against that specific commit instead of `@{u}`.
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_start_pull_merge(
    path: String,
    upstream_commit: Option<String>,
) -> Result<(), AppCommandError> {
    let target = upstream_commit.as_deref().unwrap_or("@{u}");
    let output = crate::process::tokio_command("git")
        .args(["merge", "--no-commit", target])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    // It's expected to fail with conflicts — that's the point.
    // We just need the merge state to be active so stage entries exist.
    if !output.status.success() {
        let conflicted_files = detect_conflicts(&path).await?;
        if !conflicted_files.is_empty() {
            return Ok(()); // Conflict state is now active — merge workspace can proceed
        }
        return Err(git_command_error("merge", &output.stderr));
    }

    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_has_merge_head(path: String) -> Result<bool, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["rev-parse", "--verify", "MERGE_HEAD"])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;
    Ok(output.status.success())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_merge(
    path: String,
    branch_name: String,
) -> Result<GitMergeResult, AppCommandError> {
    // Count commits to be merged before performing merge
    let count_output = crate::process::tokio_command("git")
        .args(["rev-list", "--count", &format!("HEAD..{}", branch_name)])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    let merged_commits = if count_output.status.success() {
        String::from_utf8_lossy(&count_output.stdout)
            .trim()
            .parse::<usize>()
            .unwrap_or(0)
    } else {
        0
    };

    let output = crate::process::tokio_command("git")
        .args(["merge", &branch_name])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        let conflicted_files = detect_conflicts(&path).await?;
        if !conflicted_files.is_empty() {
            return Ok(GitMergeResult {
                merged_commits,
                conflict: Some(GitConflictInfo {
                    has_conflicts: true,
                    conflicted_files,
                    operation: "merge".to_string(),
                    upstream_commit: None,
                }),
            });
        }
        return Err(git_command_error("merge", &output.stderr));
    }
    Ok(GitMergeResult {
        merged_commits,
        conflict: None,
    })
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_rebase(
    path: String,
    branch_name: String,
) -> Result<GitRebaseResult, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["rebase", &branch_name])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        let conflicted_files = detect_conflicts(&path).await?;
        if !conflicted_files.is_empty() {
            return Ok(GitRebaseResult {
                message: String::from_utf8_lossy(&output.stdout).trim().to_string(),
                conflict: Some(GitConflictInfo {
                    has_conflicts: true,
                    conflicted_files,
                    operation: "rebase".to_string(),
                    upstream_commit: None,
                }),
            });
        }
        return Err(git_command_error("rebase", &output.stderr));
    }
    Ok(GitRebaseResult {
        message: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        conflict: None,
    })
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_abort_operation(path: String, operation: String) -> Result<(), AppCommandError> {
    let args = match operation.as_str() {
        "merge" | "pull" => vec!["merge", "--abort"],
        "rebase" => vec!["rebase", "--abort"],
        _ => {
            return Err(AppCommandError::invalid_input(format!(
                "Unknown operation: {operation}"
            )));
        }
    };

    let output = crate::process::tokio_command("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error(
            &format!("{} --abort", operation),
            &output.stderr,
        ));
    }
    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_continue_operation(
    path: String,
    operation: String,
) -> Result<(), AppCommandError> {
    let (program, args): (&str, Vec<&str>) = match operation.as_str() {
        "merge" | "pull" => ("git", vec!["commit", "--no-edit"]),
        "rebase" => ("git", vec!["rebase", "--continue"]),
        _ => {
            return Err(AppCommandError::invalid_input(format!(
                "Unknown operation: {operation}"
            )));
        }
    };

    let output = crate::process::tokio_command(program)
        .args(&args)
        .current_dir(&path)
        .env("GIT_EDITOR", "true")
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error(
            &format!("{} --continue", operation),
            &output.stderr,
        ));
    }
    Ok(())
}
