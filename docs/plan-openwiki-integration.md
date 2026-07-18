# 计划：OpenWiki 原生整合进 VeryAgent

**日期**：2026-07-15  
**状态**：草案（待评审）  
**范围**：把 LangChain OpenWiki（v0.1.2）做成 VeryAgent 原生能力，而不是外挂 CLI 窗口。

---

## 0. 先澄清一个误解

之前说「方案只覆盖了 20%～30%」，指的是：

| 说法 | 含义 |
|------|------|
| **不是** | OpenWiki 有 70%～80% 功能不能用 |
| **是** | 当时口头/草稿方案只写到了核心方向，完整功能面还没落进文档 |

**正确结论：**

1. OpenWiki 的能力原则上都能接进 VeryAgent。  
2. 不能一次做完，要分阶段。  
3. 有些能力要**适配**（例如 macOS LaunchAgent → Windows/VeryAgent 调度），不是废弃。  
4. 有些交互要**换皮**（Ink TUI → 原生设置页/任务面板），能力保留，UI 不复刻终端。

本方案目标：把「能用什么 / 何时做 / 后台怎么设 / 对智能体怎么授权」一次写全。

---

## 1. 目标与原则

### 1.1 目标

把 OpenWiki 整合为 VeryAgent 原生功能：

1. **功能整合**：Code Wiki + Personal Wiki + Connectors + 命令 + 调度，都成为应用内能力。  
2. **权限管理**：可按智能体勾选「可读 / 可请求更新 / 可初始化」等权限。  
3. **命令接入**：OpenWiki CLI/slash 能力通过白名单 Command Bridge 接入，禁止任意 shell 透传。  
4. **后台完善**：独立设置页覆盖总开关、模式、模型、路径、注入策略、连接器、调度、运维。

### 1.2 非目标（一期不做）

- 复刻 OpenWiki 的 Ink 终端 UI  
- 在 Windows 上原样安装 macOS LaunchAgent  
- 让每个 CLI 参数都变成一个独立 checkbox  
- 把 OpenWiki 重写成 Rust 内部引擎（一期用进程桥接 / 任务桥）

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| 原生感 | 用户在设置页和会话里用，不感觉在跑第三方 CLI |
| 能力不丢 | 官方功能都进清单；未做的只是阶段未到，不是砍掉 |
| 权限默认收敛 | 默认可读；写/更新/初始化需显式授权 |
| 对齐现有模式 | 配置/权限参考 Vision Bridge；批量矩阵参考 Skill Agent Matrix |
| 命令白名单 | 只允许登记过的 openwiki 动作 |
| 分阶段交付 | P0 立刻可用；P1/P2 完整对等 |

---

## 2. OpenWiki 完整功能清单（官方能力）

来源：OpenWiki README + `src/commands.ts` + `src/cli.tsx` + `src/agent/types.ts`（v0.1.2）。

### 2.1 双模式

| 模式 | 输出位置 | 用途 |
|------|----------|------|
| **Code mode**（默认 bare CLI） | 仓库 `openwiki/` | 代码库文档脑 |
| **Personal mode** | `~/.openwiki/wiki` | 个人知识脑，跨源聚合 |

### 2.2 核心生成 / 维护

| 能力 | 说明 |
|------|------|
| `init` | 首次生成 wiki |
| `update` | 增量更新；CI 可直接 update，无 wiki 时会创建 |
| `chat` | 交互式提问 / 改文档意图 |
| `-p / --print` | 单次非交互输出 |
| `AGENTS.md` / `CLAUDE.md` 注入 | 维护 `<!-- OPENWIKI:START -->…END -->` 块 |
| `INSTRUCTIONS.md` | 用户 brief；正常 run 不自动改写 |
| `.last-update.json` | 最近更新元数据 |

### 2.3 Connectors（数据源）

| Connector | 说明 |
|-----------|------|
| `git-repo` | 本地仓库路径 |
| `gmail` | Gmail API OAuth |
| `notion` | Notion MCP OAuth |
| `x` | X/Twitter OAuth |
| `web-search` | Tavily（需 `TAVILY_API_KEY`） |
| `hackernews` | 公开 API，无需凭证 |
| 多实例 | 同 connector 可有 `web-search-1` / `web-search-2` |

原始数据：`~/.openwiki/connectors/<name>/raw/`  
合成 wiki：`~/.openwiki/wiki/`

### 2.4 认证 / OAuth

