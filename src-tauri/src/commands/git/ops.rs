// git/ops.rs — GitOps helper that bundles the per-call credential/working-dir
// boilerplate into one reusable struct, eliminating the 6-site repetition of
// prepare_remote_git_cmd* parameter lists.

use crate::db::AppDatabase;
use crate::models::GitCredentials;
use super::credential::*;

pub struct GitOps<'a> {
    pub working_dir: &'a str,
    pub data_dir: &'a std::path::Path,
    pub db: &'a AppDatabase,
}

impl<'a> GitOps<'a> {
    pub fn new(
        working_dir: &'a str,
        data_dir: &'a std::path::Path,
        db: &'a AppDatabase,
    ) -> Self {
        Self { working_dir, data_dir, db }
    }

    /// Equivalent to `prepare_remote_git_cmd(cmd, working_dir, credentials, db, data_dir)`.
    pub async fn prepare(
        &self,
        cmd: &mut tokio::process::Command,
        credentials: Option<&GitCredentials>,
    ) {
        prepare_remote_git_cmd(cmd, self.working_dir, credentials, self.db, self.data_dir).await;
    }

    /// Equivalent to `prepare_remote_git_cmd_with_remote(cmd, working_dir, remote_name, credentials, db, data_dir)`.
    pub async fn prepare_for_remote(
        &self,
        cmd: &mut tokio::process::Command,
        remote_name: Option<&str>,
        credentials: Option<&GitCredentials>,
    ) {
        prepare_remote_git_cmd_with_remote(
            cmd, self.working_dir, remote_name, credentials, self.db, self.data_dir,
        ).await;
    }

    /// Equivalent to `prepare_remote_git_cmd_for_url(cmd, working_dir, credentials, db, data_dir)`.
    pub async fn prepare_for_url(
        &self,
        cmd: &mut tokio::process::Command,
        credentials: Option<&GitCredentials>,
    ) {
        prepare_remote_git_cmd_for_url(cmd, self.working_dir, credentials, self.db, self.data_dir).await;
    }
}
