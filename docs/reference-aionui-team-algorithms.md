# AionUi 团队功能核心算法研究（参考）

> 状态：**参考文档**（用于 `plan-team-collaboration.md` 的设计参考）
> 创建：2026-08-10
> 来源：反编译 AionUi 安装包 + 精读 AionCore 开源源码
> 关联方案：`docs/plan-team-collaboration.md`

---

## 一、来源

- **AionUi**（Electron 前端，31.8k stars）：`https://github.com/iOfficeAI/AionUi`
- **AionCore**（Rust 后端引擎）：`https://github.com/iOfficeAI/AionCore`
  - 核心 crate：`crates/aionui-team`（团队引擎）
  - 提示词 crate：`crates/aionui-team-prompts`（Lead/Teammate 角色提示词）
  - 文档：`crates/aionui-team/docs/{api,internals,mcp,frontend-guide}.md`
- 两者均 Apache-2.0，**团队功能的运行引擎在 AionCore（Rust），完全开源**。

## 二、团队架构总览

```
用户 HTTP REST (/api/teams)
        │
   ┌────▼────┐
   │TeamSession│ 每 team 一份（内存）
   └─┬──────┬─┘
     │      │
 ┌───▼──┐ ┌──▼─────────────┐
 │Scheduler│ │TeamMcpServer │ 127.0.0.1:随机端口
 └───┬───┘ └───┬───────────┘  Agent 通过 TCP+JSON-RPC 连接
     │         │
 ┌───▼───┐ ┌───▼─────┐
 │Mailbox│ │TaskBoard │ 均 SQLite
 └───────┘ └─────────┘
```

核心模型：**一个 Lead + N 个 Teammate，共享任务板与邮箱，Lead 派单、Teammate 执行、
完成后通知 Lead 汇总。**

## 三、数据模型（SQLite 迁移代码还原）

```sql
-- teams 表（v19 初始 + v20 lead_agent_id + v23 session_mode）
teams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  workspace TEXT NOT NULL,           -- 共享工作目录
  workspace_mode TEXT DEFAULT 'shared',
  agents TEXT DEFAULT '[]',          -- 成员 JSON 数组
  lead_agent_id TEXT DEFAULT '',
  session_mode TEXT,                 -- v23 新增
  created_at INTEGER, updated_at INTEGER
)

-- mailbox 表（agent↔agent 消息信箱）
mailbox (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,
  type TEXT DEFAULT 'message',       -- message / idle_notification / shutdown_request
  content TEXT NOT NULL,
  summary TEXT,
  read INTEGER DEFAULT 0,
  created_at INTEGER,
  INDEX idx_mailbox_to (team_id, to_agent_id, read)
)

-- team_tasks 表（任务板，带依赖）
team_tasks (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',     -- pending / in_progress / completed / failed
  owner TEXT,                        -- 负责人 slot_id
  blocked_by TEXT DEFAULT '[]',      -- 依赖（JSON）
  blocks TEXT DEFAULT '[]',
  metadata TEXT DEFAULT '{}',
  created_at INTEGER, updated_at INTEGER,
  INDEX idx_tasks_team (team_id, status)
)
```

## 四、Agent 状态机

```
               try_wake() (收到新消息)
               ┌─────────────────────────┐
               ▼                         │
          ┌────────┐   Idle→Working   ┌───┴────┐
          │  Idle  │ ───────────────▶ │Working │
          └────────┘                 └───┬────┘
               ▲                        │
               │ finalize_turn() / mark_idle()
               └────────────────────────┘

状态枚举: Idle / Working / Thinking / ToolUse / Completed / Error
```

**不变式**（防死锁核心）：
- 单回合消息**至多一次投递**（`read_unread_and_mark` 原子操作）
- **Lead 绝不自唤醒**（`mark_idle` 针对 lead 立刻返回 None）
- 同一 agent 不会被重复唤醒（`try_wake` 非 Idle 直接 None）
- 一回合的所有 action 在下一次 wake 前执行完毕
- **Lead 永不被 shutdown**（`team_shutdown_agent` target=Lead 直接拒绝）
- remove_agent 清掉所有 scheduler 状态（active_wakes / wake_timeouts / finalized_turns）

## 五、wake → dispatch 时序（核心调度）

