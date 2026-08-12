use super::*;
use std::path::{Path, PathBuf};

use crate::acp::error::AcpError;


pub(crate) fn is_version_like(value: &str) -> bool {
    value.chars().any(|c| c.is_ascii_digit()) && value.contains('.')
}

pub(crate) fn normalize_version_candidate(value: &str) -> Option<String> {
    let normalized = value.trim().trim_start_matches('v');
    if is_version_like(normalized) {
        Some(normalized.to_string())
    } else {
        None
    }
}

pub(crate) fn version_from_package_spec(package: &str) -> Option<String> {
    let (_, maybe_version) = package.rsplit_once('@')?;
    let version = maybe_version.trim();
    if version.is_empty() || version.eq_ignore_ascii_case("latest") {
        return None;
    }
    normalize_version_candidate(version)
}

/// Validate and normalize a user-supplied custom version for install.
///
/// Stricter than [`normalize_version_candidate`]: tolerates a leading `v`/`V`,
/// then requires the first character to be a digit and the rest to be drawn from
/// `[0-9A-Za-z.-+]` (covers semver pre-release/build metadata and calendar
/// versions like `2026.5.20`). This rejects npm dist-tags (`latest`, `next`) and
/// anything containing whitespace, `@`, or path separators, so the result is
/// safe to interpolate into an npm package spec (`name@<v>`) and to substitute
/// into a binary download URL. Returns the version without the leading `v`.
pub(crate) fn sanitize_custom_version(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let normalized = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    let mut chars = normalized.chars();
    if !chars.next()?.is_ascii_digit() {
        return None;
    }
    // Require a dotted version (e.g. `1.2.3`) so the validator agrees with the
    // detection fallback `version_from_package_spec`, which needs a `.` — and so
    // a "custom version" is a concrete version rather than an npm range (`2`).
    if !normalized.contains('.') {
        return None;
    }
    let all_allowed = normalized
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'));
    all_allowed.then(|| normalized.to_string())
}

/// Build the `npm install -g` spec for an agent.
///
/// `version_override` of `None` or all-whitespace yields the registry-pinned
/// `package` spec unchanged (current behavior). A non-empty override is
/// validated via [`sanitize_custom_version`] and combined with the registry
/// package *name* (its pinned version is dropped) to form `name@<version>`. An
/// override that fails validation is rejected with an error.
pub(crate) fn build_npm_install_spec(
    package: &str,
    version_override: Option<&str>,
) -> Result<String, AcpError> {
    match version_override {
        Some(raw) if !raw.trim().is_empty() => {
            let version = sanitize_custom_version(raw).ok_or_else(|| {
                AcpError::protocol(format!("invalid custom version: {}", raw.trim()))
            })?;
            Ok(format!("{}@{version}", package_name_from_spec(package)))
        }
        _ => Ok(package.to_string()),
    }
}

/// Substitute a custom version into a registry binary download URL by replacing
/// every occurrence of the registry version string. The registry version is
/// embedded in the GitHub release URL (the path tag, and for some agents the
/// asset filename), so a plain replace yields the URL for the requested version
/// — assuming the upstream release reuses the same asset-naming convention.
pub(crate) fn apply_custom_version_to_url(url: &str, registry_version: &str, custom_version: &str) -> String {
    url.replace(registry_version, custom_version)
}

