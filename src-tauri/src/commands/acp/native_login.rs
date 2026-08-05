//! Unified native-login API for agents that support first-party login.
//!
//! Every agent either authenticates with its own native login (Claude Code
//! subscription OAuth, Codex ChatGPT, Gemini Google login, Kimi OAuth, Command
//! Code `cmdc login`, MiMo `mimo providers login`, Cline `cline auth`, …) or
//! is driven purely by a bound model provider. This module
//! is the single chokepoint the settings UI calls for the native-login half of
//! that choice: start / probe / cancel / logout.
//!
//! Design constraints (safety first):
//! - Status is a cheap FILE probe per agent (never a subprocess), so it is safe
//!   to call on every settings-page render.
//! - The only process spawned is the optional background login command the
//!   settings page explicitly launches, mirroring the existing `cmdc login`
//!   pattern.
//! - Existing per-agent login APIs (command code, codex, kimi) are left
//!   untouched; this module wraps them so new agents can join without churn.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use super::*;

/// Result of a native-login status probe, uniform across all agents.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLoginStatus {
    /// Whether the agent currently has a usable native credential.
    pub logged_in: bool,
    /// Best-effort account name, when the credential file carries one.
    pub account_name: Option<String>,
    /// Where the credential comes from (`auth_json`, `env_key`, `state_file`,
    /// `none`, …). Agent-specific; purely informational.
    pub source: &'static str,
    /// Whether a background login command is currently in flight.
    pub running: bool,
}

/// Agents that have a first-party native login. Everything else is
/// model-provider-only by design.
pub(crate) fn supports_native_login(agent_type: AgentType) -> bool {
    matches!(
        agent_type,
        AgentType::ClaudeCode
            | AgentType::Codex
            | AgentType::Gemini
            | AgentType::KimiCode
            | AgentType::CodeBuddy
            | AgentType::CommandCode
            | AgentType::MimoCode
            | AgentType::Cline
    )
}

/// Launch the agent's native login in the background (no terminal window).
/// The agent opens its own browser/device flow, then persists its credential;
/// the settings page polls [`probe_native_login_status`] until `logged_in`.
pub(crate) async fn start_native_login(
    db: &AppDatabase,
    agent_type: AgentType,
) -> Result<(), AcpError> {
    match agent_type {
        AgentType::CommandCode => start_command_code_login(),
        AgentType::Codex => {
            // Codex uses a device-code flow surfaced inline in the UI; there is
            // no single background command to spawn here. The UI drives the
            // device-code APIs directly. Nothing to do.
            Ok(())
        }
        AgentType::MimoCode => start_mimo_login(),
        AgentType::Cline => start_cline_login(),
        AgentType::ClaudeCode
        | AgentType::Gemini
        | AgentType::KimiCode
        | AgentType::CodeBuddy => {
            // Not yet wired to a background launcher. The settings UI falls
            // back to a "copy command + open terminal" guide for these until
            // their launchers land.
            let _ = db;
            Ok(())
        }
        _ => Err(AcpError::protocol(format!(
            "{agent_type} has no native login"
        ))),
    }
}

/// Probe the agent's native-login state from on-disk credentials.
pub(crate) async fn probe_native_login_status(
    db: &AppDatabase,
    agent_type: AgentType,
) -> Result<NativeLoginStatus, AcpError> {
    let status = match agent_type {
        AgentType::CommandCode => {
            let setting = agent_setting_service::get_by_agent_type(&db.conn, AgentType::CommandCode)
                .await
                .map_err(|e| AcpError::protocol(e.to_string()))?;
            let env_has_api_key = setting
                .and_then(|m| m.env_json)
                .and_then(|raw| serde_json::from_str::<BTreeMap<String, String>>(&raw).ok())
                .map(|env| {
                    env.get("COMMAND_CODE_API_KEY")
                        .is_some_and(|v| !v.trim().is_empty())
                })
                .unwrap_or(false);
            let s = command_code_login_status(env_has_api_key);
            NativeLoginStatus {
                logged_in: s.logged_in,
                account_name: s.account_name,
                source: s.source,
                running: s.running,
            }
        }
        AgentType::Codex => probe_codex_login_status(),
        AgentType::ClaudeCode => probe_file_based_login_status(
            claude_code_credential_paths(),
            setting_env_keys(&db.conn, AgentType::ClaudeCode).await,
        ),
        AgentType::Gemini => probe_file_based_login_status(
            gemini_credential_paths(),
            setting_env_keys(&db.conn, AgentType::Gemini).await,
        ),
        AgentType::KimiCode => probe_kimi_login_status(),
        AgentType::MimoCode => probe_mimo_login_status(),
        AgentType::Cline => probe_cline_login_status(),
        AgentType::CodeBuddy => probe_codebuddy_login_status(),
        _ => {
            return Err(AcpError::protocol(format!(
                "{agent_type} has no native login"
            )))
        }
    };
    Ok(status)
}

