# Changelog

本仓库的版本更新说明。每次有实质功能合入 `main` 时更新本文件。  
格式大致遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

当前产品版本号见：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`（现为 **1.0.0**）。

---

## [Unreleased]

### 重构

- **清理 message-input 死代码**：删除 slash 菜单遗留的 3 个未使用变量/回调及整组未使用的 dropdown 状态（`filteredSlashDropdownCommands` / `handleSlashDropdownOpenChange` / `handleSlashPopoverSelect` / `slashDropdownOpen` 组）。
- **修复 81 处 pre-existing TS 错误（约 -1700 行死代码）**：智能体设置页（main.tsx）重构遗留的 51 处 unused 声明及级联 import 清理；删除从未接线的 quickMessages 半成品（后端无对应命令）；修复 vision-bridge（`visionBridgeSaveConfig` 返回类型 void→`VisionBridgeConfig`、`VisionBridgeSettings`→`VisionBridgeConfigUpdate`）、image-generation（`usedFallback`→`used_fallback`）、`selectValueLabel` 与测试的 `kind.groups` 类型收窄、Icon `title`→`aria-label` 等类型错误。`tsc --noEmit` 源码零错误。

### 修复

- **空回复错误提示优化**：`turnFailedEmpty` 文案从「请检查代理配置」改为鉴权优先引导（模型供应商 API Key / OpenClaw 网关配置），zh-CN / en 同步。

### 变更

- **ESLint errors 清零**：`skills-tab` 的 `(s: any)` → `ExpertListItem`（补 `ExpertMetadata` 可选字段）、`selectValueLabel` 加 `kind.type` 类型收窄，并全量 prettier 格式规范化。

### 文档

- **状态文档复核同步**：VERYAGENT_TASKS / DEV_STATUS 确认 AI 总结后端、Hermes 常驻自启、OpenClaw 鉴权、技能重构 Phase 1+2、配置命名统一均已完成（此前标记待跟进已过时）。

---

## [1.0.0] — 2026-08-11

### 重构

- **智能体调用系统重构（4 阶段）**：引入 `AgentRuntime` + `AgentDescriptor` + 配置渲染器，统一管理 Agent 进程生命周期。
  - **P0 止血**：恢复重构丢失的 `cwd`/`env`/版本 pin 能力。
  - **P1 环境构建集中化**：`agent_env` 模块实现环境变量继承、净化、叠加，替换 45 个 per-agent 分支。
  - **P2 状态机接入**：`AgentRuntime` 状态机接入连接生命周期，统一管理进程启停与状态流转。
  - **P3 配置渲染备份**：`render_and_write_config()` 覆写前自动备份旧配置到 `~/.veryagent/config-backups/`；`render_toml_template()` / `render_yaml_template()` 增加格式感知转义。
- **前端设置页重构**：`AgentDescriptor` 注册表 + `AgentSettingsForm` 通用表单组件，`main.tsx` 删除 3300 行嵌套三元表达式，替换为 40 行声明式渲染。
- **ACP 模块清理**：移除未使用的 `acp_logout_command_code_core` 函数；清理编译 warning 7 处（未使用 import、未使用变量、字段命名等）。

### 新增

- **配置渲染备份机制**：`render_and_write_config()` 覆写前自动备份旧配置到 `~/.veryagent/config-backups/<agent_type>/<timestamp>/<relative_path>`，提供回滚保险，备份失败不阻塞主写入。
- **TOML/YAML 格式感知转义**：`render_toml_template()` 和 `render_yaml_template()` 不再复用 JSON 序列化，改为格式感知转义（转义 `\` 和 `"`），避免配置值中的特殊字符破坏 TOML/YAML 结构。
- **模型供应商测试 401 修复**：`probe_openai` / `probe_anthropic` 补发 `api-key` 请求头，与模型列表请求保持一致；`base_v1` 剥离 API 路径后缀，支持用户粘贴完整地址；遍历模型列表逐个尝试，解决 key 无权限访问首模型时的误报。
- **Hermes 环境自动修复**：启动时自动检测 `~/.hermes/config.yaml` + `.env` 是否存在，缺失时从数据库重新生成；自动检测 Hermes git 运行时是否缺少 `git.exe`，从系统 PATH 复制补全。
- **Hermes 模型选择器**：合成 model config option，启动时从供应商 API 拉取模型列表，对话框底部显示模型选择器。
- **Hermes 权限选择器**：合成 mode config option（Default / YOLO），对话框底部显示权限选择器。后端拦截 `set_config_option` 写入 `~/.hermes/.env` 的 `HERMES_PERMISSION_MODE`，重启 session 后生效。
- **思考链/工具链折叠合并**：对话结束后，思考和工具调用合并到一个可折叠容器中，按原始逻辑顺序排列，显示消耗 token 数；运行时实时更新状态计数，带旋转动画；支持全屏弹窗查看。
- **Claude 双回复修复**：`SessionState` 新增 `transcript_turns_emitted` 标志，防止 `emit_transcript_turns` 重复发射。
- **环境变量编辑器优化**：去掉模糊遮罩，添加说明文字，改为等宽字体。