/// Whether a `Uvx` agent can actually be launched on this machine right now:
/// the `uvx` runner is resolvable (veryagent auto-provisions it on install, so this
/// holds post-prepare), or the agent's own CLI is on PATH (system fallback).
/// The connect gate (`verify_agent_installed`) and the Settings status/list
/// paths all use this so they agree on readiness. Note: the prepared-version
/// marker is deliberately NOT consulted here — it records what was fetched (for
/// the installed-version badge), not whether the launcher is currently present.
pub(crate) fn uvx_agent_launchable(system_cmd: Option<(&'static str, &'static [&'static str])>) -> bool {
    resolve_uvx_command().is_some()
        || system_cmd
            .map(|(c, _)| resolve_command_on_path(c).is_some())
            .unwrap_or(false)
}

pub(crate) async fn resolve_npx_command_from_current_npm_prefix(cmd: &str) -> Option<PathBuf> {
    let prefix = cached_npm_global_prefix().await?;
    resolve_npx_command_from_npm_prefix(cmd, &prefix)
}

pub(crate) async fn cached_npm_global_prefix() -> Option<PathBuf> {
    cached_npm_global_prefix_with(&NPM_GLOBAL_PREFIX_CACHE, resolve_current_npm_global_prefix).await
}

pub(crate) async fn cached_npm_global_prefix_with<F, Fut>(
    cache: &tokio::sync::OnceCell<PathBuf>,
    resolve: F,
) -> Option<PathBuf>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Option<PathBuf>>,
{
    if let Some(prefix) = cache.get() {
        return Some(prefix.clone());
    }

    let resolved = resolve().await?;
    match cache.set(resolved.clone()) {
        Ok(()) => Some(resolved),
        Err(_) => cache.get().cloned(),
    }
}

/// The "global" npm prefix is ALWAYS the user-owned isolated prefix
/// (`~/.veryagent/npm-global/`), never the system one. Agent packages are
/// installed there, and command resolution / version detection look here
/// first — so a machine's system npm state is irrelevant to VeryAgent.
pub(crate) async fn resolve_current_npm_global_prefix() -> Option<PathBuf> {
    crate::process::user_npm_prefix()
}

pub(crate) fn npm_prefix_bin_dir(prefix: &Path) -> PathBuf {
    if cfg!(windows) {
        prefix.to_path_buf()
    } else {
        prefix.join("bin")
    }
}

pub(crate) fn resolve_npx_command_from_npm_prefix(cmd: &str, prefix: &Path) -> Option<PathBuf> {
    let bin_dir = npm_prefix_bin_dir(prefix);

    #[cfg(windows)]
    let candidates = [
        bin_dir.join(format!("{cmd}.cmd")),
        bin_dir.join(format!("{cmd}.exe")),
        bin_dir.join(cmd),
    ];

    #[cfg(not(windows))]
    let candidates = [bin_dir.join(cmd)];

    candidates
        .into_iter()
        .find(|path| is_npm_command_candidate(path))
}

#[cfg(windows)]
pub(crate) fn is_npm_command_candidate(path: &Path) -> bool {
    path.is_file()
}

#[cfg(not(windows))]
pub(crate) fn is_npm_command_candidate(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.is_file()
        && path
            .metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

/// Detect the actual installed version of an npm global package by running
/// `npm list -g <package_name> --json` and parsing the JSON output.
///
/// Checks both the system global prefix and the user-local prefix
/// (`~/.veryagent/npm-global/`) so packages installed via the EACCES fallback are
/// found as well.
pub(crate) async fn detect_npm_global_version(package_name: &str) -> Option<String> {
    let npm_path = which::which("npm").ok()?;

    // The isolated user prefix is authoritative — agent packages live there.
    if let Some(prefix) = crate::process::user_npm_prefix() {
        if prefix.exists() {
            if let Some(v) = npm_list_version(&npm_path, package_name, Some(&prefix)).await {
                return Some(v);
            }
        }
    }

    // Best-effort fallback: check the system global prefix for a legacy install.
    npm_list_version(&npm_path, package_name, None).await
}

/// Run `npm list -g <package_name> --json [--prefix=<p>]` and extract the
/// installed version string.
pub(crate) async fn npm_list_version(
    npm_path: &std::path::Path,
    package_name: &str,
    prefix: Option<&std::path::Path>,
) -> Option<String> {
    let mut cmd = crate::process::tokio_command(npm_path);
    cmd.arg("list")
        .arg("-g")
        .arg(package_name)
        .arg("--json")
        .arg("--depth=0");
    if let Some(p) = prefix {
        cmd.arg(format!("--prefix={}", p.display()));
    }
    let output = cmd.output().await.ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).ok()?;
    let version = json
        .get("dependencies")?
        .get(package_name)?
        .get("version")?
        .as_str()?;
    normalize_version_candidate(version)
}

pub(crate) async fn detect_local_version(agent_type: AgentType) -> Option<String> {
    let meta = registry::get_agent_meta(agent_type);
    // Command Code's adapter is embedded in the app; its version is the
    // registry version itself (no cache lookup possible).
    if agent_type == AgentType::CommandCode {
        return meta.registry_version().map(str::to_string);
    }
    match meta.distribution {
        registry::AgentDistribution::Npx { cmd, package, .. } => {
            if !is_cmd_available(cmd).await {
                return None;
            }
            // Try `npm list -g <package_name> --json` to get the real installed version.
            let pkg_name = package_name_from_spec(package);
            detect_npm_global_version(&pkg_name).await
        }
        registry::AgentDistribution::Binary { cmd, .. } => {
            binary_cache::detect_installed_version(agent_type, cmd)
                .ok()
                .flatten()
        }
        registry::AgentDistribution::Uvx { .. } => binary_cache::uvx_prepared_version(agent_type),
    }
}

/// Official npm registry URL – used to bypass local mirror configurations that
/// may not have synced niche packages like `@agentclientprotocol/*`.
pub(crate) const NPM_OFFICIAL_REGISTRY: &str = "https://registry.npmjs.org";

/// Force npm to install platform-specific `optionalDependencies`. Several agents
/// ship their native CLI as a per-platform optional package — e.g.
/// `@agentclientprotocol/claude-agent-acp` pulls in `@anthropic-ai/claude-agent-sdk`,
/// whose runtime binary lives in optional deps like
/// `@anthropic-ai/claude-agent-sdk-win32-x64`. npm includes optional deps by
/// default, but a machine with `omit=optional` in its `.npmrc` (or `npm_config_omit`
/// in the environment) silently skips them, so the install "succeeds" yet the agent
/// fails at launch with "native binary not found for <platform>". `--include` wins
/// over `--omit` regardless of order and a CLI flag outranks any `.npmrc`, so passing
/// it unconditionally guarantees the native binary lands no matter how npm is
/// configured. Harmless for agents without optional deps.
pub(crate) const NPM_INCLUDE_OPTIONAL: &str = "--include=optional";

/// Run an npm command with piped stdout/stderr, streaming each line as a log event.
/// Returns (success: bool, collected_stderr: String) so callers can inspect errors.
pub(crate) async fn run_npm_streaming(
    args: &[&str],
    task_id: &str,
    emitter: &EventEmitter,
) -> Result<(bool, String), AcpError> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut cmd = crate::process::tokio_command("npm");
    for arg in args {
        cmd.arg(arg);
    }
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AcpError::protocol(format!("failed to spawn npm: {e}")))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let emitter_clone = emitter.clone();
    let task_id_owned = task_id.to_string();

    let stdout_handle = tokio::spawn({
        let emitter = emitter_clone.clone();
        let task_id = task_id_owned.clone();
        async move {
            if let Some(out) = stdout {
                let reader = BufReader::new(out);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    emit_agent_install_event(&emitter, &task_id, AgentInstallEventKind::Log, &line);
                }
            }
        }
    });

    let stderr_handle = tokio::spawn({
        let emitter = emitter_clone;
        let task_id = task_id_owned;
        async move {
            let mut collected = String::new();
            if let Some(err) = stderr {
                let reader = BufReader::new(err);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    emit_agent_install_event(&emitter, &task_id, AgentInstallEventKind::Log, &line);
                    if !collected.is_empty() {
                        collected.push('\n');
                    }
                    collected.push_str(&line);
                }
            }
            collected
        }
    });

    let (_, stderr_result) = tokio::join!(stdout_handle, stderr_handle);
    let collected_stderr = stderr_result.unwrap_or_default();

    let status = child
        .wait()
        .await
        .map_err(|e| AcpError::protocol(format!("failed to wait for npm process: {e}")))?;

    Ok((status.success(), collected_stderr))
}

