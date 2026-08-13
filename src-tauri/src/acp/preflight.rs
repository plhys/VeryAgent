use serde::Serialize;
use std::sync::Mutex;

use crate::acp::binary_cache;
use crate::acp::registry::{self, AgentDistribution};
use crate::commands::acp::general;
use crate::models::agent::AgentType;

/// Cache for npm environment check results.
/// Stores `Some(checks)` after a successful (all-pass) run;
/// stays `None` if checks failed so they are retried next time.
static NPM_ENV_CACHE: Mutex<Option<Vec<CheckItem>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FixActionKind {
    OpenUrl,
    InstallOpencodePlugins,
    InstallUv,
    /// Install the `pi` binary (`@earendil-works/pi-coding-agent`) that pi-acp
    /// spawns as `pi --mode rpc`, into the isolated npm prefix. payload = agent_type.
    InstallPiBinary,
    /// Install the agent package (npx install or uvx prepare). payload = agent_type.
    InstallNpx,
    /// Upgrade an already-installed npx/uvx agent. payload = agent_type.
    UpgradeNpx,
    /// Download/cache the binary distribution. payload = agent_type.
    DownloadBinary,
    /// Force redownload of the binary distribution. payload = agent_type.
    ReinstallBinary,
    /// Rebuild a corrupted native config file from app state. payload = agent_type.
    RepairConfig,
    /// Ensure the user-local npm prefix is on PATH. payload = empty.
    EnsureNpmPath,
    /// Bootstrap the OpenClaw local gateway (setup + start). payload = empty.
    EnsureOpenClawGateway,
}