```
User  HTTP   TeamSession  Scheduler  Mailbox  ConvService  MCP Server  Agent
 │    │        │            │         │         │            │         │
 │ POST /messages ─▶ │        │         │         │            │         │
 │    │      send_message ─▶│         │         │            │         │
 │    │        │   mailbox.write ─────────▶       │            │         │
 │    │        │   wake_and_dispatch ─▶ │         │            │         │
 │    │        │            │ try_wake ──▶       │            │         │
 │    │        │            │◀─ Idle→Working     │            │         │
 │    │        │            │ read_unread ─▶ │ (原子标记已读) │         │
 │    │        │            │                │            │         │
 │    │        │  tokio::spawn(conv_service.send_message) ────▶│         │
 │◀── 200 OK ──│            │                │            │         │
 │    │        │            │                │ 启动 agent ──┼────────▶ │
 │    │        │            │                │            │◀─ connect │
 │    │        │            │                │            │── tools/call ◀─│
 │    │        │◀─ execute_action ───────────┼─────────────────────────│
 │    │        │            │                │            │── 结果 ──▶│
 │    │        │◀─ finalize_turn(actions) ───│            │            │
 │    │        │   mark_idle ──▶             │            │            │
 │    │        │   broadcast team.agentStatusChanged        │            │
 │    │        │   maybe_wake_lead (若都 idle)              │            │
```

关键点：
- HTTP 立刻 200 返回，agent 回合在 `tokio::spawn` 里跑，失败会 rollback 到 Idle
- 用户消息**不走 mailbox**（直接单聊 API 写 messages 表，走常规 send/stream）
- mailbox 只承载 agent 内部消息（派单、汇报、下线）

## 六、Mailbox 三种消息

| type | 用途 |
|------|------|
| `message` | agent→agent（lead 派单、teammate 汇报） |
| `idle_notification` | teammate 完成后写给 lead（带 summary）→ 触发 maybe_wake_lead |
| `shutdown_request` | lead 要求某 teammate 下线 |

所有读路径走 `read_unread`（原子标记已读），邮箱**不对外暴露 HTTP**。

## 七、Team MCP Server（Agent ↔ 调度器桥梁）

- 每个 team session 启动时在 `127.0.0.1:<随机端口>` 起 HTTP MCP server
- **帧格式**：`[4 字节 big-endian 长度 | JSON-RPC 2.0 负载]`，上限 10 MiB
- **鉴权**：第一条必须是 `initialize(auth_token, slot_id)`，否则 INVALID_REQUEST；
  `slot_id` 被记住，后续工具调用以此身份鉴权（判断是否 Lead）
- Tool 业务错误走 `result.isError=true` + 文本（MCP 惯例），不走 JSON-RPC error

### 工具清单（8 个）

| # | 工具 | 权限 | 作用 |
|---|------|------|------|
| 1 | `team_send_message` | 任意 | 给某 slot 发消息；`to="*"` 广播（排除自己） |
| 2 | `team_spawn_agent` | **Lead only** | 动态拉起新 teammate（⚠️ 后端空壳） |
| 3 | `team_task_create` | 任意 | 新建任务 |
| 4 | `team_task_update` | 任意 | 改状态 / owner / 依赖 |
| 5 | `team_task_list` | 任意 | 列所有任务 |
| 6 | `team_members` | 任意 | 列当前成员+状态 |
| 7 | `team_rename_agent` | 任意 | 改 slot 显示名 |
| 8 | `team_shutdown_agent` | **Lead only** | 请求某 teammate 下线 |

AionUi 参考实现有 10 个，多 `team_describe_assistant` / `team_list_models`（后端未实现）。
Spawn 白名单：`SPAWN_BACKEND_WHITELIST = ["claude", "codex"]`（AionCore），
`capability::is_team_capable_backend` 允许 `claude / codex / gemini / aionrs`。

## 八、MCP 注入机制（动态注入的关键设计）

**问题**：MCP 工具列表在 agent `session/new` 时锁定，无法热插拔；team session 动态创建。
**解法**：conversation 不变 + agent 进程重启 + session resume。

```
conversation_id = "conv_123" ← 不变，消息历史完整保留
agent 旧进程 (session_id=abc) ← kill
agent 新进程 (session_id=def) ← rebuild，带 team MCP config
└─ resume 旧 session 上下文（如果 backend 支持）
```

- 通过 ACP 标准 `session/new → mcpServers` 声明注入
- `conversation.extra` 写入 `teamMcpStdioConfig: { port, token, slot_id }`
- 最小侵入：`AcpBuildExtra` 加 `#[serde(default)] Option<TeamMcpStdioConfig>`，
  旧 extra 无此字段 → None → 单聊零影响
- session resume：Claude/CodeBuddy 用 `_meta.claudeCode.options.resume`；
  Codex 用 `session/load`；其他用 `resumeSessionId`

## 九、卡住检测 / 崩溃处理（Watchdog）

