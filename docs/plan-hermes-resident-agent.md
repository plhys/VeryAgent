# 计划：Hermes Agent 常驻集成

**日期**：2025-07-11  
**状态**：生命周期 MVP 已实现（Embedded 离线捆绑仍待定）

---

## 目标

将 Hermes Agent 作为 VeryAgent 的原生常驻管家，实现"同居"而不是"打电话"。

- Hermes 随 VeryAgent 启动预热，随应用退出断开
- idle sweep 不回收 resident Agent
- UI 打开 Hermes 对话时复用暖连接
- **VeryAgent 是入口和显示器，不是第二套记忆大脑** — 长期记忆仍在 Hermes 自己的 `~/.hermes`
- 其他 Agent（Claude Code、Codex 等）保持现有行为不变
- OpenClaw 常驻：后续单独做（session reset / gateway 生命周期）

---

## 已完成（生命周期 MVP）

### 注册与类型

| 项 | 内容 | 文件 |
|----|------|------|
| `resident` 元数据 | Hermes `resident: true`，其余 false | `registry.rs` |
| API 字段 | `AcpAgentInfo` / `AcpAgentStatus.resident` | `types.rs`、`commands/acp.rs`、`types.ts` |
| 列表排序 | resident 优先，再 `sort_order` / name | `commands/acp.rs` |

### 生命周期

| 项 | 内容 | 文件 |
|----|------|------|
| 自动启动 | app / server 启动后 `bootstrap_resident_agents`（best-effort） | `resident.rs`、`lib.rs`、`veryagent_server.rs` |
| 跳过回收 | `sweep_idle` 跳过 resident | `manager.rs` |
| 连接复用 | 无 `session_id` 时复用 live resident 连接 | `manager.rs` |
| 工作目录 | 预热 cwd = Hermes home（`hermes_home_dir`） | `resident.rs` |
| 退出 | 随进程 teardown 断开（现有逻辑） | 现有 |
| 可选关闭预热 | `VERYAGENT_RESIDENT_AGENTS=0\|false\|off` | `resident.rs` |

### 前端

| 项 | 内容 | 文件 |
|----|------|------|
| 常驻标识 | AgentSelector 绿点 + tooltip「常驻管家」 | `agent-selector.tsx` |
| 排序 | enabled 列表中 resident 排前 | `agent-selector.tsx` |
| i18n | `residentBadge` | `zh-CN.json` / `en.json` |
| 切 agent 不杀进程 | 前端 detach-only（不 acpDisconnect）；idle/unmount/disconnectAll 跳过 | acp-connections-context.tsx / isResidentAgent |

| 切 agent 不杀进程 | 前端 detach-only（不 acpDisconnect）；idle/unmount/disconnectAll 跳过 | acp-connections-context.tsx / isResidentAgent |

### 测试

| 项 | 内容 |
|----|------|
| 无 session_id 复用 Hermes | `find_connection_for_reuse_resident_without_session_id` |
| 死连接不复用 | `find_live_resident_connection_skips_dead` |
| idle 不杀 Hermes | `sweep_idle_skips_resident_agent` |
| 非 resident 仍不 dedup | 既有 `find_connection_for_reuse_returns_none_when_session_id_is_none` |

---

## 未做 / 后续

### 一、分发方式（仍待定）

| 项 | 内容 | 文件 |
|----|------|------|
| 离线捆绑 | 安装包自带 `runtime/` 与 `hermes-agent/` | 打包脚本 |
| 路径修复 | 启动时修复 venv `pyvenv.cfg` | 启动逻辑 |
| 注册表 | Hermes 从 `Uvx` 改为 `Embedded` | `registry.rs` |

### 二、OpenClaw 常驻

- 需处理 `OPENCLAW_RESET_SESSION` / gateway 生命周期后再标 `resident: true`

### 三、不需要改（仍成立）

- ACP 协议栈
- 前端消息渲染
- 在 VA 内再造一套 LTM / 用户画像脑
- 其他编程类 Agent 的短会话隔离

---

## 架构边界

```
用户 UI ──► VeryAgent（入口 / 显示器 / 会话列表）
                │
                │  warm ACP process (resident)
                ▼
           Hermes Agent ──► ~/.hermes (state.db / skills / config)
                              ↑ 真正的跨会话记忆在这里
```

---

## 安装包体积估算（Embedded 阶段）

```
VeryAgent 本身        ~50MB
Python 运行时          ~80MB
Node.js 运行时         ~80MB
Git                    ~50MB
Hermes venv 依赖       ~200MB
Hermes 源码            ~50MB
─────────────────────────────
总计                   ~510MB
```