### 变更

- **移除 OpenWiki 集成**：删除整个 OpenWiki 模块（`src-tauri/src/openwiki/`、`commands/openwiki.rs`、`web/handlers/openwiki.rs`、前端设置页面及 API），约 2.6k 行。
- **补充缺失前端 API 模块**：新增 `image-generation.ts`、`vision-bridge.ts`，补充 `describeAgentOptions` 导出，修复前端编译报错。

### 修复

- **Claude Code 双回复**：`background_watch.rs` 中，当 watcher 处于 `Foreground` 模式时，跳过不匹配 ledger 的 user 记录（Claude Code 自动续写提示），防止被当作 BackgroundActivity 重复发射。

### 变更

- **权限/模式显示优化**：从 `variant="name"` 改为 `variant="name-value"`，显示当前值而非仅名称。
- **多智能体协同设置**：从常规设置中独立出来，入口更明显。
- **Hermes 认证模式统一**：`handleModelProviderSelect` 中设置 `hermesAuthMode: "model_provider"`，确保模型列表能正常刷新。

### 变更

- **Claude Code / Kimi Code 只支持模型供应商**：移除 Claude Code 的官方订阅登录、Kimi 的 API Key / 账号登录入口，统一为模型供应商绑定。
- **OpenCode 双端口**：认证方式改为「官方密钥 + 模型供应商」两端口，移除误导性的「账号登录」（OpenCode 官方无 CLI 端跳转授权，仅网页注册拿 key）。
- **Gemini 模型参数注入**：Gemini 启动参数加 `--model <GEMINI_MODEL>`（Gemini CLI 不读 `GEMINI_MODEL` env，此前默认模型导致 `model not found`）。
- **Kimi 登录态误判修复**：面板登录状态检查 `credentialSynthetic`，仅存在本地门控令牌（合成凭据）时不再误显示「已通过 Kimi 账号登录」。
- **Hermes 模型服务商同步**：cascade 写入 provider 从 `custom` 改为 `openai-api`，使 API key 写入 `.env` 而非内联在 `config.yaml`；启动时刷新 Hermes 配置文件（`~/.hermes/config.yaml` + `.env`），确保每次连接都使用最新凭据。
- **代码框表头样式优化**：header 与操作按钮合并为同一行，减少垂直空白；按钮和图标缩小。
- **图片显示优化**：移除 `Attached N attachment` 占位文字，改为显示文件名 + 文件大小（如 `image.png (2.3 MB)`）。

### 修复

- **Windows 智能体无法启动（`os error 123`）**：`build_agent_env` 未过滤 Windows 特殊环境变量，导致 `AcpAgent::from_args` 解析 `KEY=VALUE` 前缀时误判命令。两类变量被剔除：
  - 驱动器特殊变量（`=C:=`、`=D:=` 等，记录各驱动器当前目录），以 `=` 开头；
  - 含 `(` `)` 等非标准字符的变量名（如 `CommonProgramFiles(x86)`、`ProgramFiles(x86)`），不符合 `parse_env_var` 的命名规则（仅接受字母/数字/下划线）。
  - 现用 `is_valid_env_var_name` 统一校验，非法变量名在继承净化阶段剔除。
