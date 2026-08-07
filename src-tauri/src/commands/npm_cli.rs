//! Generic npm CLI install / uninstall commands.
//!
//! Compiled once into the binary; any plugin that ships as an npm package
//! calls these from the frontend with its own `package_name`, `binary_name`,
//! and `event_channel`.  Adding a new npm-based plugin never requires a
//! Rust recompile.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::app_error::AppCommandError;
use crate::web::event_bridge::{emit_event, EventEmitter};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Result of installing or locating an npm-based CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmInstallResult {
    pub success: bool,
    pub executable_path: Option<String>,
    pub message: String,
}

/// Parameters for the generic `npm_install_cli` command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpmInstallParams {
    /// npm package name, e.g. `"@org/my-cli"`.
    pub package_name: String,
    /// Expected binary name produced by the package, e.g. `"my-cli"`.
    pub binary_name: String,
    /// Tauri / web event channel for streamed progress, e.g. `"app://my-cli-install"`.
    pub event_channel: String,
    /// Client-side correlation id for the install stream.
    pub task_id: String,
    /// Pass `--include=optional` to npm (for native optional deps).
    #[serde(default)]
    pub include_optional: bool,
}

/// Parameters for the generic `npm_uninstall_cli` command.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpmUninstallParams {
    /// npm package name.
    pub package_name: String,
    /// Expected binary name (used for leftover-shim cleanup).
    pub binary_name: String,
}

// ---------------------------------------------------------------------------
// Streaming event types (shared shape for all npm-based installs)
// ---------------------------------------------------------------------------

const NPM_OFFICIAL_REGISTRY: &str = "https://registry.npmjs.org";

/// Soft upper bound for a single `npm install` attempt.
const NPM_INSTALL_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum NpmInstallEventKind {
    Started,
    Progress,
    Log,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
struct NpmInstallEvent {
    task_id: String,
    kind: NpmInstallEventKind,
    payload: String,
}

fn emit_npm_event(
    emitter: &EventEmitter,
    channel: &str,
    task_id: &str,
    kind: NpmInstallEventKind,
    payload: impl Into<String>,
) {
    emit_event(
        emitter,
        channel,
        NpmInstallEvent {
            task_id: task_id.to_string(),
            kind,
            payload: payload.into(),
        },
    );
}

fn emit_npm_progress(
    emitter: &EventEmitter,
    channel: &str,
    task_id: &str,
    percent: u8,
    label: &str,
) {
    let payload = serde_json::json!({
        "percent": percent.min(100),
        "label": label,
    })
    .to_string();
    emit_npm_event(emitter, channel, task_id, NpmInstallEventKind::Progress, payload);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Absolute path to npm (Windows: npm.cmd). Bare names break npm.cmd's
/// relative node_modules lookup when the process CWD is not nodejs/.
pub fn resolve_npm_program() -> Result<PathBuf, AppCommandError> {
    which::which("npm").map_err(|e| {
        AppCommandError::dependency_missing(format!(
            "npm not found on PATH (is Node.js installed?): {e}"
        ))
    })
}

/// Candidate binary paths under a given npm prefix directory.
fn binary_candidates(prefix: &std::path::Path, binary_name: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if cfg!(windows) {
        for ext in ["cmd", "exe", "bat", "ps1"] {
            out.push(prefix.join(format!("{binary_name}.{ext}")));
        }
        out.push(prefix.join(binary_name));
    } else {
        out.push(prefix.join("bin").join(binary_name));
        out.push(prefix.join(binary_name));
    }
    out
}

/// Find the binary under a specific npm prefix.
fn find_binary_under_prefix(prefix: &std::path::Path, binary_name: &str) -> Option<PathBuf> {
    binary_candidates(prefix, binary_name)
        .into_iter()
        .find(|p| p.is_file())
}

/// Locate an installed binary in user-prefix → default global → PATH.
fn locate_installed_binary(binary_name: &str) -> Option<PathBuf> {
    // 1) User npm prefix (~/.veryagent/npm-global)
    if let Some(prefix) = crate::process::user_npm_prefix() {
        if let Some(path) = find_binary_under_prefix(&prefix, binary_name) {
            return Some(path);
        }
    }
    // 2) Default global on Windows (%APPDATA%\npm)
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let prefix = PathBuf::from(appdata).join("npm");
            if let Some(path) = find_binary_under_prefix(&prefix, binary_name) {
                return Some(path);
            }
        }
    }
    // 3) System PATH
    if let Ok(path) = which::which(binary_name) {
        return Some(path);
    }
    None
}

