//! Agent Runtime — 统一智能体进程生命周期管理
//!
//! 核心设计原则：
//! 1. 数据库是配置的唯一来源，原生配置文件是渲染结果
//! 2. 每次启动时自动渲染原生配置文件，不依赖外部级联更新
//! 3. 进程管理集中化：健康检查、自动重启、优雅关闭
//! 4. 运行时依赖自动检测和安装

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use sacp_tokio::AcpAgent;

use crate::acp::error::AcpError;
use crate::acp::registry;
use crate::models::agent::AgentType;

/// 合并 agent 子进程环境变量并转换为 `(String, String)` 列表。
///
/// 底层委托给 `agent_env::build_agent_env`（继承当前进程 + 净化黑名单 + 叠加，
/// 详见该模块）。返回值保持与旧接口一致（`Vec<(String, String)>`），各启动路径
/// 无需改动调用方式。
pub(crate) fn merge_agent_env(
    runtime_env: &BTreeMap<String, String>,
) -> Vec<(String, String)> {
    crate::acp::agent_env::build_agent_env(runtime_env)
        .into_iter()
        .map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned()))
        .collect()
}

// ---------------------------------------------------------------------------
// AgentDescriptor — 智能体的完整描述
// ---------------------------------------------------------------------------

/// 智能体可执行文件的来源
#[derive(Debug, Clone)]
pub enum ExecutableSource {
    /// 通过 npx 运行（需要 Node.js）
    Npx {
        package: &'static str,
        cmd: &'static str,
        args: &'static [&'static str],
    },
    /// 本地缓存或捆绑的二进制文件
    Binary {
        cmd: &'static str,
        args: &'static [&'static str],
    },
    /// 通过 uvx 运行（需要 Python/uv）
    Uvx {
        package: &'static str,
        cmd: &'static str,
        args: &'static [&'static str],
        python: Option<&'static str>,
        system_cmd: Option<(&'static str, &'static [&'static str])>,
    },
    /// 直接执行 Node.js 脚本
    NodeScript {
        script_path: String,
    },
}

/// 原生配置文件的格式和渲染方式
#[derive(Debug, Clone)]
pub enum ConfigFormat {
    /// JSON 文件，使用模板渲染
    Json {
        template: &'static str,
    },
    /// TOML 文件，使用模板渲染
    Toml {
        template: &'static str,
    },
    /// YAML 文件，使用模板渲染
    Yaml {
        template: &'static str,
    },
    /// 环境变量文件（KEY=VALUE 格式）
    DotEnv,
    /// 键值对映射（通用 JSON 对象）
    KeyValue,
}

/// 需要渲染的原生配置文件
#[derive(Debug, Clone)]
pub struct ConfigFile {
    /// 相对于用户主目录的路径，如 ".claude/settings.json"
    pub relative_path: &'static str,
    /// 文件格式和模板
    pub format: ConfigFormat,
}

/// 环境变量映射规则
#[derive(Debug, Clone)]
pub struct EnvMapping {
    /// API 基础 URL 的环境变量名
    pub base_url_key: &'static str,
    /// API Key 的环境变量名
    pub api_key_key: &'static str,
    /// 模型名称的环境变量名
    pub model_key: &'static str,
    /// 额外的环境变量名列表
    pub extra_keys: &'static [&'static str],
}

