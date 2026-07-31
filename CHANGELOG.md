# Changelog

本仓库的版本更新说明。每次有实质功能合入 `main` 时更新本文件。  
格式大致遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

当前产品版本号见：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`（现为 **0.9.9**）。

---

## [Unreleased]

### 新增

### 变更

### 修复

---

## [0.9.9] — 2026-07-31

### 新增

- **桌面宠物内嵌主窗口**：宠物不再脱离应用窗口，气泡锁定跟随、自下向上生长、缩放与 320 基数对齐；全局 `cursor-pointer`；防闪烁处理。
- **侧边栏置顶对话标志**：置顶对话左侧显示上箭头标志，置顶与普通对话间分割线加粗提高透明度。
- **侧边栏右键菜单「复制对话链接」**：右键菜单可复制对话链接，点击跳转原对话。
- **侧边栏对话/项目列表悬停绝对时间旗标**：悬停显示 `yyyy-MM-dd HH:mm` 格式。
- **文件夹 + 会话双选中**：会话点击走 `openTab`。

### 变更

- **对话总结气泡重构**：移除标题栏，改用纯文本气泡+更明显的背景色和边框；气泡位置改为跟随卡片并实时响应滚动/缩放，宽度自适应小屏。
- **总结内容过滤优化**：跳过斜杠命令（如 `/veryagent-image`）和废话（问候/确认/单字回复/纯表情）；用户消息全是命令时改用助手回复作为内容描述。
- HoverCard 从 radix-ui 改为 @radix-ui/react-hover-card 直连导入；箭头改为内联元素避免被图标遮挡或裁剪；用 portal 气泡替换 HoverCard 避免侧边栏裁剪。
- `dev-detached.ps1` PowerShell 5.1 兼容性改进。

### 修复

- **acp-agent-settings.tsx 拆分回滚**：远程提交的模块拆分未完成（空文件、截断内容、循环自引用），恢复备份并删除不完整拆分目录，确保构建通过。
- **acp-agent-settings.tsx 正确拆分**：将 11853 行/466KB 的单一文件拆分为 7 个模块——`types.ts`、`shared.ts`、`checks.ts`、`kimi-code-config.tsx`、`opencode-model-combobox.tsx`、`agent-reorder-item.tsx`、`main.tsx`，通过 barrel `index.ts` 统一导出。
- **AgentType 添加 mimo_code**：补充 `mimo_code` 类型的缺失定义，修复 `AGENT_LABELS`/`AGENT_COLORS` 的 Record 完整性。
- **测试文件修复**：`acp-agent-settings.test.tsx` 补充 `resident` 属性。
- **`fetch_provider_models` 命令注册**：修复设置页选中智能体后刷新模型列表报 `Command fetch_provider_models not found`——后端 `tauri_setup.rs` 的 invoke 注册表遗漏了该命令，补加注册行。
- **`model_provider.rs` 门控**：补回 `fetch_provider_models` 上的 `#[cfg(feature = "tauri-runtime")]` 门控，防止 web/standalone 构建编译失败。
- **AI 总结不再覆盖轮次和时间信息**：AI 异步总结返回后，保留 `💬 共X轮 🕐 时间范围` 头部，只替换内容部分。
- **删除无用代码**：移除 `summaryLoading` 和 `lastAssistantText` 未使用变量。
- **divider 行缺少 rowKey 处理**：修复 `Cannot read properties of undefined (reading agent_type)`。
- **JSON BOM 及版本同步**：修复文件编码和版本号不一致问题。

### 测试

- **修复 30 个预存测试失败**：涵盖 9 个测试文件，类型包括——
  - 缺少 `NextIntlClientProvider` 包装器（`PanelPermissionCard`、`session-config-selector`）
  - 组件本地化后按钮文字变更（`permission-dialog`：`Reject` → `Deny`）
  - 实现新增 divider 行未同步测试（`sidebar-conversation-grouping`）
  - 组件树中 `CloneDialog` → `useGitCredential` 缺少 mock（`sidebar`）
  - jsdom 不支持 CSS 变量值（`sidebar-conversation-card`：`style.left` → className 断言）
  - 语义错误/无障碍角色变更（`markdown-link`：`getByRole("button")` → `querySelector("a")`）
  - CSS class 重构后断言过时（`conversation-detail-panel-layout`）
  - hydrate 行为变更后重写 11 个测试（`tab-context`：不再恢复持久化标签，始终打开欢迎页）

