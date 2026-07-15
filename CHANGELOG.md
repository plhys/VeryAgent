# Changelog

本仓库的版本更新说明。每次有实质功能合入 `main` 时更新本文件。  
格式大致遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

当前产品版本号见：`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`（现为 **0.9.2**）。

---

## [Unreleased] — 2026-07-15

> 尚未抬产品版本号（仍为 0.9.2）。  
> 本段含已推送提交（`0614d01`、`8b74b40`、`2a22ec5`）以及待推工作区全量改动。

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
- **OpenWiki 插件化**
  - 从设置侧栏迁到「技能和插件 → 插件」第一方卡片
  - 按当前智能体启用；齿轮弹窗配置 / init / update / instructions
  - 通用 npm CLI 安装流（进度、可取消、便携路径），避免插件能力强依赖整包重编
- **侧边栏绝对时间旗标**
  - 对话列表 / 项目列表悬停显示 `yyyy-MM-dd HH:mm`
  - 共享组件 + 右偏移 25px
- **独立开发启动方案**
  - 文档：`docs/dev-detached.zh-CN.md`
  - 脚本：`dev-detached.ps1`
  - 前端 `pnpm dev` + debug 增量编译 + `Start-Process` 独立桌面进程  
    （避免每次 `pnpm tauri dev` 冷启动，也避免关 agent/终端带走桌面端）

### 变更

- **移除共享身份 / 共享记忆（shared identity & memory）**
  - 删除 memory 注入、共享路径、设置页与相关 API/i18n
  - 旧 `/settings/shared-preferences` 重定向到外观设置，避免白屏
- **设置侧栏分组**
  - 通用设置（默认展开）/ 专家设置（默认折叠）
  - OpenWiki 不再作为设置导航项
- 桌宠：气泡相对宠物锁定跟随；气泡内容自下向上生长；默认落点不再被 window-state 插件覆盖；缩放改窗与 320 基数对齐
- OpenClaw 会话设置文案与展示
  - 短标签：思考 / 快速 / 工具 / 插件 / 推理 / 用量 / 提权
  - 芯片显示为 `名称 · 状态`（如 `快速 · 关`）
  - 修正 `off` 被误映射为「拒绝」的问题（开关 ≠ 权限拒绝）
  - 下拉/设置面板展示详细说明
- ACP Agent 设置：OpenClaw Gateway 发现、可达性、ensure 入口
- 全局按钮 / 菜单项手型光标（`cursor-pointer`）
- 模型供应商相关前后端路径有精简/调整（与其他智能体改动一并入库）
- Windows 本地 cargo 配置：临时关闭 sccache / rust-lld（Defender / DLL 初始化问题）

### 修复

- OpenClaw 安装后仍 `ECONNREFUSED 18789`：自动 ensure + 就绪探测
- 误显示「可用」：Gateway 未真正可达时不再标 ready
- 会话设置区只有裸 `关/开`、文案像权限拒绝：改为短名 + 状态 + 说明
- 设置页访问已删除路由导致白屏
- `MessageInput`：`collapsedSettings` 在初始化前被引用导致运行时崩溃

### 文档

- `docs/dev-detached.zh-CN.md` — 日常独立开发启动
- `docs/build-recovery.zh-CN.md` — 增加指向独立开发文档的入口
- `README.md` — 推荐 `.\dev-detached.ps1`
- `docs/plan-hermes-resident-agent.md` / `docs/plan-openwiki-integration.md`
- `CHANGELOG.md` / `AGENTS.md` — 推送 main 必须写版本说明

### 提交对照

| Commit | 说明 |
|--------|------|
| `0614d01` | OpenClaw/Hermes readiness、resident、模式切换、会话设置 UX、OpenWiki/memory 等全量工作区 |
| `8b74b40` | 独立开发启动文档与 `dev-detached.ps1` |
| `2a22ec5` | 补 CHANGELOG 与推送约定 |
| （本推送） | 移除 shared identity；OpenWiki 插件化；侧栏时间旗标；设置分组；桌宠/气泡；输入区 TDZ 修复；含工作区其他已落盘改动 |

---

## [0.9.2] — 2026-07-14

### 变更

- codeg v0.20.0 → v0.20.2 合并
- 技能包前端入口改造（专家 / 科研 / 办公）
- 详见当时提交：`6cea5d9` 与 `DEV_STATUS.md`
