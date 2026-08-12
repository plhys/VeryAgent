use std::ffi::{OsStr, OsString};
use std::path::PathBuf;
use std::process::Command;

use crate::acp::error::AcpError;

#[cfg(windows)]
use std::path::Path;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn configure_std_command(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    set_utf8_env(command);
    command
}

pub fn std_command<S>(program: S) -> Command
where
    S: AsRef<OsStr>,
{
    let mut command = Command::new(normalized_program(program));
    configure_std_command(&mut command);
    command
}

pub fn configure_tokio_command(
    command: &mut tokio::process::Command,
) -> &mut tokio::process::Command {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    set_utf8_env(command);
    command
}

/// Force child processes to emit English, UTF-8 output.
///
/// Why: downstream code classifies errors by substring-matching English
/// git/coreutils stderr (e.g. "unknown revision or path not in the working
/// tree"). Without pinning the locale, those matches silently fail under
/// non-English system locales and legitimate empty-repo cases bubble up as
/// red error banners.
fn set_utf8_env<C: SetEnv>(command: &mut C) {
    // Python
    command.env("PYTHONUTF8", "1");
    command.env("PYTHONIOENCODING", "utf-8");
    // POSIX locale — honored by git, coreutils, MSYS2/Git-for-Windows.
    command.env("LANG", "C.UTF-8");
    command.env("LC_ALL", "C.UTF-8");
}

/// Abstraction over the `.env()` method shared by std and tokio Command types.
trait SetEnv {
    fn env(&mut self, key: &str, val: &str) -> &mut Self;
}

impl SetEnv for Command {
    fn env(&mut self, key: &str, val: &str) -> &mut Self {
        Command::env(self, key, val)
    }
}

impl SetEnv for tokio::process::Command {
    fn env(&mut self, key: &str, val: &str) -> &mut Self {
        tokio::process::Command::env(self, key, val)
    }
}

/// On Windows, resolve a bare program name to its concrete file on PATH
/// by trying `.exe → .cmd → .bat` in order.
///
/// Rust's `Command::new("foo")` on Windows relies on `CreateProcessW`'s
/// implicit extension lookup, which does not locate `.cmd` / `.bat` shims
/// reliably for many npm-installed tools (`tsc`, `vite`, `eslint`, ...).
/// Without this helper those agents hang or ENOENT when ACP agents send
/// bare names. Extension fallback is **purely additive**: if the caller
/// already supplied a path, extension, or the `.exe` is found, the result
/// is identical to the previous behavior.
#[cfg(windows)]
fn resolve_windows_program(program: &OsStr) -> Option<OsString> {
    let path = Path::new(program);
    // Only apply fallback for bare names (no path components, no extension).
    if path.components().count() != 1 || path.extension().is_some() {
        return None;
    }

    let raw = program.to_string_lossy();
    for ext in ["exe", "cmd", "bat"] {
        let candidate = format!("{raw}.{ext}");
        // Return the absolute path. A bare name like `npm.cmd` makes
        // CreateProcess inherit the parent CWD, and npm.cmd then resolves its
        // sibling node_modules relative to that CWD (not its own dir) — so
        // spawning from src-tauri/ fails with MODULE_NOT_FOUND.
        if let Ok(full) = which::which(&candidate) {
            return Some(full.into_os_string());
        }
    }
    None
}

pub fn normalized_program<S>(program: S) -> OsString
where
    S: AsRef<OsStr>,
{
    // Bundled Node.js takes priority over system PATH — this is the core of
    // the "zero-dependency" runtime strategy. If veryAgent ships with a
    // bundled Node.js in its resource directory, use it so agents work even
    // when the user has no Node.js installed.
    if program.as_ref() == OsStr::new("node") {
        if let Some(bundled) = resolve_bundled_node() {
            return bundled.into_os_string();
        }
    }

    #[cfg(windows)]
    {
        if let Some(resolved) = resolve_windows_program(program.as_ref()) {
            return resolved;
        }
    }

    program.as_ref().to_os_string()
}