- **Command Code 聊天历史持久化**：重启后对话记录不再丢失。新增 `conversation_turn` 表（m20260804），在 ACP turn 完成时自动将用户消息、助手回复、工具调用存入数据库，侧栏 message_count 同步更新；详情页读取改为从数据库加载，不再依赖空的 CommandCodeParser。
  - 后端：新增 migration/entity/service 层；`SessionState::completed_transcript_turns()` 投影方法；`TranscriptTurns` 事件 + lifecycle 持久化订阅；`get_folder_conversation_core` 对 Command Code 走 DB 分支。
- **Claude 智能体双回复修复**：`emit_transcript_turns` 中 `transcript_turns_emitted` 标志改为在 `emit_with_state` 之前设置，防止并发竞态导致重复发射 `TranscriptTurns` 事件；同时增加 `turn_in_flight` 检查，仅当 turn 进行中时才发射。
- **工具调用结果不显示修复**：`buildStreamingTurnsFromLiveMessage` 中 `else if` 条件从 `resolvedOutput`（空字符串时为 falsy）改为 `raw_output_chunks.length > 0 || content != null`，确保有输出时始终生成 `tool_result` 块；`ToolOutput` 和 `ToolCallPart` 中输出条件从 `output || errorText` 改为 `output != null || errorText != null`，支持空字符串结果渲染；`ToolCallPart` 中 completed 工具调用默认展开结果区域（`open` 条件增加 `!isRunning && (part.output != null || part.errorText != null)`）；`ToolGroupPart` 默认展开工具组（`useState(true)`）。
- **Command Code 原生模型选择器**：对话框上方显示 Command Code 原生模型下拉（`model` 开关），支持 10 个预置模型（DeepSeek、Kimi、GLM、MiniMax、Qwen、Gemini、Claude、GPT 等），选择后下一轮/重连生效。适配器通过 `session/new` 的 `configOptions` 广告，`session/set_config_option` 处理选择。
- **Command Code 自动工具权限**：默认"自动允许工具"（`permission_mode: auto`），不再弹逐工具审批卡；保留"询问后再执行"模式可切换。适配器 `tool_queued` 时根据模式跳过 `session/request_permission`。
- **CodeBuddy 登录/登出 Windows 文件锁问题**：`fs::remove_file` 在 Windows 上因文件锁静默失败，改用三层清理（删除→重命名→覆写空白）；登出前先 `cancel_codebuddy_login()`；启动时加 `CREATE_NEW_CONSOLE` 标志防止终端关闭时带走 veryagent。
- **Codex 启动失败**：`~/.codex/local.toml` 缺失导致 Codex 启动报错，新增 `seed_kimi_project_config` 在启动时创建空 `local.toml`。
- **Kimi Code 启动失败**：`~/.kimi-code/local.toml` 缺失导致 Kimi Code 启动报错，新增 `seed_kimi_project_config` 在启动时创建空文件。
- **i18n JSON 格式损坏导致设置页白屏**：`en.json` / `zh-CN.json` 的 `codex` 区块混入 tab 缩进破坏 JSON 结构，`JSON.parse` 失败导致设置页渲染白屏。统一缩进为空格修复。
- **persistEnv 无错误处理**：前端 `persistEnv` 缺少 `catch` 块，后端保存失败时错误被静默吞掉，用户无任何反馈。新增 `catch` 块 + toast 成功/失败提示。
- **Command Code ACP 适配器字段统一**：所有 ACP wire 字段改用 camelCase（`sessionId`、`sessionId`、`toolCall`、`toolCallId`、`optionId`、`rawInput`、`rawOutput`），`ToolCall`/`ToolCallUpdate` 字段平铺不嵌套，`session/set_config_option` 从 `-32601` 改为实现处理。

### 修复

