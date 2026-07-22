// git/credential.rs
use std::process::Stdio;
use crate::db::AppDatabase;
use crate::models::GitCredentials;

/// Configure a git command for remote operations:
/// - Always disable interactive prompts (prevent hanging in a GUI app)
/// - If explicit credentials are provided, use them directly
/// - Otherwise, try to inject stored account credentials
pub async fn prepare_remote_git_cmd(
    cmd: &mut tokio::process::Command,
    repo_path: &str,
    credentials: Option<&GitCredentials>,
    db: &AppDatabase,
    data_dir: &std::path::Path,
) {
    prepare_remote_git_cmd_with_remote(cmd, repo_path, None, credentials, db, data_dir).await;
}

/// Same as `prepare_remote_git_cmd` but allows specifying a remote name
/// to match credentials against the correct remote URL.
pub async fn prepare_remote_git_cmd_with_remote(
    cmd: &mut tokio::process::Command,
    repo_path: &str,
    remote_name: Option<&str>,
    credentials: Option<&GitCredentials>,
    db: &AppDatabase,
    data_dir: &std::path::Path,
) {
    cmd.env("GIT_TERMINAL_PROMPT", "0").stdin(Stdio::null());

    if let Some(creds) = credentials {
        // Explicit credentials provided (e.g. from credential dialog)
        if let Ok(askpass) = crate::git_credential::ensure_askpass_script(data_dir) {
            crate::git_credential::inject_credentials(
                cmd,
                &creds.username,
                &creds.password,
                &askpass,
            );
        }
    } else {
        // Fall back to stored accounts, matching against the specified remote
        crate::git_credential::try_inject_for_repo_remote(
            cmd,
            repo_path,
            remote_name,
            &db.conn,
            data_dir,
        )
        .await;
    }
}

/// Same as `prepare_remote_git_cmd` but for clone (URL only, no repo yet).
pub async fn prepare_remote_git_cmd_for_url(
    cmd: &mut tokio::process::Command,
    clone_url: &str,
    credentials: Option<&GitCredentials>,
    db: &AppDatabase,
    data_dir: &std::path::Path,
) {
    cmd.env("GIT_TERMINAL_PROMPT", "0").stdin(Stdio::null());

    if let Some(creds) = credentials {
        if let Ok(askpass) = crate::git_credential::ensure_askpass_script(data_dir) {
            crate::git_credential::inject_credentials(
                cmd,
                &creds.username,
                &creds.password,
                &askpass,
            );
        }
    } else {
        crate::git_credential::try_inject_for_url(cmd, clone_url, &db.conn, data_dir).await;
    }
}
