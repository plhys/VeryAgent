// git/remote.rs
#[cfg(feature = "tauri-runtime")]
use tauri::Manager;
use crate::app_error::AppCommandError;
use crate::db::AppDatabase;
use crate::models::GitCredentials;
use crate::git_repo::ensure_git_repo;
use std::path::PathBuf;
use std::collections::HashSet;
use super::*;

pub fn git_command_error(operation: &str, stderr: &[u8]) -> AppCommandError {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    AppCommandError::external_command(format!("git {operation} failed"), stderr)
}

pub async fn detect_conflicts(path: &str) -> Result<Vec<String>, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["-c", "core.quotePath=false"])
        .args(["diff", "--name-only", "--diff-filter=U"])
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(unquote_git_path)
        .filter(|l| !l.is_empty())
        .collect())
}

pub async fn count_files_in_commit(path: &str, commit: &str) -> Result<usize, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["show", "--name-only", "--pretty=format:", commit])
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("show", &output.stderr));
    }

    Ok(count_non_empty_lines(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

async fn git_output(
    path: &str,
    args: &[&str],
) -> Result<std::process::Output, AppCommandError> {
    crate::process::tokio_command("git")
        .args(args)
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)
}

/// Resolve the current `HEAD` state. The common cases (on a branch / detached)
/// cost a single git invocation; the rarer unborn-branch and non-repository
/// cases fall through to `symbolic-ref` and `--is-inside-work-tree`.
pub async fn resolve_git_head(path: &str) -> Result<GitHeadInfo, AppCommandError> {
    // `rev-parse --abbrev-ref HEAD` prints the branch name, the literal "HEAD"
    // when detached, and fails on an unborn branch or a non-repository.
    let head = git_output(path, &["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    if head.status.success() {
        let name = String::from_utf8_lossy(&head.stdout).trim().to_string();
        if !name.is_empty() && name != "HEAD" {
            return Ok(GitHeadInfo {
                is_repo: true,
                branch: Some(name),
                detached: false,
                short_sha: None,
            });
        }
        // Detached HEAD — surface the short commit so the UI can label it.
        let short_sha = git_output(path, &["rev-parse", "--short", "HEAD"])
            .await
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty());
        return Ok(GitHeadInfo {
            is_repo: true,
            branch: None,
            detached: true,
            short_sha,
        });
    }

    // Unborn branch (after `git init`, before the first commit): `symbolic-ref`
    // still resolves the branch name where `rev-parse` cannot.
    let sym = git_output(path, &["symbolic-ref", "--short", "HEAD"]).await?;
    if sym.status.success() {
        let name = String::from_utf8_lossy(&sym.stdout).trim().to_string();
        if !name.is_empty() {
            return Ok(GitHeadInfo {
                is_repo: true,
                branch: Some(name),
                detached: false,
                short_sha: None,
            });
        }
    }

    // Neither resolved a branch — authoritatively decide repo-ness. An unusual
    // work tree with no resolvable branch still counts as a repo so the UI
    // offers git operations rather than "initialize".
    let inside = git_output(path, &["rev-parse", "--is-inside-work-tree"]).await?;
    let is_repo =
        inside.status.success() && String::from_utf8_lossy(&inside.stdout).trim() == "true";
    Ok(GitHeadInfo {
        is_repo,
        branch: None,
        detached: false,
        short_sha: None,
    })
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_git_head(path: String) -> Result<GitHeadInfo, AppCommandError> {
    resolve_git_head(&path).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_git_branch(path: String) -> Result<Option<String>, AppCommandError> {
    Ok(resolve_git_head(&path).await?.branch)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_init(path: String) -> Result<(), AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["init"])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("init", &output.stderr));
    }
    Ok(())
}

