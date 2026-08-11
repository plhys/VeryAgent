# VeryAgent 开发任务追踪

> 最后更新：2026-08-12

---

## 当前进行中：团队协作 Step 1（2026-08-12）

### ✅ 已完成
- **侧边栏「团队协作」入口**：独立入口 + 上下分割线（`sidebar.tsx`、workbench route `"team"`）
- **创建团队 UI**（`src/components/team/team-page.tsx`）：
  - 预设模板：3人组(领班+开发+测试) / 4人组(+文档) / 5人组(双开发+审查)
  - 角色标签 → 点击/拖拽分配到智能体（一人最多 3 角色，领班唯一必选）
  - 团队名 + 工作目录选择（「选择文件夹…」按钮直接弹系统选择器，空态友好提示）
  - 实时校验（角色数 3~5 / 智能体 2~5 / 领班 / 名称 / 目录）
- **后端**（`src-tauri/src/db/` + `commands/team.rs`）：
  - 三表 `team` / `team_slot` / `team_task` + 迁移 `m20260811_000001_team`
  - `team_service.rs`：CRUD + 任务生命周期；9 个 Tauri 命令；`team://changed` 事件；Axum handler + 路由
  - **踩坑记录**：SQLite 下 String 主键用 `Entity::insert().exec()`（`.insert()` 会因 last_insert_rowid 反查报 `RecordNotFound`）
- **领班对话 + 右侧成员面板**（`team-side-panel.tsx` + `team-context.tsx`）：
  - 创建成功 → 自动打开领班对话，右侧垂直等大成员小窗（头像/角色徽章/状态/小字内容区）
  - 点击小窗 → 放大 Dialog
  - **修复**：面板"时灵时不灵" = 后端 `team://changed` 异步刷新时序 → 前端乐观绑定 `bindLeaderConversation`
  - **修复**：Mobile 布局分支（≤767px）漏挂 TeamSidePanel
- **顺带修复**：`toErrorMessage` 空对象兜底；`normalizeKeyToken` 空值保护；错误消息 sanitize（防特殊字符破坏 IPC）

### ⏳ 未完成（明天继续）
- [ ] **派活功能**：选成员 → 填任务 → 拉起成员会话（成员小窗开始实时滚动）
- [ ] 成员小窗实时流（复用现有 liveMessage / acp-connections 机制）
- [ ] 团队列表/详情页（当前只有创建 + 领班对话）
- [ ] 删除团队、工作区团队标识（图标/颜色）

---

## ⚠️ 已知问题：智能体全部连不上（待诊断，优先级高）

**现象**：任何对话发消息即报
```
ACP protocol error: Internal error: Not Found: 404 page not found: { "errorName": "APIError", "service": "session" }
```
（另见：claude 报 `422 model not found: claude-opus-4-8`）

**已排除**：
- ✅ veryagent ↔ agent 的 ACP 协议层兼容（`session/prompt` 方法正确；`turn/prompt` 是旧名）
- ✅ claude-agent-acp 0.55.0、opencode `acp` 的 initialize / session/new 握手正常
- ✅ claude / opencode CLI 均可用（claude 2.1.220 / opencode 1.18.4）

**嫌疑 / 下一步**：
- ❓ `404 service: session` 来自运行时某内部环节 —— **读 `veryagent-run.log`**（已用日志模式启动：`cmd /c "veryagent.exe > veryagent-run.log 2>&1"`）
- ❓ veryagent-mcp sidecar 注入（session/new.mcpServers）是否失败
- ❓ 模型供应商 `AxonHub`(10.10.100.10:18080) 非标准 API（`/models` 返回 HTML），模型映射 `claude-opus-4-8` 不存在 → 422
- ⚠️ `~/.claude/settings.json` 被 Orca 注入 hooks，可能干扰
- ⚠️ 绑定了模型供应商时，provider 模型字段权威覆盖用户 env（`acp_update_agent_env_core`），"保存不了模型变量"是此逻辑所致（取消绑定即可恢复用户控制）

---

## 已完成（已在仓库中）

### ✅ commands/acp 拆分（Task A + B）

以下文件均已存在且编译通过：

| 文件 | 行数 | 内容 |
|------|------|------|
| `commands/acp/mod.rs` | 7,967 | Tauri 命令入口 + 辅助函数 |
| `commands/acp/binary.rs` | 635 | npm/uvx 二进制管理、版本解析 |
| `commands/acp/codex_config.rs` | 389 | Codex 配置读写 |
| `commands/acp/cline_config.rs` | 288 | Cline 配置读写 |
| `commands/acp/kimi_config.rs` | 464 | Kimi Code 配置读写 |
| `commands/acp/pi_config.rs` | 238 | Pi 配置读写 |
| `commands/acp/openclaw_config.rs` | 480 | OpenClaw 配置 |
| `commands/acp/hermes_config.rs` | 593 | Hermes 配置 |
| `commands/acp/codebuddy_config.rs` | 127 | CodeBuddy 配置 |
| `commands/acp/skills.rs` | 170 | 技能存储 |
| `commands/acp/general.rs` | 843 | 通用工具函数 |