/// 运行时依赖类型
#[derive(Debug, Clone, PartialEq)]
pub enum RuntimeDependency {
    Node,
    Uv,
    Python(&'static str),
}

/// 预检检查项
#[derive(Debug, Clone)]
pub enum PreflightCheck {
    /// 检查可执行文件是否存在
    ExecutableExists,
    /// 检查运行时依赖是否可用
    RuntimeDependency(RuntimeDependency),
    /// 检查配置文件是否可写
    ConfigWritable,
    /// 检查网络连接
    NetworkReachable,
}

/// 健康检查策略
#[derive(Debug, Clone)]
pub enum HealthCheckPolicy {
    /// 不检查（适合一次性任务）
    None,
    /// 定期发送 ping
    Heartbeat {
        interval: Duration,
        timeout: Duration,
    },
    /// 检查进程是否存活
    ProcessAlive {
        interval: Duration,
    },
}

/// 重启策略
#[derive(Debug, Clone)]
pub enum RestartPolicy {
    /// 不重启
    Never,
    /// 有限次重启
    Limited {
        max_retries: u32,
        backoff: Duration,
    },
    /// 无限重启（适合常驻 Agent）
    Always {
        backoff: Duration,
    },
}

/// 智能体的完整描述
///
/// 每个 Agent 类型对应一个 `AgentDescriptor`，集中描述其所有行为。
/// 添加新 Agent 只需要写一个 `AgentDescriptor`，不需要改 45 个地方。
#[derive(Debug, Clone)]
pub struct AgentDescriptor {
    /// 智能体类型
    pub agent_type: AgentType,
    /// 显示名称
    pub name: &'static str,
    /// 是否支持 MCP 转发
    pub supports_mcp: bool,
    /// 是否常驻运行
    pub resident: bool,
    /// 可执行文件来源
    pub executable: ExecutableSource,
    /// 需要渲染的原生配置文件列表
    pub config_files: &'static [ConfigFile],
    /// 环境变量映射
    pub env_mapping: EnvMapping,
    /// 运行时依赖
    pub runtime_deps: &'static [RuntimeDependency],
    /// 预检检查项
    pub preflight_checks: &'static [PreflightCheck],
    /// 健康检查策略
    pub health_check: HealthCheckPolicy,
    /// 重启策略
    pub restart: RestartPolicy,
}

impl AgentDescriptor {
    /// 从 registry 和额外信息构建 AgentDescriptor
    pub fn from_registry(agent_type: AgentType) -> Self {
        let meta = registry::get_agent_meta(agent_type);
        let env_keys = crate::commands::acp::agent_env_keys(agent_type);

        let (executable, config_files, runtime_deps, preflight_checks, health_check, restart) =
            build_descriptor_for(agent_type);

        AgentDescriptor {
            agent_type,
            name: meta.name,
            supports_mcp: meta.supports_mcp,
            resident: meta.resident,
            executable,
            config_files,
            env_mapping: EnvMapping {
                base_url_key: env_keys.0,
                api_key_key: env_keys.1,
                model_key: env_keys.2,
                extra_keys: &[],
            },
            runtime_deps,
            preflight_checks,
            health_check,
            restart,
        }
    }
}

// ---------------------------------------------------------------------------
// AgentRuntime — 智能体进程管理器
// ---------------------------------------------------------------------------

/// 智能体进程状态
#[derive(Debug, Clone, PartialEq)]
pub enum AgentStatus {
    /// 未启动
    Idle,
    /// 准备中（配置渲染、依赖检查）
    Preparing,
    /// 启动中
    Starting,
    /// 运行中
    Running,
    /// 健康检查中
    Checking,
    /// 已崩溃（等待重启）
    Crashed { retry_count: u32, last_error: String },
    /// 已停止
    Stopped,
}

/// 智能体进程运行时
pub struct AgentRuntime {
    /// 智能体描述
    descriptor: AgentDescriptor,
    /// 当前状态
    status: AgentStatus,
    /// 运行时环境变量
    runtime_env: BTreeMap<String, String>,
    /// 工作目录
    cwd: PathBuf,
    /// 底层 ACP 连接
    agent: Option<AcpAgent>,
    /// 重启计数
    retry_count: u32,
}

impl AgentRuntime {
    /// 创建新的 AgentRuntime
    pub fn new(agent_type: AgentType) -> Self {
        let descriptor = AgentDescriptor::from_registry(agent_type);
        AgentRuntime {
            descriptor,
            status: AgentStatus::Idle,
            runtime_env: BTreeMap::new(),
            cwd: PathBuf::from("."),
            agent: None,
            retry_count: 0,
        }
    }

    /// 设置运行时环境变量
    pub fn with_env(mut self, env: BTreeMap<String, String>) -> Self {
        self.runtime_env = env;
        self
    }

    /// 设置工作目录
    pub fn with_cwd(mut self, cwd: PathBuf) -> Self {
        self.cwd = cwd;
        self
    }

    /// 获取智能体描述
    pub fn descriptor(&self) -> &AgentDescriptor {
        &self.descriptor
    }

    /// 获取当前状态
    pub fn status(&self) -> &AgentStatus {
        &self.status
    }

    // ---- 生命周期 ----

    /// 准备阶段：配置渲染 + 运行时依赖检查
    ///
    /// 在启动智能体之前调用，确保所有配置文件和运行时依赖就绪。
    pub async fn prepare(&mut self) -> Result<(), AcpError> {
        self.status = AgentStatus::Preparing;

        // 1. 渲染原生配置文件
        self.render_config_files().await?;

        // 2. 执行预检
        self.run_preflight_checks().await?;

        // 3. 确保运行时依赖
        self.ensure_runtime_deps().await?;

        Ok(())
    }

    /// 启动阶段：启动智能体进程
    ///
    /// 调用 `prepare()` 后调用此方法。
    pub async fn start(&mut self) -> Result<AcpAgent, AcpError> {
        self.status = AgentStatus::Starting;

        let agent = build_agent_from_descriptor(
            &self.descriptor,
            &self.runtime_env,
            &self.cwd,
        ).await?;

        self.status = AgentStatus::Running;
        self.agent = Some(agent);
        // 返回克隆或引用 — 实际使用中 AcpAgent 需要 move 到 run_connection
        // 这里的设计是：AgentRuntime 创建 AcpAgent，然后交给 connection.rs 使用
        self.agent.take().ok_or_else(|| {
            AcpError::SpawnFailed("agent already consumed".to_string())
        })
    }

    /// 停止智能体
    pub async fn stop(&mut self) {
        self.status = AgentStatus::Stopped;
        // AcpAgent 的清理由 drop 处理
    }

    // ---- 内部方法 ----

