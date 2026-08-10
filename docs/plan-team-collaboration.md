# 团队协作（Team Collaboration）方案

> 状态：**下一步任务（待实施）**
> 创建：2026-08-10
> 关联：多智能体协同（delegate_to_agent）的演进，参考 AionUi/AionCore 的 Team Mode 设计

---

## 一、目标

在 VeryAgent 里支持"团队"模式：一个 Leader（项目经理/领班）+ N 个成员（Teammate），
Leader 接收用户目标 → 拆解任务 → 派给成员并行执行 → 实时监控/汇报 → 汇总结果。

核心体验：
- 用户只跟 Leader 对话（单一入口）
- Leader 实时汇报成员进度、谁卡住了、卡在哪
- 可展开"团队全景视图"并排查看所有成员对话

## 二、设计哲学

1. **复用优先**：成员 = 现有 Agent（Codex / Claude / Gemini…），复用
   `ConnectionManager`、`resume`、`HealthCheckPolicy`、`automation`（cron）引擎。
2. **Leader 不是新东西**：是"带特殊提示词的成员 + 被心跳/事件驱动"。
3. **监控分层**：系统盯进程（快、可靠），Leader 做判断（准、有上下文）。
4. **不造复杂调度器**：用"任务板 + 事件驱动"自然产生并行/串行，不做 mailbox /
   复杂状态机。

## 三、数据模型（SQLite，3 张表）

```sql
teams        id TEXT PK, name TEXT, leader_slot_id TEXT,
             workspace TEXT, created_at INTEGER

team_slots   id TEXT PK, team_id TEXT, slot_id TEXT,
             agent_type TEXT, role TEXT(JSON), display_name TEXT,
             status TEXT  -- idle / working / thinking / tool_use / stuck / error

team_tasks   id TEXT PK, team_id TEXT, subject TEXT, description TEXT,
             status TEXT,  -- pending / in_progress / completed / failed
             owner_slot_id TEXT, blocked_by TEXT(JSON 依赖), result TEXT,
             created_at INTEGER
```

- `team_slots.role` = 角色提示词 + 可选技能，存 JSON。
- `team_tasks.blocked_by` 表达依赖 → 有依赖的串行、无依赖的并行。

## 四、核心机制

### 1. 卡住检测（复用 + 一行扩展）

- **进程级**：复用现有 `HealthCheckPolicy`（30s 心跳）→ 进程死 → 自动重启 + resume。
- **静默级**（新增）：成员 60s 无任何流输出 → 标记 `stuck` → 唤醒 Leader 诊断。
- 不做复杂状态机。

### 2. Leader 心跳（复用 automation/cron 引擎）

- 任务进行中，每 15s 触发一个内部任务："查看组员状态并汇报"。
- 有异常（stuck / 成员汇报 / 依赖完成）→ **立即唤醒**（不等心跳）。
- 所有成员空闲 → 心跳停止（省 token）。

### 3. Leader 诊断与修复（LLM 判断 + 系统执行）

- 系统把可疑成员数据包（最后状态、最近的 thinking/工具调用片段）交给 Leader。
- Leader 判断：
  - **假卡住**（大量运算）→ 告诉用户"正常"，延长观察。
  - **真卡住**（语法/函数错误、死循环）→ 给出修复指令。
- 系统执行修复：改任务重派 / 换人（shutdown + spawn）/ 重启后补上下文。
- **自动执行，但重大动作（换人）先在 Leader 对话里问用户确认。**

### 4. 并行 / 串行

- 无依赖任务 → 并行（默认同时最多 3 个成员，可配置）。
- 有依赖任务 → 等前置完成后串行派发（避免成员"stand by"超时）。

## 五、MCP 工具集（成员侧，复用 veryagent-mcp 注入）

只加 5 个，全部走现有 MCP 注入：

| 工具 | 用途 |
|------|------|
| `team_report(进度/结果)` | 成员汇报进度/结果 |
| `team_get_task()` | 查看我的任务 |
| `team_get_members()` | 谁在 / 谁卡了 |
| `team_request_help(问题)` | 卡住了求助 |
| `team_update_status(完成/失败)` | 标记任务状态 |

不搞 mailbox：成员 → Leader 汇报直接走 `team_report` → 系统转发进 Leader 对话。

## 六、前端（4 个组件）

### 1. 创建团队弹窗

- 中央弹出，背景模糊。
- 所有 Agent 图标可多选；**第一个选中的默认 = Leader**（可改，⚑ 标记）。
- 选中后可分配角色（下拉：开发 / 测试 / 文档 / 审查 / 自定义）。
- "组团"按钮 → 创建成功。

### 2. 侧边栏团队列表

- "创建团队"按钮加在侧边栏"技能 / 007"下方。
- 每个团队显示：团队图标 + 成员头像 + 名称。
- 点击 → 打开 Leader 对话。

### 3. Leader 对话页（主界面）

- 普通对话界面，顶部有"展开团队"按钮 + 成员实时状态条（谁在干嘛 / 谁卡了）。

### 4. 团队全景视图（点"展开团队"）

- 并排滚动显示所有成员对话。
- 小字号：思考 / 过程小字，重要信息正常。
- 每个成员卡片：头像 + 状态 + 最近进度（来自 `team_report`）。

## 七、效率考量

- 心跳 token 可控：15s 一次，每次 Leader 简短汇报（几百 token），任务期间才开。
- 不搞真·实时流：成员汇报走"完成时上报"，省资源。
- 并行度上限：默认 3 个（可配置）。
- 进程复用：成员用现有 agent 连接，不重复起进程。

## 八、实现顺序（3 步，每步可独立交付）

### Step 1：最小闭环
建团队 + Leader 对话 + 手动派活 + 成员汇报回 Leader。

### Step 2：任务板 + 心跳 + 卡住检测（系统层）
任务板（team_tasks）+ Leader 心跳汇报 + 进程级/静默级卡住检测。

### Step 3：诊断修复 + 全景视图 + 换人
Leader 诊断修复（假卡住 vs 真卡住）+ 全景视图 + 增删/替换成员。

## 九、参考

- AionUi 团队模式（Leader + Teammate + 任务板 + mailbox）：
  - `https://github.com/iOfficeAI/AionUi`（前端）
  - `https://github.com/iOfficeAI/AionCore`（Rust 后端，`crates/aionui-team`）
- 借鉴点：Leader 提示词（拆解/派单/汇总）、任务依赖（blocked_by）、
  卡住检测（watchdog）、动态扩缩成员。
- 避开点：AionCore 的已知坑 —— team_spawn_agent 空壳、MCP 写 mailbox 不 wake、
  任务依赖无环检测。