| 命令 | 说明 |
|------|------|
| `auth <provider>` | slack / gmail / notion / x |
| `auth configure <provider>` | 生成 connector 配置 |
| `auth tools <provider>` | 查看 MCP tools |
| `ngrok start [url]` | Slack OAuth HTTPS 回调隧道 |
| `~/.openwiki/.env` | 密钥存储（connector 配置不写裸密钥） |

### 2.5 摄取与调度

| 命令 | 说明 |
|------|------|
| `ingest all \| <source> \| <instance>` | 摄取并更新 wiki |
| `cron list` | 列出调度 |
| `cron pause/resume/delete` | 暂停/恢复/删除 |
| macOS LaunchAgent | 官方调度实现；Windows 需替换 |

### 2.6 模型 / Provider

- Providers：OpenAI、OpenAI-ChatGPT OAuth、Anthropic、OpenRouter、Nebius、Fireworks、Baseten、NVIDIA、OpenAI-compatible  
- 运行参数：`--modelId`、provider、API key、base URL、retry  
- 聊天内：`/api-key`、`/langsmith-key`  
- 配置：`~/.openwiki/.env`

### 2.7 CI 自动更新

- GitHub Actions / GitLab CI / Bitbucket 示例  
- 典型：`openwiki code --update --print`

### 2.8 Onboarding

- 首次配置 provider/model/LangSmith/connectors/template/scope/notes/schedule  
- `~/.openwiki/onboarding.json`

### 2.9 官方 CLI 命令全集

```text
openwiki
openwiki code [--init|--update] [message]
openwiki personal [--init|--update] [message]
openwiki --mode <personal|code> [--init|--update] [message]
openwiki --modelId <id> [message]
openwiki -p/--print "..."
openwiki --dry-run                 # 开发用

openwiki auth <provider>
openwiki auth configure <provider> [--force]
openwiki auth tools <provider>

openwiki ingest <source|source-instance|all>
openwiki cron list
openwiki cron pause <source|all>
openwiki cron resume <source|all>
openwiki cron delete <source|all>

openwiki ngrok start [url] [--port <port>]
openwiki --help
```

聊天内 slash：`/provider` `/model` `/api-key` `/langsmith-key` `/init` `/update` `/clear` `/help` `/exit`  
Agent 动作枚举：`chat | init | update`

---

## 3. 整合策略：不是砍功能，是分阶段 + 换皮

### 3.1 三种落地方式

| 类型 | 含义 | 例子 |
|------|------|------|
| **原生接入** | UI + 后端直接支持 | 总开关、智能体权限、init/update、wiki 注入 |
| **适配接入** | 能力保留，实现换成 VeryAgent 方式 | cron → 应用内任务调度；TUI → 设置页 |
| **延后接入** | 能用，但放 P1/P2 | Personal、Connectors、ngrok、CI 模板 |

### 3.2 阶段划分

| 阶段 | 目标 | 用户体感 |
|------|------|----------|
| **P0 可用** | Code Wiki 成为原生知识库 | 打开设置 → 勾选智能体 → init/update → 会话可读 wiki |
| **P1 完整** | Personal + Connectors + Auth + 调度 | 个人脑、数据源、定时更新可用 |
| **P2 打磨** | CI、高级调试、运维增强 | 工作流模板、dry-run、诊断面板 |

### 3.3 完整能力 → 阶段矩阵

| OpenWiki 能力 | 是否保留 | 阶段 | VeryAgent 落地形态 |
|---------------|----------|------|--------------------|
| Code mode wiki | 是 | P0 | 仓库 `openwiki/` + 设置页 |
| Personal mode wiki | 是 | P1 | `~/.veryagent/openwiki/wiki` 或桥接 `~/.openwiki/wiki` |
| init | 是 | P0 | 按钮 + slash + API |
| update | 是 | P0 | 按钮 + 自动策略 + API |
| chat / -p | 是 | P0（基础）/ P1（完整面板） | 任务面板 + 可选 slash |
| AGENTS.md / CLAUDE.md 注入 | 是 | P0 | 可开关；只改 OPENWIKI 块 |
| INSTRUCTIONS.md 编辑 | 是 | P0 | 设置页文本编辑 |
| 智能体权限勾选 | 是（VeryAgent 新增） | P0 | 对齐 Vision Bridge |
| Provider / model / key | 是 | P0 | 设置表单；可复用/桥接 env |
| Connectors 管理 | 是 | P1 | 连接器列表 + 实例配置 |
| auth / OAuth | 是 | P1 | 认证向导 |
| ingest | 是 | P1 | 「立即摄取」动作 |
| cron 调度 | 是 | P1 | VeryAgent 内置 scheduler（非 launchd） |
| ngrok | 是 | P2 | 仅 Slack 场景显示 |
| auth tools / dry-run | 是 | P2 | 高级模式 |
| CI workflow | 是 | P2 | 「生成 workflow 文件」 |
| Ink TUI | 不复刻 | — | 原生 UI 替代，能力不丢 |