| 场景 | 检测 | 处理 |
|------|------|------|
| Agent 进程退出 / stream Error | `detect_crash` 纯函数 | 写 testament 到 lead mailbox、kill 进程、teammate 崩则唤醒 lead；lead 崩走 leader-crash 分支 |
| Agent 卡死（Working 不动） | `handle_inactivity_timeout` 看门狗 + `wake_timeouts` | 到期回滚到 Idle，重新 wake |
| 429 / rate limit | `is_rate_limited` 分类器 | 走 crash handler 的限流分支 |
| 同一回合重复 finalize | `finalized_turns` 5s 去重表 | 第二次直接丢弃 |

## 十、Leader / Teammate 提示词（核心算法，纯文本可移植）

### Leader（Lead）提示词关键规则

1. **不亲自干活**："You coordinate a team of AI agents. You do NOT do implementation work yourself."
2. **拆解流程**：收请求 → 分析是否够 → `team_members` 确认花名册 →
   `team_list_assistants` 选助手 → 文本提出人员方案（表格：名字/职责/建议助手）→
   等用户确认 → 才 `team_spawn_agent` 建人
3. **派活用任务板**：`team_task_create` 指定 owner **自动通知并唤醒对方**，
   不需要单独 `team_send_message` 派活
4. **依赖任务必须串行派发（关键防超时）**：
   - ❌ 不要给 B 派"等 A 完成"的任务（B 会挂机等 → 300s 超时 → 判失败）
   - ✅ 先派 A（owner=A）→ 等 A 的 idle_notification → 再派 B
5. **idle 不是错误**：teammate 每回合结束 idle 是正常的，idle = 等输入
6. **下线流程**：用户说"fire/dismiss/下线" → 用 `team_shutdown_agent`（不是发消息）

### Teammate 提示词关键规则

1. **Standing by = 结束回合**（关键防超时）："standing by" 意味着结束当前 turn，
   不是生成等待文本。系统会在新 mailbox 消息到达时重新唤醒。
   - 系统保持 idle 状态，新消息到达**立即重新唤醒**
   - 如果一直开着 LLM 流等待 → 命中 300s 超时 → 标记失败
2. **工作流**：读未读 → 开始任务（`team_task_update` in_progress）→ 干活 →
   `team_task_update` completed → `team_send_message` 汇报结果给 leader
3. **卡住求助**：卡住时发消息给 leader 请求指导
4. **shutdown 协议**：同意 → 发 `shutdown_approved`；拒绝 → `shutdown_rejected: 原因`

## 十一、已知 Bug（移植要避开）

| # | 问题 | 现象 |
|---|------|------|
| 1 | Agent 中途崩溃导致消息丢失 | `read_unread` 已标已读但 agent 没处理完就挂了 |
| 2 | WAKE_TIMEOUT 卡死保护未完成 | agent 卡在 Working 永不恢复，新消息静默入队 |
| 3 | `team_spawn_agent` 是空壳 | Lead 调了但新 agent 不会真的加进调度器 |
| 4 | 任务依赖无环检测 | A blocked_by B、B blocked_by A 可创建，互相死锁 |
| 5 | `list_teams` 不按 user_id 过滤 | 任意登录用户能列出所有人的 team |

## 十二、对 VeryAgent 移植的启示

### 可直接借鉴

- **Lead/Teammate 提示词**（纯文本，直接翻译适配）—— 这是"拆解任务"的核心算法
- **任务依赖模型**（owner / blocked_by / blocks）
- **idle_notification 唤醒机制**（依赖完成 → 唤醒 Leader）
- **卡住检测思路**（inactivity timeout + rollback + re-wake）
- **依赖任务串行派发**（防 LLM 流超时）

### 需要改造

- VeryAgent 已有 `DelegationBroker` + `delegate_to_agent` + 会话体系，可叠加团队层
- 状态机 / wake 机制用 VeryAgent 现有 `ConnectionManager` 事件驱动
- MCP 工具命名 team_* → veryagent 风格（或扩展 delegate 工具）
- 心跳机制复用 VeryAgent 的 automation（cron）引擎

### 必须避开的坑

- team_spawn_agent 空壳 → 我们直接实现真实创建
- MCP 写 mailbox 不 wake（bug #2）→ 我们写后主动 wake
- 任务依赖无环检测缺失（bug #4）→ 我们加环检测
- list_teams 不按 user 过滤（bug #5）→ 我们加过滤

## 十三、文档来源链接

- AionUi README（Team Mode 章节）：`https://github.com/iOfficeAI/AionUi`
- AionCore 团队 crate：`https://github.com/iOfficeAI/AionCore/tree/main/crates/aionui-team`
- 内部调度文档：`crates/aionui-team/docs/internals.md`
- MCP 通信文档：`crates/aionui-team/docs/mcp.md`
- 提示词源码：`crates/aionui-team-prompts/src/role_prompt.rs`