- **Command Code 缓存的适配器版本过旧**：`ensure_command_code_adapter()` 只写不覆盖，导致旧缓存中 `protocolInfo` 返回 `{version:1}` 而非 `{protocolVersion:1}`；改为始终覆盖写入 + 版本号同步 `0.1.0` → `0.1.1`。
- **Command Code ACP 会话通知未路由**：`sendSessionUpdate` 中 `session_id`（snake_case）不匹配 `SessionNotification` 的 `#[serde(rename_all = "camelCase")]`（期望 `sessionId`），导致通知无法进入会话更新流 → turn 完成后检测不到输出 → 报 `turn_failed_empty`。已全部改为 camelCase。
- **Command Code 工具调用时 `optionId` 缺失**：`RequestPermissionRequest` 中的 `option_id`、`tool_call_id`、`raw_input`、`raw_output` 用 snake_case 不匹配 camelCase 结构体。已全部改为 camelCase。
- **Command Code 工具调用时 `toolCall` 字段名错误**：`RequestPermissionRequest` 外层 `tool_call` 应为 `toolCall`。

### 变更

- **Command Code 退出登录**：设置页 Command Code 卡片新增"退出登录"按钮，删除本地 `~/.commandcode/auth.json` 凭证文件；已登录时按钮显示"退出登录"，未登录时显示"登录"。
  - 后端：`command_code_config.rs` 新增 `logout_command_code()` 函数，删除 auth.json；注册 Tauri 命令 `acp_logout_command_code` 及 Web 路由。
  - 前端：`main.tsx` 新增 `handleLogoutCommandCode` 回调 + `LogOut` 图标 + 按钮三态逻辑（登录/退出登录/取消）；`agents.ts` 新增 `acpLogoutCommandCode()` API。
  - i18n：中/英文新增 `logoutButton` 文案。
- **侧边栏对话卡片右键菜单**：移除"新建会话"；置顶/取消置顶移到第一位；新增"复制任务路径"；菜单样式更紧凑（`rounded-md`、`px-2 py-1.5`、`gap-2`）。
- **对话详情面板右键菜单**：移除"新建会话"、"重载会话"、"对话详情"、"关闭会话"；新增"复制图片"、"下载图片"（有生成图片时显示）；新增"切换辅助面板"；菜单样式与侧边栏一致（`rounded-md p-1`）。
- **右键菜单全局样式**：`ring-foreground/5 ring-1` → `border border-border/60`（可见灰色边框）；`rounded-2xl` → `rounded-md`（小圆角）。
- **右键菜单全局修复**：`GlobalContextMenuGuard` 拦截机制导致正文区域右键被阻止，已为 `conversation-detail-panel.tsx`、`sidebar-conversation-list.tsx` 添加 `data-context-menu="true"`。
- **侧边栏字体与间距**：对话标题 0.9rem→0.95rem；文件夹/节标题 0.875rem→0.9rem；辅助文字 0.75rem→0.8rem；卡片上下 padding 0.125rem→0.25rem。
- **选中状态背景**：选中行背景改用与悬停一致的缩进圆角样式（`color-mix` 混合色 + `rounded-md`），替代原通栏 `bg-sidebar-border`。
- **Command Code 一键登录**：点击「登录」后台 spawn `cmdc login`（`CREATE_NO_WINDOW` 隐藏窗口），Command Code 自动打开浏览器授权、本地回调写 auth.json 后退出；前端轮询 `running` 状态，登录完成自动刷新为「已登录：{name}」，可随时取消。
  - 通道二「API Key」：粘贴 `commandcode.ai/studio` 生成的 API Key，以 `COMMAND_CODE_API_KEY` 存入 agent env（官方变量优先于 auth.json，不碰官方文件）。
  - 新增命令 `acp_get_command_code_login_status` / `acp_start_command_code_login` / `acp_cancel_command_code_login`（Tauri + Web 双注册）；`agent_env_keys` 的 CommandCode 分支修正为 `COMMAND_CODE_*` 键族。

### 修复

