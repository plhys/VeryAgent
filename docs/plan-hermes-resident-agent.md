# 计划：Hermes Agent 常驻集成

**日期**：2025-07-11  
**状态**：待定

---

## 目标

将 Hermes Agent 作为 VeryAgent 的原生常驻管家，实现"同居"而不是"打电话"。

- 用户安装 VeryAgent 时自带 Hermes Agent（离线捆绑）
- Hermes Agent 随 VeryAgent 启动，随 VeryAgent 退出，永远在线
- 其他 Agent（Claude Code、Codex 等）保持现有行为不变

---

## 改动清单

### 一、分发方式

| 项 | 内容 | 文件 |
|----|------|------|
| 离线捆绑 | 安装包自带 `runtime/`（Python、Node.js、Git）和 `hermes-agent/`（含 venv、全部依赖） | 打包脚本 |
| 路径修复 | 启动时修复 venv 的 `pyvenv.cfg`，指向内嵌 Python | 启动逻辑 |
| 注册表 | Hermes 分发方式从 `Uvx` 改为 `Embedded` | `registry.rs` |

### 二、生命周期管理

| 项 | 内容 | 文件 |
|----|------|------|
| 自动启动 | 应用启动时自动 connect Hermes | `app_state.rs` / `lib.rs` |
| 跳过回收 | idle sweep 跳过 resident=true 的 Agent | `idle_sweep.rs` |
| 随应用退出 | 应用退出时正常断开 Hermes | 现有 teardown 逻辑 |

### 三、前端 UI

| 项 | 内容 | 文件 |
|----|------|------|
| 常驻标识 | Hermes 在 AgentSelector 中显示绿点/常驻标记 | `agent-selector.tsx` |
| 默认排序 | Hermes 排在 Agent 列表第一位 | `agent-selector.tsx` |

### 四、不需要改

- ACP 协议栈 — 完全不变
- 前端消息渲染 — 完全复用
- 其他 9 个 Agent — 行为不变
- 会话管理、数据库 — 不动

---

## 预估工作量

| 部分 | 行数 | 说明 |
|------|:---:|------|
| `registry.rs` | ~5 | Hermes 分发方式改为 Embedded |
| `idle_sweep.rs` | ~3 | 跳过 resident Agent |
| 启动逻辑 | ~10 | 启动时自动 connect Hermes |
| 前端标识 | ~5 | 常驻状态显示 |
| 打包脚本 | 已有 | 参考现有离线包 |
| **总计** | **~30 行** | |

---

## 安装包体积估算

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