#[derive(Debug, Clone, Serialize)]
pub struct FixAction {
    pub label: String,
    pub kind: FixActionKind,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Pass,
    Fail,
    Warn,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckItem {
    pub check_id: String,
    pub label: String,
    pub status: CheckStatus,
    pub message: String,
    pub fixes: Vec<FixAction>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreflightResult {
    pub agent_type: AgentType,
    pub agent_name: String,
    pub passed: bool,
    pub checks: Vec<CheckItem>,
}

pub fn clear_npm_env_cache() {
    *NPM_ENV_CACHE.lock().unwrap() = None;
}

pub async fn run_preflight(agent_type: AgentType) -> PreflightResult {
    let meta = registry::get_agent_meta(agent_type);
    debug_assert_eq!(meta.agent_type, agent_type);
    let mut checks = match &meta.distribution {
        AgentDistribution::Npx { node_required, .. } => check_npm_environment(*node_required).await,
        AgentDistribution::Binary {
            version,
            cmd,
            platforms,
            ..
        } if agent_type == AgentType::CommandCode => {
            // Command Code ships its ACP adapter built into the app — there is
            // no downloadable binary and no binary cache entry to check. The
            // only runtime prerequisite is Node.js (the adapter is executed
            // with `node <resources>/command-code-acp.mjs`).
            check_command_code_environment().await
        }
        AgentDistribution::Binary {
            version,
            cmd,
            platforms,
            ..
        } => check_binary_environment(agent_type, version, cmd, platforms).await,
        AgentDistribution::Uvx {
            uv_required,
            system_cmd,
            ..
        } => check_uv_environment(*uv_required, *system_cmd).await,
    };

    // Distribution-agnostic checks: is the package/binary actually installed
    // and launchable, and is the native config file parseable? These power the
    // one-click 检测全部 / 修复全部 flow — the "installed" gate mirrors
    // `verify_agent_installed`, and the config check catches a machine whose
    // config file was corrupted/left in a bad state.
    checks.extend(check_package_installed(agent_type).await);
    checks.extend(check_config_parse(agent_type));
    checks.extend(check_legacy_system_install(agent_type).await);
    // Pi 特有：`pi-acp` 只是 ACP 壳，运行时还会 spawn `pi --mode rpc` 这个真实
    // 二进制。上面的 package/legacy 检查只覆盖 `pi-acp`，这里单独检查 `pi` 是否
    // 从隔离前缀解析，避免检测页全绿但实际 pi 落在系统全局 / 缺失。
    checks.extend(check_pi_binary_isolation(agent_type).await);

    let passed = checks
        .iter()
        .all(|c| !matches!(c.status, CheckStatus::Fail));

    PreflightResult {
        agent_type,
        agent_name: meta.name.to_string(),
        passed,
        checks,
    }
}

async fn check_npm_environment(node_required: Option<&str>) -> Vec<CheckItem> {
    // Return cached result if a previous check passed.
    // The cache stores only the base checks (node_available + npm_available);
    // the per-agent node_version check is appended separately.
    let cached = NPM_ENV_CACHE.lock().unwrap().clone();
    if let Some(cached) = cached {
        let mut checks = cached;
        if let Some(required) = node_required {
            // Extract node version string from the cached node_available message
            // (format: "Node.js v20.19.0 available")
            let node_ver = extract_node_version_from_message(&checks[0].message);
            checks.push(build_node_version_check(node_ver.as_deref(), required));
        }
        return checks;
    }

    // Resolve absolute paths — bundled / managed runtime first (isolation),
    // then system PATH — and run version checks in parallel.
    let node_path = crate::process::resolve_node_command();
    let npm_path = crate::process::resolve_npm_command();
    // Whether node/npm came from the isolated runtime (for the message).
    let node_from_bundle = node_path.is_some()
        && crate::process::resolve_bundled_node_dir()
            .map(|dir| {
                let dir_str = dir.to_string_lossy().into_owned();
                node_path
                    .as_ref()
                    .map(|p| p.starts_with(&dir_str))
                    .unwrap_or(false)
            })
            .unwrap_or(false);
    let node_source_hint = if node_from_bundle { " (bundled runtime)" } else { "" };

    let (node_result, npm_result) = tokio::join!(
        async {
            match &node_path {
                Some(p) => {
                    crate::process::tokio_command(p)
                        .arg("--version")
                        .output()
                        .await
                }
                None => Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "node not found in PATH",
                )),
            }
        },
        async {
            match &npm_path {
                Some(p) => {
                    crate::process::tokio_command(p)
                        .arg("--version")
                        .output()
                        .await
                }
                None => Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "npm not found in PATH",
                )),
            }
        },
    );

    // Track the raw node version string for reuse in the version check
    let mut node_version_str: Option<String> = None;

    let node_check = match node_result {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            node_version_str = Some(version.clone());
            CheckItem {
                check_id: "node_available".into(),
                label: "Node.js".into(),
                status: CheckStatus::Pass,
                message: format!("Node.js {version} available{node_source_hint}"),
                fixes: vec![],
            }
        }
        _ => CheckItem {
            check_id: "node_available".into(),
            label: "Node.js".into(),
            status: CheckStatus::Fail,
            message: "Node.js is not installed or not in PATH".into(),
            fixes: vec![FixAction {
                label: "Install Node.js".into(),
                kind: FixActionKind::OpenUrl,
                payload: "https://nodejs.org/".into(),
            }],
        },
    };

    let npm_check = match npm_result {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            CheckItem {
                check_id: "npm_available".into(),
                label: "npm".into(),
                status: CheckStatus::Pass,
                message: format!("npm {version} available"),
                fixes: vec![],
            }
        }
        _ => CheckItem {
            check_id: "npm_available".into(),
            label: "npm".into(),
            status: CheckStatus::Fail,
            message: "npm is not installed or not in PATH".into(),
            fixes: vec![FixAction {
                label: "Install Node.js".into(),
                kind: FixActionKind::OpenUrl,
                payload: "https://nodejs.org/".into(),
            }],
        },
    };

    let mut checks = vec![node_check, npm_check];

    // Cache only if all checks passed — failed results are not cached so
    // the user can retry after installing the missing tools.
    let all_passed = checks
        .iter()
        .all(|c| !matches!(c.status, CheckStatus::Fail));
    if all_passed {
        *NPM_ENV_CACHE.lock().unwrap() = Some(checks.clone());
    }

    // After caching the base checks, append the per-agent Node.js version
    // requirement if specified. Only meaningful when node is available.
    if let Some(required) = node_required {
        if all_passed {
            checks.push(build_node_version_check(
                node_version_str.as_deref(),
                required,
            ));
        }
    }

    checks
}