// ---------------------------------------------------------------------------
// Core: streaming npm install
// ---------------------------------------------------------------------------

/// Stream npm stdout/stderr as install Log events; return (ok, combined_stderr).
///
/// Includes a heartbeat progress nudger and a hard timeout with process kill
/// so the UI cannot hang on "installing" forever.
async fn run_npm_install_streaming(
    args: &[String],
    task_id: &str,
    channel: &str,
    emitter: &EventEmitter,
    progress_base: u8,
    progress_cap: u8,
) -> Result<(bool, String), AppCommandError> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let npm = resolve_npm_program()?;
    let mut cmd = crate::process::tokio_command(&npm);
    for arg in args {
        cmd.arg(arg);
    }
    // Neutral CWD so batch shims never inherit a project folder.
    if let Some(home) = dirs::home_dir() {
        cmd.current_dir(home);
    }
    // Disable TTY-style progress (uses `\r`); prefer real log lines.
    cmd.env("npm_config_progress", "false");
    cmd.env("npm_config_loglevel", "info");
    cmd.env("npm_config_color", "false");
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    emit_npm_event(
        emitter,
        channel,
        task_id,
        NpmInstallEventKind::Log,
        format!("running {} {}", npm.display(), args.join(" ")),
    );

    let mut child = cmd.spawn().map_err(|e| {
        AppCommandError::dependency_missing(format!(
            "failed to run npm at {} (is Node.js / npm installed?): {e}",
            npm.display()
        ))
    })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let emitter_clone = emitter.clone();
    let channel_owned = channel.to_string();
    let task_id_owned = task_id.to_string();

    let stdout_handle = tokio::spawn({
        let emitter = emitter_clone.clone();
        let channel = channel_owned.clone();
        let task_id = task_id_owned.clone();
        async move {
            if let Some(out) = stdout {
                let reader = BufReader::new(out);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = line.replace('\r', " ").trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    emit_npm_event(&emitter, &channel, &task_id, NpmInstallEventKind::Log, &line);
                }
            }
        }
    });

    let stderr_handle = tokio::spawn({
        let emitter = emitter_clone.clone();
        let channel = channel_owned.clone();
        let task_id = task_id_owned.clone();
        async move {
            let mut collected = String::new();
            if let Some(err) = stderr {
                let reader = BufReader::new(err);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = line.replace('\r', " ");
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        emit_npm_event(
                            &emitter,
                            &channel,
                            &task_id,
                            NpmInstallEventKind::Log,
                            trimmed,
                        );
                    }
                    if !collected.is_empty() {
                        collected.push('\n');
                    }
                    collected.push_str(trimmed);
                }
            }
            collected
        }
    });

    // Heartbeat: nudge the UI bar while npm is downloading with no newlines.
    let heartbeat = tokio::spawn({
        let emitter = emitter_clone;
        let channel = channel_owned;
        let task_id = task_id_owned;
        async move {
            let base = progress_base.min(progress_cap);
            let cap = progress_cap.max(base);
            let mut tick = 0u8;
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                tick = tick.saturating_add(1);
                let span = (cap - base) as u32;
                let stepped = base as u32 + ((span * tick as u32) / (tick as u32 + 8)).min(span);
                let percent = (stepped as u8).min(cap.saturating_sub(1));
                emit_npm_progress(&emitter, &channel, &task_id, percent, "npm still working…");
            }
        }
    });

    let wait_result = tokio::time::timeout(NPM_INSTALL_TIMEOUT, async {
        let (_, stderr_result) = tokio::join!(stdout_handle, stderr_handle);
        let collected_stderr = stderr_result.unwrap_or_default();
        let status = child.wait().await.map_err(|e| {
            AppCommandError::configuration_invalid(format!("failed to wait for npm process: {e}"))
        })?;
        Ok::<_, AppCommandError>((status.success(), collected_stderr))
    })
    .await;

    heartbeat.abort();

    match wait_result {
        Ok(inner) => inner,
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(AppCommandError::configuration_invalid(format!(
                "npm install timed out after {}s",
                NPM_INSTALL_TIMEOUT.as_secs()
            )))
        }
    }
}