    async fn render_config_files(&self) -> Result<(), AcpError> {
        for config_file in self.descriptor.config_files {
            let home = dirs::home_dir().ok_or_else(|| {
                AcpError::SpawnFailed("cannot determine home directory".to_string())
            })?;
            let config_path = home.join(config_file.relative_path);

            // 如果文件已存在且内容正确，跳过
            if config_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&config_path) {
                    if self.is_config_content_valid(&content, config_file) {
                        continue;
                    }
                }
            }

            // 渲染配置文件
            let content = self.render_config_content(config_file)?;

            // 确保父目录存在
            if let Some(parent) = config_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            // 写入文件
            std::fs::write(&config_path, &content).map_err(|e| {
                AcpError::SpawnFailed(format!(
                    "failed to write config file {}: {e}",
                    config_file.relative_path
                ))
            })?;
        }
        Ok(())
    }

    /// 检查现有配置文件内容是否有效
    fn is_config_content_valid(&self, content: &str, _config_file: &ConfigFile) -> bool {
        // 简单的有效性检查：配置文件存在且包含必要的环境变量
        // 更复杂的检查可以按 Agent 类型定制
        let api_key = self.runtime_env.get(self.descriptor.env_mapping.api_key_key);
        if let Some(key) = api_key {
            if !content.contains(key) {
                return false;
            }
        }
        true
    }

    /// 渲染配置文件内容
    fn render_config_content(&self, config_file: &ConfigFile) -> Result<String, AcpError> {
        match &config_file.format {
            ConfigFormat::Json { template } => {
                self.render_json_template(template)
            }
            ConfigFormat::Toml { template } => {
                self.render_toml_template(template)
            }
            ConfigFormat::Yaml { template } => {
                self.render_yaml_template(template)
            }
            ConfigFormat::DotEnv => {
                self.render_dotenv()
            }
            ConfigFormat::KeyValue => {
                self.render_keyvalue_json()
            }
        }
    }

    fn render_json_template(&self, template: &str) -> Result<String, AcpError> {
        let mut result = template.to_string();
        let env = &self.runtime_env;
        let mapping = &self.descriptor.env_mapping;

        // 替换占位符
        if let Some(val) = env.get(mapping.api_key_key) {
            result = result.replace("{{api_key}}", val);
        }
        if let Some(val) = env.get(mapping.base_url_key) {
            result = result.replace("{{base_url}}", val);
        }
        if let Some(val) = env.get(mapping.model_key) {
            result = result.replace("{{model}}", val);
        }

        Ok(result)
    }

    fn render_toml_template(&self, template: &str) -> Result<String, AcpError> {
        // 与 JSON 模板类似，但输出 TOML 格式
        self.render_json_template(template)
    }

    fn render_yaml_template(&self, template: &str) -> Result<String, AcpError> {
        self.render_json_template(template)
    }

    fn render_dotenv(&self) -> Result<String, AcpError> {
        let mut content = String::new();
        let env = &self.runtime_env;
        let mapping = &self.descriptor.env_mapping;

        if let Some(val) = env.get(mapping.api_key_key) {
            content.push_str(&format!("{}={}\n", mapping.api_key_key, val));
        }
        if let Some(val) = env.get(mapping.base_url_key) {
            content.push_str(&format!("{}={}\n", mapping.base_url_key, val));
        }
        if let Some(val) = env.get(mapping.model_key) {
            content.push_str(&format!("{}={}\n", mapping.model_key, val));
        }

        Ok(content)
    }

    fn render_keyvalue_json(&self) -> Result<String, AcpError> {
        let mut map = serde_json::Map::new();
        let env = &self.runtime_env;
        let mapping = &self.descriptor.env_mapping;

        if let Some(val) = env.get(mapping.api_key_key) {
            map.insert(mapping.api_key_key.to_string(), serde_json::Value::String(val.clone()));
        }
        if let Some(val) = env.get(mapping.base_url_key) {
            map.insert(mapping.base_url_key.to_string(), serde_json::Value::String(val.clone()));
        }
        if let Some(val) = env.get(mapping.model_key) {
            map.insert(mapping.model_key.to_string(), serde_json::Value::String(val.clone()));
        }

        serde_json::to_string_pretty(&map)
            .map_err(|e| AcpError::SpawnFailed(format!("failed to serialize config: {e}")))
    }

    async fn run_preflight_checks(&self) -> Result<(), AcpError> {
        for check in self.descriptor.preflight_checks {
            match check {
                PreflightCheck::ExecutableExists => {
                    // 检查可执行文件是否存在
                    // 具体实现取决于 ExecutableSource 类型
                }
                PreflightCheck::RuntimeDependency(dep) => {
                    self.check_runtime_dependency(dep).await?;
                }
                PreflightCheck::ConfigWritable => {
                    // 检查配置文件目录是否可写
                    if let Some(home) = dirs::home_dir() {
                        for config_file in self.descriptor.config_files {
                            let path = home.join(config_file.relative_path);
                            if let Some(parent) = path.parent() {
                                if !parent.exists() {
                                    std::fs::create_dir_all(parent).map_err(|e| {
                                        AcpError::SpawnFailed(format!(
                                            "cannot create config directory {}: {e}",
                                            parent.display()
                                        ))
                                    })?;
                                }
                            }
                        }
                    }
                }
                PreflightCheck::NetworkReachable => {
                    // 网络可达性检查（可选，不阻塞启动）
                }
            }
        }
        Ok(())
    }

    async fn check_runtime_dependency(&self, dep: &RuntimeDependency) -> Result<(), AcpError> {
        match dep {
            RuntimeDependency::Node => {
                // First check bundled Node.js
                if crate::process::resolve_bundled_node().is_some() {
                    return Ok(());
                }
                // Check system Node.js
                let node = crate::process::normalized_program("node");
                if which::which(&node).is_ok() {
                    return Ok(());
                }
                // Node.js not found — try auto-download
                tracing::info!("[AgentRuntime] Node.js not found; attempting auto-download...");
                match crate::process::download_node().await {
                    Ok(path) => {
                        tracing::info!("[AgentRuntime] Node.js downloaded to {:?}", path);
                        return Ok(());
                    }
                    Err(e) => return Err(AcpError::SdkNotInstalled(format!(
                        "Node.js is not installed and auto-download failed: {e}. \
                         Please install Node.js 22+ or set VERYAGENT_BUNDLED_NODE_DIR."
                    ))),
                }
            }
            RuntimeDependency::Uv => {
                // 检查 uv 是否可用，不可用时尝试自动下载
                if crate::commands::acp::resolve_uvx_command().is_none() {
                    // 尝试自动下载 uv
                    match crate::acp::binary_cache::ensure_uv_tool(|_| {}).await {
                        Ok(_) => tracing::info!("[AgentRuntime] uv tool downloaded successfully"),
                        Err(e) => {
                            return Err(AcpError::SdkNotInstalled(format!(
                                "uv is not installed and auto-download failed: {e}"
                            )));
                        }
                    }
                }
            }
            RuntimeDependency::Python(version) => {
                // 检查 Python 版本（uv 会自动管理，不需要系统 Python）
                if crate::commands::acp::resolve_uvx_command().is_some() {
                    // uvx 会自动处理 Python 版本
                    return Ok(());
                }
                // 检查系统 Python
                let python = format!("python{}", version);
                if which::which(&python).is_err() && which::which("python3").is_err() {
                    return Err(AcpError::SdkNotInstalled(format!(
                        "Python {version} is not available. Install uv or Python {version} to use this agent."
                    )));
                }
            }
        }
        Ok(())
    }

    async fn ensure_runtime_deps(&self) -> Result<(), AcpError> {
        for dep in self.descriptor.runtime_deps {
            self.check_runtime_dependency(dep).await?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// 构建 AgentDescriptor 的辅助函数
// ---------------------------------------------------------------------------

/// 为指定 Agent 类型构建描述符
fn build_descriptor_for(agent_type: AgentType) -> (
    ExecutableSource,
    &'static [ConfigFile],
    &'static [RuntimeDependency],
    &'static [PreflightCheck],
    HealthCheckPolicy,
    RestartPolicy,
) {
    match agent_type {
        AgentType::ClaudeCode => (
            ExecutableSource::Npx {
                package: "@agentclientprotocol/claude-agent-acp@0.55.0",
                cmd: "claude-agent-acp",
                args: &[],
            },
            &[ConfigFile {
                relative_path: ".claude/settings.json",
                format: ConfigFormat::Json {
                    template: r#"{
  "models": {
    "default": "{{model}}"
  },
  "providers": {
    "anthropic": {
      "apiKey": "{{api_key}}",
      "baseUrl": "{{base_url}}"
    }
  }
}"#,
                },
            }],
            &[RuntimeDependency::Node],
            &[PreflightCheck::ExecutableExists, PreflightCheck::ConfigWritable],
            HealthCheckPolicy::ProcessAlive { interval: Duration::from_secs(30) },
            RestartPolicy::Limited { max_retries: 3, backoff: Duration::from_secs(5) },
        ),
        AgentType::Codex => (
            ExecutableSource::Npx {
                package: "@agentclientprotocol/codex-acp@1.1.0",
                cmd: "codex-acp",
                args: &[],
            },
            &[ConfigFile {
                relative_path: ".codex/config.toml",
                format: ConfigFormat::Toml {
                    template: r#"[provider]
type = "openai"
base_url = "{{base_url}}"
api_key = "{{api_key}}"
model = "{{model}}"
"#,
                },
            }],
            &[RuntimeDependency::Node],
            &[PreflightCheck::ExecutableExists, PreflightCheck::ConfigWritable],
            HealthCheckPolicy::ProcessAlive { interval: Duration::from_secs(30) },
            RestartPolicy::Limited { max_retries: 3, backoff: Duration::from_secs(5) },
        ),
        AgentType::Gemini => (
            ExecutableSource::Npx {
                package: "@google/gemini-cli@0.47.0",
                cmd: "gemini",
                args: &["--acp", "--skip-trust"],
            },
            &[ConfigFile {
                relative_path: ".gemini/settings.json",
                format: ConfigFormat::Json {
                    template: r#"{
  "apiKey": "{{api_key}}",
  "model": "{{model}}"
}"#,
                },
            }],
            &[RuntimeDependency::Node],
            &[PreflightCheck::ExecutableExists, PreflightCheck::ConfigWritable],
            HealthCheckPolicy::ProcessAlive { interval: Duration::from_secs(30) },
            RestartPolicy::Limited { max_retries: 3, backoff: Duration::from_secs(5) },
        ),
        AgentType::Hermes => (
            ExecutableSource::Uvx {
                package: "hermes-agent[acp,mcp]==0.18.0",
                cmd: "hermes-acp",
                args: &[],
                python: Some("3.13"),
                system_cmd: Some(("hermes", &["acp"])),
            },
            &[
                ConfigFile {
                    relative_path: ".hermes/config.yaml",
                    format: ConfigFormat::Yaml {
                        template: r#"model:
  provider: openai-api
  default: "{{model}}"
  base_url: "{{base_url}}"
"#,
                    },
                },
                ConfigFile {
                    relative_path: ".hermes/.env",
                    format: ConfigFormat::DotEnv,
                },
            ],
            &[RuntimeDependency::Uv, RuntimeDependency::Python("3.13")],
            &[
                PreflightCheck::RuntimeDependency(RuntimeDependency::Uv),
                PreflightCheck::ConfigWritable,
            ],
            HealthCheckPolicy::Heartbeat {
                interval: Duration::from_secs(15),
                timeout: Duration::from_secs(30),
            },
            RestartPolicy::Always {
                backoff: Duration::from_secs(5),
            },
        ),
        AgentType::OpenClaw => (
            ExecutableSource::Npx {
                package: "openclaw@2026.7.1",
                cmd: "openclaw",
                args: &["acp"],
            },
            &[ConfigFile {
                relative_path: ".openclaw/openclaw.json",
                format: ConfigFormat::Json {
                    template: r#"{
  "apiKey": "{{api_key}}",
  "baseUrl": "{{base_url}}",
  "model": "{{model}}"
}"#,
                },
            }],
            &[RuntimeDependency::Node],
            &[PreflightCheck::ExecutableExists, PreflightCheck::ConfigWritable],
            HealthCheckPolicy::Heartbeat {
                interval: Duration::from_secs(15),
                timeout: Duration::from_secs(30),
            },
            RestartPolicy::Always {
                backoff: Duration::from_secs(5),
            },
        ),
        AgentType::OpenCode => (
            ExecutableSource::Binary {
                cmd: "opencode",
                args: &["acp"],
            },
            &[],
            &[],
            &[PreflightCheck::ExecutableExists],
            HealthCheckPolicy::ProcessAlive { interval: Duration::from_secs(30) },
            RestartPolicy::Limited { max_retries: 2, backoff: Duration::from_secs(5) },
        ),
        AgentType::Cline => (
            ExecutableSource::Npx {
                package: "cline@3.0.34",
                cmd: "cline",
                args: &["--acp"],
            },
            &[],
            &[RuntimeDependency::Node],
            &[PreflightCheck::ExecutableExists],
            HealthCheckPolicy::ProcessAlive { interval: Duration::from_secs(30) },
            RestartPolicy::Limited { max_retries: 3, backoff: Duration::from_secs(5) },
        ),
        AgentType::CodeBuddy => (
            ExecutableSource::Npx {
                package: "@tencent-ai/codebuddy-code@2.117.0",
                cmd: "codebuddy",
                args: &["--acp"],
            },
            &[],
            &[RuntimeDependency::Node],
            &[PreflightCheck::ExecutableExists],
            HealthCheckPolicy::ProcessAlive { interval: Duration::from_secs(30) },
            RestartPolicy::Limited { max_retries: 3, backoff: Duration::from_secs(5) },
        ),
        AgentType::KimiCode => (
            ExecutableSource::Npx {
                package: "@moonshot-ai/kimi-code@0.22.3",
                cmd: "kimi",
                args: &["acp"],
            },
            &[],
            &[RuntimeDependency::Node],
            &[PreflightCheck::ExecutableExists],
            HealthCheckPolicy::ProcessAlive { interval: Duration::from_secs(30) },
            RestartPolicy::Limited { max_retries: 3, backoff: Duration::from_secs(5) },
        ),
        AgentType::Pi => (
            ExecutableSource::Npx {
                package: "pi-acp@0.0.31",
                cmd: "pi-acp",
                args: &[],
            },
            &[],
            &[RuntimeDependency::Node],
            &[PreflightCheck::ExecutableExists],
            HealthCheckPolicy::ProcessAlive { interval: Duration::from_secs(30) },
            RestartPolicy::Limited { max_retries: 3, backoff: Duration::from_secs(5) },
        ),
        AgentType::MimoCode => (
            ExecutableSource::Npx {
                package: "@mimo-ai/cli@0.1.6",
                cmd: "mimo",
                args: &["acp"],
            },
            &[],
            &[RuntimeDependency::Node],
            &[PreflightCheck::ExecutableExists],
            HealthCheckPolicy::ProcessAlive { interval: Duration::from_secs(30) },
            RestartPolicy::Limited { max_retries: 3, backoff: Duration::from_secs(5) },
        ),
        AgentType::CommandCode => (
            ExecutableSource::NodeScript {
                script_path: String::new(), // 运行时动态获取
            },
            &[],
            &[RuntimeDependency::Node],
            &[PreflightCheck::ExecutableExists],
            HealthCheckPolicy::ProcessAlive { interval: Duration::from_secs(30) },
            RestartPolicy::Limited { max_retries: 3, backoff: Duration::from_secs(5) },
        ),
    }
}