pub fn tokio_command<S>(program: S) -> tokio::process::Command
where
    S: AsRef<OsStr>,
{
    let mut command = tokio::process::Command::new(normalized_program(program));
    configure_tokio_command(&mut command);
    command
}

/// If veryAgent ships with a bundled Node.js, return its path.
///
/// Resolution order:
/// 1. `VERYAGENT_BUNDLED_NODE_DIR` env var (development override)
/// 2. `~/.veryagent/runtime/node/` (managed download — dev / portable fallback)
/// 3. `<resource_dir>/node/` (production bundle, Windows: next to the exe)
/// 4. macOS `Contents/Resources/node/` (Tauri bundle layout)
///
/// Returns `None` when no bundled Node.js is found.
pub fn resolve_bundled_node() -> Option<PathBuf> {
    resolve_bundled_node_dir().map(|dir| node_exe_path_in_dir(&dir))
}

/// Resolve the directory containing the bundled/managed Node.js distribution
/// (the dir that holds `node.exe`/`npm.cmd` on Windows, or `bin/node` on Unix).
///
/// Order matches [`resolve_bundled_node`]. The env override may point at a dir
/// with a *full* distribution (node + npm + npx) — the flat bundle layout.
pub fn resolve_bundled_node_dir() -> Option<PathBuf> {
    // Allow override via env var (useful in development)
    if let Ok(dir) = std::env::var("VERYAGENT_BUNDLED_NODE_DIR") {
        if !dir.is_empty() {
            let dir = PathBuf::from(dir);
            if node_exe_path_in_dir(&dir).exists() {
                return Some(dir);
            }
        }
    }

    // Managed download target: ~/.veryagent/runtime/node/
    let isolated = crate::paths::isolated_runtime_node_dir();
    if node_exe_path_in_dir(&isolated).exists() {
        return Some(isolated);
    }

    // Check for bundled node in the app's resource directory.
    // In production, this is next to the veryagent executable.
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    // Check sibling `node/` directory (side-by-side with the exe)
    let sibling = exe_dir.join("node");
    if node_exe_path_in_dir(&sibling).exists() {
        return Some(sibling);
    }

    // Check `resources/node/` relative to the exe (Windows/Linux Tauri layout)
    let resources = exe_dir.join("resources").join("node");
    if node_exe_path_in_dir(&resources).exists() {
        return Some(resources);
    }

    // macOS Tauri bundle: <app>.app/Contents/MacOS/../Resources/node/
    #[cfg(target_os = "macos")]
    {
        let mac_resources = exe_dir.join("..").join("Resources").join("node");
        if node_exe_path_in_dir(&mac_resources).exists() {
            return Some(mac_resources);
        }
    }

    None
}

/// The node executable path inside a node distribution dir.
fn node_exe_path_in_dir(dir: &Path) -> PathBuf {
    if cfg!(windows) {
        dir.join("node.exe")
    } else {
        dir.join("bin").join("node")
    }
}