// ---------------------------------------------------------------------------
// Core: install strategy (user-prefix-first, fallback, --force on EEXIST)
// ---------------------------------------------------------------------------

/// Install an npm package globally using the standard strategy:
/// 1. User prefix (`~/.veryagent/npm-global`) — deterministic, no admin rights
/// 2. Default global prefix (fallback)
/// Both retry with `--force` on `EEXIST`.
async fn npm_install_package_global(
    package_name: &str,
    include_optional: bool,
    task_id: &str,
    channel: &str,
    emitter: &EventEmitter,
) -> Result<(), AppCommandError> {
    let registry_arg = format!("--registry={NPM_OFFICIAL_REGISTRY}");
    let optional_arg = include_optional.then_some("--include=optional".to_string());

    // Primary: ~/.veryagent/npm-global
    let prefix = crate::process::user_npm_prefix().ok_or_else(|| {
        AppCommandError::configuration_invalid(
            "could not determine home directory for npm install prefix".to_string(),
        )
    })?;
    tokio::fs::create_dir_all(&prefix).await.map_err(|e| {
        AppCommandError::configuration_invalid(format!(
            "failed to create user npm prefix {}: {e}",
            prefix.display()
        ))
    })?;
    let prefix_arg = format!("--prefix={}", prefix.display());

    emit_npm_progress(emitter, channel, task_id, 20, "npm install (user prefix)");
    emit_npm_event(
        emitter,
        channel,
        task_id,
        NpmInstallEventKind::Log,
        format!(
            "$ npm install -g {} --prefix={} {package_name}",
            optional_arg.as_deref().unwrap_or(""),
            prefix.display()
        ),
    );

    let mut args = vec![
        "install".to_string(),
        "-g".to_string(),
    ];
    if let Some(ref opt) = optional_arg {
        args.push(opt.clone());
    }
    args.push(prefix_arg.clone());
    args.push(registry_arg.clone());
    args.push(package_name.to_string());

    let (ok, user_log) =
        run_npm_install_streaming(&args, task_id, channel, emitter, 20, 50).await?;

    if !ok {
        if user_log.contains("EEXIST") {
            emit_npm_progress(emitter, channel, task_id, 40, "user prefix --force");
            emit_npm_event(
                emitter,
                channel,
                task_id,
                NpmInstallEventKind::Log,
                "File conflict in user prefix, retrying with --force…",
            );
            let mut force_args = vec![
                "install".to_string(),
                "-g".to_string(),
                "--force".to_string(),
            ];
            if let Some(ref opt) = optional_arg {
                force_args.push(opt.clone());
            }
            force_args.push(prefix_arg.clone());
            force_args.push(registry_arg.clone());
            force_args.push(package_name.to_string());
            let (force_ok, force_log) =
                run_npm_install_streaming(&force_args, task_id, channel, emitter, 40, 55).await?;
            if force_ok {
                crate::process::ensure_user_npm_prefix_in_path();
                emit_npm_progress(emitter, channel, task_id, 85, "npm install finished");
                return Ok(());
            }
            emit_npm_event(
                emitter,
                channel,
                task_id,
                NpmInstallEventKind::Log,
                format!(
                    "user prefix --force failed, trying default global: {}",
                    force_log.trim()
                ),
            );
        } else {
            emit_npm_event(
                emitter,
                channel,
                task_id,
                NpmInstallEventKind::Log,
                format!(
                    "user prefix install failed, trying default global: {}",
                    user_log.trim()
                ),
            );
        }

        // Fallback: default global prefix.
        emit_npm_progress(emitter, channel, task_id, 55, "npm install -g (default)");
        emit_npm_event(
            emitter,
            channel,
            task_id,
            NpmInstallEventKind::Log,
            format!(
                "$ npm install -g {} {package_name}",
                optional_arg.as_deref().unwrap_or("")
            ),
        );

        let mut default_args = vec![
            "install".to_string(),
            "-g".to_string(),
        ];
        if let Some(ref opt) = optional_arg {
            default_args.push(opt.clone());
        }
        default_args.push(registry_arg.clone());
        default_args.push(package_name.to_string());

        let (success, log) =
            run_npm_install_streaming(&default_args, task_id, channel, emitter, 55, 75).await?;
        if !success {
            if log.contains("EEXIST") {
                emit_npm_progress(emitter, channel, task_id, 70, "default global --force");
                let mut retry_args = vec![
                    "install".to_string(),
                    "-g".to_string(),
                    "--force".to_string(),
                ];
                if let Some(ref opt) = optional_arg {
                    retry_args.push(opt.clone());
                }
                retry_args.push(registry_arg);
                retry_args.push(package_name.to_string());
                let (retry_ok, retry_log) =
                    run_npm_install_streaming(&retry_args, task_id, channel, emitter, 70, 84)
                        .await?;
                if !retry_ok {
                    let err = retry_log.trim();
                    return Err(AppCommandError::configuration_invalid(if err.is_empty() {
                        format!("failed to install {package_name} via npm")
                    } else {
                        format!("failed to install {package_name} via npm: {err}")
                    }));
                }
            } else {
                let err = log.trim();
                return Err(AppCommandError::configuration_invalid(if err.is_empty() {
                    format!("failed to install {package_name} via npm")
                } else {
                    format!("failed to install {package_name} via npm: {err}")
                }));
            }
        }
    }

    crate::process::ensure_user_npm_prefix_in_path();
    emit_npm_progress(emitter, channel, task_id, 85, "npm install finished");
    Ok(())
}

