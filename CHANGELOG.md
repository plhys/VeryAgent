# Changelog

本仓库的版本更新说明。每次有实质功能合入 `main` 时更新本文件。  
格式大致遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

当前产品版本号见：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`（现为 **0.9.2**）。

---

## [Unreleased] — 2026-07-15

> 已合入 `main`（`0614d01`、`8b74b40`），尚未抬产品版本号。  
> 说明：该次提交为**工作区全量提交**（`git add -A`），包含本会话改动及其他智能体已落盘的改动。

### 新增

- **OpenClaw / Hermes 就绪态（readiness）**
  - 区分「已安装」与「真正可用」
  - OpenClaw Gateway 需实时可达才显示可用
  - 支持一键 / 会话侧自动 ensure（setup、local gateway、start/run、再探测）
- **OpenClaw 常驻（resident）**
  - 与 Hermes 类似的进程级预热与工作目录 `~/.openclaw`
- **欢迎页通用 / 专家模式**
  - 通用模式：Hermes + OpenClaw
  - 专家模式：其余编程类智能体
  - 选择记忆在本地 `workspace:chat-agent-mode`
- **共享身份 / 记忆（shared identity & memory）**
  - 后端 memory 注入与共享路径
  - 设置页「共享偏好」入口
- **OpenWiki 集成骨架**
  - 配置、注入、runner、设置页与 Web handler
  - 规划文档：`docs/plan-openwiki-integration.md`
- **独立开发启动方案**
  - 文档：`docs/dev-detached.zh-CN.md`
  - 脚本：`dev-detached.ps1`
  - 前端 `pnpm dev` + debug 增量编译 + `Start-Process` 独立桌面进程  
    （避免每次 `pnpm tauri dev` 冷启动，也避免关 agent/终端带走桌面端）

### 变更

- OpenClaw 会话设置文案与展示
  - 短标签：思考 / 快速 / 工具 / 插件 / 推理 / 用量 / 提权
  - 芯片显示为 `名称 · 状态`（如 `快速 · 关`）
  - 修正 `off` 被误映射为「拒绝」的问题（开关 ≠ 权限拒绝）
  - 下拉/设置面板展示详细说明
- ACP Agent 设置：OpenClaw Gateway 发现、可达性、ensure 入口
- 模型供应商相关前后端路径有精简/调整（与其他智能体改动一并入库）
- Windows 本地 cargo 配置：临时关闭 sccache / rust-lld（Defender / DLL 初始化问题）

### 修复

- OpenClaw 安装后仍 `ECONNREFUSED 18789`：自动 ensure + 就绪探测
- 误显示「可用」：Gateway 未真正可达时不再标 ready
- 会话设置区只有裸 `关/开`、文案像权限拒绝：改为短名 + 状态 + 说明

### 文档

- `docs/dev-detached.zh-CN.md` — 日常独立开发启动
- `docs/build-recovery.zh-CN.md` — 增加指向独立开发文档的入口
- `README.md` — 推荐 `.\dev-detached.ps1`
- `docs/plan-hermes-resident-agent.md` / `docs/plan-openwiki-integration.md`

### 提交对照

| Commit | 说明 |
|--------|------|
| `0614d01` | OpenClaw/Hermes readiness、resident、模式切换、会话设置 UX、OpenWiki/memory 等全量工作区 |
| `8b74b40` | 独立开发启动文档与 `dev-detached.ps1` |

---

## [0.9.2] — 2026-07-14

### 变更

- codeg v0.20.0 → v0.20.2 合并
- 技能包前端入口改造（专家 / 科研 / 办公）
- 详见当时提交：`6cea5d9` 与 `DEV_STATUS.md`
