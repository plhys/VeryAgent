# 模型提供商全智能体支持计划

## 目标
让所有智能体都能使用模型提供商，不再仅限于 claude_code、codex、gemini。

## 当前状态
`MODEL_PROVIDER_AGENT_TYPES` 虽然列了 7 个智能体，但**只有 3 个真正能用**：
- ✅ Claude Code（有模型提供商认证模式）
- ✅ Codex（有模型提供商认证模式）
- ✅ Gemini（有模型提供商认证模式）
- ❌ Kimi Code（只有 API Key / 登录）
- ❌ Hermes（有自己的提供商体系）
- ❌ Open Claw（只有网关配置）
- ❌ Cline（有自己的提供商下拉）

## 阻塞点

### 1. 前端设置页
文件：`src/components/settings/acp-agent-settings.tsx`

`selectedNeedsModelProvider`（第 4710 行）只对 3 个智能体返回 true。

### 2. 后端配置文件写入
文件：`src-tauri/src/commands/acp.rs`

`cascade_update_agent_config`（第 4934 行）对 4 个智能体是 NO-OP。

## 分阶段实施

### 阶段 1：Kimi Code（最简单）
- 后端运行时注入已支持（`agent_env_keys` 已返回 `KIMI_MODEL_*`）
- 前端：`KimiAuthMode` 加 `"model_provider"` 选项 + provider 下拉
- 后端：`cascade_update_agent_config` 写 `~/.kimi-code/config.toml`

### 阶段 2：Hermes
- 后端运行时注入已支持（走 `OPENAI_*` 通配）
- 前端：新增 auth mode 选择器
- 后端：写 `~/.hermes/.env` + `~/.hermes/config.yaml`

### 阶段 3：Open Claw
- 后端运行时注入已支持（走 `OPENAI_*` 通配）
- 前端：新增 auth mode 选择器
- 后端：确认配置文件路径或 env-only

### 阶段 4：Cline
- 后端运行时注入已支持（走 `OPENAI_*` 通配）
- 前端：新增 auth mode 选择器
- 后端：写 `~/.cline/data/globalState.json` + `secrets.json`

## 每个智能体需要的改动模板

### 前端（acp-agent-settings.tsx）
1. `selectedNeedsModelProvider` 加对应 agent 分支
2. Auth mode 常量加 `"model_provider"`
3. 渲染 provider 下拉（复用 claude_code/codex/gemini 的模板）
4. `handleModelProviderSelect` 加对应 agent 分支（或走 else 默认）
5. API URL/Key 字段在 model_provider 模式下设为 readOnly

### 后端（acp.rs）
1. `cascade_update_agent_config` 对应分支改为实际文件写入
2. 复用已有的 agent 配置文件读写逻辑