- **Command Code 预检误报「Binary is not installed」**：`run_preflight` 对 Command Code 走了通用 Binary 缓存检查，但适配器内置、无缓存二进制，导致设置页恒显示警告。新增 `check_command_code_environment` 特判（内置适配器 Pass + Node.js 可用性检查）。
- **已登录时点「登录」卡「等待授权」**：`cmdc login` 在已登录时秒退（"Already logged in"），不会弹浏览器。后端 `start_command_code_login` 增加已登录保护（no-op），前端点登录先查状态，已登录直接提示账号，不再进入假等待；轮询成功 toast 去重。

### 变更

- **边栏会话卡片重构**：移除 hover 时「标记完成/重新打开」和「展开/折叠子会话」快速操作按钮，简化卡片交互模型；移除 `AgentIcon` 依赖，时间显示从相对时间（"5m ago"）改为绝对时间（HH:mm），减少不必要的重渲染。
- **`tsconfig.json` 格式化**：数组展开为多行格式，添加 `.next/dev/dev/types/**/*.ts` 到 include 列表。

### 其他

- **`.gitignore` 更新**：添加 `.commandcode/`（Command Code CLI 缓存）、`/docs/运维笔记/`、`/docs/运营项目必看.md`、`/计划内容/` 到忽略列表。

### 新增

- **工作区文件夹右键菜单**：置顶 / 重命名 / 打开工作区 / 删除。重命名仅修改 VeryAgent 内显示名（`folder.name`），不触碰磁盘目录名与路径；重新打开已有工作区时保留自定义显示名（不再被目录 basename 覆盖）；「打开工作区」在桌面端用系统文件管理器打开目录（补 `opener:allow-reveal-item-in-dir` 权限）。
- **智能体筛选**：底部状态栏统计弹窗内点击任一智能体即可筛选侧边栏会话列表（再次点击取消），顶部统计行右侧出现「清除筛选」；筛选状态下会话行前显示对应智能体图标。
- **会话天数标签**：会话卡标题右侧显示「今天 / 昨天 / N天前」（右对齐），鼠标悬浮时原位切换为置顶 / 归档操作按钮（绝对定位不占位）。

### 变更

- **侧边栏「项目」→「工作区」**：标签与列表语义统一；工作区文件夹 hover 仅保留「新建会话」快捷按钮。
- **输入框底部操作栏统一**：所有智能体固定为「加号 → 权限 → 模型 → 强度」三段式（权限/强度只显名、无强度配置则隐藏该格、模型显模型名）；移除模式 chip 与折叠「设置」齿轮，视觉开关保留并置于 chips 之后；模式功能仍随发送携带。
- **配置名中文化**：`config-option-labels` 映射表扩展（effort / approval / permission / mode 等变体及裸协议 id），配置名未命中时回退本地化配置 id；修复既有 `ask` 重复 key 编译错误。
- **侧边栏排版统一**：圆角统一为小圆角（`rounded-full` → `rounded-md`）；会话列表左右边距对称、行宽右扩；滚动条 4px、手柄 ≤55% 且过渡丝滑；会话浮标向左压住侧边栏边缘（偏移 `-8px`），两个标签页锚点统一为整行宽度。

### 修复

- **选中会话天数不可见**：右侧天数槽容器改为 `relative`，置于选中高亮背景之上，选中行仍显示「今天/昨天/N天前」。
- **「打开工作区」无反应**：`openPath` 受 capabilities `$HOME/**` 限制，改用 `revealItemInDir` 并补充权限声明。

### 变更

- **智能体设置页「安装 | 配置」选项卡**：配置面板拆分为两步，未安装/未启用的智能体仅显示「安装」；切换智能体或可用状态变化时自动同步选项卡，配置入口在不可用时置灰并提示「请先安装智能体」。
- **保存模型提供商立即生效**：保存模型提供商时同步更新 draft 认证模式为 `model_provider`，并调用 `handleModelProviderSelect` + 持久化智能体专用配置（如 Codex 的 auth.json / config.toml），凭据与 base_url 无需重启即可生效。
- **外观设置补回 Select import**：缩放级别选择器使用的 `Select` 组件 import 缺失，补回。

