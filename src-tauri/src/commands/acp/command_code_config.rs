//! Command Code (cmdc) login-state helpers.
//!
//! Command Code authenticates against its own account system (`cmdc login`,
//! browser OAuth) and persists the credential at `~/.commandcode/auth.json`.
//! The VeryAgent ACP adapter drives `cmdc -p` headlessly, which transparently
//! shares that same credential — so "logged in" here means: an auth.json from
//! the official CLI exists, or the user has supplied an API key via the
//! `COMMAND_CODE_API_KEY` env setting (the CLI reads it at startup and it
//! takes precedence over auth.json).
//!
//! This module is deliberately spawn-light: login status is a cheap file
//! probe (never a `cmdc status` subprocess), and the only process spawned is
//! the optional background `cmdc login` the settings page can launch.

use super::*;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// Pending `cmdc login` child PID (set while an interactive login is in
/// flight so the settings page can cancel it). A login is one-shot — the
/// process exits when the OAuth callback lands — so a stale PID is harmless.
static CMDC_LOGIN_PID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

fn cmdc_login_pid_lock() -> &'static Mutex<Option<u32>> {
    CMDC_LOGIN_PID.get_or_init(|| Mutex::new(None))
}

/// Resolve how to launch the Command Code CLI. Mirrors the ACP adapter's
/// `resolveCmdcLaunch`: on Windows the npm `.cmd` shim cannot be spawned
/// directly, so we exec `node <npm-dir>/node_modules/command-code/dist/index.mjs`
/// with an argv array. Falls back to a bare `cmdc` on PATH (Unix, or when the
/// npm layout is not found).
pub(crate) fn resolve_cmdc_launch() -> (PathBuf, Vec<String>) {
    if let Some(custom) = std::env::var_os("COMMAND_CODE_ACP_CMD") {
        return (PathBuf::from(custom), Vec::new());
    }

    #[cfg(windows)]
    {
        if let Some(npm_dir) = std::env::var_os("APPDATA").map(PathBuf::from).map(|p| p.join("npm"))
        {
            let entry = npm_dir.join("node_modules").join("command-code").join("dist").join("index.mjs");
            if entry.is_file() {
                if let Some(node) = crate::process::normalized_program("node").to_str().map(PathBuf::from) {
                    return (node, vec![entry.to_string_lossy().into_owned()]);
                }
            }
            let shim = npm_dir.join("cmdc.cmd");
            if shim.is_file() {
                return (shim, Vec::new());
            }
        }
    }

    (PathBuf::from("cmdc"), Vec::new())
}

/// Spawn `cmdc login` in the background (no terminal window). Command Code
/// opens the browser itself and completes the OAuth callback against its
/// temporary localhost server, then writes `~/.commandcode/auth.json` and
/// exits. The PID is remembered so the settings page can cancel the flow.
pub(crate) fn start_command_code_login() -> Result<(), AcpError> {
    if command_code_login_running() {
        return Ok(());
    }
    // Already logged in — `cmdc login` would just print "Already logged in"
    // and exit without opening a browser. Treat it as a no-op so the settings
    // page doesn't show a fake "waiting for authorization" state.
    if let Some(raw) = load_command_code_auth_json_raw() {
        if auth_json_has_credential(&raw) {
            return Ok(());
        }
    }
    let (program, mut args) = resolve_cmdc_launch();
    args.push("login".to_string());

    let mut cmd = crate::process::std_command(&program);
    cmd.args(&args);
    // Detached, hidden: no console window, no stdin (the OAuth callback is
    // delivered over HTTP, not the terminal).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd
        .spawn()
        .map_err(|e| AcpError::protocol(format!("failed to start cmdc login: {e}")))?;
    *cmdc_login_pid_lock().lock().unwrap_or_else(|e| e.into_inner()) = Some(child.id());
    Ok(())
}

/// Kill a pending `cmdc login` child, if any.
pub(crate) fn cancel_command_code_login() {
    let pid = {
        let mut guard = cmdc_login_pid_lock().lock().unwrap_or_else(|e| e.into_inner());
        guard.take()
    };
    if let Some(pid) = pid {
        #[cfg(windows)]
        {
            let _ = crate::process::std_command("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .spawn();
        }
        #[cfg(not(windows))]
        {
            let _ = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
        }
    }
}

/// Log out of Command Code by deleting the local `~/.commandcode/auth.json`
/// credential file. The user can log back in afterward via OAuth or API Key.
/// Returns Ok(true) if the file was deleted, Ok(false) if it didn't exist,
/// Err if deletion failed.
pub(crate) fn logout_command_code() -> Result<(), AcpError> {
    let path = command_code_auth_json_path();
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path)
        .map_err(|e| AcpError::protocol(format!("failed to delete auth.json: {e}")))
}

/// Whether a `cmdc login` child is still running.
pub(crate) fn command_code_login_running() -> bool {
    let pid = cmdc_login_pid_lock().lock().unwrap_or_else(|e| e.into_inner());
    match *pid {
        Some(pid) => {
            #[cfg(windows)]
            {
                // A running process — cheap check via OpenProcess(0).
                let handle = unsafe {
                    windows_sys::Win32::System::Threading::OpenProcess(
                        windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
                        0,
                        pid,
                    )
                };
                if handle.is_null() {
                    return false;
                }
                unsafe {
                    windows_sys::Win32::Foundation::CloseHandle(handle);
                }
                true
            }
            #[cfg(not(windows))]
            {
                unsafe { libc::kill(pid as i32, 0) == 0 }
            }
        }
        None => false,
    }
}

