// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // When called as a git credential helper, handle it immediately and exit.
    // This avoids starting the full Tauri GUI runtime.
    if std::env::args().any(|a| a == "--credential-helper") {
        // Subprocess mode, before the desktop logging init in `run()`: install a
        // stderr-only subscriber so helper diagnostics aren't dropped, while
        // stdout stays the git credential protocol channel.
        let _log_guard = veryagent_lib::logging::init::init_stderr_only();
        veryagent_lib::git_credential::run_credential_helper();
        return;
    }

    // Kill any existing veryagent.exe processes so only one instance runs.
    // Uses the same identifier as the single-instance plugin so it covers
    // both debug and release builds launched from any path.
    veryagent_lib::process::kill_other_instances();

    veryagent_lib::run()
}
