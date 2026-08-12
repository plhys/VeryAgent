//! 智能体「检测 / 修复」诊断引擎。
//!
//! 在 preflight 的基础之上，把「这台机器上智能体能不能用」的完整画面
//! 聚合给前端，并支持一键自动修复：
//!
//! - `acp_diagnose_agent` / `acp_diagnose_all_agents` — 分层检测：
//!   运行时依赖（node/npm/uv，来自 preflight）+ 安装态 + 配置解析 +
//!   鉴权缺失（warn）+ OpenClaw gateway 探活。
//! - `acp_repair_agent_config` — 配置损坏时从应用状态重建（先备份）。
//! - `acp_ensure_npm_path` — 把用户级 npm 前缀补进 PATH。
//!
//! 修复动作与设置页现有逐项修复复用同一套 `FixActionKind`，前端「修复全部」
//! 只是把这些动作按顺序批量执行。

use serde::Serialize;

use crate::acp::agent_runtime::ConfigRenderer;
use crate::acp::error::AcpError;
use crate::acp::preflight::{self, CheckItem, CheckStatus, FixAction, FixActionKind};
use crate::acp::registry;
use crate::db::AppDatabase;
use crate::db::service::agent_setting_service;
use crate::models::agent::AgentType;

/// 单个智能体的完整诊断结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AgentDiagnosis {
    pub agent_type: AgentType,
    pub agent_name: String,
    pub passed: bool,
    pub checks: Vec<CheckItem>,
    /// 一句话汇总，如 "2 issues (1 fixable) · 5 pass · 1 warn"。
    pub summary: String,
}

pub(crate) async fn diagnose_agent_core(
    db: &AppDatabase,
    agent_type: AgentType,
) -> Result<AgentDiagnosis, AcpError> {
    let meta = registry::get_agent_meta(agent_type);
    let preflight = preflight::run_preflight(agent_type).await;
    let mut checks = preflight.checks;

    // 鉴权缺失（warn，不 fail）：
    // 用与真实连接一致的 env 解析逻辑（跳过 disabled 闸门与 OpenClaw gateway
    // ensure），检查该 agent 的 api-key 槽位是否为空且未绑定模型供应商。
    // 只提示不阻断——应用看不到原生登录（如 `claude login`、Pi 的 models.json），
    // 用户若走原生登录可忽略该警告。
    if !matches!(agent_type, AgentType::OpenClaw | AgentType::CommandCode) {
        let setting = agent_setting_service::get_by_agent_type(&db.conn, agent_type)
            .await
            .map_err(|e| AcpError::protocol(e.to_string()))?;
        let local_config_json = crate::commands::acp::load_agent_local_config_json(agent_type);
        let mut runtime_env = crate::commands::acp::build_runtime_env_from_setting(
            agent_type,
            setting.as_ref(),
            local_config_json.as_deref(),
        );
        crate::commands::acp::apply_model_provider_env(
            agent_type,
            setting.as_ref(),
            &mut runtime_env,
            &db.conn,
        )
        .await;

        let bound_provider = setting
            .as_ref()
            .and_then(|s| s.model_provider_id)
            .is_some();
        let (_, api_key_key, _) = crate::commands::acp::general::agent_env_keys(agent_type);
        let has_credential = runtime_env
            .get(api_key_key)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);

        if !bound_provider && !has_credential {
            checks.push(CheckItem {
                check_id: "auth_configured".into(),
                label: "Credentials".into(),
                status: CheckStatus::Warn,
                message: format!(
                    "{} has no API key and no bound model provider. Connect may fail until you \
                     configure it below (or sign in with a native login and ignore this).",
                    meta.name
                ),
                fixes: vec![],
            });
        }
    }

    // OpenClaw：gateway 探活（与 ensure 按钮共用同一探针）。
    if agent_type == AgentType::OpenClaw {
        let discovery = crate::commands::acp::discover_openclaw_gateway_core().await;
        let reachable = discovery.gateway_reachable;
        let url = discovery.gateway_url.clone().unwrap_or_default();
        checks.push(CheckItem {
            check_id: "gateway_reachable".into(),
            label: "OpenClaw Gateway".into(),
            status: if reachable {
                CheckStatus::Pass
            } else {
                CheckStatus::Fail
            },
            message: if reachable {
                format!("OpenClaw Gateway is reachable at {url}.")
            } else {
                "OpenClaw Gateway is not reachable. Click 'Ensure Gateway' to start it.".into()
            },
            fixes: if reachable {
                vec![]
            } else {
                vec![FixAction {
                    label: "Ensure Gateway".into(),
                    kind: FixActionKind::EnsureOpenClawGateway,
                    payload: String::new(),
                }]
            },
        });
    }

    let passed = checks
        .iter()
        .all(|c| !matches!(c.status, CheckStatus::Fail));
    let summary = summarize(&checks);
    Ok(AgentDiagnosis {
        agent_type,
        agent_name: meta.name.to_string(),
        passed,
        checks,
        summary,
    })
}

