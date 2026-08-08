//! 学术技能 — 薄包装，委托给 `skills.rs`
//!
//! 维护与旧前端兼容的 Tauri 命令签名，实际逻辑在 skills.rs。

use include_dir::{include_dir, Dir};

use crate::commands::skills::{
    apply_links, ensure_skills_installed, get_install_status, link_skill,
    list_all_install_statuses, list_skills, open_central_dir, read_skill_content, unlink_skill,
    SkillBundle, SkillInstallStatus, SkillListItem,
};
use crate::models::agent::AgentType;

// ─── Embedded bundle ────────────────────────────────────────────────────

static SCIENCE_BUNDLE: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/science");

fn bundle() -> SkillBundle {
    SkillBundle {
        bundle: &SCIENCE_BUNDLE,
        manifest_name: ".manifest.science.json",
        toml_name: "science.toml",
        toml_array_name: "science",
        supported_agents: &SUPPORTED_AGENTS,
    }
}

const SUPPORTED_AGENTS: &[AgentType] = &[
    AgentType::ClaudeCode,
    AgentType::Codex,
    AgentType::OpenCode,
    AgentType::Gemini,
    AgentType::Cline,
    AgentType::Hermes,
    AgentType::KimiCode,
    AgentType::Pi,
];

// ─── Re-exports ─────────────────────────────────────────────────────────

pub use crate::commands::skills::{
    SkillInstallStatus as ScienceInstallStatus,
    SkillLinkState as ScienceLinkState,
    SkillListItem as ScienceListItem,
    SkillsError as ScienceError,
    LinkOp, LinkOpResult, InstallReport,
};

// ─── Tauri commands ─────────────────────────────────────────────────────

pub async fn ensure_central_science_installed() -> InstallReport {
    ensure_skills_installed(&bundle()).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn science_list() -> Result<Vec<SkillListItem>, ScienceError> {
    list_skills(&bundle())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn science_get_install_status(
    skill_id: String,
) -> Result<Vec<SkillInstallStatus>, ScienceError> {
    get_install_status(&bundle(), &skill_id)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn science_list_all_install_statuses() -> Result<Vec<SkillInstallStatus>, ScienceError> {
    list_all_install_statuses(&bundle())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn science_link_to_agent(
    skill_id: String,
    agent_type: AgentType,
) -> Result<SkillInstallStatus, ScienceError> {
    link_skill(&bundle(), &skill_id, agent_type)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn science_unlink_from_agent(
    skill_id: String,
    agent_type: AgentType,
) -> Result<(), ScienceError> {
    unlink_skill(&skill_id, agent_type)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn science_apply_links(ops: Vec<LinkOp>) -> Result<Vec<LinkOpResult>, ScienceError> {
    apply_links(&bundle(), ops)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn science_read_content(skill_id: String) -> Result<String, ScienceError> {
    read_skill_content(&bundle(), &skill_id)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn science_open_central_dir() -> Result<String, ScienceError> {
    open_central_dir()
}