// ---------------------------------------------------------------------------
// 基于 AgentDescriptor 构建 AcpAgent
// ---------------------------------------------------------------------------

/// 根据 AgentDescriptor 构建 AcpAgent
pub async fn build_agent_from_descriptor(
    descriptor: &AgentDescriptor,
    runtime_env: &BTreeMap<String, String>,
    cwd: &Path,
) -> Result<AcpAgent, AcpError> {

    match &descriptor.executable {
        ExecutableSource::Npx { package, cmd, args } => {
            build_npx_agent(descriptor, package, cmd, args, runtime_env, cwd).await
        }
        ExecutableSource::Binary { cmd, args } => {
            build_binary_agent(descriptor, cmd, args, runtime_env, cwd).await
        }
        ExecutableSource::Uvx { package, cmd, args, python, system_cmd } => {
            build_uvx_agent(descriptor, package, cmd, args, *python, *system_cmd, runtime_env, cwd).await
        }
        ExecutableSource::NodeScript { script_path } => {
            build_node_script_agent(descriptor, script_path, runtime_env, cwd)
        }
    }
}

/// 构建 npx 启动的 Agent
async fn build_npx_agent(
    descriptor: &AgentDescriptor,
    package: &str,
    cmd: &str,
    args: &[&str],
    runtime_env: &BTreeMap<String, String>,
    cwd: &Path,
) -> Result<AcpAgent, AcpError> {
    let mut parts: Vec<String> = Vec::new();

    // 合并环境变量（format：KEY=VALUE），含代理变量 / CLICOLOR / officecli PATH。
    // 重构前由 merge_agent_env 注入，重构时被误删，此处恢复。
    for (k, v) in merge_agent_env(runtime_env) {
        parts.push(format!("{k}={v}"));
    }

    // 解析 npx 命令路径
    let resolved = crate::commands::acp::resolve_npx_command(cmd)
        .await
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            crate::process::normalized_program(cmd)
                .to_string_lossy()
                .to_string()
        });

    // 诊断日志：记录 registry-pinned package 与解析到的启动路径。
    // 启动本身用已安装的命令（resolve_npx_command），package 仅作为版本 pin
    // 的单一事实源（与 registry.rs 保持一致），供排障时核对安装版本。
    tracing::debug!(
        "[ACP][{}] npx package={} resolved_cmd={}",
        descriptor.name, package, resolved
    );
    parts.push(resolved);

    // 添加参数
    for a in args {
        parts.push((*a).to_string());
    }

    // 处理 Agent 特定的 CLI 参数翻译
    handle_agent_specific_args(descriptor.agent_type, runtime_env, &mut parts);

    let refs: Vec<&str> = parts.iter().map(|s| s.as_str()).collect();
    let agent_name = descriptor.name.to_string();

    build_agent_with_cwd(cwd, || {
        AcpAgent::from_args(&refs)
            .map(|a| {
                a.with_debug(move |line, dir| {
                    if dir == sacp_tokio::LineDirection::Stderr {
                        tracing::debug!("[ACP][{agent_name}][stderr] {line}");
                    }
                })
            })
            .map_err(|e| AcpError::SpawnFailed(e.to_string()))
    })
}