**结论：剩下 70%～80% 不是不能用，是放入 P1/P2，并且部分要适配实现。**

---

## 4. 功能整合设计

### 4.1 架构（对齐 Vision Bridge）

```text
Frontend (settings/open-wiki + session inject)
    │  Tauri command / Web handler
    ▼
commands/openwiki.rs
    │
    ├─ config (app_metadata / AppState runtime)
    ├─ permission (agent_types + capability matrix)
    ├─ runner  (白名单调用 openwiki CLI / 后续可换本地引擎)
    └─ inject  (会话启动时按权限注入 wiki 摘要/路径提示)
```

建议模块：

| 层 | 路径建议 | 职责 |
|----|----------|------|
| Runtime config | `src-tauri/src/openwiki/config.rs` | 热更新配置、权限查询 |
| Runner | `src-tauri/src/openwiki/runner.rs` | 白名单命令执行、日志、取消 |
| Commands | `src-tauri/src/commands/openwiki.rs` | get/save config、run、status |
| Web handlers | `src-tauri/src/web/handlers/openwiki.rs` | Web 模式同构 API |
| Settings UI | `src/components/settings/openwiki-settings.tsx` | 后台页 |
| Route | `src/app/(main)/settings/open-wiki/page.tsx` | 设置路由 |
| API | `src/lib/api.ts` + `tauri.ts` | 前端封装 |
| Session inject | ACP connect / prompt 前处理 | 按 agent 权限注入 |

### 4.2 与智能体的关系

OpenWiki **不是**又一个对话 Agent，而是：

1. **知识层**：给已授权智能体提供仓库/个人 wiki 上下文  
2. **维护层**：用户或授权智能体可触发 init/update  
3. **连接层（P1）**：从外部源摄取知识

默认：智能体只能 **读**；不能默认 **写/更新**。

### 4.3 会话注入策略（P0）

当 `enabled=true` 且当前 agent 在可读列表中：

1. 检查工作区是否存在 `openwiki/`  
2. 读取索引/摘要（优先 overview / TOC，避免整库塞 prompt）  
3. 注入简短指引：  
   - wiki 根路径  
   - 建议先读哪些页  
   - 是否允许请求 update  
4. 若开启 `inject_agents_md`，维护根目录 `AGENTS.md`/`CLAUDE.md` 的 OPENWIKI 块

未授权 agent：完全不注入、不暴露 openwiki 命令。

---

## 5. 权限管理（核心）

### 5.1 配置模型

```ts
type OpenWikiAgentCapability =
  | "read_wiki"
  | "request_update"
  | "request_init"
  | "request_chat"

type OpenWikiAgentPermission = {
  agent_type: AgentType
  capabilities: OpenWikiAgentCapability[]
}

type OpenWikiConfig = {
  enabled: boolean
  modes: {
    code: boolean
    personal: boolean
  }
  // 兼容简单勾选：仅 read 时可用 agent_types_list
  agent_types_list: AgentType[]
  // 细粒度权限（优先）
  agent_permissions: OpenWikiAgentPermission[]
  inject: {
    on_session_start: boolean
    inject_agents_md: boolean
    inject_mode: "summary" | "path_only" | "summary_and_path"
  }
  auto_update: {
    enabled: boolean
    on_git_change: boolean
    schedule_cron?: string | null
  }
  model: {
    use_openwiki_env: boolean
    provider?: string | null
    model_id?: string | null
    // secrets 不进前端明文回显策略与 Vision Bridge 对齐
  }
  paths: {
    code_wiki_dirname: string // default "openwiki"
    personal_wiki_root?: string | null
  }
  commands: {
    allow_init: boolean
    allow_update: boolean
    allow_chat: boolean
    allow_ingest: boolean
    allow_cron: boolean
    allow_auth: boolean
    advanced_enabled: boolean // dry-run / auth tools / ngrok
  }
  ignore_patterns: string[]
}
```

