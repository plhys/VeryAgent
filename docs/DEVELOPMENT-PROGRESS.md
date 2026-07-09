# veryAgent 开发进程记录

## 一、已完成的功能

### 1. 技能和工具侧边栏（Skills and Tools）
- ✅ 卡片式布局（标题大、描述小、带图标）
- ✅ 三个标签页：当前智能体 / 技能 / 插件
- ✅ 当前智能体标签页：智能体选择器 pills（只显示已安装的智能体）
- ✅ 技能列表：显示所有可用技能，带"安装"按钮
- ✅ 插件列表：显示已安装的 MCP 插件
- ✅ 安装/卸载功能（点击加号 → 已启用）
- ✅ 每个技能带独立图标（来自 experts.toml）
- ✅ 技能列表全中文显示

### 2. 国际化（i18n）
- ✅ 10 种语言全部添加 SkillsAndTools 命名空间
- ✅ 添加 Folder.sidebar.chats 和 Folder.sidebar.projects 键
- ✅ 侧边栏正确显示"会话"和"项目"（不再显示"代码"）

### 3. 其他修复
- ✅ 修复 CurrentAgentTab 始终显示 Claude Code 的 bug（添加智能体选择器）
- ✅ 修复对话区域点击出现黑框的 bug（移除 focus-visible:ring-* 样式）
- ✅ 修复技能启用状态与设置页矩阵同步
- ✅ useEnabledSkillIds 添加 strict 参数（true=只返回已启用的技能）
- ✅ 自定义 logo 替换（logo-01.png, logo-03.png, welcome.png 等）

### 4. 用户修改的完整版本（来自 stash）
- ✅ DeepSeek 面板修改（acp.rs, model_provider.rs 等 54 个文件）
- ✅ 多智能体模型提供商系统
- ✅ 侧边栏、对话列表、设置页面等大量前端修改
- ✅ 自定义图标替换
- ✅ package.json 修改（webpack 替代 turbopack）

## 二、当前卡在哪里

### 迁移文件问题（已解决）
- ~~m20260708_000001_model_provider_multi_agent.rs 缺失导致编译失败~~
- ~~SeaORM 报错：migration has been applied but its file is missing~~
- ✅ **已解决**：删除迁移文件 + 从数据库删除迁移记录 + 从 mod.rs 取消注册

### 当前问题：Tauri 桌面应用无法启动
- `pnpm tauri dev` 在准备 sidecar 二进制时失败（`veryagent-mcp` 编译错误）
- 直接 `cargo run` 运行时也失败（同样的问题）
- Next.js dev server 可以正常启动（端口 3000）

**错误信息：**
```
Error: Command failed: cargo build --release --bin veryagent-mcp --no-default-features --target x86_64-pc-windows-msvc
```

### 原始版本残留
- ✅ 已删除 `codeg-main-extracted` 文件夹（原始项目副本）
- ✅ 已清理所有原始迁移文件

## 三、后续需要做的事

### 紧急
1. **修复 sidecar 二进制编译错误** — 需要找出 `veryagent-mcp` 编译失败的原因
   - 可能是缺少特性标志、依赖版本不匹配、或编译配置问题
   - 或者跳过 sidecar 编译，直接使用已有的二进制文件

2. **启动桌面应用** — 用户的核心需求是能够运行自己的修改版本

### 后续优化
3. 技能和工具页面：
   - 添加搜索/过滤功能
   - 技能详情弹窗（点击卡片显示详细介绍）
   - 插件安装界面改进
   - 滚动条样式优化（用户提到太粗）

4. 其他功能（根据 stash 中的修改）：
   - DeepSeek 面板的进一步完善
   - 模型提供商管理界面
   - 技能-智能体矩阵设置页面

## 四、技术栈
- Tauri 2 (Rust + WebView)
- Next.js 16 (静态导出)
- React 19 + TypeScript (strict 模式)
- SeaORM + SQLite
- next-intl (10 种语言)
- Tailwind CSS
- ACP (Agent Client Protocol)

## 五、重要文件位置
- 主项目：`D:\aicodework\veryAgent\veryagent-plus\`
- 技能和工具页面：`src/components/skills-and-tools/skills-and-tools-page.tsx`
- 技能启用状态 hook：`src/hooks/use-enabled-skill-ids.ts`
- 国际化文件：`src/i18n/messages/*.json`
- 专家定义：`src-tauri/experts/experts.toml`
- Rust 后端 DeepSeek 修改：`src-tauri/src/commands/acp.rs` 等
- 数据库（调试）：`C:\Users\EVAN\AppData\Roaming\app.veryagent\veryagent-dev.db`
- 数据库（正式）：`C:\Users\EVAN\AppData\Roaming\app.veryagent\veryagent.db`