// ---------------------------------------------------------------------------
// Core: uninstall from both prefixes + shim cleanup
// ---------------------------------------------------------------------------

/// Uninstall an npm package from both the default global prefix and the
/// user-local prefix. Cleans up leftover Windows shims.
pub async fn npm_uninstall_package(
    package_name: &str,
    binary_name: &str,
) -> Result<NpmInstallResult, AppCommandError> {
    let npm = resolve_npm_program()?;
    let mut notes: Vec<String> = Vec::new();
    let mut removed_any = false;

    // 1) Default global: `npm uninstall -g <package>`
    {
        let mut cmd = crate::process::tokio_command(&npm);
        if let Some(home) = dirs::home_dir() {
            cmd.current_dir(home);
        }
        let output = cmd
            .args(["uninstall", "-g", package_name])
            .output()
            .await
            .map_err(|e| {
                AppCommandError::configuration_invalid(format!(
                    "failed to run npm uninstall -g: {e}"
                ))
            })?;
        let log = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if output.status.success() {
            removed_any = true;
            notes.push("removed from default global prefix".to_string());
        } else {
            let err = log.trim();
            if err.contains("ENOENT")
                || err.contains("not found")
                || err.contains("No matching version")
                || err.is_empty()
            {
                notes.push("default global prefix: not installed".to_string());
            } else {
                notes.push(format!("default global uninstall: {err}"));
            }
        }
    }

    // 2) User prefix: `npm uninstall -g --prefix=~/.veryagent/npm-global <package>`
    if let Some(prefix) = crate::process::user_npm_prefix() {
        if prefix.exists() {
            let prefix_arg = format!("--prefix={}", prefix.display());
            let mut cmd = crate::process::tokio_command(&npm);
            if let Some(home) = dirs::home_dir() {
                cmd.current_dir(home);
            }
            let output = cmd
                .args(["uninstall", "-g", &prefix_arg, package_name])
                .output()
                .await
                .map_err(|e| {
                    AppCommandError::configuration_invalid(format!(
                        "failed to run npm uninstall (user prefix): {e}"
                    ))
                })?;
            let log = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            if output.status.success() {
                removed_any = true;
                notes.push(format!("removed from {}", prefix.display()));
            } else {
                let err = log.trim();
                if err.contains("ENOENT")
                    || err.contains("not found")
                    || err.contains("No matching version")
                    || err.is_empty()
                {
                    notes.push(format!("{}: not installed", prefix.display()));
                } else {
                    notes.push(format!("user prefix uninstall: {err}"));
                }
            }
        }

        // Best-effort shim cleanup (Windows leaves .cmd/.ps1 sometimes).
        for candidate in binary_candidates(&prefix, binary_name) {
            if candidate.is_file() {
                if let Err(e) = tokio::fs::remove_file(&candidate).await {
                    notes.push(format!(
                        "failed to remove leftover {}: {e}",
                        candidate.display()
                    ));
                } else {
                    removed_any = true;
                    notes.push(format!("removed leftover {}", candidate.display()));
                }
            }
        }
    }

    // 3) Check if still findable on PATH.
    if let Some(path) = locate_installed_binary(binary_name) {
        return Ok(NpmInstallResult {
            success: false,
            executable_path: Some(path.display().to_string()),
            message: format!(
                "{} still present at {}; {}",
                binary_name,
                path.display(),
                notes.join("; ")
            ),
        });
    }

    let message = if removed_any || notes.iter().any(|n| n.contains("cleared")) {
        format!("{package_name} uninstalled ({})", notes.join("; "))
    } else {
        format!("{package_name} was not installed ({})", notes.join("; "))
    };
    Ok(NpmInstallResult {
        success: true,
        executable_path: None,
        message,
    })
}