### 5.2 UI 交互

参考 `vision-bridge-settings.tsx`：

1. 总开关  
2. 智能体 Checkbox 网格（基础：是否开放 read）  
3. 展开行可细调 capabilities（update/init/chat）  
4. 保存后热更新 `AppState`，无需重启

### 5.3 运行时校验

```text
is_enabled_for_agent(agent, cap) =
  config.enabled
  && agent in permissions
  && cap in agent.capabilities
```

所有 runner 入口、会话注入、slash 命令都必须走该校验。

### 5.4 默认策略建议

| 能力 | 默认 |
|------|------|
| read_wiki | 用户手动勾选后开启；不默认全开 |
| request_update | 默认关 |
| request_init | 默认关 |
| request_chat | 默认关（或与 read 绑定，产品可定） |

---

## 6. 命令接入设计

### 6.1 原则

- **都能接入**，但不是每个命令一个总开关  
- 使用 **Feature flags + Agent permission + Command whitelist** 三层控制  
- 禁止 `openwiki ${userArbitraryArgs}` 直接拼接

### 6.2 白名单动作

| Action ID | 对应 OpenWiki | 阶段 | 触发入口 |
|-----------|---------------|------|----------|
| `code.init` | `openwiki code --init` | P0 | 设置页 / slash / API |
| `code.update` | `openwiki code --update` | P0 | 设置页 / 自动 / slash |
| `code.chat` | `openwiki code -p "..."` 或 chat | P0/P1 | 面板 / slash |
| `personal.init` | `openwiki personal --init` | P1 | 设置页 |
| `personal.update` | `openwiki personal --update` | P1 | 设置页 / 调度 |
| `personal.chat` | personal chat | P1 | 面板 |
| `ingest.run` | `openwiki ingest ...` | P1 | 连接器页 |
| `cron.list` | `cron list` | P1 | 调度页（或内部 API） |
| `cron.pause` | `cron pause` | P1 | 调度页 |
| `cron.resume` | `cron resume` | P1 | 调度页 |
| `cron.delete` | `cron delete` | P1 | 调度页 |
| `auth.oauth` | `auth <provider>` | P1 | 认证向导 |
| `auth.configure` | `auth configure` | P1 | 高级 |
| `auth.tools` | `auth tools` | P2 | 高级 |
| `ngrok.start` | `ngrok start` | P2 | Slack 专用 |
| `dev.dry_run` | `--dry-run` | P2 | 高级 |

### 6.3 命令是否「都可以设置」？

| 类别 | 设置方式 |
|------|----------|
| 核心动作 init/update/chat | Feature flag + agent capability |
| ingest/cron/auth | 管理 UI + 白名单；按 source/provider 配置，不散成一堆命令开关 |
| modelId/mode/print | 运行参数（后台默认 + 单次覆盖） |
| api-key/langsmith-key | 设置表单替代聊天 slash |
| dry-run/ngrok/auth tools | `advanced_enabled` 下可见 |

### 6.4 Slash / 快捷入口建议（P0）

在 VeryAgent 会话中（仅授权 agent 会话或全局命令面板）：

- `/wiki`：查看状态 / 摘要  
- `/wiki-update`：请求 update（需 `request_update`）  
- `/wiki-init`：请求 init（需 `request_init`）  

不直接暴露原始 `openwiki ...` 任意参数。

### 6.5 Runner 约束

1. 可配置 `openwiki` 可执行路径（bundled / PATH / 自定义）  
2. 工作目录 = 当前 workspace（code）或 personal root  
3. 流式日志回传到任务面板  
4. 可取消  
5. 退出码与错误结构化返回  
6. 密钥只通过 env / 安全存储注入，不进日志

---

## 7. 后台设置（完整）

入口：`设置 → Open Wiki`（独立侧边栏，类似 Vision Bridge）

### 7.1 页面信息架构