/// 若 cwd 是存在的目录，则把 agent 子进程的工作目录设为 cwd；否则原样返回。
///
/// 重构前 build_agent 尾部有 `agent.with_current_dir(cwd)`，重构时被误删。
/// 恢复它是因为编码 agent 必须跑在项目根目录（Hermes 的本地终端后端会从
/// os.getcwd() 强制导出 TERMINAL_CWD，若跑在 "/" 会报告错误的工作目录在它的
/// system prompt 里）。对已通过 ACP session/new 设置 cwd 的 agent 是无害对齐。
fn build_agent_with_cwd(
    cwd: &Path,
    build: impl FnOnce() -> Result<AcpAgent, AcpError>,
) -> Result<AcpAgent, AcpError> {
    let agent = build()?;
    Ok(if cwd.is_dir() {
        agent.with_current_dir(cwd)
    } else {
        agent
    })
}

/// 构建二进制本地缓存的 Agent
async fn build_binary_agent(
    descriptor: &AgentDescriptor,
    cmd: &str,
    args: &[&str],
    runtime_env: &BTreeMap<String, String>,
    cwd: &Path,
) -> Result<AcpAgent, AcpError> {
    use sacp::schema::McpServerStdio;

    // 查找缓存的二进制文件
    let (binary_path, _cached_version) =
        crate::acp::binary_cache::find_best_cached_binary_for_agent(
            descriptor.agent_type, cmd
        )?
        .ok_or_else(|| {
            AcpError::SdkNotInstalled(format!(
                "{} is not installed. Please install it in Agent Settings.",
                descriptor.name
            ))
        })?;

    let binary_str = binary_path.to_string_lossy().to_string();
    let mut server = McpServerStdio::new(descriptor.name, &binary_str);

    let cmd_args: Vec<String> = args.iter().map(|a| (*a).to_string()).collect();
    if !cmd_args.is_empty() {
        server = server.args(cmd_args);
    }

    // 注入环境变量（含代理变量 / CLICOLOR / officecli PATH，同重构前 merge_agent_env）
    let merged_env = merge_agent_env(runtime_env);
    if !merged_env.is_empty() {
        let env_vars: Vec<sacp::schema::EnvVariable> = merged_env
            .iter()
            .map(|(k, v)| sacp::schema::EnvVariable::new(k, v))
            .collect();
        server = server.env(env_vars);
    }

    let agent_name = descriptor.name.to_string();
    let stdio_debug_enabled = std::env::var("VERYAGENT_ACP_DEBUG")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    build_agent_with_cwd(cwd, || {
        Ok(
            AcpAgent::new(sacp::schema::McpServer::Stdio(server)).with_debug(
                move |line, dir| {
                    let (tag, enabled) = match dir {
                        sacp_tokio::LineDirection::Stderr => ("stderr", true),
                        sacp_tokio::LineDirection::Stdout => ("stdout", stdio_debug_enabled),
                        sacp_tokio::LineDirection::Stdin => ("stdin", stdio_debug_enabled),
                    };
                    if !enabled { return; }
                    const MAX: usize = 256;
                    if line.len() > MAX {
                        let head = line.char_indices()
                            .take_while(|(i, _)| *i < MAX)
                            .last()
                            .map(|(i, c)| i + c.len_utf8())
                            .unwrap_or(MAX);
                        tracing::debug!(
                            "[ACP][{agent_name}][{tag}] {}... <truncated {} bytes>",
                            &line[..head], line.len() - head
                        );
                    } else {
                        tracing::debug!("[ACP][{agent_name}][{tag}] {line}");
                    }
                },
            ),
        )
    })
}