fn summarize(checks: &[CheckItem]) -> String {
    let fails = checks
        .iter()
        .filter(|c| matches!(c.status, CheckStatus::Fail))
        .count();
    let warns = checks
        .iter()
        .filter(|c| matches!(c.status, CheckStatus::Warn))
        .count();
    let passes = checks
        .iter()
        .filter(|c| matches!(c.status, CheckStatus::Pass))
        .count();
    let fixable = checks
        .iter()
        .filter(|c| !matches!(c.status, CheckStatus::Pass) && !c.fixes.is_empty())
        .count();
    if fails == 0 && warns == 0 {
        format!("{passes} checks · all pass")
    } else if fails == 0 {
        format!("{passes} pass · {warns} warn")
    } else {
        format!("{fails} issue(s) ({fixable} fixable) · {passes} pass · {warns} warn")
    }
}

/// 重建损坏的原生配置文件：从数据库 env + 模型供应商级联构建运行时环境，
/// 交给 `ConfigRenderer::render_for_agent` 重新渲染（覆写前自动备份到
/// `~/.veryagent/config-backups/`）。
pub(crate) async fn repair_agent_config_core(
    db: &AppDatabase,
    agent_type: AgentType,
) -> Result<(), AcpError> {
    let setting = agent_setting_service::get_by_agent_type(&db.conn, agent_type)
        .await
        .map_err(|e| AcpError::protocol(e.to_string()))?;
    let local_config_json = crate::commands::acp::load_agent_local_config_json(agent_type);
    let mut runtime_env = crate::commands::acp::build_runtime_env_from_setting(
        agent_type,
        setting.as_ref(),
        local_config_json.as_deref(),
    );
    crate::commands::acp::apply_model_provider_env(
        agent_type,
        setting.as_ref(),
        &mut runtime_env,
        &db.conn,
    )
    .await;
    ConfigRenderer::render_for_agent(agent_type, &runtime_env).await
}

/// 确保用户级 npm 前缀在 PATH 中（用于 npm 回退安装后命令可解析）。
pub(crate) fn ensure_npm_path_core() -> Result<(), AcpError> {
    crate::process::ensure_user_npm_prefix_in_path();
    Ok(())
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_diagnose_agent(
    agent_type: AgentType,
    db: tauri::State<'_, AppDatabase>,
) -> Result<AgentDiagnosis, AcpError> {
    diagnose_agent_core(&db, agent_type).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_diagnose_all_agents(
    db: tauri::State<'_, AppDatabase>,
) -> Result<Vec<AgentDiagnosis>, AcpError> {
    let mut out = Vec::new();
    for agent_type in registry::all_acp_agents() {
        out.push(diagnose_agent_core(&db, agent_type).await?);
    }
    Ok(out)
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_repair_agent_config(
    agent_type: AgentType,
    db: tauri::State<'_, AppDatabase>,
) -> Result<(), AcpError> {
    repair_agent_config_core(&db, agent_type).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn acp_ensure_npm_path() -> Result<(), AcpError> {
    ensure_npm_path_core()
}