```text
Open Wiki
├── 1. 总览
│   ├── 总开关 enabled
│   ├── 当前状态：未初始化 / 就绪 / 更新中 / 失败
│   ├── 最近更新时间、git head、页数（能取则显示）
│   └── 快捷操作：初始化 / 立即更新 / 打开 wiki 目录
├── 2. 智能体共享（权限）
│   ├── 智能体勾选（read）
│   └── 每行细粒度：update / init / chat
├── 3. 模式与路径
│   ├── Code mode 开关
│   ├── Personal mode 开关（P1 可先灰显说明）
│   ├── code wiki 目录名（默认 openwiki）
│   └── personal 根路径
├── 4. 注入策略
│   ├── 会话启动注入
│   ├── 注入模式 summary / path_only / both
│   └── 维护 AGENTS.md / CLAUDE.md 块
├── 5. 生成与模型
│   ├── allow init/update/chat
│   ├── 自动更新策略
│   ├── provider / model
│   └── API key / LangSmith（表单，不走聊天）
├── 6. 指令 Brief
│   └── 编辑 openwiki/INSTRUCTIONS.md（及 personal brief）
├── 7. 连接器（P1）
│   ├── 列表 / 多实例
│   ├── 认证状态
│   ├── 立即 ingest
│   └── notes / schedule
├── 8. 调度（P1）
│   ├── 任务列表
│   ├── pause/resume/delete
│   └── Windows 友好的 cron 表达
└── 9. 运维 / 高级（P1–P2）
    ├── 重建 / 清理
    ├── 日志与失败原因
    ├── 生成 CI workflow
    └── advanced：dry-run / ngrok / auth tools
```

### 7.2 后台 API 清单

| API | 说明 | 阶段 |
|-----|------|------|
| `openwiki_get_config` | 读配置 | P0 |
| `openwiki_save_config` | 存配置并热更新 | P0 |
| `openwiki_status` | 状态摘要 | P0 |
| `openwiki_run` | 白名单动作执行 | P0 |
| `openwiki_cancel` | 取消任务 | P0 |
| `openwiki_get_instructions` / `save_instructions` | brief | P0 |
| `openwiki_list_pages` / `read_page` | 浏览 wiki | P0/P1 |
| `openwiki_list_connectors` | 连接器 | P1 |
| `openwiki_auth_start` | OAuth | P1 |
| `openwiki_ingest` | 摄取 | P1 |
| `openwiki_cron_*` | 调度 | P1 |
| `openwiki_generate_ci` | CI 模板 | P2 |

### 7.3 配置持久化

- 使用 `app_metadata`（与 Vision Bridge / system settings 一致）  
- 启动时 `apply_persisted_openwiki_config` 填入 `AppState`  
- secrets：优先 OS 安全存储或现有密钥方案；至少保证前端不明文落盘日志

---

## 8. 后台完善：除了设置页还要什么

为让整体「完善」，后台/系统侧还需要这些能力：

| 能力 | 为什么需要 |
|------|------------|
| 任务队列 + 状态机 | init/update/ingest 是长任务，要可看可取消 |
| 日志环缓 | 失败可诊断，不刷屏污染会话 |
| 权限中间件 | 所有入口统一鉴权 |
| 工作区绑定 | 多工作区时 code wiki 跟 workspace 走 |
| 可执行文件探测 | 未安装 openwiki 时给出安装/捆绑指引 |
| 健康检查 | provider key 缺失、wiki 损坏、路径无权限 |
| 事件推送 | 更新完成通知前端（SSE/Tauri event） |
| 并发控制 | 同 workspace 同时只允许一个写任务 |
| 卸载/关闭策略 | enabled=false 时停止调度、停止注入 |

---

## 9. P0 详细落地范围（先做到「能用且原生」）

### 9.1 必做

1. Open Wiki 设置页（总开关、权限勾选、模型、注入、init/update）  
2. 配置持久化 + 热更新  
3. Command Bridge：`code.init` / `code.update` / 基础 status  
4. 会话注入（只对授权 agent）  
5. `INSTRUCTIONS.md` 编辑  
6. 可选维护 `AGENTS.md`/`CLAUDE.md` OPENWIKI 块  
7. 任务日志面板（最小）  
8. i18n 文案  
9. 单测：权限判断、配置序列化、注入块改写纯函数

### 9.2 P0 明确不做（但文档保留，后续做）

- Personal mode 完整 UI  
- Connectors / OAuth / ngrok  
- cron 调度  
- CI 生成  
- 完整 wiki 浏览器（可用「打开目录」顶上）

### 9.3 验收标准（P0）

1. 关闭总开关后，任何 agent 都读不到 wiki 注入。  
2. 只勾选 Claude 时，Codex 会话无 wiki 上下文。  
3. 授权 agent 可在设置页一键 init/update 成功。  
4. update 只改 OPENWIKI 块，不破坏用户 `AGENTS.md` 其它内容。  
5. 未授权 agent 调 `/wiki-update` 被拒绝。  
6. Web / Tauri 两套 API 行为一致（若该功能在 Web 暴露）。