/// Parse a Node.js version string like "v20.19.0" or "20.19.0" into (major, minor, patch).
/// Handles pre-release suffixes such as "v22.0.0-nightly" by stripping non-numeric tails.
fn parse_node_version(v: &str) -> Option<(u32, u32, u32)> {
    let v = v.trim().trim_start_matches('v');
    let mut parts = v.splitn(3, '.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch_str = parts.next()?;
    // Strip pre-release/build suffixes: "0-nightly" → "0", "3+build" → "3"
    let patch_digits: String = patch_str
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let patch = patch_digits.parse().ok()?;
    Some((major, minor, patch))
}

/// Extract the node version string from a cached node_available message.
/// Expected format: "Node.js v20.19.0 available" → Some("v20.19.0")
fn extract_node_version_from_message(message: &str) -> Option<String> {
    message
        .split_whitespace()
        .find(|s| s.starts_with('v') && s.contains('.'))
        .map(|s| s.to_string())
}

/// Build a `CheckItem` for the Node.js version requirement check.
/// `current_version` is the raw output from `node --version` (e.g. "v20.19.0").
fn build_node_version_check(current_version: Option<&str>, required: &str) -> CheckItem {
    let current_version = match current_version {
        Some(v) => v,
        None => {
            return CheckItem {
                check_id: "node_version".into(),
                label: "Node.js version".into(),
                status: CheckStatus::Fail,
                message: "Cannot determine Node.js version".into(),
                fixes: vec![],
            };
        }
    };

    let current = parse_node_version(current_version);
    let required_parsed = parse_node_version(required);

    match (current, required_parsed) {
        (Some(cur), Some(req)) if cur >= req => CheckItem {
            check_id: "node_version".into(),
            label: "Node.js version".into(),
            status: CheckStatus::Pass,
            message: format!(
                "Node.js {current_version} meets the minimum requirement (>={required})"
            ),
            fixes: vec![],
        },
        (Some(_), Some(_)) => CheckItem {
            check_id: "node_version".into(),
            label: "Node.js version".into(),
            status: CheckStatus::Fail,
            message: format!(
                "Node.js {current_version} is too old — this package requires Node.js >={required}"
            ),
            fixes: vec![FixAction {
                label: "Update Node.js".into(),
                kind: FixActionKind::OpenUrl,
                payload: "https://nodejs.org/".into(),
            }],
        },
        _ => CheckItem {
            check_id: "node_version".into(),
            label: "Node.js version".into(),
            status: CheckStatus::Warn,
            message: format!("Cannot parse Node.js version; required >={required}"),
            fixes: vec![],
        },
    }
}

/// Preflight for `Uvx` agents (Python ACP agents launched via `uvx`, e.g.
/// Hermes). Passes when either the `uv` tool runner is resolvable, or — as a
/// fallback — the agent's own CLI is already installed on PATH.
async fn check_uv_environment(
    uv_required: Option<&str>,
    system_cmd: Option<(&str, &[&str])>,
) -> Vec<CheckItem> {
    // Primary: the `uv` tool runner (uvx) fetches + launches the agent package.
    if let Some(uvx_path) = crate::commands::acp::resolve_uvx_command() {
        let version = run_uv_version(&uvx_path).await;
        let mut checks = vec![CheckItem {
            check_id: "uv_available".into(),
            label: "uv".into(),
            status: CheckStatus::Pass,
            message: match &version {
                Some(v) => format!("uv {v} available"),
                None => "uv available".into(),
            },
            fixes: vec![],
        }];
        if let Some(required) = uv_required {
            checks.push(build_uv_version_check(version.as_deref(), required));
        }
        return checks;
    }

    // Fallback: the agent's own CLI is already installed on PATH (e.g. a user
    // who ran the official installer has `hermes` available). The agent is
    // launchable as-is, but installing uv unlocks veryagent's managed install /
    // upgrade flow, so offer it as a non-blocking action.
    if let Some((cmd, _)) = system_cmd {
        if crate::commands::acp::resolve_command_on_path(cmd).is_some() {
            return vec![CheckItem {
                check_id: "uv_available".into(),
                label: "uv".into(),
                status: CheckStatus::Warn,
                message: format!(
                    "uv not found; will launch via the system `{cmd}` command on PATH. Install uv to enable managed install/upgrade."
                ),
                fixes: vec![FixAction {
                    label: "Install uv".into(),
                    kind: FixActionKind::InstallUv,
                    payload: String::new(),
                }],
            }];
        }
    }

    // uv is required and not installed: a hard failure with an actionable
    // installer. Installing uv is a separate step from installing the agent.
    vec![CheckItem {
        check_id: "uv_available".into(),
        label: "uv".into(),
        status: CheckStatus::Fail,
        message: "uv (the Python tool runner) is not installed. Click Install uv to set it up."
            .into(),
        fixes: vec![FixAction {
            label: "Install uv".into(),
            kind: FixActionKind::InstallUv,
            payload: String::new(),
        }],
    }]
}

/// Run `<uvx> --version` and extract the version token (output looks like
/// "uvx 0.8.10 (hash date)").
async fn run_uv_version(uvx_path: &std::path::Path) -> Option<String> {
    let output = crate::process::tokio_command(uvx_path)
        .arg("--version")
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.split_whitespace().nth(1).map(|s| s.to_string())
}

/// Build a `CheckItem` for the `uv` minimum-version requirement. Too-old is a
/// `Warn` (not `Fail`): recent uv releases are backward compatible for the
/// `uvx --from <pkg>==<ver>` invocation, so an old uv should not hard-block.
fn build_uv_version_check(current: Option<&str>, required: &str) -> CheckItem {
    match (current.and_then(parse_node_version), parse_node_version(required)) {
        (Some(cur), Some(req)) if cur >= req => CheckItem {
            check_id: "uv_version".into(),
            label: "uv version".into(),
            status: CheckStatus::Pass,
            message: format!("uv {} meets the minimum requirement (>={required})", current.unwrap_or("")),
            fixes: vec![],
        },
        (Some(_), Some(_)) => CheckItem {
            check_id: "uv_version".into(),
            label: "uv version".into(),
            status: CheckStatus::Warn,
            message: format!(
                "uv {} is older than the recommended >={required}; consider `uv self update`",
                current.unwrap_or("")
            ),
            fixes: vec![],
        },
        _ => CheckItem {
            check_id: "uv_version".into(),
            label: "uv version".into(),
            status: CheckStatus::Warn,
            message: format!("Cannot parse uv version; recommended >={required}"),
            fixes: vec![],
        },
    }
}

/// Preflight for the built-in Command Code ACP adapter. There is no binary to
/// download or cache — the adapter ships inside the app and is executed with
/// `node <resources>/command-code-acp.mjs` — so the only real prerequisite is
/// a Node.js runtime on PATH. The adapter resolves `node` through the same
/// `crate::process::normalized_program` path the connect path uses.
async fn check_command_code_environment() -> Vec<CheckItem> {
    let mut checks = Vec::new();

    let adapter_check = CheckItem {
        check_id: "adapter_bundled".into(),
        label: "Adapter".into(),
        status: CheckStatus::Pass,
        message: "Command Code ACP adapter is built into the app".into(),
        fixes: vec![],
    };
    checks.push(adapter_check);

    // Node.js availability — the adapter's only runtime dependency. Uses the
    // bundled / managed runtime first (isolation), then system PATH.
    let node_path = crate::process::resolve_node_command();
    let node_check = match node_path {
        Some(path) => {
            let output = crate::process::tokio_command(&path)
                .arg("--version")
                .output()
                .await;
            match output {
                Ok(out) if out.status.success() => CheckItem {
                    check_id: "node_available".into(),
                    label: "Node.js".into(),
                    status: CheckStatus::Pass,
                    message: format!(
                        "Node.js {} available",
                        String::from_utf8_lossy(&out.stdout).trim()
                    ),
                    fixes: vec![],
                },
                _ => CheckItem {
                    check_id: "node_available".into(),
                    label: "Node.js".into(),
                    status: CheckStatus::Fail,
                    message: "Node.js is not installed or not in PATH".into(),
                    fixes: vec![],
                },
            }
        }
        None => CheckItem {
            check_id: "node_available".into(),
            label: "Node.js".into(),
            status: CheckStatus::Fail,
            message: "Node.js is not installed or not in PATH".into(),
            fixes: vec![],
        },
    };
    checks.push(node_check);

    // cmdc CLI availability — the ACP adapter spawns `cmdc` for every prompt.
    let cmdc_available = which::which("cmdc").is_ok()
        || std::env::var("COMMAND_CODE_ACP_CMD").is_ok();
    let cmdc_check = if cmdc_available {
        CheckItem {
            check_id: "cmdc_available".into(),
            label: "Command Code CLI".into(),
            status: CheckStatus::Pass,
            message: "cmdc is available on PATH".into(),
            fixes: vec![],
        }
    } else {
        CheckItem {
            check_id: "cmdc_available".into(),
            label: "Command Code CLI".into(),
            status: CheckStatus::Fail,
            message: "cmdc is not installed. Run `npm install -g command-code` to install it.".into(),
            fixes: vec![FixAction {
                label: "Install Command Code".into(),
                kind: FixActionKind::OpenUrl,
                payload: "https://www.npmjs.com/package/command-code".into(),
            }],
        }
    };
    checks.push(cmdc_check);

    checks
}

async fn check_binary_environment(
    agent_type: AgentType,
    version: &str,
    cmd: &str,
    platforms: &[registry::PlatformBinary],
) -> Vec<CheckItem> {
    let mut checks = Vec::new();

    // Check platform support
    let current = registry::current_platform();
    let platform_supported = platforms.iter().any(|p| p.platform == current);

    let platform_check = if platform_supported {
        CheckItem {
            check_id: "platform_supported".into(),
            label: "Platform".into(),
            status: CheckStatus::Pass,
            message: format!("Platform {current} is supported"),
            fixes: vec![],
        }
    } else {
        CheckItem {
            check_id: "platform_supported".into(),
            label: "Platform".into(),
            status: CheckStatus::Fail,
            message: format!("Platform {current} is not supported"),
            fixes: vec![],
        }
    };
    checks.push(platform_check);

    // Check binary cache.
    //
    // Pass as long as *any* cached version is present — the session-page
    // connect path uses the best cached version via
    // `find_best_cached_binary_for_agent`, so an older-but-working cache
    // should still be considered "ready". If the cached version differs
    // from the registry's recommended version, we note it in the message
    // but still pass — the Settings page's version-badge flow is the
    // canonical place to surface "upgrade available".
    if platform_supported {
        let cache_check = match binary_cache::find_best_cached_binary_for_agent(agent_type, cmd) {
            Ok(Some((_, cached_version))) => {
                let message = if cached_version == version {
                    "Binary is cached locally".to_string()
                } else {
                    format!("Binary {cached_version} is cached locally (recommended: {version})")
                };
                CheckItem {
                    check_id: "binary_cached".into(),
                    label: "Binary cache".into(),
                    status: CheckStatus::Pass,
                    message,
                    fixes: vec![],
                }
            }
            Ok(None) => CheckItem {
                check_id: "binary_cached".into(),
                label: "Binary cache".into(),
                status: CheckStatus::Warn,
                message:
                    "Binary is not installed. Download it from Agent Settings before connecting."
                        .into(),
                fixes: vec![],
            },
            Err(_) => CheckItem {
                check_id: "binary_cached".into(),
                label: "Binary cache".into(),
                status: CheckStatus::Warn,
                message: "Cannot determine binary cache path".into(),
                fixes: vec![],
            },
        };
        checks.push(cache_check);
    }

    // OpenCode plugin checks
    if agent_type == AgentType::OpenCode {
        use crate::acp::opencode_plugins::{self, spec_has_floating_version, PluginStatus};
        match opencode_plugins::check_opencode_plugins(None) {
            Ok(summary) => {
                let missing: Vec<_> = summary
                    .plugins
                    .iter()
                    .filter(|p| p.status == PluginStatus::Missing)
                    .collect();

                if summary.plugins.is_empty() {
                    checks.push(CheckItem {
                        check_id: "opencode_plugins".into(),
                        label: "OpenCode plugins".into(),
                        status: CheckStatus::Pass,
                        message: "No plugins declared".into(),
                        fixes: vec![],
                    });
                } else if missing.is_empty() {
                    checks.push(CheckItem {
                        check_id: "opencode_plugins".into(),
                        label: "OpenCode plugins".into(),
                        status: CheckStatus::Pass,
                        message: format!("{} plugin(s) installed", summary.plugins.len()),
                        fixes: vec![],
                    });
                } else {
                    let names: Vec<&str> = missing.iter().map(|p| p.name.as_str()).collect();
                    checks.push(CheckItem {
                        check_id: "opencode_plugins".into(),
                        label: "OpenCode plugins".into(),
                        status: CheckStatus::Fail,
                        message: format!(
                            "{} plugin(s) not installed: {}",
                            missing.len(),
                            names.join(", ")
                        ),
                        fixes: vec![FixAction {
                            label: "Install Plugins".into(),
                            kind: FixActionKind::InstallOpencodePlugins,
                            payload: String::new(),
                        }],
                    });
                }

                // Warn about @latest specs that cause slow startup
                let floating: Vec<&str> = summary
                    .plugins
                    .iter()
                    .filter(|p| spec_has_floating_version(&p.declared_spec))
                    .map(|p| p.name.as_str())
                    .collect();
                if !floating.is_empty() {
                    checks.push(CheckItem {
                        check_id: "opencode_plugins_floating".into(),
                        label: "Plugin versions".into(),
                        status: CheckStatus::Warn,
                        message: format!(
                            "{} plugin(s) use @latest which forces a network check on every startup: {}. \
                             Install via the plugin manager to auto-pin versions.",
                            floating.len(),
                            floating.join(", ")
                        ),
                        fixes: vec![FixAction {
                            label: "Install Plugins".into(),
                            kind: FixActionKind::InstallOpencodePlugins,
                            payload: String::new(),
                        }],
                    });
                }

                // Project-level config hint
                if summary.has_project_config_hint {
                    checks.push(CheckItem {
                        check_id: "opencode_project_config_hint".into(),
                        label: "Project config".into(),
                        status: CheckStatus::Warn,
                        message:
                            "Project-level opencode config detected; its plugins are not checked. \
                             Expect slower first connect if it declares plugins."
                                .into(),
                        fixes: vec![],
                    });
                }
            }
            Err(e) => {
                checks.push(CheckItem {
                    check_id: "opencode_plugins".into(),
                    label: "OpenCode plugins".into(),
                    status: CheckStatus::Warn,
                    message: format!("Failed to parse opencode.json: {e}"),
                    fixes: vec![],
                });
            }
        }
    }

    checks
}

/// Check that the agent's package/binary is actually installed and launchable
/// on this machine — the same gate `verify_agent_installed` uses before connect.
/// Exposing it as a preflight `CheckItem` lets the one-click 检测全部 / 修复全部
/// flow drive installs from a single source of truth instead of duplicating the
/// version-status logic in the UI.
async fn check_package_installed(agent_type: AgentType) -> Vec<CheckItem> {
    let meta = registry::get_agent_meta(agent_type);
    let not_installed = |fix_kind: FixActionKind| {
        CheckItem {
            check_id: "package_installed".into(),
            label: "Package".into(),
            status: CheckStatus::Fail,
            message: format!(
                "{} is not installed or not launchable on this machine.",
                meta.name
            ),
            fixes: vec![FixAction {
                label: match fix_kind {
                    FixActionKind::InstallNpx => "Install".into(),
                    FixActionKind::UpgradeNpx => "Upgrade".into(),
                    FixActionKind::DownloadBinary | FixActionKind::ReinstallBinary => {
                        "Install".into()
                    }
                    _ => "Install".into(),
                },
                kind: fix_kind,
                payload: agent_type_wire_id(agent_type),
            }],
        }
    };
    let pass = CheckItem {
        check_id: "package_installed".into(),
        label: "Package".into(),
        status: CheckStatus::Pass,
        message: format!("{} is installed and launchable.", meta.name),
        fixes: vec![],
    };

    match &meta.distribution {
        AgentDistribution::Npx { cmd, .. } => {
            let cmd = cmd.to_string();
            if crate::commands::acp::resolve_npx_command(&cmd).await.is_some() {
                vec![pass]
            } else {
                vec![not_installed(FixActionKind::InstallNpx)]
            }
        }
        // Command Code's adapter is embedded — nothing to install.
        AgentDistribution::Binary { .. } if agent_type == AgentType::CommandCode => vec![pass],
        AgentDistribution::Binary { cmd, .. } => {
            let cached =
                binary_cache::find_best_cached_binary_for_agent(agent_type, cmd).ok().flatten();
            match cached {
                Some(_) => vec![pass],
                None => vec![not_installed(FixActionKind::DownloadBinary)],
            }
        }
        AgentDistribution::Uvx { system_cmd, .. } => {
            // Same launchability test as `verify_agent_installed`: uvx
            // resolvable (auto-provisioned on install) or the agent's own CLI
            // on PATH. The missing-runtime case (uv not installed) is reported
            // by the `uv_available` check with its own Install uv fix.
            if crate::commands::acp::binary::uvx_agent_launchable(*system_cmd) {
                vec![pass]
            } else {
                vec![not_installed(FixActionKind::InstallNpx)]
            }
        }
    }
}

/// Detect npm agents that are installed in the SYSTEM global npm directory but
/// not (yet) in the isolated VeryAgent prefix (`~/.veryagent/npm-global/`).
///
/// Isolation is the target state: agents should run from the isolated prefix so
/// the machine's npm state is irrelevant. A legacy system install still works
/// (via the PATH fallback in `resolve_npx_command`), so this is a `Warn` with a
/// one-click "migrate" fix (`InstallNpx` → reinstalls into the isolated prefix).
/// 「修复全部」 picks this up automatically.
async fn check_legacy_system_install(agent_type: AgentType) -> Vec<CheckItem> {
    let meta = registry::get_agent_meta(agent_type);
    let AgentDistribution::Npx { cmd, .. } = &meta.distribution else {
        // Binary / uvx agents have no "system npm global" concept.
        return vec![];
    };
    if agent_type == AgentType::CommandCode {
        return vec![]; // embedded adapter, nothing to migrate
    }
    let cmd = cmd.to_string();

    // Already resolvable from the isolated prefix → no migration needed.
    if let Some(path) =
        crate::commands::acp::resolve_npx_command_from_current_npm_prefix(&cmd).await
    {
        let inside_isolated = crate::process::user_npm_prefix()
            .map(|p| path.starts_with(&p))
            .unwrap_or(false);
        if inside_isolated {
            return vec![CheckItem {
                check_id: "legacy_system_install".into(),
                label: "Runtime isolation".into(),
                status: CheckStatus::Pass,
                message: format!("{} runs from the isolated VeryAgent npm prefix.", meta.name),
                fixes: vec![],
            }];
        }
    }

    // Isolated missing, but a system-global copy is findable on PATH → migrate.
    if let Some(path) = crate::commands::acp::resolve_command_on_path(&cmd) {
        let inside_isolated = crate::process::user_npm_prefix()
            .map(|p| path.starts_with(&p))
            .unwrap_or(false);
        if !inside_isolated {
            return vec![CheckItem {
                check_id: "legacy_system_install".into(),
                label: "Runtime isolation".into(),
                status: CheckStatus::Warn,
                message: format!(
                    "{} is installed in the system npm global directory ({}). Reinstall to move it into the isolated VeryAgent environment.",
                    meta.name,
                    path.display()
                ),
                fixes: vec![FixAction {
                    label: "Migrate to isolated env".into(),
                    kind: FixActionKind::InstallNpx,
                    payload: agent_type_wire_id(agent_type),
                }],
            }];
        }
    }

    // Neither isolated nor system — `package_installed` already reported it.
    vec![]
}

/// Check that the `pi` binary (the inner coding agent pi-acp spawns as
/// `pi --mode rpc`) resolves from the isolated VeryAgent npm prefix.
///
/// The distribution checks above (`check_package_installed` /
/// `check_legacy_system_install`) only cover the `pi-acp` ACP adapter command,
/// so a machine where pi-acp is isolated but `pi` landed in the system global
/// npm directory (or is missing) would otherwise show all-green on the settings
/// page yet fail at launch with ENOENT. Only applies to Pi. `None` means the
/// launch preflight already surfaced the missing case; here we report the
/// location when it exists outside isolation.
async fn check_pi_binary_isolation(agent_type: AgentType) -> Vec<CheckItem> {
    if agent_type != AgentType::Pi {
        return vec![];
    }
    let meta = registry::get_agent_meta(agent_type);
    let pass = CheckItem {
        check_id: "pi_binary_isolation".into(),
        label: "Pi binary".into(),
        status: CheckStatus::Pass,
        message: format!("{} runs from the isolated VeryAgent npm prefix.", meta.name),
        fixes: vec![],
    };
    let migrate_fix = |label: &str, message: String| CheckItem {
        check_id: "pi_binary_isolation".into(),
        label: "Pi binary".into(),
        status: CheckStatus::Warn,
        message,
        fixes: vec![FixAction {
            label: label.into(),
            kind: FixActionKind::InstallPiBinary,
            payload: agent_type_wire_id(agent_type),
        }],
    };

    // Resolve the bare `pi` command (the launch default). A custom
    // `PI_ACP_PI_COMMAND` override is validated separately by
    // `acp_validate_pi_command`; here we report the default path.
    let Some(resolved) = crate::commands::acp::resolve_pi_command_path("pi") else {
        return vec![migrate_fix(
            "Install pi",
            format!(
                "{}'s `pi` binary is not found. Install it into the isolated VeryAgent environment.",
                meta.name
            ),
        )];
    };
    if crate::process::user_npm_prefix()
        .map(|p| resolved.starts_with(&p))
        .unwrap_or(false)
    {
        return vec![pass];
    }
    vec![migrate_fix(
        "Migrate to isolated env",
        format!(
            "{}'s `pi` binary is installed in the system npm global directory ({}). Reinstall to move it into the isolated VeryAgent environment.",
            meta.name,
            resolved.display()
        ),
    )]
}

/// Check that a JSON-native config file parses. Only applies to agents whose
/// native config is a JSON file the app manages (Claude Code, Gemini,
/// OpenCode); the rest are TOML/YAML/env and validated by their own modules at
/// spawn. A corrupt config is repairable — offer the RepairConfig action.
fn check_config_parse(agent_type: AgentType) -> Vec<CheckItem> {
    if !matches!(
        agent_type,
        AgentType::ClaudeCode | AgentType::Gemini | AgentType::OpenCode
    ) {
        return vec![];
    }
    let Some(path) = general::agent_local_config_path(agent_type) else {
        return vec![];
    };
    if !path.exists() {
        // A missing config is normal — it is rendered on first spawn. Not an
        // error, and nothing to repair yet.
        return vec![];
    }
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) => {
            return vec![CheckItem {
                check_id: "config_parse".into(),
                label: "Config file".into(),
                status: CheckStatus::Fail,
                message: format!("Cannot read {}: {e}", path.display()),
                fixes: vec![repair_config_fix(agent_type)],
            }];
        }
    };
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(value) if value.is_object() => vec![CheckItem {
            check_id: "config_parse".into(),
            label: "Config file".into(),
            status: CheckStatus::Pass,
            message: format!("{} is valid JSON.", path.display()),
            fixes: vec![],
        }],
        _ => vec![CheckItem {
            check_id: "config_parse".into(),
            label: "Config file".into(),
            status: CheckStatus::Fail,
            message: format!(
                "{} is corrupted or not valid JSON. The app can rebuild it from your settings (a backup is kept).",
                path.display()
            ),
            fixes: vec![repair_config_fix(agent_type)],
        }],
    }
}

fn repair_config_fix(agent_type: AgentType) -> FixAction {
    FixAction {
        label: "Repair config".into(),
        kind: FixActionKind::RepairConfig,
        payload: agent_type_wire_id(agent_type),
    }
}

/// The snake_case wire id for an agent type, matching the frontend's
/// `agent.agent_type` (e.g. "claude_code"). `AgentType`'s `Display` impl is the
/// human-readable name, not the wire id, so reuse serde's `rename_all`.
pub(crate) fn agent_type_wire_id(agent_type: AgentType) -> String {
    serde_json::to_value(agent_type)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}