pub(crate) async fn git_pull_core(
    path: &str,
    credentials: Option<&GitCredentials>,
    db: &AppDatabase,
    data_dir: &std::path::Path,
) -> Result<GitPullResult, AppCommandError> {
    let head_before = get_head_hash(path).await?;

    // Step 1: fetch from remote
    let mut fetch_cmd = crate::process::tokio_command("git");
    fetch_cmd.args(["fetch"]).current_dir(path);
    GitOps::new(path, data_dir, db).prepare(&mut fetch_cmd, credentials).await;

    let fetch_output = fetch_cmd.output().await.map_err(AppCommandError::io)?;

    if !fetch_output.status.success() {
        return Err(classify_remote_git_error("fetch", &fetch_output.stderr));
    }

    // Step 2: check if upstream exists
    let upstream_check = crate::process::tokio_command("git")
        .args(["rev-parse", "@{u}"])
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !upstream_check.status.success() {
        return Ok(GitPullResult {
            updated_files: 0,
            conflict: None,
        });
    }
    let upstream_commit = String::from_utf8_lossy(&upstream_check.stdout)
        .trim()
        .to_string();

    // Step 3: check if we can fast-forward
    let merge_base = crate::process::tokio_command("git")
        .args(["merge-base", "HEAD", "@{u}"])
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)?;
    let head_hash = crate::process::tokio_command("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    let base_hash = String::from_utf8_lossy(&merge_base.stdout)
        .trim()
        .to_string();
    let current_head = String::from_utf8_lossy(&head_hash.stdout)
        .trim()
        .to_string();

    if base_hash == current_head {
        let ff_output = crate::process::tokio_command("git")
            .args(["merge", "--ff-only", "@{u}"])
            .current_dir(path)
            .output()
            .await
            .map_err(AppCommandError::io)?;

        if !ff_output.status.success() {
            return Err(git_command_error("merge --ff-only", &ff_output.stderr));
        }
    } else {
        let merge_output = crate::process::tokio_command("git")
            .args(["merge", "--no-commit", "@{u}"])
            .current_dir(path)
            .output()
            .await
            .map_err(AppCommandError::io)?;

        if !merge_output.status.success() {
            let conflicted_files = detect_conflicts(path).await?;
            if !conflicted_files.is_empty() {
                let _ = crate::process::tokio_command("git")
                    .args(["merge", "--abort"])
                    .current_dir(path)
                    .output()
                    .await;

                return Ok(GitPullResult {
                    updated_files: 0,
                    conflict: Some(GitConflictInfo {
                        has_conflicts: true,
                        conflicted_files,
                        operation: "pull".to_string(),
                        upstream_commit: Some(upstream_commit),
                    }),
                });
            }
            return Err(git_command_error("merge", &merge_output.stderr));
        }

        let commit_output = crate::process::tokio_command("git")
            .args(["commit", "--no-edit"])
            .current_dir(path)
            .output()
            .await
            .map_err(AppCommandError::io)?;

        if !commit_output.status.success() {
            let stderr = String::from_utf8_lossy(&commit_output.stderr);
            let stdout = String::from_utf8_lossy(&commit_output.stdout);
            if !stderr.contains("nothing to commit") && !stdout.contains("nothing to commit") {
                return Err(git_command_error("commit", &commit_output.stderr));
            }
        }
    }

    let head_after = get_head_hash(path).await?;
    let updated_files = match (head_before.as_deref(), head_after.as_deref()) {
        (Some(before), Some(after)) if before != after => {
            count_changed_files_between(path, before, after).await?
        }
        (None, Some(after)) => count_files_in_commit(path, after).await?,
        _ => 0,
    };

    Ok(GitPullResult {
        updated_files,
        conflict: None,
    })
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_pull(
    path: String,
    credentials: Option<GitCredentials>,
    db: tauri::State<'_, AppDatabase>,
    app_handle: tauri::AppHandle,
) -> Result<GitPullResult, AppCommandError> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| {
        AppCommandError::external_command("Failed to resolve app data dir", e.to_string())
    })?;
    // Resolve through the effective data dir so a custom
    // `VERYAGENT_DATA_DIR` reaches the git credential helper invoked by
    // this subprocess.
    let data_dir = crate::paths::resolve_effective_data_dir(&data_dir);
    git_pull_core(&path, credentials.as_ref(), &db, &data_dir).await
}

