// git/stash.rs
use crate::app_error::AppCommandError;
use super::*;

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_stash_push(
    path: String,
    message: Option<String>,
    keep_index: bool,
) -> Result<String, AppCommandError> {
    let mut args = vec!["stash".to_string(), "push".to_string()];
    if let Some(msg) = message {
        if !msg.is_empty() {
            args.push("-m".to_string());
            args.push(msg);
        }
    }
    if keep_index {
        args.push("--keep-index".to_string());
    }
    let output = crate::process::tokio_command("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("stash push", &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_stash_pop(
    path: String,
    stash_ref: Option<String>,
) -> Result<String, AppCommandError> {
    let mut args = vec!["stash", "pop"];
    let stash_ref_val;
    if let Some(ref r) = stash_ref {
        stash_ref_val = r.clone();
        args.push(&stash_ref_val);
    }
    let output = crate::process::tokio_command("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("stash pop", &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_stash_list(path: String) -> Result<Vec<GitStashEntry>, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["stash", "list", "--format=%gd||%gs||%ci"])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("stash list", &output.stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .enumerate()
        .filter_map(|(i, line)| {
            let parts: Vec<&str> = line.splitn(3, "||").collect();
            if parts.len() < 3 {
                return None;
            }
            let ref_name = parts[0].to_string();
            let subject = parts[1];
            let date = parts[2].to_string();

            // Parse branch and message from subject like "On branch: message" or "WIP on branch: hash"
            let (branch, message) = if let Some(rest) = subject.strip_prefix("On ") {
                if let Some(colon_pos) = rest.find(": ") {
                    let branch = rest[..colon_pos].to_string();
                    let msg = rest[colon_pos + 2..].to_string();
                    (branch, msg)
                } else {
                    (String::new(), subject.to_string())
                }
            } else if let Some(rest) = subject.strip_prefix("WIP on ") {
                if let Some(colon_pos) = rest.find(": ") {
                    let branch = rest[..colon_pos].to_string();
                    let msg = rest[colon_pos + 2..].to_string();
                    (branch, msg)
                } else {
                    (String::new(), subject.to_string())
                }
            } else {
                (String::new(), subject.to_string())
            };

            Some(GitStashEntry {
                index: i,
                message,
                branch,
                date,
                ref_name,
            })
        })
        .collect();

    Ok(entries)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_stash_apply(path: String, stash_ref: String) -> Result<String, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["stash", "apply", &stash_ref])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("stash apply", &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_stash_drop(path: String, stash_ref: String) -> Result<String, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["stash", "drop", &stash_ref])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("stash drop", &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_stash_clear(path: String) -> Result<String, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["stash", "clear"])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("stash clear", &output.stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_stash_show(
    path: String,
    stash_ref: String,
) -> Result<Vec<GitStatusEntry>, AppCommandError> {
    let output = crate::process::tokio_command("git")
        .args(["-c", "core.quotePath=false"])
        .args(["stash", "show", "--name-status", &stash_ref])
        .current_dir(&path)
        .output()
        .await
        .map_err(AppCommandError::io)?;

    if !output.status.success() {
        return Err(git_command_error("stash show", &output.stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let status = parts.next()?.trim().to_string();
            let file = unquote_git_path(parts.next()?);
            Some(GitStatusEntry { status, file })
        })
        .collect();

    Ok(entries)
}