pub(crate) async fn install_npm_global_package_streaming(
    package: &str,
    task_id: &str,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    // Isolation: ALL agent npm installs target the user-owned prefix
    // (~/.veryagent/npm-global/), never the system global prefix. This keeps
    // VeryAgent's agents independent of the machine's Node/npm environment —
    // installing or uninstalling anything globally on the system cannot affect
    // them (and vice versa).
    let registry_arg = format!("--registry={NPM_OFFICIAL_REGISTRY}");
    install_npm_to_user_prefix_streaming(package, &registry_arg, task_id, emitter).await
}

/// Install an npm package into the isolated user prefix (`~/.veryagent/npm-global/`).
///
/// This is the PRIMARY install path for all agent npm packages — VeryAgent
/// never writes to the system global prefix, so its agents are independent of
/// the machine's npm environment.
pub(crate) async fn install_npm_to_user_prefix_streaming(
    package: &str,
    registry_arg: &str,
    task_id: &str,
    emitter: &EventEmitter,
) -> Result<(), AcpError> {
    let prefix = crate::process::user_npm_prefix().ok_or_else(|| {
        AcpError::protocol(
            "npm install -g failed with EACCES and could not determine home directory for fallback"
                .to_string(),
        )
    })?;

    // Ensure the prefix directory exists.
    tokio::fs::create_dir_all(&prefix).await.map_err(|e| {
        AcpError::protocol(format!(
            "failed to create user npm prefix {}: {e}",
            prefix.display()
        ))
    })?;

    let prefix_arg = format!("--prefix={}", prefix.display());

    emit_agent_install_event(
        emitter,
        task_id,
        AgentInstallEventKind::Log,
        format!(
            "$ npm install -g {NPM_INCLUDE_OPTIONAL} --prefix={} {package}",
            prefix.display()
        ),
    );

    let (success, stderr) = run_npm_streaming(
        &[
            "install",
            "-g",
            NPM_INCLUDE_OPTIONAL,
            &prefix_arg,
            registry_arg,
            package,
        ],
        task_id,
        emitter,
    )
    .await?;

    if !success {
        // EEXIST in the user prefix: retry with --force to overwrite stale files
        // from a previous installation.
        if stderr.contains("EEXIST") {
            emit_agent_install_event(
                emitter,
                task_id,
                AgentInstallEventKind::Log,
                "File conflict in user prefix, retrying with --force...",
            );
            let (force_success, force_stderr) = run_npm_streaming(
                &[
                    "install",
                    "-g",
                    "--force",
                    NPM_INCLUDE_OPTIONAL,
                    &prefix_arg,
                    registry_arg,
                    package,
                ],
                task_id,
                emitter,
            )
            .await?;
            if !force_success {
                let err = force_stderr.trim().to_string();
                let msg = if err.is_empty() {
                    format!(
                        "failed to install npm package (user prefix {}, --force)",
                        prefix.display()
                    )
                } else {
                    format!(
                        "failed to install npm package (user prefix {}, --force): {err}",
                        prefix.display()
                    )
                };
                return Err(AcpError::protocol(msg));
            }
            // --force succeeded, fall through to PATH setup below.
        } else {
            let err = stderr.trim().to_string();
            let msg = if err.is_empty() {
                format!(
                    "failed to install npm package globally (user prefix {})",
                    prefix.display()
                )
            } else {
                format!(
                    "failed to install npm package globally (user prefix {}): {err}",
                    prefix.display()
                )
            };
            return Err(AcpError::protocol(msg));
        }
    }

    // Make sure the user prefix bin dir is in PATH for subsequent `which` lookups.
    crate::process::ensure_user_npm_prefix_in_path();

    Ok(())
}