/// Cancel a pending background login, if any.
pub(crate) async fn cancel_native_login(agent_type: AgentType) -> Result<(), AcpError> {
    match agent_type {
        AgentType::CommandCode => {
            cancel_command_code_login();
            Ok(())
        }
        AgentType::MimoCode => {
            cancel_mimo_login();
            Ok(())
        }
        AgentType::Cline => {
            cancel_cline_login();
            Ok(())
        }
        AgentType::Codex => {
            // Device-code flow is driven by the UI; nothing to cancel server-side.
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Log out of the agent's native credential (deletes the local credential file
/// where applicable). Best-effort: an agent with no stored credential is a no-op.
pub(crate) async fn logout_native_login(agent_type: AgentType) -> Result<(), AcpError> {
    match agent_type {
        AgentType::CommandCode => logout_command_code(),
        AgentType::Codex => {
            // Codex stores credentials in ~/.codex/auth.json. Deleting the file
            // signs the local CLI out. Keep it safe: only remove when present.
            remove_credential_file_if_present(&codex_auth_json_path())
        }
        AgentType::KimiCode => remove_credential_file_if_present(&kimi_credential_path()),
        AgentType::MimoCode => remove_credential_file_if_present(&mimo_auth_json_path()),
        AgentType::Cline => remove_credential_file_if_present(&cline_auth_json_path()),
        _ => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Per-agent probes
// ---------------------------------------------------------------------------

/// Build a login status from the union of a list of credential files plus the
/// agent's persisted env.
fn probe_file_based_login_status(
    paths: Vec<PathBuf>,
    env_has_key: bool,
) -> NativeLoginStatus {
    let file_cred = paths.into_iter().find_map(|p| {
        let raw = fs::read_to_string(&p).ok()?;
        credential_text_has_key(&raw).then_some(())
    });
    let (logged_in, account, src) = match file_cred {
        Some(()) => (true, None, "auth_file"),
        _ if env_has_key => (true, None, "env_key"),
        _ => (false, None, "none"),
    };
    NativeLoginStatus {
        logged_in,
        account_name: account,
        source: src,
        running: false,
    }
}

/// Whether `raw` (any JSON-ish credential text) contains a non-empty credential
/// key. Conservative: any of the common spellings counts.
fn credential_text_has_key(raw: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        // Not JSON — treat non-empty content as a credential (e.g. a bare token).
        return !raw.trim().is_empty();
    };
    match value {
        serde_json::Value::Object(map) => map.iter().any(|(k, v)| {
            let key_lower = k.to_ascii_lowercase();
            let looks_credential = key_lower.contains("token")
                || key_lower.contains("key")
                || key_lower.contains("credential")
                || key_lower.contains("auth")
                || key_lower == "access_token";
            looks_credential
                && v.as_str().is_some_and(|s| !s.trim().is_empty())
        }),
        serde_json::Value::String(s) => !s.trim().is_empty(),
        _ => false,
    }
}

async fn setting_env_keys(
    conn: &sea_orm::DatabaseConnection,
    agent_type: AgentType,
) -> bool {
    let setting = agent_setting_service::get_by_agent_type(conn, agent_type)
        .await
        .ok()
        .flatten();
    let env: BTreeMap<String, String> = setting
        .and_then(|m| m.env_json)
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let keys = agent_env_keys(agent_type);
    [keys.0, keys.1]
        .into_iter()
        .any(|k| env.get(k).is_some_and(|v| !v.trim().is_empty()))
}

// --- Command Code -----------------------------------------------------------

// --- Codex ------------------------------------------------------------------

fn codex_auth_json_path() -> PathBuf {
    home_dir_or_default().join(".codex").join("auth.json")
}

fn probe_codex_login_status() -> NativeLoginStatus {
    let path = codex_auth_json_path();
    let logged_in = fs::read_to_string(&path)
        .map(|raw| credential_text_has_key(&raw))
        .unwrap_or(false);
    NativeLoginStatus {
        logged_in,
        account_name: None,
        source: "auth_file",
        running: false,
    }
}

// --- Claude Code ------------------------------------------------------------

fn claude_code_credential_paths() -> Vec<PathBuf> {
    let home = home_dir_or_default();
    vec![
        home.join(".claude").join("credentials.json"),
        home.join(".claude.json"),
    ]
}

// --- Gemini -----------------------------------------------------------------

fn gemini_credential_paths() -> Vec<PathBuf> {
    let home = home_dir_or_default();
    vec![
        home.join(".gemini").join("credentials.json"),
        home.join(".gemini").join("settings.json"),
    ]
}

// --- Kimi -------------------------------------------------------------------

fn kimi_credential_path() -> PathBuf {
    home_dir_or_default().join(".kimi-code").join("auth.json")
}

fn probe_kimi_login_status() -> NativeLoginStatus {
    let path = kimi_credential_path();
    let logged_in = fs::read_to_string(&path)
        .map(|raw| credential_text_has_key(&raw))
        .unwrap_or(false);
    NativeLoginStatus {
        logged_in,
        account_name: None,
        source: "auth_file",
        running: false,
    }
}

// --- MiMo Code --------------------------------------------------------------

fn mimo_auth_json_path() -> PathBuf {
    // MiMo Code (OpenCode fork) stores credentials in the XDG data dir
    // (`~\.local\share\mimocode\auth.json` on Windows too, per
    // `mimo providers list`).
    std::env::var_os("MIMOCODE_HOME")
        .map(PathBuf::from)
        .map(|p| p.join("auth.json"))
        .or_else(|| {
            std::env::var_os("XDG_DATA_HOME")
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
                .or_else(|| dirs::data_dir())
                .map(|p| p.join("mimocode").join("auth.json"))
        })
        .unwrap_or_else(|| home_dir_or_default().join("mimocode").join("auth.json"))
}

fn probe_mimo_login_status() -> NativeLoginStatus {
    let path = mimo_auth_json_path();
    let logged_in = fs::read_to_string(&path)
        .map(|raw| credential_text_has_key(&raw))
        .unwrap_or(false);
    NativeLoginStatus {
        logged_in,
        account_name: None,
        source: "auth_file",
        running: mimo_login_running(),
    }
}

/// Pending `mimo providers login` child PID (set while an interactive login is
/// in flight so the settings page can cancel it).
static MIMO_LOGIN_PID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

fn mimo_login_pid_lock() -> &'static Mutex<Option<u32>> {
    MIMO_LOGIN_PID.get_or_init(|| Mutex::new(None))
}

/// Spawn `mimo providers login` in the background. MiMo opens the provider's
/// browser login; the PID is remembered so the settings page can cancel it.
pub(crate) fn start_mimo_login() -> Result<(), AcpError> {
    if mimo_login_running() {
        return Ok(());
    }
    // Already logged in — nothing to do.
    if probe_mimo_login_status().logged_in {
        return Ok(());
    }
    let program = PathBuf::from("mimo");
    let args = ["providers", "login"];
    let mut cmd = crate::process::std_command(&program);
    cmd.args(args);
    // Detached, hidden: no console window, no stdin (the browser flow is the
    // interaction surface).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd
        .spawn()
        .map_err(|e| AcpError::protocol(format!("failed to start mimo login: {e}")))?;
    *mimo_login_pid_lock().lock().unwrap_or_else(|e| e.into_inner()) = Some(child.id());
    Ok(())
}

/// Whether a `mimo providers login` child is still running.
pub(crate) fn mimo_login_running() -> bool {
    let pid = mimo_login_pid_lock().lock().unwrap_or_else(|e| e.into_inner());
    match *pid {
        Some(pid) => {
            #[cfg(windows)]
            {
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

/// Kill a pending `mimo providers login` child, if any.
pub(crate) fn cancel_mimo_login() {
    let pid = {
        let mut guard = mimo_login_pid_lock().lock().unwrap_or_else(|e| e.into_inner());
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

// --- Cline ------------------------------------------------------------------

fn cline_auth_json_path() -> PathBuf {
    home_dir_or_default().join(".cline").join("auth.json")
}

/// Pending `cline auth` child PID.
static CLINE_LOGIN_PID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

fn cline_login_pid_lock() -> &'static Mutex<Option<u32>> {
    CLINE_LOGIN_PID.get_or_init(|| Mutex::new(None))
}

/// Spawn `cline auth cline` (Cline's OAuth sign-in) in the background. Cline
/// opens the browser; the PID is remembered so the settings page can cancel it.
pub(crate) fn start_cline_login() -> Result<(), AcpError> {
    if cline_login_running() {
        return Ok(());
    }
    // Already logged in — nothing to do.
    if probe_cline_login_status().logged_in {
        return Ok(());
    }
    let program = PathBuf::from("cline");
    let args = ["auth", "cline"];
    let mut cmd = crate::process::std_command(&program);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd
        .spawn()
        .map_err(|e| AcpError::protocol(format!("failed to start cline auth: {e}")))?;
    *cline_login_pid_lock().lock().unwrap_or_else(|e| e.into_inner()) = Some(child.id());
    Ok(())
}

/// Whether a `cline auth` child is still running.
pub(crate) fn cline_login_running() -> bool {
    let pid = cline_login_pid_lock().lock().unwrap_or_else(|e| e.into_inner());
    match *pid {
        Some(pid) => {
            #[cfg(windows)]
            {
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

/// Kill a pending `cline auth` child, if any.
pub(crate) fn cancel_cline_login() {
    let pid = {
        let mut guard = cline_login_pid_lock().lock().unwrap_or_else(|e| e.into_inner());
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

fn probe_cline_login_status() -> NativeLoginStatus {
    let path = cline_auth_json_path();
    let logged_in = fs::read_to_string(&path)
        .map(|raw| credential_text_has_key(&raw))
        .unwrap_or(false);
    NativeLoginStatus {
        logged_in,
        account_name: None,
        source: "auth_file",
        running: cline_login_running(),
    }
}

// --- CodeBuddy --------------------------------------------------------------

fn probe_codebuddy_login_status() -> NativeLoginStatus {
    let home = home_dir_or_default();
    let candidates = [
        home.join(".codebuddy").join("auth.json"),
        home.join(".codebuddy").join("credentials.json"),
    ];
    let logged_in = candidates
        .iter()
        .any(|p| fs::read_to_string(p).map(|raw| credential_text_has_key(&raw)).unwrap_or(false));
    NativeLoginStatus {
        logged_in,
        account_name: None,
        source: "auth_file",
        running: false,
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

fn remove_credential_file_if_present(path: &PathBuf) -> Result<(), AcpError> {
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(path)
        .map_err(|e| AcpError::protocol(format!("failed to delete {}: {e}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_text_detects_common_shapes() {
        assert!(credential_text_has_key(r#"{"api_key":"sk-abc"}"#));
        assert!(credential_text_has_key(r#"{"access_token":"t-1"}"#));
        assert!(credential_text_has_key(r#"{"openaiKey":"k"}"#));
        assert!(credential_text_has_key(r#"{"userName":"x","apiKey":"y"}"#));
        assert!(!credential_text_has_key(r#"{"userName":"x"}"#));
        assert!(!credential_text_has_key(r#"{"api_key":""}"#));
        assert!(!credential_text_has_key("not json without creds"));
        assert!(credential_text_has_key("bare-token-line"));
    }

    #[test]
    fn file_probe_union_file_or_env() {
        // No file + no env → not logged in.
        let s = probe_file_based_login_status(Vec::new(), false);
        assert!(!s.logged_in);
        assert_eq!(s.source, "none");

        // No file + env key → logged in via env_key.
        let s = probe_file_based_login_status(Vec::new(), true);
        assert!(s.logged_in);
        assert_eq!(s.source, "env_key");

        // File + env → auth_file wins.
        let dir = std::env::temp_dir().join(format!("nal-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let cred = dir.join("cred.json");
        fs::write(&cred, r#"{"api_key":"sk"}"#).expect("write");
        let s = probe_file_based_login_status(vec![cred.clone()], true);
        assert!(s.logged_in);
        assert_eq!(s.source, "auth_file");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn supports_native_login_covers_expected_set() {
        for at in [
            AgentType::ClaudeCode,
            AgentType::Codex,
            AgentType::Gemini,
            AgentType::KimiCode,
            AgentType::CodeBuddy,
            AgentType::CommandCode,
            AgentType::MimoCode,
            AgentType::Cline,
        ] {
            assert!(supports_native_login(at), "{at:?} should support native login");
        }
        for at in [
            AgentType::OpenCode,
            AgentType::Pi,
            AgentType::OpenClaw,
            AgentType::Hermes,
        ] {
            assert!(!supports_native_login(at), "{at:?} should be provider-only");
        }
    }
}
