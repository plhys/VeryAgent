//! 统一技能管理模块
//!
//! 将 `experts.rs` 和 `science.rs` 的公共逻辑抽取到此模块。
//! 两个模块通过 `SkillBundle` 参数化调用此模块，避免代码重复。
//!
//! 技能编译进二进制（`include_dir!`），启动时提取到 `~/.veryagent/skills/<id>/`。
//! 用户启用技能时，从中央存储复制到智能体的技能目录。

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::Mutex as StdMutex;

use chrono::Utc;
use include_dir::{Dir, DirEntry};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use crate::acp::types::AgentSkillScope;
use crate::commands::acp::{
    preferred_scope_skill_dir, remove_skill_entry, scoped_skill_dirs, skill_storage_spec,
    validate_skill_id,
};
use crate::models::agent::AgentType;

// ─── Constants ──────────────────────────────────────────────────────────

const CENTRAL_DIR_NAME: &str = ".veryagent";
const CENTRAL_SKILLS_SUBDIR: &str = "skills";

// ─── Error type ─────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum SkillsError {
    #[error("skill not found: {0}")]
    NotFound(String),
    #[error("agent does not support skills: {0:?}")]
    UnsupportedAgent(AgentType),
    #[error("io error: {0}")]
    Io(String),
    #[error("metadata error: {0}")]
    Metadata(String),
    #[error("central skill store is unavailable: {0}")]
    CentralUnavailable(String),
}

impl Serialize for SkillsError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<io::Error> for SkillsError {
    fn from(err: io::Error) -> Self {
        SkillsError::Io(err.to_string())
    }
}

// ─── Public types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SkillMetadata {
    pub id: String,
    pub category: String,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub display_name: BTreeMap<String, String>,
    pub description: BTreeMap<String, String>,
    pub bundled_hash: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillListItem {
    pub metadata: SkillMetadata,
    pub installed_centrally: bool,
    pub user_modified: bool,
    pub central_path: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillLinkState {
    NotLinked,
    Linked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallStatus {
    pub expert_id: String,
    pub agent_type: AgentType,
    pub state: SkillLinkState,
    pub link_path: String,
    pub expected_target_path: String,
}

/// Legacy alias for backward compatibility (used by office_tools.rs).
pub type ExpertInstallStatus = SkillInstallStatus;
/// Legacy alias for backward compatibility.
pub type ExpertLinkState = SkillLinkState;
/// Legacy alias for backward compatibility.
pub type ExpertListItem = SkillListItem;
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkOp {
    pub expert_id: String,
    pub agent_type: AgentType,
    pub enable: bool,
}

/// Per-op outcome of a batch apply.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkOpResult {
    pub expert_id: String,
    pub agent_type: AgentType,
    pub ok: bool,
    pub status: Option<SkillInstallStatus>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct InstallReport {
    pub installed_count: usize,
    pub updated_count: usize,
    pub pending_user_review: Vec<String>,
    pub errors: Vec<String>,
}

// ─── Skill bundle descriptor ────────────────────────────────────────────

/// Describes a skill bundle: where to find the embedded files and how to
/// identify this bundle's manifest and metadata.
pub struct SkillBundle {
    pub bundle: &'static Dir<'static>,
    pub manifest_name: &'static str,
    pub toml_name: &'static str,
    pub toml_array_name: &'static str,
    pub supported_agents: &'static [AgentType],
}

// ─── Manifest ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Manifest {
    #[serde(default)]
    veryagent_version: String,
    #[serde(default)]
    installed_at: String,
    #[serde(default)]
    skills: BTreeMap<String, ManifestEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ManifestEntry {
    #[serde(default)]
    hash: String,
    #[serde(default)]
    installed_at: String,
    #[serde(default)]
    pending_user_review: bool,
}

// ─── Concurrency ────────────────────────────────────────────────────────

fn mutation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

// ─── Paths ──────────────────────────────────────────────────────────────

fn home_dir_or_default() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub(crate) fn central_skills_dir() -> PathBuf {
    home_dir_or_default()
        .join(CENTRAL_DIR_NAME)
        .join(CENTRAL_SKILLS_SUBDIR)
}

/// Legacy alias for `central_skills_dir()`, used by office_tools.rs.
pub fn central_experts_dir() -> PathBuf {
    central_skills_dir()
}

fn manifest_path(bundle: &SkillBundle) -> PathBuf {
    central_skills_dir().join(bundle.manifest_name)
}

fn skill_central_path(skill_id: &str) -> PathBuf {
    central_skills_dir().join(skill_id)
}

fn agent_link_path(agent: AgentType, skill_id: &str) -> Result<PathBuf, SkillsError> {
    let dir = preferred_scope_skill_dir(agent, AgentSkillScope::Global, None)
        .map_err(|_| SkillsError::UnsupportedAgent(agent))?;
    Ok(dir.join(skill_id))
}

// ─── TOML parsing ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct TomlRoot {
    #[serde(default)]
    expert: Vec<TomlEntry>,
    #[serde(default)]
    science: Vec<TomlEntry>,
}

#[derive(Debug, Deserialize)]
struct TomlEntry {
    id: String,
    category: String,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    sort_order: i32,
    #[serde(default)]
    display_name: BTreeMap<String, String>,
    #[serde(default)]
    description: BTreeMap<String, String>,
}

fn load_bundled_metadata(bundle: &SkillBundle) -> &'static [SkillMetadata] {
    static METADATA: OnceLock<BTreeMap<String, Vec<SkillMetadata>>> = OnceLock::new();
    METADATA.get_or_init(|| {
        let mut map: BTreeMap<String, Vec<SkillMetadata>> = BTreeMap::new();
        // We'll load on demand per bundle, but since OnceLock is global,
        // we load all bundles at once on first access.
        map
    });

    // Load metadata for this specific bundle
    let result = load_bundled_metadata_inner(bundle);
    match result {
        Ok(list) => {
            // Store in static for caching
            let _ = list;
            // We can't easily cache per-bundle in a static, so we just
            // return the result directly. The callers will cache it.
            panic!("use cached_bundled_metadata instead");
        }
        Err(err) => {
            tracing::error!("[Skills] failed to load bundled metadata: {err}");
            &[]
        }
    }
}