> ⚠️ 注意：原计划中的 `commands/acp/commands.rs` 并未创建，Tauri 命令仍集中在 `mod.rs`。

### ✅ acp/lifecycle.rs 存在但功能未迁移

`src-tauri/src/acp/lifecycle.rs`（2,891 行）已存在，内含 `lifecycle_subscriber_task`
和事件处理辅助函数，但 **manager.rs 的生命周期方法（spawn/cancel/fork/disconnect 等）
尚未迁移至此**——它们仍然留在 `manager.rs` 内。

---

## 当前待办（高优先级）

### 🔴 发版前必须完成

- [x] 手动验收矩阵（Claude / Pi / OpenCode / CodeBuddy 原生+A计划；Codex 告警）— 2026-08-11 验证完毕，所有智能体 OK
- [x] 正式包构建与冒烟测试 — v1.0.0 构建通过（前端/sidecar/Rust release/NSIS 打包/运行冒烟）
- [x] AI 总结后端对接 — `summary.rs` `generate_conversation_summary`（LLM 调用 + 存库）+ 前端 `sidebar-conversation-card` 已接入（394dc05 引入）
- [x] OpenClaw 模型鉴权流程完善 — `write_openclaw_managed_provider` + gateway auth 已实现

> ✅ **v1.0.0 已于 2026-08-11 正式发布**（GitHub Release + 新签名钥 48E87990D9E79ED5）。

---

## 下一步任务（已规划，待实施）

### 🚀 团队协作（Team Collaboration）

完整方案见：**`docs/plan-team-collaboration.md`**
核心算法参考：**`docs/reference-aionui-team-algorithms.md`**（AionUi/AionCore 团队功能研究）

**一句话**：在 VeryAgent 里支持"团队"模式 —— 一个 Leader（项目经理）+ N 个成员并行干活，
Leader 拆解任务、派活、实时监控/汇报，用户只跟 Leader 对话。

**实现顺序（3 步）**：
- [ ] **Step 1 最小闭环**：建团队 + Leader 对话 + 手动派活 + 成员汇报回 Leader
- [ ] **Step 2 任务板 + 心跳 + 卡住检测**：team_tasks 任务板 + Leader 心跳汇报 +
      进程级/静默级卡住检测（复用 HealthCheckPolicy / automation 引擎）
- [ ] **Step 3 诊断修复 + 全景视图 + 换人**：Leader 诊断"假卡住 vs 真卡住"并修复 +
      团队全景视图（并排成员对话）+ 增删/替换成员

**核心设计**：
- 复用现有 Agent（Codex/Claude…）当成员，复用 ConnectionManager / resume / cron
- 监控分层：系统盯进程（快），Leader 做判断（准）
- 卡住机制：进程级自动重启 + Leader 心跳诊断 + 修复指令由系统执行
- 只加 5 个 MCP 工具（team_report / team_get_task / team_get_members /
  team_request_help / team_update_status）
- 前端：创建团队弹窗（多选+角色）→ 侧边栏团队列表 → Leader 对话页（带状态条）→
  团队全景视图（小字号并排）

---

## 待定：宠物系统去重

**已执行：** 保留内嵌宠物（PetFloating），删除独立桌宠系统（/pet 路由、/pet-bubble 路由、召唤按钮、后端 open_pet_window/close_pet_window/pet_window_record_position/hover watcher/context menu/bubble）。pet-panel 会话面板保留（从内嵌宠物角标打开）。
## 可选优化（低优先级，不影响功能）

### 大型文件拆分

以下文件超过 5000 行，可考虑按需拆分。**不紧急**，当前 IDE 导航完全够用。

| 文件 | 行数 | 外部调用者 | 评估 |
|------|------|-----------|------|
| `acp/connection.rs` | 6,915 | ~5 个 | 可与 lifecycle 合并后清理 |
| `acp/manager.rs` | 5,621 | **~25 个** | 拆分成本高，暂缓 |
| `commands/acp/mod.rs` | 7,967 | 0（内部模块） | 中等优先级 |
| `acp/delegation/broker.rs` | 7,554 | 无外部调用 | 最该拆但最难拆 |

### 技术债

- [ ] ESLint：32 条 unused-disable directive
- [ ] Knip：若干 dead export + 2 组重复导出
- [ ] 清理 `wip-image-licensing.md`（已过期的 WIP 文档）
- [ ] `docs/pet-improvement-plan.md` 待实现（见文档）

---

## 已知 Bug（已修复）

- [x] `crypto.rs` 重复表达式 `||` / `&&`（clippy 错误）
- [x] `conversations.rs` / `import_service.rs` 缺少 `summary` 字段（编译错误）