### 修复

- **认证模式切换字段污染**：切换到 API Key 等非提供商模式时保存当前提供商字段值再清空，切回提供商模式时恢复，避免两套模式互相污染。
- **技能编辑器渲染错误**：技能编辑器模式下 AI 创建对话框与编辑器缺少 Fragment 包裹导致渲染异常，补回。

### 其他

- **移除云桥（yunqiao）临时脚本**：删除已跟踪的 `find_yunqiao.py` 及工作区未跟踪的 `start-ez.py` / `start-gui.py` / `start-gui2.py`（云桥组网脚本，不属于 VeryAgent；仅本会话提交，不含工作区其他改动）。

### 构建

- **版本号统一为 1.0.0**：`package.json` / `tauri.conf.json` / `Cargo.toml` / `Cargo.lock` 四文件版本同步（此前 package.json 0.9.9.1 与其余 0.9.9 不一致）。
- **打包目标收敛为 NSIS**：`tauri.conf.json` 的 `bundle.targets` 从 `"all"` 改为 `["nsis"]`。修复 MSI(WiX) 打包失败导致构建卡死的问题（MSI 链路历史遗留：WiX UI 扩展缺失 + sidecar 组件 ICE30，且项目发版始终只用 NSIS）。
- **`build-release.bat` 修复**：`pnpm tauri build --no-build` 参数在 tauri CLI 2.11 已移除（导致打包步骤必失败），改为 `pnpm tauri build --bundles nsis`；新增自动加载签名私钥逻辑（`%USERPROFILE%\.veryagent\keys\`，存在即签名）。
- **updater 换新签名密钥**：旧正式钥私钥丢失，重新生成密钥对（minisign id `48E87990D9E79ED5`），更新 `tauri.conf.json` / `verify.rs` 公钥并同步文档；自 v1.0.0 起生效（当前仅开发者自用）。

### 安全

- **脱敏核查**：全仓库 + git 历史扫描确认无真实凭据/私钥残留（云桥脚本网络密钥已随历史重写清除）；确认 `.gitignore` 忽略 `.env` / `*.key`；签名密钥文档更新为当前主机路径。

---

## [0.9.9.1] — 2026-08-01

### 新增

- **技能仓库系统**：技能数据源从编译后端切换为远程仓库 URL，支持 GitHub/Gitee 双源 5 秒超时切换，仓库在线/离线信号图标指示。
- **自制技能标签页**：独立的「自制」标签页，展示用户通过 VeryAgent 创建的自定义技能，支持编辑、删除、启用/禁用（localStorage 暂存内容）。
- **技能仓库 + 自制技能 + 已添加三段式页面结构**：标签页重组为「技能仓库 | 连接器仓库 | 自制 | 已添加」。
- **`index.json` 技能索引格式**：定义仓库标准格式，支持多语言名称/描述、分类、图标。

### 变更

- **技能仓库入口统一**：删除设置侧栏的「Skills」和「Skill Packs」入口，技能管理全部集中到工作台 Skills & Tools 页面。
- **预装技能按钮文字统一**：按钮从「添加/移除」改为「启用/禁用」，Toast 提示同步更新。
- **当前智能体标签改为绿色激活态**：指示灯和标签背景色从 primary 改为 `emerald` 绿色。
- **设置侧栏清理**：移除 `skill_packs` 和 `skills` 菜单项及相关页面文件。

### 修复

- **预装技能重复显示**：`acpListAgentSkills` 返回的符号链接与 `enabledIds` 去重，避免同一技能在「已添加」中显示两次。
- **TOML 解析器缺失 `zh-CN` 键名**：修复引号键名 `"zh-CN"` 的解析，确保 index.json 中包含中文技能名和描述。
- **技能下载 URL 路径错误**：修复 `SKILL_RAW_URLS` 基础 URL 与 `path` 重复拼接 `skills/` 导致 404 的问题。
- **`fetchSkillIndex` 返回值解构错误**：`handleToggle` 中未正确解构 `{ index, online }` 导致 `Cannot read properties of undefined`。

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