/// Thread-safe cache for bundled metadata per bundle.
/// Key is the toml_name (e.g. "experts.toml").
fn cached_bundled_metadata(bundle: &SkillBundle) -> &'static Vec<SkillMetadata> {
    static METADATA_MAP: OnceLock<StdMutex<BTreeMap<String, Vec<SkillMetadata>>>> = OnceLock::new();
    let map = METADATA_MAP.get_or_init(|| StdMutex::new(BTreeMap::new()));
    let mut guard = map.lock().unwrap();
    if let Some(list) = guard.get(bundle.toml_name) {
        unsafe { &*(list as *const Vec<SkillMetadata>) }
    } else {
        match load_bundled_metadata_inner(bundle) {
            Ok(list) => {
                guard.insert(bundle.toml_name.to_string(), list);
                let entry = guard.get(bundle.toml_name).unwrap();
                unsafe { &*(entry as *const Vec<SkillMetadata>) }
            }
            Err(err) => {
                tracing::error!("[Skills] failed to load bundled metadata: {err}");
                guard.insert(bundle.toml_name.to_string(), Vec::new());
                let entry = guard.get(bundle.toml_name).unwrap();
                unsafe { &*(entry as *const Vec<SkillMetadata>) }
            }
        }
    }
}

fn load_bundled_metadata_inner(bundle: &SkillBundle) -> Result<Vec<SkillMetadata>, SkillsError> {
    let toml_file = bundle
        .bundle
        .get_file(bundle.toml_name)
        .ok_or_else(|| SkillsError::Metadata(format!("{} missing from bundle", bundle.toml_name)))?;
    let toml_str = toml_file
        .contents_utf8()
        .ok_or_else(|| SkillsError::Metadata(format!("{} is not valid UTF-8", bundle.toml_name)))?;
    let root: TomlRoot = toml::from_str(toml_str)
        .map_err(|e| SkillsError::Metadata(format!("failed to parse {}: {e}", bundle.toml_name)))?;

    // Pick the right array based on bundle
    let entries = match bundle.toml_array_name {
        "expert" => root.expert,
        "science" => root.science,
        _ => return Err(SkillsError::Metadata(format!("unknown array name: {}", bundle.toml_array_name))),
    };

    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let bundled_hash = hash_bundled_skill(bundle, &entry.id)?;
        out.push(SkillMetadata {
            id: entry.id,
            category: entry.category,
            icon: entry.icon,
            sort_order: entry.sort_order,
            display_name: entry.display_name,
            description: entry.description,
            bundled_hash,
        });
    }
    out.sort_by(|a, b| {
        a.sort_order
            .cmp(&b.sort_order)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(out)
}

fn find_metadata(bundle: &SkillBundle, skill_id: &str) -> Result<&'static SkillMetadata, SkillsError> {
    cached_bundled_metadata(bundle)
        .iter()
        .find(|m| m.id == skill_id)
        .ok_or_else(|| SkillsError::NotFound(skill_id.to_string()))
}