// ---------------------------------------------------------------------------
// Public core entry points (no Tauri / DB dependency — usable from web handlers too)
// ---------------------------------------------------------------------------

/// Install an npm-based CLI, streaming progress on the given event channel.
pub async fn npm_install_cli_core(
    params: &NpmInstallParams,
    emitter: &EventEmitter,
) -> Result<NpmInstallResult, AppCommandError> {
    emit_npm_event(
        emitter,
        &params.event_channel,
        &params.task_id,
        NpmInstallEventKind::Started,
        "",
    );
    emit_npm_progress(
        emitter,
        &params.event_channel,
        &params.task_id,
        5,
        "checking existing install",
    );

    // Already installed?
    if let Some(existing) = locate_installed_binary(&params.binary_name) {
        let path = existing.display().to_string();
        let msg = format!("{} already installed at {path}", params.package_name);
        emit_npm_progress(
            emitter,
            &params.event_channel,
            &params.task_id,
            100,
            "already installed",
        );
        emit_npm_event(
            emitter,
            &params.event_channel,
            &params.task_id,
            NpmInstallEventKind::Completed,
            &msg,
        );
        return Ok(NpmInstallResult {
            success: true,
            executable_path: Some(path),
            message: msg,
        });
    }

    // Run the install.
    if let Err(e) = npm_install_package_global(
        &params.package_name,
        params.include_optional,
        &params.task_id,
        &params.event_channel,
        emitter,
    )
    .await
    {
        emit_npm_event(
            emitter,
            &params.event_channel,
            &params.task_id,
            NpmInstallEventKind::Failed,
            e.to_string(),
        );
        return Err(e);
    }

    emit_npm_progress(
        emitter,
        &params.event_channel,
        &params.task_id,
        92,
        "resolving binary",
    );
    emit_npm_event(
        emitter,
        &params.event_channel,
        &params.task_id,
        NpmInstallEventKind::Log,
        format!("Locating {} binary…", params.binary_name),
    );

    // Resolve installed binary.
    if let Some(path) = locate_installed_binary(&params.binary_name) {
        let path_str = path.display().to_string();
        let msg = format!("{} installed at {path_str}", params.package_name);
        emit_npm_progress(
            emitter,
            &params.event_channel,
            &params.task_id,
            100,
            "done",
        );
        emit_npm_event(
            emitter,
            &params.event_channel,
            &params.task_id,
            NpmInstallEventKind::Completed,
            &msg,
        );
        return Ok(NpmInstallResult {
            success: true,
            executable_path: Some(path_str),
            message: msg,
        });
    }

    let msg = format!(
        "npm install completed but {} binary was not found on PATH or under ~/.veryagent/npm-global",
        params.binary_name
    );
    emit_npm_event(
        emitter,
        &params.event_channel,
        &params.task_id,
        NpmInstallEventKind::Failed,
        &msg,
    );
    Err(AppCommandError::dependency_missing(msg))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn npm_install_cli(
    #[cfg(feature = "tauri-runtime")] app: tauri::AppHandle,
    params: NpmInstallParams,
) -> Result<NpmInstallResult, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        let emitter = EventEmitter::Tauri(app);
        npm_install_cli_core(&params, &emitter).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = params;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn npm_uninstall_cli(
    #[cfg(feature = "tauri-runtime")] app: tauri::AppHandle,
    params: NpmUninstallParams,
) -> Result<NpmInstallResult, AppCommandError> {
    #[cfg(feature = "tauri-runtime")]
    {
        // Uninstall doesn't need streaming, but keep the AppHandle for consistency.
        let _emitter = EventEmitter::Tauri(app);
        npm_uninstall_package(&params.package_name, &params.binary_name).await
    }
    #[cfg(not(feature = "tauri-runtime"))]
    {
        let _ = params;
        Err(AppCommandError::configuration_invalid("tauri-only command"))
    }
}