/// Download and cache a portable Node.js distribution (node + npm + npx) for
/// the current platform into `~/.veryagent/runtime/node/`.
///
/// This is the dev / portable fallback when the app has no bundled runtime
/// (`resources/node/` in the installer) — the managed runtime keeps agents
/// independent of any system Node.js install. Downloads the FULL distribution
/// (not the single-file node.exe) because the isolated runtime also needs
/// npm/npx to install agent packages.
pub async fn download_node() -> Result<PathBuf, AcpError> {
    let node_dir = crate::paths::isolated_runtime_node_dir();
    let node_exe = node_exe_path_in_dir(&node_dir);

    // Already provisioned
    if node_exe.exists() {
        return Ok(node_exe);
    }

    tracing::info!("[Node] Node.js not found locally; downloading portable distribution...");

    let distro = current_node_distro();
    let is_windows = cfg!(target_os = "windows");
    let archive_name = format!(
        "node-{NODE_DIST_VERSION}-{distro}.{}",
        if is_windows { "zip" } else { "tar.gz" }
    );
    let url = format!("https://nodejs.org/dist/{NODE_DIST_VERSION}/{archive_name}");

    // Stage under the runtime root (sibling of the target dir) so a versioned
    // top-level dir can be renamed into place without recursive copy.
    let runtime_root = node_dir
        .parent()
        .ok_or_else(|| AcpError::DownloadFailed("cannot resolve runtime root".into()))?;
    let staging = runtime_root.join(format!(".node-download-{}", std::process::id()));
    let archive_tmp = staging.join(&archive_name);
    let extract_tmp = staging.join("extracted");
    std::fs::create_dir_all(&extract_tmp).map_err(|e| {
        AcpError::DownloadFailed(format!("failed to create node staging dir: {e}"))
    })?;

    let response = reqwest::get(&url).await.map_err(|e| {
        AcpError::DownloadFailed(format!("failed to download Node.js: {e}"))
    })?;
    let bytes = response.bytes().await.map_err(|e| {
        AcpError::DownloadFailed(format!("failed to read Node.js download: {e}"))
    })?;
    std::fs::write(&archive_tmp, &bytes).map_err(|e| {
        AcpError::DownloadFailed(format!("failed to write node archive: {e}"))
    })?;

    // Extract the full distribution.
    if is_windows {
        let file = std::fs::File::open(&archive_tmp).map_err(|e| {
            AcpError::DownloadFailed(format!("failed to open node archive: {e}"))
        })?;
        let mut zip = zip::ZipArchive::new(file)
            .map_err(|e| AcpError::DownloadFailed(format!("failed to read node zip: {e}")))?;
        zip.extract(&extract_tmp)
            .map_err(|e| AcpError::DownloadFailed(format!("failed to extract node zip: {e}")))?;
    } else {
        let file = std::fs::File::open(&archive_tmp).map_err(|e| {
            AcpError::DownloadFailed(format!("failed to open node archive: {e}"))
        })?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut tar = tar::Archive::new(gz);
        tar.unpack(&extract_tmp).map_err(|e| {
            AcpError::DownloadFailed(format!("failed to extract node archive: {e}"))
        })?;
    }

    // Flatten the versioned top dir (`node-v22.19.0-win-x64/…`) into node_dir.
    let mut entries = std::fs::read_dir(&extract_tmp)
        .map_err(|e| AcpError::DownloadFailed(format!("failed to list node staging: {e}")))?;
    let mut top_dir: Option<PathBuf> = None;
    while let Some(entry) = entries.next() {
        let entry = entry.map_err(|e| {
            AcpError::DownloadFailed(format!("failed to read node staging entry: {e}"))
        })?;
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            top_dir = Some(entry.path());
            break;
        }
    }
    let top_dir = top_dir.ok_or_else(|| {
        AcpError::DownloadFailed("node archive had no top-level directory".into())
    })?;
    std::fs::rename(&top_dir, &node_dir).map_err(|e| {
        AcpError::DownloadFailed(format!(
            "failed to move node distribution into place: {e}"
        ))
    })?;
    let _ = std::fs::remove_dir_all(&staging);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&node_exe, std::fs::Permissions::from_mode(0o755)).ok();
    }

    // Refresh PATH so `node` / `npm` / `npx` resolve from the managed runtime
    // even though the app already started (ensure_node_in_path ran at boot).
    ensure_node_in_path();

    tracing::info!("[Node] Node.js downloaded to {:?}", node_exe);
    Ok(node_exe)
}

const NODE_DIST_VERSION: &str = "v22.19.0";

/// The Node.js distro id for the current platform (`win-x64` / `linux-arm64` /
/// `darwin-x64` …), matching the official nodejs.org distribution layout.
fn current_node_distro() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "win-x64"
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        "win-arm64"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "linux-x64"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "linux-arm64"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "darwin-arm64"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "darwin-x64"
    }
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64")
    )))]
    {
        compile_error!("unsupported platform for bundled Node.js runtime");
    }
}