// ─── Hashing ────────────────────────────────────────────────────────────

fn hash_bundled_skill(bundle: &SkillBundle, skill_id: &str) -> Result<String, SkillsError> {
    let skill_dir = format!("skills/{skill_id}");
    let dir = bundle
        .bundle
        .get_dir(&skill_dir)
        .ok_or_else(|| SkillsError::NotFound(skill_id.to_string()))?;
    let mut files: Vec<(&str, &[u8])> = Vec::new();
    collect_bundle_files(dir, &mut files);
    files.sort_by_key(|(path, _)| *path);
    let mut hasher = Sha256::new();
    for (path, contents) in files {
        hasher.update(path.as_bytes());
        hasher.update(b"\0");
        hasher.update(contents);
        hasher.update(b"\0");
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn collect_bundle_files<'a>(dir: &'a Dir<'a>, out: &mut Vec<(&'a str, &'a [u8])>) {
    for entry in dir.entries() {
        match entry {
            DirEntry::File(f) => {
                let rel = f.path().to_str().unwrap_or("");
                out.push((rel, f.contents()));
            }
            DirEntry::Dir(d) => collect_bundle_files(d, out),
        }
    }
}

fn hash_disk_directory(path: &Path) -> Result<String, SkillsError> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    collect_disk_files(path, path, &mut files)?;
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = Sha256::new();
    for (rel_path, contents) in files {
        let logical = format!(
            "skills/{}/{}",
            path.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default(),
            rel_path
        );
        hasher.update(logical.as_bytes());
        hasher.update(b"\0");
        hasher.update(&contents);
        hasher.update(b"\0");
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn collect_disk_files(
    base: &Path,
    current: &Path,
    out: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), SkillsError> {
    if !current.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let child = entry.path();
        if file_type.is_dir() {
            collect_disk_files(base, &child, out)?;
        } else if file_type.is_file() {
            let rel = child
                .strip_prefix(base)
                .map_err(|e| SkillsError::Io(e.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            let contents = fs::read(&child)?;
            out.push((rel, contents));
        }
    }
    Ok(())
}

// ─── Manifest I/O ───────────────────────────────────────────────────────

fn load_manifest(bundle: &SkillBundle) -> Manifest {
    let path = manifest_path(bundle);
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<Manifest>(&content).unwrap_or_default(),
        Err(_) => Manifest::default(),
    }
}

fn save_manifest(bundle: &SkillBundle, manifest: &Manifest) -> Result<(), SkillsError> {
    let path = manifest_path(bundle);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let serialized = serde_json::to_string_pretty(manifest)
        .map_err(|e| SkillsError::Metadata(format!("failed to serialize manifest: {e}")))?;
    fs::write(&path, serialized)?;
    Ok(())
}

// ─── Copy operations ────────────────────────────────────────────────────

/// Recursively copy a directory from src to dst.
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if ft.is_file() {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Check if a path exists (indicating a skill is linked/enabled).
pub fn path_exists(path: &Path) -> bool {
    path.exists()
}

/// Alias for `path_exists`, used by code that was migrated from the old
/// `classify_link` / symlink-based API.
pub fn dir_exists(path: &Path) -> bool {
    path_exists(path)
}

// ─── Central store installation ─────────────────────────────────────────

pub async fn ensure_skills_installed(bundle: &SkillBundle) -> InstallReport {
    let _guard = mutation_lock().lock().await;
    let bundle_clone = SkillBundle {
        bundle: bundle.bundle,
        manifest_name: bundle.manifest_name,
        toml_name: bundle.toml_name,
        toml_array_name: bundle.toml_array_name,
        supported_agents: bundle.supported_agents,
    };
    tokio::task::spawn_blocking(move || ensure_installed_blocking(&bundle_clone))
        .await
        .unwrap_or_else(|e| {
            let mut r = InstallReport::default();
            r.errors.push(format!("join error: {e}"));
            r
        })
}

fn ensure_installed_blocking(bundle: &SkillBundle) -> InstallReport {
    let mut report = InstallReport::default();

    let central = central_skills_dir();
    if let Err(e) = fs::create_dir_all(&central) {
        report.errors.push(format!("failed to create central dir: {e}"));
        return report;
    }

    let mut manifest = load_manifest(bundle);
    let meta_list = cached_bundled_metadata(bundle);

    for meta in meta_list {
        match install_or_refresh_skill(bundle, meta, &mut manifest) {
            Ok(InstallAction::Skipped) => {}
            Ok(InstallAction::Installed) => report.installed_count += 1,
            Ok(InstallAction::Updated) => report.updated_count += 1,
            Ok(InstallAction::BackedUp) => {
                report.updated_count += 1;
                report.pending_user_review.push(meta.id.clone());
            }
            Err(e) => report.errors.push(format!("{}: {}", meta.id, e)),
        }
    }

    manifest.veryagent_version = env!("CARGO_PKG_VERSION").to_string();
    manifest.installed_at = Utc::now().to_rfc3339();
    if let Err(e) = save_manifest(bundle, &manifest) {
        report.errors.push(format!("save manifest: {e}"));
    }

    report
}

enum InstallAction {
    Skipped,
    Installed,
    Updated,
    BackedUp,
}

fn install_or_refresh_skill(
    bundle: &SkillBundle,
    meta: &SkillMetadata,
    manifest: &mut Manifest,
) -> Result<InstallAction, SkillsError> {
    let central_path = skill_central_path(&meta.id);
    let bundled_hash = &meta.bundled_hash;
    let manifest_entry = manifest.skills.get(&meta.id).cloned().unwrap_or_default();

    if central_path.exists() {
        let on_disk_hash = hash_disk_directory(&central_path).unwrap_or_default();
        if &on_disk_hash == bundled_hash {
            if manifest_entry.hash != *bundled_hash {
                manifest.skills.insert(
                    meta.id.clone(),
                    ManifestEntry {
                        hash: bundled_hash.clone(),
                        installed_at: Utc::now().to_rfc3339(),
                        pending_user_review: false,
                    },
                );
            }
            return Ok(InstallAction::Skipped);
        }

        let user_modified = manifest_entry.hash.is_empty() || on_disk_hash != manifest_entry.hash;
        if user_modified {
            let backup_name = format!(
                "{}.user-backup-{}",
                meta.id,
                Utc::now().format("%Y%m%d-%H%M%S")
            );
            let backup_path = central_skills_dir().join(backup_name);
            fs::rename(&central_path, &backup_path)?;
            extract_skill_to_disk(bundle, meta, &central_path)?;
            manifest.skills.insert(
                meta.id.clone(),
                ManifestEntry {
                    hash: bundled_hash.clone(),
                    installed_at: Utc::now().to_rfc3339(),
                    pending_user_review: true,
                },
            );
            return Ok(InstallAction::BackedUp);
        }

        // Pristine but outdated → overwrite.
        remove_skill_entry(&central_path)
            .map_err(|e| SkillsError::Io(format!("remove stale skill: {e}")))?;
        extract_skill_to_disk(bundle, meta, &central_path)?;
        manifest.skills.insert(
            meta.id.clone(),
            ManifestEntry {
                hash: bundled_hash.clone(),
                installed_at: Utc::now().to_rfc3339(),
                pending_user_review: false,
            },
        );
        Ok(InstallAction::Updated)
    } else {
        extract_skill_to_disk(bundle, meta, &central_path)?;
        manifest.skills.insert(
            meta.id.clone(),
            ManifestEntry {
                hash: bundled_hash.clone(),
                installed_at: Utc::now().to_rfc3339(),
                pending_user_review: false,
            },
        );
        Ok(InstallAction::Installed)
    }
}

fn extract_skill_to_disk(
    bundle: &SkillBundle,
    meta: &SkillMetadata,
    target: &Path,
) -> Result<(), SkillsError> {
    let skill_rel = format!("skills/{}", meta.id);
    let dir = bundle
        .bundle
        .get_dir(&skill_rel)
        .ok_or_else(|| SkillsError::NotFound(meta.id.clone()))?;
    fs::create_dir_all(target)?;
    extract_bundle_dir(dir, &skill_rel, target)?;
    Ok(())
}

fn extract_bundle_dir(
    dir: &Dir<'_>,
    bundle_prefix: &str,
    target: &Path,
) -> Result<(), SkillsError> {
    for entry in dir.entries() {
        match entry {
            DirEntry::File(f) => {
                let rel = f
                    .path()
                    .to_str()
                    .ok_or_else(|| SkillsError::Io("non-utf8 path in bundle".into()))?;
                let rel_within = rel
                    .strip_prefix(bundle_prefix)
                    .and_then(|s| s.strip_prefix('/'))
                    .unwrap_or(rel);
                let out_path = target.join(rel_within);
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&out_path, f.contents())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if f.contents().starts_with(b"#!") {
                        let mut perms = fs::metadata(&out_path)?.permissions();
                        perms.set_mode(perms.mode() | 0o111);
                        fs::set_permissions(&out_path, perms)?;
                    }
                }
            }
            DirEntry::Dir(d) => {
                extract_bundle_dir(d, bundle_prefix, target)?;
            }
        }
    }
    Ok(())
}

// ─── Commands: list / status ────────────────────────────────────────────

pub fn list_skills(bundle: &SkillBundle) -> Result<Vec<SkillListItem>, SkillsError> {
    let meta_list = cached_bundled_metadata(bundle).to_vec();
    let manifest = load_manifest(bundle);
    let mut out = Vec::with_capacity(meta_list.len());
    for meta in meta_list {
        let central_path = skill_central_path(&meta.id);
        let installed_centrally = central_path.exists();
        let user_modified = manifest
            .skills
            .get(&meta.id)
            .map(|e| e.pending_user_review)
            .unwrap_or(false);
        out.push(SkillListItem {
            metadata: meta,
            installed_centrally,
            user_modified,
            central_path: central_path.to_string_lossy().to_string(),
        });
    }
    Ok(out)
}

pub fn get_install_status(
    bundle: &SkillBundle,
    skill_id: &str,
) -> Result<Vec<SkillInstallStatus>, SkillsError> {
    let skill_id =
        validate_skill_id(skill_id).map_err(|e| SkillsError::Metadata(e.to_string()))?;
    let _ = find_metadata(bundle, &skill_id)?;
    let agents = bundle.supported_agents;

    let mut out = Vec::with_capacity(agents.len());
    for agent in agents {
        if skill_storage_spec(*agent).is_none() {
            continue;
        }
        let link_path = match agent_link_path(*agent, &skill_id) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let state = if path_exists(&link_path) {
            SkillLinkState::Linked
        } else {
            SkillLinkState::NotLinked
        };
        out.push(SkillInstallStatus {
            expert_id: skill_id.clone(),
            agent_type: *agent,
            state,
            link_path: link_path.to_string_lossy().to_string(),
            expected_target_path: String::new(),
        });
    }
    Ok(out)
}

// ─── Commands: link / unlink ────────────────────────────────────────────

pub fn link_skill(
    bundle: &SkillBundle,
    skill_id: &str,
    agent_type: AgentType,
) -> Result<SkillInstallStatus, SkillsError> {
    let skill_id =
        validate_skill_id(skill_id).map_err(|e| SkillsError::Metadata(e.to_string()))?;
    let _ = find_metadata(bundle, &skill_id)?;
    let central = skill_central_path(&skill_id);
    if !central.exists() {
        return Err(SkillsError::CentralUnavailable(format!(
            "skill '{skill_id}' is not installed in central store"
        )));
    }

    let link_path = agent_link_path(agent_type, &skill_id)?;
    if let Some(parent) = link_path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Remove existing directory if present, then copy fresh.
    if link_path.exists() {
        fs::remove_dir_all(&link_path)?;
    }
    copy_dir_recursive(&central, &link_path)?;

    Ok(SkillInstallStatus {
        expert_id: skill_id.clone(),
        agent_type,
        state: SkillLinkState::Linked,
        link_path: link_path.to_string_lossy().to_string(),
        expected_target_path: central.to_string_lossy().to_string(),
    })
}

pub fn unlink_skill(skill_id: &str, agent_type: AgentType) -> Result<(), SkillsError> {
    let skill_id =
        validate_skill_id(skill_id).map_err(|e| SkillsError::Metadata(e.to_string()))?;

    let dirs = scoped_skill_dirs(agent_type, AgentSkillScope::Global, None)
        .map_err(|_| SkillsError::UnsupportedAgent(agent_type))?;

    for dir in dirs {
        let candidate = dir.join(&skill_id);
        if candidate.exists() {
            fs::remove_dir_all(&candidate)?;
        }
    }
    Ok(())
}

pub fn apply_links(
    bundle: &SkillBundle,
    ops: Vec<LinkOp>,
) -> Result<Vec<LinkOpResult>, SkillsError> {
    let mut out = Vec::with_capacity(ops.len());
    for op in ops {
        let LinkOp { expert_id, agent_type, enable } = op;
        let res = if enable {
            link_skill(bundle, &expert_id, agent_type).map(Some)
        } else {
            unlink_skill(&expert_id, agent_type).map(|()| None)
        };
        out.push(match res {
            Ok(status) => LinkOpResult {
                expert_id,
                agent_type,
                ok: true,
                status,
                error: None,
            },
            Err(err) => LinkOpResult {
                expert_id,
                agent_type,
                ok: false,
                status: None,
                error: Some(err.to_string()),
            },
        });
    }
    Ok(out)
}

pub fn list_all_install_statuses(
    bundle: &SkillBundle,
) -> Result<Vec<SkillInstallStatus>, SkillsError> {
    let agents = bundle.supported_agents;
    let mut out = Vec::with_capacity(cached_bundled_metadata(bundle).len() * agents.len());
    for meta in cached_bundled_metadata(bundle).iter() {
        for agent in agents {
            if skill_storage_spec(*agent).is_none() {
                continue;
            }
            let link_path = match agent_link_path(*agent, &meta.id) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let state = if path_exists(&link_path) {
                SkillLinkState::Linked
            } else {
                SkillLinkState::NotLinked
            };
            out.push(SkillInstallStatus {
                expert_id: meta.id.clone(),
                agent_type: *agent,
                state,
                link_path: link_path.to_string_lossy().to_string(),
                expected_target_path: String::new(),
            });
        }
    }
    Ok(out)
}

// ─── Commands: read / open ──────────────────────────────────────────────

pub fn read_skill_content(bundle: &SkillBundle, skill_id: &str) -> Result<String, SkillsError> {
    let skill_id =
        validate_skill_id(skill_id).map_err(|e| SkillsError::Metadata(e.to_string()))?;
    let _ = find_metadata(bundle, &skill_id)?;
    let path = skill_central_path(&skill_id).join("SKILL.md");
    if !path.exists() {
        let bundled_rel = format!("skills/{skill_id}/SKILL.md");
        if let Some(f) = bundle.bundle.get_file(&bundled_rel) {
            if let Some(text) = f.contents_utf8() {
                return Ok(text.to_string());
            }
        }
        return Err(SkillsError::CentralUnavailable(format!(
            "skill '{skill_id}' has no SKILL.md on disk"
        )));
    }
    let content = fs::read_to_string(&path)?;
    Ok(content)
}

pub fn open_central_dir() -> Result<String, SkillsError> {
    let dir = central_skills_dir();
    fs::create_dir_all(&dir)?;
    Ok(dir.to_string_lossy().to_string())
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_exists() {
        assert!(path_exists(Path::new("/")));
        assert!(!path_exists(Path::new("/nonexistent-path-xyz-123")));
    }
}