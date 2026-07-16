# Changelog

本仓库的版本更新说明。每次有实质功能合入 `main` 时更新本文件。  
格式大致遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

当前产品版本号见：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`（现为 **0.9.3**）。

---

## [Unreleased]

### 新增

- **双更新源**：系统设置可选 **GitHub 仓库**（`plhys/VeryAgent`）或 **Gitea 仓库**（内网 `10.10.100.233:3030/boss/veryagent`），检查/下载均跟随所选源
- 桌面更新检查改为后端 `check_app_update`（可覆盖 endpoint）；开启 `createUpdaterArtifacts` 与 updater 插件
- **标题栏更新按钮**：主题切换旁，有新版本时显示绿色「更新」小按钮，点击下载安装；装完可「重启以更新」
- 文档：`docs/updater-release.zh-CN.md`（双仓 `latest.json` 与签名发布说明）

---

## [0.9.3] — 2026-07-16

### 新增

- **共享模型供应商（A计划）绑定**
  - 智能体可绑定后台配置的模型供应商；聊天模型选择仅展示 ACP 已通告/已配置可用模型（不注入占位目录）
  - **Pi**：写入 `~/.pi/agent/models.json` 完整 schema + 内联 `apiKey`；运行时不注入 `OPENAI_*`（避免展开约 40 个内置 openai 模型）
  - **CodeBuddy**：A计划作为**自定义模型追加**到 `~/.codebuddy/models.json`（完整 chat/completions URL）；保留原生中国版/海外版/iOA 与 `CODEBUDDY_API_KEY`；不写 `availableModels`、不设 `CODEBUDDY_DISABLE_BUILTIN_MODELS`、不劫持 `CODEBUDDY_BASE_URL`
  - **OpenCode / OpenClaw / Kimi** 等继续走受管 `veryagent` 供应商路径
- **模型路由设置合并**：模型供应商 + 视觉桥接同页（`ModelRoutingSettings`）；旧 vision-bridge 路由重定向
- **智能体默认全关**：新装/新库 `agent_setting` 默认 `enabled = false`，按需开启
- **OpenClaw / Hermes 就绪态（readiness）**
  - 区分「已安装」与「真正可用」；OpenClaw Gateway 需实时可达；一键 / 会话侧 auto ensure
- **OpenClaw 常驻（resident）**：进程级预热与工作目录 `~/.openclaw`
- **欢迎页通用 / 专家模式**（通用：Hermes + OpenClaw；选择记忆 `workspace:chat-agent-mode`）
- **OpenWiki 插件化**：技能和插件第一方卡片；按智能体启用；npm CLI 安装流
- **侧边栏绝对时间旗标**：对话/项目列表悬停 `yyyy-MM-dd HH:mm`
- **独立开发启动**：`docs/dev-detached.zh-CN.md` + `dev-detached.ps1`

### 变更

- **移除共享身份 / 共享记忆**；`/settings/shared-preferences` 重定向外观设置
- **设置侧栏分组**：通用设置（默认展开）/ 专家设置（默认折叠）
- 桌宠：气泡锁定跟随、自下向上生长、缩放与 320 基数对齐
- OpenClaw 会话设置：短标签 + `名称 · 状态`；修正 `off` 误映射为「拒绝」
- ACP 设置：OpenClaw Gateway 发现 / 可达 / ensure
- 全局 `cursor-pointer`；Windows 本地 cargo 临时关 sccache / rust-lld
- Codex：选「模型供应商」时提示仅支持 OpenAI Responses API（多数 Chat Completions / A计划网关不可用）
- CodeBuddy / Pi / OpenClaw / Hermes / Cline 等 authMode 中英文案对齐；CodeBuddy 说明改为「追加自定义模型」
- 智能体选择器：禁用项完全隐藏；已启用但不可用的仍灰显

### 修复

- Pi `Model not found: veryagent/...`：补全 models.json + 停止 OPENAI 环境注入
- CodeBuddy 找不到 A计划供应商；以及误隐藏原生内置模型的错误写入路径
- 项目侧栏：点击会话会真正 `openTab`；**文件夹 + 会话** 同时显示选中态
- OpenClaw 安装后 `ECONNREFUSED 18789`、误标 ready
- 设置页访问已删路由白屏；`MessageInput` `collapsedSettings` TDZ 崩溃
- vision-bridge settings 缩进问题

### 文档

- `docs/dev-detached.zh-CN.md`、`docs/build-recovery.zh-CN.md`、`README.md`
- `CHANGELOG.md` / `AGENTS.md` — 推送 main 必须写版本说明

### 已知限制

- **Codex + A计划**：当前 Codex 强制 `wire_api = responses`；仅 Chat Completions 的网关仍不可用（UI 已告警）
- 本机已有 `agent_setting` 行的启用状态不会被「默认全关」批量改写（仅新建行）

### 提交对照

| Commit / 状态 | 说明 |
|---------------|------|
| `0614d01` | OpenClaw/Hermes readiness、resident、模式切换、会话设置 UX |
| `8b74b40` | 独立开发启动文档与 `dev-detached.ps1` |
| `2a22ec5` | CHANGELOG 与推送约定 |
| `bc2a0ce` | OpenWiki 插件化、移除共享身份、侧栏/设置/桌宠 |
| （工作区待提交） | A计划/CodeBuddy/Pi、默认禁用智能体、Codex 边界、项目侧栏选中、i18n、模型路由合并、0.9.3 版本号 |

---

## [0.9.2] — 2026-07-14

### 变更

- codeg v0.20.0 → v0.20.2 合并
- 技能包前端入口改造（专家 / 科研 / 办公）
- 详见当时提交：`6cea5d9` 与 `DEV_STATUS.md`
