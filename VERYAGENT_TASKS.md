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

- [ ] 手动验收矩阵（Claude / Pi / OpenCode / CodeBuddy 原生+A计划；Codex 告警）
- [ ] 正式包构建与冒烟测试
- [ ] AI 总结后端对接（当前只有提取式摘要）
- [ ] OpenClaw 模型鉴权流程完善

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