pub(crate) async fn git_fetch_core(
    path: &str,
    credentials: Option<&GitCredentials>,
    db: &AppDatabase,
    data_dir: &std::path::Path,
) -> Result<String, AppCommandError> {
    let mut cmd = crate::process::tokio_command("git");
    cmd.args(["fetch", "--all"]).current_dir(path);
    GitOps::new(path, data_dir, db).prepare(&mut cmd, credentials).await;

    let output = cmd.output().await.map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(classify_remote_git_error("fetch --all", &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_fetch(
    path: String,
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
    git_fetch_core(&path, credentials.as_ref(), &db, &data_dir).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_new_branch(
    path: String,
    branch_name: String,
    start_point: Option<String>,
) -> Result<(), AppCommandError> {
    let mut args = vec!["checkout".to_string(), "-b".to_string(), branch_name];
    if let Some(start_point) = start_point {
        let trimmed = start_point.trim();
        if !trimmed.is_empty() {
            args.push(trimmed.to_string());
        }
    }

    let output = crate::process::tokio_command("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("checkout -b", &output.stderr));
    }
    Ok(())
}

/// Whether the working tree at `path` has no uncommitted changes to *tracked*
/// files (untracked files are ignored — they survive a branch switch). Used to
/// refuse a `shared_in_root` automation before it `git checkout`s the user's
/// root tree, which would otherwise carry their in-progress edits onto the
/// target branch (or fail outright).
pub async fn git_is_clean(path: String) -> Result<bool, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["status", "--porcelain", "--untracked-files=no"])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("status", &output.stderr));
    }
    // Porcelain prints one line per changed tracked path; clean ⇒ no output.
    Ok(output.stdout.iter().all(|b| b.is_ascii_whitespace()))
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_list_branches(path: String) -> Result<Vec<String>, AppCommandError> {
    ensure_git_repo(&path)?;

    let output = crate::process::tokio_command("git")
        .args(["branch", "--format=%(refname:short)"])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("branch", &output.stderr));
    }

    let branches = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(branches)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_add_files(path: String, files: Vec<String>) -> Result<(), AppCommandError> {
    if files.is_empty() {
        return Ok(());
    }

    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(files.iter().map(|file| to_git_literal_pathspec(file)));

    let output = crate::process::tokio_command("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("add", &output.stderr));
    }

    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_list_all_branches(path: String) -> Result<GitBranchList, AppCommandError> {
    ensure_git_repo(&path)?;

    let local_fut = crate::process::tokio_command("git")
        .args(["branch", "--format=%(refname:short)"])
        .current_dir(&path)
        .output();

    let remote_fut = crate::process::tokio_command("git")
        .args(["branch", "-r", "--format=%(refname:short)"])
        .current_dir(&path)
        .output();

    let wt_fut = crate::process::tokio_command("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&path)
        .output();

    let (local_output, remote_output, wt_output) = tokio::join!(local_fut, remote_fut, wt_fut);

    let local_output = local_output.map_err(AppCommandError::io)?;
    if !local_output.status.success() {
        return Err(git_command_error("branch", &local_output.stderr));
    }

    let local: Vec<String> = String::from_utf8_lossy(&local_output.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let remote: Vec<String> = match remote_output {
        Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && !l.contains("HEAD") && l.contains('/'))
            .collect(),
        _ => vec![],
    };

    // Parse worktree entries, excluding the current worktree (path itself)
    let worktree_branches: Vec<String> = match wt_output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let canonical_path =
                std::fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path));
            let mut branches = Vec::new();
            let mut current_wt_path: Option<String> = None;
            for line in stdout.lines() {
                if let Some(wt) = line.strip_prefix("worktree ") {
                    current_wt_path = Some(wt.trim().to_string());
                } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
                    if let Some(ref wt) = current_wt_path {
                        let wt_canonical =
                            std::fs::canonicalize(wt).unwrap_or_else(|_| PathBuf::from(wt));
                        if wt_canonical != canonical_path {
                            branches.push(b.trim().to_string());
                        }
                    }
                } else if line.is_empty() {
                    current_wt_path = None;
                }
            }
            branches
        }
        _ => vec![],
    };

    Ok(GitBranchList {
        local,
        remote,
        worktree_branches,
    })
}