/// 构建 uvx 启动的 Agent
async fn build_uvx_agent(
    descriptor: &AgentDescriptor,
    package: &str,
    cmd: &str,
    args: &[&str],
    python: Option<&str>,
    system_cmd: Option<(&str, &[&str])>,
    runtime_env: &BTreeMap<String, String>,
    cwd: &Path,
) -> Result<AcpAgent, AcpError> {
    let mut parts: Vec<String> = Vec::new();

    // 合并环境变量（含代理变量 / CLICOLOR / officecli PATH，同重构前 merge_agent_env）
    for (k, v) in merge_agent_env(runtime_env) {
        parts.push(format!("{k}={v}"));
    }

    if let Some(uvx_path) = crate::commands::acp::resolve_uvx_command() {
        // 主路径：uvx --from <package> <cmd>
        parts.push(uvx_path.to_string_lossy().to_string());
        if let Some(py) = python {
            parts.push("--python".into());
            parts.push(py.to_string());
        }
        parts.push("--from".into());
        parts.push(package.to_string());
        parts.push(cmd.to_string());
        for a in args {
            parts.push((*a).to_string());
        }
    } else if let Some((sys_path, sys_args)) = system_cmd.and_then(|(c, a)| {
        crate::commands::acp::resolve_command_on_path(c).map(|path| (path, a))
    }) {
        // 回退：系统命令
        tracing::warn!(
            "[ACP][{}] uvx unavailable; falling back to system command {:?}",
            descriptor.name, sys_path
        );
        parts.push(sys_path.to_string_lossy().to_string());
        for a in sys_args {
            parts.push((*a).to_string());
        }
    } else {
        return Err(AcpError::SdkNotInstalled(format!(
            "{} is not installed. Please install it in Agent Settings.",
            descriptor.name
        )));
    }

    let refs: Vec<&str> = parts.iter().map(|s| s.as_str()).collect();
    let agent_name = descriptor.name.to_string();

    build_agent_with_cwd(cwd, || {
        AcpAgent::from_args(&refs)
            .map(|a| {
                a.with_debug(move |line, dir| {
                    if dir == sacp_tokio::LineDirection::Stderr {
                        tracing::debug!("[ACP][{agent_name}][stderr] {line}");
                    }
                })
            })
            .map_err(|e| AcpError::SpawnFailed(e.to_string()))
    })
}