---

## [0.9.7] — 2026-07-20

### 变更

- 版本号统一抬升至 0.9.7，CHANGELOG 补充 0.9.5/0.9.6 遗漏记录。

## [0.9.6] — 2026-07-19

### 修复

- 启动不再闪 PowerShell 窗口。
- 恢复主窗口先隐藏再显示，消除启动闪窗。
- PluginsTab 使用 refreshKey 刷新。
- 权限对话框卡片布局缩小。

## [0.9.5] — 2026-07-18

### 新增

- **出图网关 Skills 化与多网关配置**：图片生成能力重构为 Skill 体系，支持多网关配置。
- **技能仓库主路径**：技能可从仓库添加进当前智能体。
- **MiMo Code（小米）智能体支持**：新增小米 MiMo Code 智能体，支持历史对话解析与模型供应商绑定。
- **开机自启设置**：设置页新增开机自启开关。
- **CI/CD 自动构建**：GitHub Actions 工作流自动构建与发布。
- **PPT 幻灯片生成技能**：支持 Markdown 和 HTML 两种模式生成 .pptx 幻灯片。

### 变更

- 启动时重置僵尸 `in_progress` 会话，防止 AI 加载指示器空转。
- 用户消息气泡使用主题变量配色。
- 更新签名公钥并补充密钥保管文档。

### 修复

- 技能仓库可用性与 UX 对齐，清理出图技能空壳。
- 注册 openwiki 模块（`mod.rs` 遗漏）。
- 恢复 `#[cfg(feature = "tauri-runtime")]` 门控。

### 重构

- **ACP 模块化**：将 `commands/acp.rs` 拆分为按智能体（Codex/Cline/OpenCode/Kimi/Pi/OpenClaw/Hermes/CodeBuddy）和通用工具（binary/npm/uvx）的独立模块。
- MCP 模块拆分：`mcp.rs` → `mod.rs`（marketplace）+ `agent_servers.rs`（per-agent MCP）。
- 替换 `tokio::Mutex` 为 `std::Mutex` 避免 server 路径下 `blocking_lock` panic。

## [0.9.4] — 2026-07-17

### 新增

- **web-search 技能**：网页搜索 + 图片搜索，经 MCP 代理上游 `feishu.ideasir.com`，中文优先，支持时间过滤
- **doubao-image 技能**：豆包出图，使用 `generate_image` 工具 + `model: "doubao"`
- **gemini-image 技能重构**：从旧 1666 直连 API 迁移到 MCP 端点 `feishu.ideasir.com`，支持 `model` 参数切换 Gemini/豆包
- 恢复 transcripts 图片右键「引用二次创作」菜单项

### 变更

- `generate_image` / `modify_image` 后端改用 MCP JSON-RPC 协议，返回 base64 图片数据
- 出图工具 `model` 参数：`gemini` → `generate_image_model1`，`doubao` → `generate_image_model2`

### 新增

- **双更新源**：系统设置可选 **GitHub 仓库**（`plhys/VeryAgent`）或 **Gitea 仓库**（内网 `10.10.100.233:3030/boss/veryagent`），检查/下载均跟随所选源
- 桌面更新检查改为后端 `check_app_update`（可覆盖 endpoint）；开启 `createUpdaterArtifacts` 与 updater 插件
- **标题栏更新按钮**：主题切换旁，有新版本时显示绿色「更新」小按钮，点击下载安装；装完可「重启以更新」
- 文档：`docs/updater-release.zh-CN.md`（双仓 `latest.json` 与签名发布说明）
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

- 更新检查：未发布 / 空渠道时按「已是最新」处理，不再向用户展示清单/签名技术细节
- 发布用 updater 签名公钥更新为本机正式发布密钥（首次自动更新渠道）
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
