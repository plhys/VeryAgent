# VeryAgent 开发任务追踪

> 最后更新：2026-07-31

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
- [ ] 正式包构建与冒烟测试
- [ ] AI 总结后端对接（当前只有提取式摘要）
- [ ] OpenClaw 模型鉴权流程完善

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

## 待定：宠物系统去重（独立窗口 vs 内嵌）

**问题**：现在有两套宠物呈现 —— 界面内嵌宠物（`PetFloating`，工作区右下角）和
独立桌宠窗口（`/pet` 路由，可"召唤宠物窗口"）。用户希望**去掉独立的宠物系统**，
只保留界面内嵌的。

**现状**（2026-08-10 排查）：
- 内嵌宠物 `PetFloating`（`src/components/layout/pet-floating.tsx`）复用了 `/app/pet/_components`
  下的 `PetSprite` / `PetBadge` / `usePetState` 等组件
- `PetBadge` 点击会 `togglePetPanel()` → 打开 **pet-panel 独立窗口**（会话面板/处理权限）
- 独立窗口一套：`/pet`（桌宠）+ `/pet-bubble`（气泡）+ `/pet-panel`（会话面板），
  后端在 `src-tauri/src/commands/windows.rs`（`open_pet_window` / `close_pet_window` /
  `pet_window_record_position` / `reposition_pet_bubble` / hover watcher / context menu）
- 内嵌宠物和独立窗口**共用**渲染组件与会话面板，不是两个独立系统

**关键决策点（待用户确认）**：
- A. **彻底删干净**：连 pet-panel 会话面板也删，内嵌宠物只保留纯展示
  （看状态，点不了详情）
- B. **只删"召唤宠物窗口"**：保留 pet-panel 会话面板（从内嵌宠物角标打开），
  只删 `/pet` 独立桌宠窗口 + summon 按钮

**删除范围（若执行）**：
- 前端：`/pet` 路由、`/pet-bubble` 路由、`pet-manager-section` 的 summon 按钮、
  `lib/pet/api.ts` 的 `openPetWindow`/`closePetWindow`/`pet_window_record_position`
- 后端：`windows.rs` 的 `open_pet_window`/`close_pet_window`/`pet_window_record_position`/
  hover watcher/context menu + `tauri_setup.rs` 注册
- 注意保留内嵌宠物依赖的：`PetSprite` / `PetBadge`（去掉 togglePetPanel）/
  `usePetState` / `usePetSessions` / `session-display`

---

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
