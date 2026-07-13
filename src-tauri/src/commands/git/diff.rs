// git/diff.rs
use crate::app_error::AppCommandError;
use crate::git_repo::ensure_git_repo;
use std::path::Path;
use super::*;

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_checkout(path: String, branch_name: String) -> Result<(), AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["checkout", &branch_name])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("checkout", &output.stderr));
    }
    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_reset(path: String, commit: String, mode: String) -> Result<(), AppCommandError> {
    let mode = mode.trim().to_lowercase();
    let mode_flag = match mode.as_str() {
        "soft" | "mixed" | "hard" | "keep" => format!("--{mode}"),
        _ => {
            return Err(AppCommandError::invalid_input(
                "Reset mode must be one of: soft, mixed, hard, keep",
            ))
        }
    };

    let output = crate::process::tokio_command("git")
        .args(["reset", mode_flag.as_str(), commit.as_str()])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("reset", &output.stderr));
    }

    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_status(
    path: String,
    show_all_untracked: Option<bool>,
) -> Result<Vec<GitStatusEntry>, AppCommandError> {
    ensure_git_repo(&path)?;

    let untracked_mode = if show_all_untracked.unwrap_or(false) {
        "-uall"
    } else {
        "-unormal"
    };
    // `--no-optional-locks` keeps this read-only query from contending with
    // concurrent agent writes on `.git/index.lock`. See PR #215 follow-up.
    let output = crate::process::tokio_command("git")
        .arg("--no-optional-locks")
        .args(["-c", "core.quotePath=false"])
        .args(["status", "--porcelain=v1", untracked_mode])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("status", &output.stderr));
    }

    let entries = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let status = line[..2].trim().to_string();
            let file = unquote_git_path(&line[3..]);
            GitStatusEntry { status, file }
        })
        .collect();
    Ok(entries)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_is_tracked(path: String, file: String) -> Result<bool, AppCommandError> {
    let literal_file = to_git_literal_pathspec(&file);
    let output = crate::process::tokio_command("git")
        .args(["ls-files", "--error-unmatch", "--"])
        .arg(&literal_file)
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    Ok(output.status.success())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_diff(path: String, file: Option<String>) -> Result<String, AppCommandError> {
    ensure_git_repo(&path)?;

    let literal_file = file.as_deref().map(to_git_literal_pathspec);
    let mut args = vec!["diff".to_string(), "HEAD".to_string()];
    if let Some(ref f) = literal_file {
        args.push("--".to_string());
        args.push(f.clone());
    }

    let output = crate::process::tokio_command("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        // For new repos with no HEAD, fall back to diff --cached
        let mut fallback_args = vec!["diff".to_string(), "--cached".to_string()];
        if let Some(ref f) = literal_file {
            fallback_args.push("--".to_string());
            fallback_args.push(f.clone());
        }
        let fallback = crate::process::tokio_command("git")
            .args(&fallback_args)
            .current_dir(&path)
            .output()
            .await
            .map_err(AppCommandError::io)?;
        return Ok(String::from_utf8_lossy(&fallback.stdout).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_diff_with_branch(
    path: String,
    branch: String,
    file: Option<String>,
) -> Result<String, AppCommandError> {
    ensure_git_repo(&path)?;

    let target_branch = branch.trim();
    if target_branch.is_empty() {
        return Err(AppCommandError::invalid_input(
            "Branch name cannot be empty",
        ));
    }

    let literal_file = file.as_deref().map(to_git_literal_pathspec);
    let mut args = vec![
        "diff".to_string(),
        "--no-color".to_string(),
        target_branch.to_string(),
    ];
    if let Some(ref f) = literal_file {
        args.push("--".to_string());
        args.push(f.clone());
    }

    let output = crate::process::tokio_command("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppCommandError::external_command(
            "git diff failed",
            format!("branch={target_branch}; {stderr}"),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_show_diff(
    path: String,
    commit: String,
    file: Option<String>,
) -> Result<String, AppCommandError> {
    ensure_git_repo(&path)?;

    let literal_file = file.as_deref().map(to_git_literal_pathspec);
    let mut args = vec![
        "show".to_string(),
        "--no-color".to_string(),
        "--format=".to_string(),
        commit,
    ];
    if let Some(ref f) = literal_file {
        args.push("--".to_string());
        args.push(f.clone());
    }

    let output = crate::process::tokio_command("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("show", &output.stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_show_file(
    path: String,
    file: String,
    ref_name: Option<String>,
) -> Result<String, AppCommandError> {
    ensure_git_repo(&path)?;

    let git_ref = ref_name.unwrap_or_else(|| "HEAD".to_string());
    let file_spec = format!("{}:{}", git_ref, file);

    let output = crate::process::tokio_command("git")
        .args(["show", &file_spec])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        // File doesn't exist at this ref (e.g. new/untracked file) — return empty
        return Ok(String::new());
    }

    let bytes = &output.stdout;
    if bytes.iter().take(2048).any(|b| *b == 0) {
        return Err(
            AppCommandError::invalid_input("Binary files are not supported").with_detail(file_spec),
        );
    }

    Ok(String::from_utf8_lossy(bytes).to_string())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_rollback_file(path: String, file: String) -> Result<(), AppCommandError> {
    let target = file.trim();
    if target.is_empty() {
        return Err(AppCommandError::invalid_input("File path cannot be empty"));
    }

    let literal_file = to_git_literal_pathspec(target);
    let restore_output = crate::process::tokio_command("git")
        .args([
            "restore",
            "--source=HEAD",
            "--staged",
            "--worktree",
            "--",
            &literal_file,
        ])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if restore_output.status.success() {
        return Ok(());
    }

    let restore_stderr = String::from_utf8_lossy(&restore_output.stderr)
        .trim()
        .to_string();
    let restore_stderr_lower = restore_stderr.to_lowercase();
    let supports_restore = !restore_stderr_lower.contains("unknown option")
        && !restore_stderr_lower.contains("unknown switch")
        && !restore_stderr_lower.contains("not a git command")
        && !restore_stderr_lower.contains("did you mean");

    if supports_restore {
        return Err(AppCommandError::external_command(
            "git restore failed",
            restore_stderr,
        ));
    }

    let _ = crate::process::tokio_command("git")
        .args(["reset", "HEAD", "--", &literal_file])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    let checkout_output = crate::process::tokio_command("git")
        .args(["checkout", "--", &literal_file])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !checkout_output.status.success() {
        return Err(git_command_error("checkout --", &checkout_output.stderr));
    }

    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_list_conflicts(path: String) -> Result<Vec<String>, AppCommandError> {
    detect_conflicts(&path).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_conflict_file_versions(
    path: String,
    file: String,
) -> Result<GitConflictFileVersions, AppCommandError> {
    // :1: = base (common ancestor), :2: = ours (HEAD), :3: = theirs (incoming)
    let mut versions = Vec::with_capacity(3);
    for stage in ["1", "2", "3"] {
        let file_spec = format!(":{}:{}", stage, file);
        let output = crate::process::tokio_command("git")
            .args(["show", &file_spec])
            .current_dir(&path)
            .output()
            .await
            .map_err(AppCommandError::io)?;

        if !output.status.success() {
            // File may not exist at this stage (e.g. newly added on one side)
            versions.push(String::new());
        } else {
            let bytes = &output.stdout;
            if bytes.iter().take(2048).any(|b| *b == 0) {
                return Err(
                    AppCommandError::invalid_input("Binary files are not supported")
                        .with_detail(file_spec),
                );
            }
            versions.push(String::from_utf8_lossy(bytes).to_string());
        }
    }

    // Read the working tree file (contains conflict markers)
    let file_path = Path::new(&path).join(&file);
    let merged = std::fs::read_to_string(&file_path).unwrap_or_default();

    Ok(GitConflictFileVersions {
        base: versions.remove(0),
        ours: versions.remove(0),
        theirs: versions.remove(0),
        merged,
    })
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_resolve_conflict(
    path: String,
    file: String,
    content: String,
) -> Result<(), AppCommandError> {
    let file_path = Path::new(&path).join(&file);

    // Write resolved content
    std::fs::write(&file_path, content)
        .map_err(|e| AppCommandError::io_error(format!("Failed to write resolved file: {}", e)))?;

    // Stage the resolved file
    let output = crate::process::tokio_command("git")
        .args(["add", &file])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("add", &output.stderr));
    }

    Ok(())
}