/// Parse `git worktree list --porcelain` into `(worktree_path, branch)` pairs.
/// Each porcelain block starts with a `worktree <path>` line and is terminated
/// by a blank line; a `branch refs/heads/<name>` line carries the checked-out
/// branch (absent for detached/bare worktrees → `None`). Trailing blocks with
/// no terminating blank line are flushed at EOF.
pub fn parse_worktrees(stdout: &str) -> Vec<(String, Option<String>)> {
    let mut entries: Vec<(String, Option<String>)> = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;

    for line in stdout.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            // Defensive flush in case a block wasn't blank-line terminated.
            if let Some(path) = current_path.take() {
                entries.push((path, current_branch.take()));
            }
            current_path = Some(p.trim().to_string());
            current_branch = None;
        } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
            current_branch = Some(b.trim().to_string());
        } else if line.is_empty() {
            if let Some(path) = current_path.take() {
                entries.push((path, current_branch.take()));
            }
            current_branch = None;
        }
    }
    if let Some(path) = current_path.take() {
        entries.push((path, current_branch.take()));
    }
    entries
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_list_remotes(path: String) -> Result<Vec<GitRemote>, AppCommandError> {
    ensure_git_repo(&path)?;

    let output = crate::process::tokio_command("git")
        .args(["remote", "-v"])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("remote -v", &output.stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut seen = HashSet::new();
    let mut remotes = Vec::new();
    for line in stdout.lines() {
        // Format: "name\turl (fetch|push)"
        if !line.ends_with("(fetch)") {
            continue;
        }
        let Some((name, rest)) = line.split_once('\t') else {
            continue;
        };
        let url = rest.trim_end_matches("(fetch)").trim();
        if seen.insert(name.to_string()) {
            remotes.push(GitRemote {
                name: name.to_string(),
                url: url.to_string(),
            });
        }
    }
    Ok(remotes)
}

pub(crate) async fn git_fetch_remote_core(
    path: &str,
    name: &str,
    credentials: Option<&GitCredentials>,
    db: &AppDatabase,
    data_dir: &std::path::Path,
) -> Result<String, AppCommandError> {
    let mut cmd = crate::process::tokio_command("git");
    cmd.args(["fetch", name]).current_dir(path);
    GitOps::new(path, data_dir, db).prepare_for_remote(&mut cmd, Some(name), credentials).await;

    let output = cmd.output().await.map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(classify_remote_git_error("fetch", &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_fetch_remote(
    path: String,
    name: String,
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
    git_fetch_remote_core(&path, &name, credentials.as_ref(), &db, &data_dir).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_add_remote(
    path: String,
    name: String,
    url: String,
) -> Result<(), AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["remote", "add", &name, &url])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("remote add", &output.stderr));
    }
    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_remove_remote(path: String, name: String) -> Result<(), AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["remote", "remove", &name])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("remote remove", &output.stderr));
    }
    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_set_remote_url(
    path: String,
    name: String,
    url: String,
) -> Result<(), AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["remote", "set-url", &name, &url])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("remote set-url", &output.stderr));
    }
    Ok(())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_delete_branch(
    path: String,
    branch_name: String,
    force: bool,
) -> Result<String, AppCommandError> {
    let flag = if force { "-D" } else { "-d" };
    let output = crate::process::tokio_command("git")
        .args(["branch", flag, &branch_name])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error(&format!("branch {flag}"), &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Remove surrounding quotes from a git output path.
/// Git quotes paths containing non-ASCII or special characters, e.g.
/// `"path/\344\270\255\346\226\207.txt"`.  With `core.quotePath=false`
/// the octal escapes are gone, but the quotes may still appear for paths
/// with spaces, tabs, etc.
pub fn unquote_git_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_log(
    path: String,
    limit: Option<u32>,
    branch: Option<String>,
    remote: Option<String>,
) -> Result<GitLogResult, AppCommandError> {
    ensure_git_repo(&path)?;

    const COMMIT_META_PREFIX: &str = "__COMMIT__\0";
    const MESSAGE_END_MARKER: &str = "__COMMIT_MESSAGE_END__";

    let limit_str = format!("-{}", limit.unwrap_or(100));
    let mut args = vec![
        "log".to_string(),
        limit_str,
        format!("--format=__COMMIT__%x00%h%x00%H%x00%an%x00%aI%n%B%n{MESSAGE_END_MARKER}"),
        "--raw".to_string(),
        "--numstat".to_string(),
        "--no-renames".to_string(),
    ];
    if let Some(ref b) = branch {
        args.push(b.clone());
    }
    let output = crate::process::tokio_command("git")
        .args(["-c", "core.quotePath=false"])
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        // Empty repo (no commits yet) — return empty list instead of error
        let stderr_str = String::from_utf8_lossy(&output.stderr);
        if stderr_str.contains("does not have any commits yet")
            || stderr_str.contains("unknown revision or path not in the working tree")
        {
            return Ok(GitLogResult {
                entries: Vec::new(),
                has_upstream: false,
            });
        }
        return Err(git_command_error("log", &output.stderr));
    }

    let mut entries = Vec::<GitLogEntry>::new();
    let mut current: Option<GitLogEntryBuilder> = None;
    let mut reading_message = false;

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some(meta) = line.strip_prefix(COMMIT_META_PREFIX) {
            if let Some(entry) = current.take() {
                entries.push(entry.finish());
            }

            let parts: Vec<&str> = meta.splitn(4, '\0').collect();
            if parts.len() == 4 {
                current = Some(GitLogEntryBuilder::new(parts));
                reading_message = true;
            } else {
                reading_message = false;
            }
            continue;
        }

        let Some(entry) = current.as_mut() else {
            continue;
        };

        if reading_message {
            if line == MESSAGE_END_MARKER {
                reading_message = false;
                entry.finalize_message();
            } else {
                entry.push_message_line(line);
            }
            continue;
        }

        if line.is_empty() {
            continue;
        }

        if line.starts_with(':') {
            if let Some((status, file_path)) = parse_raw_file_line(line) {
                let file = entry.get_or_insert_file(file_path);
                file.status = status;
            }
            continue;
        }

        if let Some((additions, deletions, file_path)) = parse_numstat_file_line(line) {
            let file = entry.get_or_insert_file(file_path);
            file.additions = additions;
            file.deletions = deletions;
        }
    }

    if let Some(entry) = current {
        entries.push(entry.finish());
    }

    let log_limit = limit.unwrap_or(100);
    let (unpushed_hashes, has_upstream) =
        get_unpushed_hashes(&path, log_limit, remote.as_deref(), branch.as_deref())
            .await
            .unwrap_or((None, false));
    for entry in entries.iter_mut() {
        entry.pushed = unpushed_hashes
            .as_ref()
            .map(|hashes| !hashes.contains(&entry.full_hash));
    }

    Ok(GitLogResult {
        entries,
        has_upstream,
    })
}