/// Resolve the `node` executable to use: the bundled / managed runtime first
/// (isolation — agents never depend on a system Node), then the system PATH.
pub fn resolve_node_command() -> Option<PathBuf> {
    if let Some(node) = resolve_bundled_node() {
        return Some(node);
    }
    which::which("node").ok()
}

/// Resolve the `npm` executable to use: the bundled / managed runtime's npm
/// first, then the isolated npm-global prefix shim, then the system PATH.
pub fn resolve_npm_command() -> Option<PathBuf> {
    if let Some(dir) = resolve_bundled_node_dir() {
        let npm = if cfg!(windows) {
            dir.join("npm.cmd")
        } else {
            dir.join("bin").join("npm")
        };
        if npm.exists() {
            return Some(npm);
        }
    }
    if let Some(prefix) = user_npm_prefix() {
        let bin = if cfg!(windows) {
            prefix
        } else {
            prefix.join("bin")
        };
        let npm = if cfg!(windows) {
            bin.join("npm.cmd")
        } else {
            bin.join("npm")
        };
        if npm.exists() {
            return Some(npm);
        }
    }
    which::which("npm").ok()
}

/// If `node` is not already in PATH, detect common Node.js version manager
/// installations and prepend the best matching bin directory to the process
/// PATH so that **all** downstream code (`which`, `Command`, child processes)
/// can find node/npm/npx without any special handling.
///
/// Only ONE directory is ever added (the first candidate that contains a
/// real `node` binary), so PATH pollution is minimal.
///
/// # Call site requirements
///
/// * Call **once** at startup, **before** any multi-threaded work begins.
///   `std::env::set_var` is not thread-safe (`unsafe` in Rust edition 2024);
///   calling it while other threads may read `PATH` is a data race.
/// * In the Tauri desktop binary: call from `run()` before `tauri::Builder`.
/// * In the standalone server binary: call from `main()` before building the
///   tokio runtime (do **not** use `#[tokio::main]` which spawns threads first).
/// * In Docker / systemd services: typically a no-op — `which("node")`
///   succeeds because `node` is installed to a standard PATH directory.
pub fn ensure_node_in_path() {
    // Bundled / managed Node.js takes priority: prepend its directory so
    // `node` / `npm` / `npx` all resolve from the isolated runtime, making the
    // whole agent stack independent of any system Node.js install.
    if let Some(node_dir) = resolve_bundled_node_dir() {
        let bin_dir = if cfg!(windows) {
            node_dir
        } else {
            node_dir.join("bin")
        };
        prepend_dir_to_path_if_absent(&bin_dir);
        tracing::info!("[PATH] prepended bundled Node runtime {}", bin_dir.display());
        return;
    }

    // Already reachable — nothing to do.
    if which::which("node").is_ok() {
        return;
    }

    let home = dirs::home_dir();
    if home.is_none() {
        tracing::info!("[PATH] HOME not set; env-var-only Node.js search (no home-relative paths)");
    }

    if let Some(bin_dir) = find_node_bin_dir(home.as_deref()) {
        prepend_to_path(&bin_dir);
        tracing::info!("[PATH] node not in PATH, prepended {}", bin_dir.display());
    }
}

/// Prepend `dir` to the process PATH unless it is already present (dedup).
fn prepend_dir_to_path_if_absent(dir: &Path) {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let sep = if cfg!(windows) { ";" } else { ":" };
    let dir_str = dir.to_string_lossy();
    if !current
        .to_string_lossy()
        .split(sep)
        .any(|p| p == dir_str.as_ref())
    {
        prepend_to_path(dir);
    }
}

