use std::collections::HashMap;
// git/types.rs
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct GitStatusEntry {
    pub status: String,
    pub file: String,
}

#[derive(Debug, Serialize)]
pub struct GitBranchList {
    pub local: Vec<String>,
    pub remote: Vec<String>,
    pub worktree_branches: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct GitConflictInfo {
    pub has_conflicts: bool,
    pub conflicted_files: Vec<String>,
    pub operation: String,
    pub upstream_commit: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GitPullResult {
    pub updated_files: usize,
    pub conflict: Option<GitConflictInfo>,
}

#[derive(Debug, Serialize)]
pub struct GitPushResult {
    pub pushed_commits: usize,
    pub upstream_set: bool,
}

#[derive(Debug, Serialize)]
pub struct GitPushInfo {
    pub branch: String,
    pub remotes: Vec<GitRemote>,
    pub tracking_remote: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GitMergeResult {
    pub merged_commits: usize,
    pub conflict: Option<GitConflictInfo>,
}

#[derive(Debug, Serialize)]
pub struct GitRebaseResult {
    pub message: String,
    pub conflict: Option<GitConflictInfo>,
}

#[derive(Debug, Serialize)]
pub struct GitConflictFileVersions {
    pub base: String,
    pub ours: String,
    pub theirs: String,
    pub merged: String,
}

#[derive(Debug, Serialize)]
pub struct GitCommitResult {
    pub committed_files: usize,
}

#[derive(Debug, Serialize)]
pub struct GitStashEntry {
    pub index: usize,
    pub message: String,
    pub branch: String,
    pub date: String,
    pub ref_name: String,
}

#[derive(Debug, Serialize)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitCommitSucceededEvent {
    pub folder_id: i32,
    pub committed_files: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitPushSucceededEvent {
    pub folder_id: i32,
    pub pushed_commits: usize,
    pub upstream_set: bool,
}

#[derive(Debug, Serialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub full_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
    pub files: Vec<GitLogFileChange>,
    pub pushed: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct GitLogFileChange {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Serialize)]
pub struct GitLogResult {
    pub entries: Vec<GitLogEntry>,
    pub has_upstream: bool,
}

/// The state of a working tree's `HEAD`. The legacy `get_git_branch` contract
/// collapsed every non-branch state into `None`, so a detached HEAD looked
/// identical to a non-git folder and the UI hid all git operations (issue
/// #279). This distinguishes the four states the UI actually needs.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitHeadInfo {
    /// Whether git recognizes this path as a work tree.
    pub is_repo: bool,
    /// Branch name when `HEAD` points at a branch — including an unborn branch
    /// right after `git init`. `None` when detached or not a repo.
    pub branch: Option<String>,
    /// Whether `HEAD` is detached (points directly at a commit, not a branch).
    pub detached: bool,
    /// Short commit hash; present when detached and at least one commit exists.
    pub short_sha: Option<String>,
}

pub struct GitLogEntryBuilder {
    hash: String,
    full_hash: String,
    author: String,
    date: String,
    message: String,
    files: Vec<GitLogFileChange>,
    index_by_path: HashMap<String, usize>,
}

impl GitLogEntryBuilder {
    pub fn new(parts: Vec<&str>) -> Self {
        Self {
            hash: parts[0].to_string(),
            full_hash: parts[1].to_string(),
            author: parts[2].to_string(),
            date: parts[3].to_string(),
            message: String::new(),
            files: Vec::new(),
            index_by_path: HashMap::new(),
        }
    }

    pub fn push_message_line(&mut self, line: &str) {
        if !self.message.is_empty() {
            self.message.push('\n');
        }
        self.message.push_str(line);
    }

    pub fn finalize_message(&mut self) {
        self.message = self.message.trim_end_matches('\n').to_string();
    }

    pub fn get_or_insert_file(&mut self, path: String) -> &mut GitLogFileChange {
        let index = if let Some(index) = self.index_by_path.get(&path) {
            *index
        } else {
            self.files.push(GitLogFileChange {
                path: path.clone(),
                status: "M".to_string(),
                additions: 0,
                deletions: 0,
            });
            let index = self.files.len() - 1;
            self.index_by_path.insert(path, index);
            index
        };

        &mut self.files[index]
    }

    pub fn finish(self) -> GitLogEntry {
        GitLogEntry {
            hash: self.hash,
            full_hash: self.full_hash,
            author: self.author,
            date: self.date,
            message: self.message,
            files: self.files,
            pushed: None,
        }
    }
}