/// 构建 Node.js 脚本启动的 Agent（如 CommandCode）
fn build_node_script_agent(
    descriptor: &AgentDescriptor,
    script_path: &str,
    runtime_env: &BTreeMap<String, String>,
    cwd: &Path,
) -> Result<AcpAgent, AcpError> {
    use sacp::schema::McpServerStdio;

    let script_path = if script_path.is_empty() {
        crate::acp::binary_cache::ensure_command_code_adapter()
            .map_err(|e| AcpError::SpawnFailed(e.to_string()))?
    } else {
        PathBuf::from(script_path)
    };

    let node = crate::process::normalized_program("node");
    let binary_str = node.to_string_lossy().to_string();
    let mut server = McpServerStdio::new(descriptor.name, &binary_str);
    server = server.args(vec![script_path.to_string_lossy().to_string()]);

    // 注入环境变量（含代理变量 / CLICOLOR / officecli PATH，同重构前 merge_agent_env）
    let merged_env = merge_agent_env(runtime_env);
    if !merged_env.is_empty() {
        let env_vars: Vec<sacp::schema::EnvVariable> = merged_env
            .iter()
            .map(|(k, v)| sacp::schema::EnvVariable::new(k, v))
            .collect();
        server = server.env(env_vars);
    }

    let agent_name = descriptor.name.to_string();
    build_agent_with_cwd(cwd, || {
        Ok(
            AcpAgent::new(sacp::schema::McpServer::Stdio(server)).with_debug(
                move |line, dir| {
                    if dir == sacp_tokio::LineDirection::Stderr {
                        tracing::debug!("[ACP][{agent_name}][stderr] {line}");
                    }
                },
            ),
        )
    })
}