/// Search common Node.js version manager directories for a `node` binary and
/// return the containing bin directory.
///
/// `home` may be `None` in minimal environments (Docker, systemd without HOME).
/// When `None`, only version managers whose location is determined by an
/// explicit environment variable are searched; home-relative default paths
/// (e.g. `~/.nvm`) are skipped.
///
/// Supported version managers / installation methods:
/// - **nvm** (Unix) — `$NVM_DIR` or `~/.nvm`
/// - **nvm-windows** — `%NVM_SYMLINK%`, `%NVM_HOME%` or `%APPDATA%\nvm`
/// - **fnm** (cross-platform) — `$FNM_MULTISHELL_PATH`, `$FNM_DIR` or platform default
/// - **volta** (cross-platform) — `$VOLTA_HOME` or `~/.volta`
/// - **asdf** (Unix) — `$ASDF_DATA_DIR` or `~/.asdf`
/// - **mise / rtx** (cross-platform) — `$MISE_DATA_DIR` or platform default
/// - **n** (Unix) — `$N_PREFIX` or `/usr/local`
/// - **Homebrew** (macOS) — `/opt/homebrew/opt/node` or `/usr/local/opt/node`
/// - **Scoop** (Windows) — `%SCOOP%\apps\nodejs*\current`
fn find_node_bin_dir(home: Option<&std::path::Path>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    let node_bin = if cfg!(windows) { "node.exe" } else { "node" };

    /// Extract a (major, minor, patch) tuple from a version directory name
    /// like `v20.11.1` or `20.11.1` for correct numeric sorting.
    /// Falls back to (0,0,0) for unparseable names so they sort last.
    fn semver_key(path: &std::path::Path) -> (u32, u32, u32) {
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .trim_start_matches('v')
            .to_string();
        let mut parts = name.split('.').filter_map(|s| s.parse::<u32>().ok());
        (
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
        )
    }

    /// Try each `(env_var, suffix_segments)` in order; return as soon as one
    /// env var is set.  If none match, fall back to `home / home_relative`.
    /// Returns `None` when no env var is set **and** `home` is `None` —
    /// the caller should skip that version manager entirely.
    fn resolve_dir(
        env_chain: &[(&str, &[&str])],
        home: Option<&std::path::Path>,
        home_relative: &[&str],
    ) -> Option<PathBuf> {
        for (key, suffixes) in env_chain {
            if let Ok(val) = std::env::var(key) {
                return Some(suffixes.iter().fold(PathBuf::from(val), |p, s| p.join(s)));
            }
        }
        home.map(|h| home_relative.iter().fold(h.to_path_buf(), |p, s| p.join(s)))
    }

    // ── nvm (Unix) ───────────────────────────────────────────────────────
    // Standard nvm for macOS/Linux. nvm-windows is a separate tool (below).
    if cfg!(not(windows)) {
        if let Some(nvm_dir) = resolve_dir(&[("NVM_DIR", &[])], home, &[".nvm"]) {
            if nvm_dir.is_dir() {
                let versions_dir = nvm_dir.join("versions").join("node");
                let mut alias_matched = false;

                // Try to match the "default" alias to a concrete version.
                // The alias may be a partial version (e.g. "18", "20.11"),
                // a full version, or a symbolic name ("lts/*", "node").
                // We only attempt matching for numeric prefixes — symbolic
                // aliases require full nvm resolution we cannot replicate.
                let default_alias = nvm_dir.join("alias").join("default");
                if let Ok(raw_alias) = std::fs::read_to_string(&default_alias) {
                    let alias = raw_alias.trim();
                    let is_numeric = alias
                        .trim_start_matches('v')
                        .starts_with(|c: char| c.is_ascii_digit());
                    if is_numeric {
                        let alias_stripped = alias.trim_start_matches('v');
                        if let Ok(entries) = std::fs::read_dir(&versions_dir) {
                            let mut matched: Vec<PathBuf> = entries
                                .flatten()
                                .filter(|e| {
                                    let name = e.file_name().to_string_lossy().to_string();
                                    let stripped = name.trim_start_matches('v');
                                    stripped.starts_with(alias_stripped)
                                })
                                .map(|e| e.path())
                                .collect();
                            if !matched.is_empty() {
                                matched.sort_by_key(|p| semver_key(p));
                                matched.reverse();
                                alias_matched = true;
                                candidates.extend(matched.into_iter().map(|p| p.join("bin")));
                            }
                        }
                    }
                }

                // Fall back: all installed versions, newest first.
                // Skipped when alias resolution already produced candidates.
                if !alias_matched {
                    if let Ok(mut entries) = std::fs::read_dir(&versions_dir)
                        .map(|rd| rd.flatten().map(|e| e.path()).collect::<Vec<_>>())
                    {
                        entries.sort_by_key(|p| semver_key(p));
                        entries.reverse();
                        for entry in entries {
                            candidates.push(entry.join("bin"));
                        }
                    }
                }
            }
        }
    }

    // ── nvm-windows ──────────────────────────────────────────────────────
    // nvm-windows is a completely separate tool from Unix nvm with a
    // different directory layout: %NVM_HOME%\v<version>\node.exe (no bin/).
    // The active version is symlinked at %NVM_SYMLINK%.
    if cfg!(windows) {
        // The active symlinked version directory (e.g. C:\Program Files\nodejs)
        if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
            let symlink_path = PathBuf::from(&nvm_symlink);
            if symlink_path.is_dir() {
                candidates.push(symlink_path);
            }
        }

        // All installed versions, newest first.
        if let Some(nvm_home) = resolve_dir(&[("NVM_HOME", &[]), ("APPDATA", &["nvm"])], None, &[])
        {
            if nvm_home.is_dir() {
                if let Ok(mut entries) = std::fs::read_dir(&nvm_home).map(|rd| {
                    rd.flatten()
                        .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
                        .filter(|e| e.file_name().to_string_lossy().starts_with('v'))
                        .map(|e| e.path())
                        .collect::<Vec<_>>()
                }) {
                    entries.sort_by_key(|p| semver_key(p));
                    entries.reverse();
                    // nvm-windows places node.exe directly in the version dir
                    candidates.extend(entries);
                }
            }
        }
    }

    // ── fnm ──────────────────────────────────────────────────────────────
    // FNM_MULTISHELL_PATH is set by `eval "$(fnm env)"` in the user's
    // shell RC. It points to a temporary directory that only exists during
    // an active shell session. In a GUI app (Tauri) this is typically
    // NOT set because the process inherits from the window manager, not a
    // shell. It mainly helps the *server binary* launched from a terminal.
    if let Ok(fnm_multishell_path) = std::env::var("FNM_MULTISHELL_PATH") {
        let path = PathBuf::from(fnm_multishell_path);
        if path.is_dir() {
            candidates.push(path);
        }
    }

    // Platform-specific default for FNM_DIR:
    //   Unix:    $FNM_DIR → $XDG_DATA_HOME/fnm → ~/.local/share/fnm
    //   Windows: $FNM_DIR → %APPDATA%/fnm      → ~/.fnm
    let fnm_dir = if cfg!(windows) {
        resolve_dir(&[("FNM_DIR", &[]), ("APPDATA", &["fnm"])], home, &[".fnm"])
    } else {
        resolve_dir(
            &[("FNM_DIR", &[]), ("XDG_DATA_HOME", &["fnm"])],
            home,
            &[".local", "share", "fnm"],
        )
    };
    if let Some(fnm_dir) = fnm_dir {
        let fnm_versions = fnm_dir.join("node-versions");
        if fnm_versions.is_dir() {
            if let Ok(mut entries) = std::fs::read_dir(&fnm_versions)
                .map(|rd| rd.flatten().map(|e| e.path()).collect::<Vec<_>>())
            {
                entries.sort_by_key(|p| semver_key(p));
                entries.reverse();
                for entry in entries {
                    let installation = entry.join("installation");
                    // On Unix fnm places binaries under installation/bin;
                    // on Windows they sit directly in the installation dir.
                    let bin = installation.join("bin");
                    candidates.push(if bin.is_dir() { bin } else { installation });
                }
            }
        }
    }

    // ── volta ────────────────────────────────────────────────────────────
    // Volta's bin/ directory contains *shims* — they exist even if no Node
    // version has been installed (`volta install node`).  Only add the
    // shim directory when at least one concrete Node image is present,
    // otherwise downstream `node` invocations would get a cryptic Volta
    // error instead of a clean "node not found".
    if let Some(volta_home) = resolve_dir(&[("VOLTA_HOME", &[])], home, &[".volta"]) {
        let volta_node_images = volta_home.join("tools").join("image").join("node");
        let has_volta_node = volta_node_images
            .is_dir()
            .then(|| std::fs::read_dir(&volta_node_images).ok())
            .flatten()
            .is_some_and(|mut rd| rd.next().is_some());
        if has_volta_node {
            let volta_bin = volta_home.join("bin");
            if volta_bin.is_dir() {
                candidates.push(volta_bin);
            }
        }
    }

    // ── asdf (Unix) ──────────────────────────────────────────────────────
    // asdf does not officially support Windows.
    if cfg!(not(windows)) {
        if let Some(asdf_dir) = resolve_dir(&[("ASDF_DATA_DIR", &[])], home, &[".asdf"]) {
            let asdf_nodejs = asdf_dir.join("installs").join("nodejs");
            if asdf_nodejs.is_dir() {
                if let Ok(mut entries) = std::fs::read_dir(&asdf_nodejs)
                    .map(|rd| rd.flatten().map(|e| e.path()).collect::<Vec<_>>())
                {
                    entries.sort_by_key(|p| semver_key(p));
                    entries.reverse();
                    for entry in entries {
                        candidates.push(entry.join("bin"));
                    }
                }
            }
        }
    }

    // ── mise / rtx (cross-platform) ─────────────────────────────────────
    // mise respects MISE_DATA_DIR > XDG_DATA_HOME > dirs::data_dir() > home.
    let mise_dir = resolve_dir(
        &[("MISE_DATA_DIR", &[]), ("XDG_DATA_HOME", &["mise"])],
        None,
        &[],
    )
    .or_else(|| {
        dirs::data_dir()
            .or_else(|| home.map(|h| h.join(".local").join("share")))
            .map(|d| d.join("mise"))
    });
    if let Some(mise_dir) = mise_dir {
        let mise_node = mise_dir.join("installs").join("node");
        if mise_node.is_dir() {
            if let Ok(mut entries) = std::fs::read_dir(&mise_node)
                .map(|rd| rd.flatten().map(|e| e.path()).collect::<Vec<_>>())
            {
                entries.sort_by_key(|p| semver_key(p));
                entries.reverse();
                for entry in entries {
                    // mise on Unix places binaries under <version>/bin/;
                    // on Windows they may sit directly in the version dir.
                    let bin = entry.join("bin");
                    candidates.push(if bin.is_dir() { bin } else { entry });
                }
            }
        }
    }

    // ── n (Unix) ─────────────────────────────────────────────────────────
    // `n` stores versions under $N_PREFIX/n/versions/node/<version>/bin/.
    // N_PREFIX defaults to /usr/local (no home dependency).
    if cfg!(not(windows)) {
        let n_prefix = std::env::var("N_PREFIX")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/usr/local"));
        let n_versions = n_prefix.join("n").join("versions").join("node");
        if n_versions.is_dir() {
            if let Ok(mut entries) = std::fs::read_dir(&n_versions)
                .map(|rd| rd.flatten().map(|e| e.path()).collect::<Vec<_>>())
            {
                entries.sort_by_key(|p| semver_key(p));
                entries.reverse();
                for entry in entries {
                    candidates.push(entry.join("bin"));
                }
            }
        }
    }

    // ── Homebrew (macOS) ─────────────────────────────────────────────────
    if cfg!(target_os = "macos") {
        // Apple Silicon (/opt/homebrew) and Intel (/usr/local)
        for prefix in &["/opt/homebrew", "/usr/local"] {
            let brew_node = PathBuf::from(prefix).join("opt").join("node").join("bin");
            if brew_node.is_dir() {
                candidates.push(brew_node);
            }
        }
    }

    // ── Scoop (Windows) ─────────────────────────────────────────────────
    if cfg!(windows) {
        if let Some(scoop_dir) = resolve_dir(&[("SCOOP", &[])], home, &["scoop"]) {
            // Scoop may install as "nodejs-lts" or "nodejs".
            for app_name in &["nodejs-lts", "nodejs"] {
                let scoop_node = scoop_dir.join("apps").join(app_name).join("current");
                if scoop_node.is_dir() {
                    candidates.push(scoop_node);
                }
            }
        }
    }

    // Return the first candidate that actually contains a `node` binary.
    candidates
        .into_iter()
        .find(|dir| dir.join(node_bin).is_file())
}