/// Keys that, when present with a non-empty value in `~/.commandcode/auth.json`,
/// indicate a usable Command Code credential. The file is written by `cmdc
/// login` (official OAuth) or by the user pasting an API key; the exact schema
/// is not public, so we accept any of the plausible spellings.
const AUTH_CREDENTIAL_KEYS: &[&str] = &["api_key", "apiKey", "access_token", "token"];

/// Keys that may carry a human-readable account name, in priority order.
/// `userName` is the official field written by `cmdc login`
/// (`{apiKey, userId, userName, keyName, authenticatedAt}`).
const AUTH_NAME_KEYS: &[&str] = &["userName", "account", "account_name", "name", "email", "username"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandCodeLoginStatus {
    pub logged_in: bool,
    /// Best-effort account name from auth.json (None when the file has no
    /// name field, or when login is via env API key only).
    pub account_name: Option<String>,
    /// Where the credential comes from: the official auth.json, or the
    /// `COMMAND_CODE_API_KEY` env setting.
    pub source: &'static str,
    /// Whether a background `cmdc login` is currently in flight (the browser
    /// OAuth callback has not landed yet).
    pub running: bool,
}

pub(crate) fn command_code_home_dir() -> PathBuf {
    home_dir_or_default().join(".commandcode")
}

pub(crate) fn command_code_auth_json_path() -> PathBuf {
    command_code_home_dir().join("auth.json")
}

pub(crate) fn load_command_code_auth_json_raw() -> Option<String> {
    fs::read_to_string(command_code_auth_json_path()).ok()
}

/// True when `raw` parses to a JSON object containing any non-empty
/// credential key. Pure so it is unit-testable without touching the fs.
pub(crate) fn auth_json_has_credential(raw: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return false;
    };
    let Some(obj) = value.as_object() else {
        return false;
    };
    AUTH_CREDENTIAL_KEYS.iter().any(|key| {
        obj.get(*key)
            .and_then(serde_json::Value::as_str)
            .is_some_and(|v| !v.trim().is_empty())
    })
}

/// Extract a best-effort account name from the auth.json text. Pure.
pub(crate) fn auth_json_account_name(raw: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(raw).ok()?;
    let obj = value.as_object()?;
    for key in AUTH_NAME_KEYS {
        if let Some(name) = obj
            .get(*key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Some(name.to_string());
        }
    }
    None
}

/// Compute the login status from the on-disk auth.json plus whether the agent
/// env carries a `COMMAND_CODE_API_KEY`. `env_has_api_key` is supplied by the
/// caller (it comes from the persisted agent env); the file read is thin.
pub(crate) fn command_code_login_status(env_has_api_key: bool) -> CommandCodeLoginStatus {
    let mut status =
        login_status_from_parts(load_command_code_auth_json_raw().as_deref(), env_has_api_key);
    status.running = command_code_login_running();
    status
}

/// Pure decision helper: given the raw auth.json text (None when the file is
/// absent) and the env-key flag, produce the login status. This is what the
/// tests exercise with fixed inputs.
pub(crate) fn login_status_from_parts(
    auth_raw: Option<&str>,
    env_has_api_key: bool,
) -> CommandCodeLoginStatus {
    let (logged_in, account_name, source) = match auth_raw {
        Some(text) if auth_json_has_credential(text) => (
            true,
            auth_json_account_name(text),
            "auth_json",
        ),
        _ if env_has_api_key => (true, None, "env_key"),
        _ => (false, None, "none"),
    };
    CommandCodeLoginStatus {
        logged_in,
        account_name,
        source,
        running: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_json_credential_detection() {
        assert!(auth_json_has_credential(r#"{"api_key":"sk-abc"}"#));
        assert!(auth_json_has_credential(r#"{"apiKey":"sk-abc"}"#));
        assert!(auth_json_has_credential(r#"{"access_token":"t-1"}"#));
        assert!(!auth_json_has_credential(r#"{"api_key":""}"#));
        assert!(!auth_json_has_credential(r#"{"name":"x"}"#));
        assert!(!auth_json_has_credential("not json"));
        assert!(!auth_json_has_credential("[]"));
    }

    #[test]
    fn auth_json_account_name_extraction() {
        assert_eq!(
            auth_json_account_name(r#"{"account":"myuser"}"#),
            Some("myuser".to_string())
        );
        assert_eq!(
            auth_json_account_name(r#"{"userName":"cmdc-user"}"#),
            Some("cmdc-user".to_string())
        );
        assert_eq!(
            auth_json_account_name(r#"{"email":"a@b.c"}"#),
            Some("a@b.c".to_string())
        );
        assert_eq!(
            auth_json_account_name(r#"{"api_key":"sk"}"#),
            None
        );
        assert_eq!(auth_json_account_name("not json"), None);
    }

    #[test]
    fn login_status_precedence() {
        // auth.json with credential beats env key.
        let s = login_status_from_parts(Some(r#"{"api_key":"sk-abc"}"#), true);
        assert!(s.logged_in);
        assert_eq!(s.source, "auth_json");

        // No auth.json credential + env key => env_key source.
        let s = login_status_from_parts(Some(r#"{"name":"x"}"#), true);
        assert!(s.logged_in);
        assert_eq!(s.source, "env_key");

        // Nothing => not logged in.
        let s = login_status_from_parts(None, false);
        assert!(!s.logged_in);
        assert_eq!(s.source, "none");

        // Account name surfaces only from auth.json.
        let s = login_status_from_parts(Some(r#"{"api_key":"sk","account":"me"}"#), false);
        assert_eq!(s.account_name.as_deref(), Some("me"));
    }
}