pub(crate) async fn uninstall_npm_global_package(package: &str) -> Result<(), AcpError> {
    let package_name = package_name_from_spec(package);

    if !package_name.is_empty() {
        // The isolated user prefix is authoritative; a system-global copy is
        // only cleaned up best-effort (VeryAgent never installs there anymore).
        let user_result = uninstall_npm_from_user_prefix(&package_name).await;
        let _ = uninstall_npm_from_system_prefix(&package_name).await;
        user_result
    } else {
        Ok(())
    }
}

/// Uninstall from the system global prefix — legacy cleanup only.
async fn uninstall_npm_from_system_prefix(package_name: &str) -> Result<(), AcpError> {
    let output = crate::process::tokio_command("npm")
        .arg("uninstall")
        .arg("-g")
        .arg(package_name)
        .output()
        .await
        .map_err(|e| AcpError::protocol(format!("failed to run npm uninstall -g: {e}")))?;

    if !output.status.success() {
        // EACCES means it wasn't installed in the system prefix either — ignore.
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("EACCES") {
            return Ok(());
        }
        tracing::debug!(
            "[npm] system-prefix uninstall of {package_name} failed (best-effort): {}",
            stderr.trim()
        );
    }
    Ok(())
}

/// Uninstall an npm package from the user-local prefix (`~/.veryagent/npm-global/`).
pub(crate) async fn uninstall_npm_from_user_prefix(package_name: &str) -> Result<(), AcpError> {
    let prefix = match crate::process::user_npm_prefix() {
        Some(p) if p.exists() => p,
        _ => return Ok(()),
    };

    let prefix_arg = format!("--prefix={}", prefix.display());
    let output = crate::process::tokio_command("npm")
        .arg("uninstall")
        .arg("-g")
        .arg(&prefix_arg)
        .arg(package_name)
        .output()
        .await
        .map_err(|e| {
            AcpError::protocol(format!(
                "failed to run npm uninstall -g with user prefix: {e}"
            ))
        })?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let msg = if err.is_empty() {
            format!(
                "failed to uninstall npm package from user prefix (exit code {})",
                output.status.code().unwrap_or(-1)
            )
        } else {
            format!("failed to uninstall npm package from user prefix: {err}")
        };
        return Err(AcpError::protocol(msg));
    }

    Ok(())
}