/// Prepend a directory to the process `PATH` environment variable.
pub(crate) fn prepend_to_path(dir: &std::path::Path) {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut new_path = OsString::from(dir);
    new_path.push(sep);
    new_path.push(current);
    std::env::set_var("PATH", new_path);
}

/// Return the user-local npm prefix directory (`~/.veryagent/npm-global/`).
///
/// Used as a fallback when `npm install -g` fails with EACCES because the
/// system global prefix (e.g. `/usr/local/lib/node_modules/`) is not writable.
pub(crate) fn user_npm_prefix() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".veryagent").join("npm-global"))
}

/// Build a PATH string with VeryAgent's isolated runtime dirs prepended
/// (managed Node distribution dir + the user npm-global bin dir), ahead of the
/// current process PATH. Used when spawning subprocesses that must resolve
/// `node` / `npm` / `npx` / agent shims from the isolated runtime regardless of
/// the live process PATH state (e.g. OpenClaw gateway CLI runs).
pub fn isolated_path_string() -> String {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(node_dir) = resolve_bundled_node_dir() {
        dirs.push(if cfg!(windows) {
            node_dir
        } else {
            node_dir.join("bin")
        });
    }
    if let Some(prefix) = user_npm_prefix() {
        dirs.push(if cfg!(windows) {
            prefix
        } else {
            prefix.join("bin")
        });
    }
    let current = std::env::var("PATH").unwrap_or_default();
    if dirs.is_empty() {
        return current;
    }
    let sep = if cfg!(windows) { ";" } else { ":" };
    let prepended = dirs
        .iter()
        .map(|d| d.to_string_lossy())
        .collect::<Vec<_>>()
        .join(sep);
    if current.is_empty() {
        prepended
    } else {
        format!("{prepended}{sep}{current}")
    }
}

