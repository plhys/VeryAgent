# VeryAgent

[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)](https://tauri.app/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)

一个多智能体协作编程桌面应用。把多个 AI 编程助手（Claude Code、Codex CLI、Gemini CLI、OpenCode 等）整合到一个工作空间里，支持会话聚合、多智能体协作、以及丰富的开发工具链。

## 主要功能

- **多智能体协作** — 一个会话中可以同时调度多个不同类型的智能体，各自独立运行，共同完成复杂任务
- **会话聚合** — 导入所有支持的智能体会话到统一工作空间
- **专家技能系统** — 内置可扩展的技能插件，智能体可直接调用（如 Gemini 文生图/图生图）
- **图片交互** — 聊天中的图片支持右键复制、下载、地址复制，以及引用二次创作
- **项目脚手架** — 可视化创建新项目，实时预览，一键生成 shadcn/ui 模板
- **Office 文档** — 创建、分析、编辑 `.docx` / `.xlsx` / `.pptx`，支持在线预览
- **自动化** — 将编辑器配置保存为可复用的自动化任务，支持定时或手动执行
- **聊天频道** — 接入 Telegram、飞书、微信等消息平台，远程控制智能体
- **MCP 管理** — 本地扫描 + 市场搜索安装 MCP 服务器
- **Git 工作流** — 内置文件树、差异对比、提交、终端等完整开发工具链
- **Web 服务模式** — 支持 Docker 部署和独立服务器模式，浏览器即可访问
- **桌面端宠物** — 桌面小宠物陪伴，支持自定义

## 支持的智能体

Claude Code · Codex CLI · OpenCode · Gemini CLI · OpenClaw · Cline · Hermes Agent · CodeBuddy · Kimi Code · Pi

## 快速开始

### 桌面端

```bash
# 安装依赖
pnpm install

# 开发模式启动
pnpm tauri dev

# 构建安装包
pnpm tauri build
```

产物在 `src-tauri/target/release/bundle/` 下，Windows 会生成 `.exe` 安装包。

### 服务端 (Docker)

```bash
docker compose up -d
```

### 开发

```bash
# 前端开发 (Next.js dev server)
pnpm dev

# 完整桌面应用
pnpm tauri dev

# 独立服务器
pnpm server:dev
```

### 环境要求

- Node.js ≥ 22
- pnpm ≥ 10
- Rust stable (2021 edition)
- Tauri 2 构建依赖（仅桌面端需要）

## 架构

```
Next.js 16 (React 19) + Tauri 2
    │
    ▼
共享 Rust 核心
  ├── ACP 智能体管理
  ├── 会话聚合 & 解析
  ├── 聊天频道 (Telegram / 飞书 / 微信)
  ├── Git / 文件树 / 终端
  ├── MCP 市场 & 配置
  ├── Office 工具 & 自动化
  └── SeaORM + SQLite
```

## 致谢

- [ACP](https://agentclientprotocol.com) — 智能体客户端协议
- [Superpowers](https://github.com/obra/superpowers) — 专家技能模块
- [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) — Office 文档工作流

## License

Apache-2.0