/// 处理 Agent 特定的 CLI 参数翻译
///
/// 某些 Agent 需要通过 CLI 参数而非环境变量传递配置（如 OpenClaw 的 --url/--token）。
fn handle_agent_specific_args(
    agent_type: AgentType,
    runtime_env: &BTreeMap<String, String>,
    parts: &mut Vec<String>,
) {
    match agent_type {
        AgentType::OpenClaw => {
            if let Some(url) = runtime_env
                .get("OPENCLAW_GATEWAY_URL")
                .filter(|v| !v.is_empty())
            {
                parts.push("--url".into());
                parts.push(url.clone());
                if let Some(token) = runtime_env
                    .get("OPENCLAW_GATEWAY_TOKEN")
                    .filter(|v| !v.is_empty())
                {
                    parts.push("--token".into());
                    parts.push(token.clone());
                }
            }
            if let Some(key) = runtime_env
                .get("OPENCLAW_SESSION_KEY")
                .filter(|v| !v.is_empty())
            {
                parts.push("--session".into());
                parts.push(key.clone());
            }
            if runtime_env
                .get("OPENCLAW_RESET_SESSION")
                .is_some_and(|v| v == "1")
            {
                parts.push("--reset-session".into());
            }
        }
        AgentType::Gemini => {
            if let Some(model) = runtime_env
                .get("GEMINI_MODEL")
                .filter(|v| !v.trim().is_empty())
            {
                parts.push("--model".into());
                parts.push(model.clone());
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// 配置渲染器 — 独立的配置渲染功能
// ---------------------------------------------------------------------------

/// 配置渲染器，用于渲染 Agent 的原生配置文件
pub struct ConfigRenderer;

impl ConfigRenderer {
    /// 为指定 Agent 渲染所有原生配置文件
    ///
    /// 在 Agent 启动前调用，确保配置文件存在且内容正确。
    pub async fn render_for_agent(
        agent_type: AgentType,
        runtime_env: &BTreeMap<String, String>,
    ) -> Result<(), AcpError> {
        let mut runtime = AgentRuntime::new(agent_type);
        runtime.runtime_env = runtime_env.clone();
        runtime.render_config_files().await
    }

    /// 检查指定 Agent 的配置文件是否就绪
    pub fn check_config_ready(agent_type: AgentType) -> bool {
        let descriptor = AgentDescriptor::from_registry(agent_type);
        if descriptor.config_files.is_empty() {
            return true;
        }
        let home = match dirs::home_dir() {
            Some(h) => h,
            None => return false,
        };
        for config_file in descriptor.config_files {
            let path = home.join(config_file.relative_path);
            if !path.exists() {
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_descriptor_basic() {
        let desc = AgentDescriptor::from_registry(AgentType::ClaudeCode);
        assert_eq!(desc.name, "Claude Code");
        assert!(desc.supports_mcp);
        assert!(!desc.resident);
    }

    #[test]
    fn test_hermes_descriptor() {
        let desc = AgentDescriptor::from_registry(AgentType::Hermes);
        assert!(desc.resident);
        assert!(matches!(desc.health_check, HealthCheckPolicy::Heartbeat { .. }));
        assert!(matches!(desc.restart, RestartPolicy::Always { .. }));
    }

    #[test]
    fn test_config_renderer() {
        let desc = AgentDescriptor::from_registry(AgentType::ClaudeCode);
        assert!(!desc.config_files.is_empty());
        assert_eq!(desc.config_files[0].relative_path, ".claude/settings.json");
    }
}