/// Ensure the user-local npm prefix `bin/` directory is in `PATH` so that
/// binaries installed via the EACCES fallback can be found by `which` and
/// child processes.  Safe to call even if the directory does not exist yet.
///
/// On Unix, `npm install -g --prefix=<p>` places binaries in `<p>/bin/`.
/// On Windows, binaries are placed directly in `<p>/`.
pub fn ensure_user_npm_prefix_in_path() {
    if let Some(prefix) = user_npm_prefix() {
        let bin_dir = if cfg!(windows) {
            prefix
        } else {
            prefix.join("bin")
        };
        // Avoid adding duplicates.
        let current = std::env::var_os("PATH").unwrap_or_default();
        let bin_str = bin_dir.to_string_lossy();
        let sep = if cfg!(windows) { ";" } else { ":" };
        if !current
            .to_string_lossy()
            .split(sep)
            .any(|p| p == bin_str.as_ref())
        {
            prepend_to_path(&bin_dir);
        }
    }
}

/// Kill any running veryagent.exe processes other than the current one.
/// Called at startup to enforce single-instance: the new launch always wins
/// and the old instance is terminated.
pub fn kill_other_instances() {
    let current_pid = std::process::id();

    #[cfg(windows)]
    {
        // Must use CREATE_NO_WINDOW (via std_command). Bare `powershell.exe` /
        // `taskkill` without that flag flashes a console — not acceptable for a
        // desktop app. Prefer taskkill over PowerShell: same job, no script host.
        let filter = format!("PID ne {current_pid}");
        let _ = std_command("taskkill.exe")
            .args(["/F", "/IM", "veryagent.exe", "/FI", &filter])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }

    #[cfg(not(windows))]
    {
        let _ = std_command("pkill")
            .args(["-f", "veryagent"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}
