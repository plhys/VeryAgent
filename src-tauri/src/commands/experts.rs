//! 专家技能 — 薄包装，委托给 `skills.rs`
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

static EXPERTS_BUNDLE: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/experts");

fn bundle() -> SkillBundle {
    SkillBundle {
        bundle: &EXPERTS_BUNDLE,
        manifest_name: ".manifest.json",
        toml_name: "experts.toml",
        toml_array_name: "expert",
        supported_agents: &SUPPORTED_AGENTS,
    }
}

const SUPPORTED_AGENTS: &[AgentType] = &[
    AgentType::ClaudeCode,
    AgentType::Codex,
    AgentType::OpenCode,
    AgentType::Gemini,
    AgentType::OpenClaw,
    AgentType::Cline,
    AgentType::Hermes,
    AgentType::CodeBuddy,
    AgentType::KimiCode,
    AgentType::Pi,
];

// ─── Re-exports ─────────────────────────────────────────────────────────

pub use crate::commands::skills::{
    copy_dir_recursive, dir_exists, path_exists, central_experts_dir,
    SkillInstallStatus as ExpertInstallStatus,
    SkillLinkState as ExpertLinkState,
    SkillListItem as ExpertListItem,
    SkillsError as ExpertsError,
    LinkOp, LinkOpResult, InstallReport,
};

// ─── Tauri commands ─────────────────────────────────────────────────────

pub async fn ensure_central_experts_installed() -> InstallReport {
    ensure_skills_installed(&bundle()).await
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn experts_list() -> Result<Vec<SkillListItem>, ExpertsError> {
    list_skills(&bundle())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn experts_get_install_status(
    expert_id: String,
) -> Result<Vec<SkillInstallStatus>, ExpertsError> {
    get_install_status(&bundle(), &expert_id)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn experts_list_all_install_statuses() -> Result<Vec<SkillInstallStatus>, ExpertsError> {
    list_all_install_statuses(&bundle())
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn experts_link_to_agent(
    expert_id: String,
    agent_type: AgentType,
) -> Result<SkillInstallStatus, ExpertsError> {
    link_skill(&bundle(), &expert_id, agent_type)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn experts_unlink_from_agent(
    expert_id: String,
    agent_type: AgentType,
) -> Result<(), ExpertsError> {
    unlink_skill(&expert_id, agent_type)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn experts_apply_links(ops: Vec<LinkOp>) -> Result<Vec<LinkOpResult>, ExpertsError> {
    apply_links(&bundle(), ops)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn experts_read_content(expert_id: String) -> Result<String, ExpertsError> {
    read_skill_content(&bundle(), &expert_id)
}

#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn experts_open_central_dir() -> Result<String, ExpertsError> {
    open_central_dir()
}