---

## 10. P1 / P2 路线

### P1

- Personal mode  
- Connectors 管理与多实例  
- auth 向导（gmail/notion/x/slack）  
- ingest  
- VeryAgent 内置调度替代 launchd  
- wiki 页面浏览/搜索  
- 更完整 chat 面板

### P2

- CI workflow 生成  
- ngrok 辅助  
- dry-run / auth tools  
- 更细运维：损坏修复、迁移 `~/.openwiki`  
- 可选：减少 CLI 依赖，局部内嵌引擎

---

## 11. 与现有 VeryAgent 能力的映射

| VeryAgent 现有 | OpenWiki 复用方式 |
|----------------|-------------------|
| Vision Bridge 设置页 | 总开关 + agent 勾选 UX |
| Skill Agent Matrix | 细粒度权限矩阵 UX 参考 |
| app_metadata | 配置存储 |
| AppState runtime config | 热更新权限 |
| model-providers | 可桥接模型配置，避免双套密钥 |
| logs 设置 | 任务日志展示风格 |
| chat-channels / pet 权限卡 | 权限请求交互可参考（若 agent 申请 update） |

---

## 12. 风险与决策

| 风险 | 处理 |
|------|------|
| 依赖外部 `openwiki` CLI | P0 支持 PATH/自定义路径；后续可 bundled |
| Windows 无 launchd | 自建 scheduler，不宣称 1:1 复用 mac 实现 |
| 长任务阻塞 UI | 异步任务 + 事件流 |
| Prompt 膨胀 | 默认 summary/path，不整库注入 |
| 密钥泄露 | 日志脱敏；表单替代 slash 贴 key |
| 与用户已有 `~/.openwiki` 并存 | 允许桥接现有目录，不强制迁移 |

### 待产品确认（不影响方案骨架）

1. Personal mode 是否进 P0 灰显入口，还是 P1 再出现？  
2. `request_chat` 是否默认跟随 `read_wiki`？  
3. 模型密钥：复用 VeryAgent providers，还是独立 OpenWiki env？  
4. 是否捆绑 openwiki 到安装包？

---

## 13. 预估工作量（粗估）

| 部分 | 工作量 | 阶段 |
|------|--------|------|
| 配置模型 + 持久化 + 权限 runtime | 中 | P0 |
| 设置页（总览/权限/注入/模型/brief） | 中 | P0 |
| Runner 白名单 + 日志 | 中 | P0 |
| 会话注入 + AGENTS 块 | 中 | P0 |
| 测试与 i18n | 中 | P0 |
| Connectors + Auth | 高 | P1 |
| Scheduler | 中高 | P1 |
| CI / 高级运维 | 中 | P2 |

P0 建议按「可合并的垂直切片」交付：先 config+权限+status，再 runner init/update，再 inject。

---

## 14. 实施顺序（建议）

1. 定义 `OpenWikiConfig` 与 metadata key  
2. 后端 get/save/status + AppState  
3. 设置页骨架 + 智能体勾选  
4. Runner：init/update  
5. 会话注入 + 权限拦截  
6. INSTRUCTIONS 编辑 + AGENTS 块  
7. 补测试  
8. 开 P1：personal/connectors/scheduler

---

## 15. 总结（直接回答三个关键问题）

### Q1：是不是只覆盖 20%～30%，剩下不能用？

**不是。**  
20%～30% 是「当时方案写到的深度」。OpenWiki 功能默认都保留，按 P0/P1/P2 接入。

### Q2：咱们怎样？

**分阶段原生整合：**

- **P0**：Code Wiki + 智能体权限 + init/update + 注入 + 后台核心设置  
- **P1**：Personal + Connectors + Auth + 调度  
- **P2**：CI、ngrok、高级诊断  

### Q3：命令是不是都可以设置？

**都能接入，不都做成零散开关。**  
用「功能开关 + 智能体权限矩阵 + 命令白名单」三层控制，既完整又好用。

---

## 16. 文档状态

- [ ] 产品确认阶段边界（第 12 节 4 个问题）  
- [ ] 评审通过后改状态为「已确认」  
- [ ] 开工后在 `DEV_STATUS.md` 增加跟踪项  
