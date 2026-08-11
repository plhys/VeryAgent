# veryAgent 开发状态报告

> 更新日期：2026-08-08

---

## 近期（2026-08-08）

### 重构

- [x] **智能体调用系统重构（4 阶段）**：
  - [x] P0 止血：恢复重构丢失的 cwd/env/版本 pin 能力
  - [x] P1 agent_env 继承+净化+叠加 — 环境构建集中化
  - [x] P2 AgentRuntime 状态机接入连接生命周期
  - [x] P3 配置渲染备份机制 + TOML/YAML 格式转义
- [x] **前端设置页重构**：AgentDescriptor 注册表 + AgentSettingsForm 通用表单，main.tsx 删除 3300 行嵌套三元
- [x] **编译 warning 清零**：清理 7 处 warning（未使用 import、未使用变量、字段命名、死函数）

### 修复

- [x] Windows agent spawn `os error 123`：过滤 `=C:=`/`=D:=` 驱动器变量 + `CommonProgramFiles(x86)` 等含括号变量名（`build_agent_env` 增加 `is_valid_env_var_name` 校验）
- [x] Hermes 权限切换真实生效（后端拦截 `set_config_option` + 写入 `HERMES_PERMISSION_MODE` 到 `~/.hermes/.env`）

### 新增

- [x] P3 配置渲染备份机制 + TOML/YAML 格式转义（已合入 main）

---

## 近期（2026-08-06）

### 修复

- [x] 模型供应商测试 401 修复（`api-key` 请求头 + URL 路径剥离 + 模型遍历）
- [x] Claude 双回复修复（`transcript_turns_emitted` 防重复标志）
- [x] Hermes 换机器配置自动修复（缺失时从数据库重新生成）
- [x] Hermes git 运行时缺失自动补全（从系统 PATH 复制 `git.exe`）
- [x] Hermes 模型选择器（合成 config option，从供应商 API 拉取模型列表）
- [x] Hermes 权限选择器（合成 mode config option：Default / YOLO）

### 优化

- [x] 权限/模式显示当前值（`variant="name-value"`）
- [x] 环境变量编辑器优化（去掉模糊遮罩，加说明文字）
- [x] 思考链/工具链折叠合并（实时状态 + token 统计 + 全屏查看）

### 待跟进

- [x] ~~Hermes 权限切换真实生效~~（后端拦截 `set_config_option` + 写入 `HERMES_PERMISSION_MODE` 到 `~/.hermes/.env`，session 重启生效）
- [ ] 命名统一（跨智能体的配置选项名称）
- [ ] Hermes 开机自启（常驻智能体自动连接）
- [ ] 多智能体协同功能完善（`delegate_to_agent` 工具暴露与使用）

---

## 近期（2026-08-04，未发版）

### 侧边栏 & 工作区

- [x] 侧边栏「项目」→「工作区」改名
- [x] 工作区文件夹右键菜单：置顶 / 重命名（仅改显示名 `folder.name`，不动磁盘路径）/ 打开工作区（`revealItemInDir`）/ 删除；重新打开保留自定义显示名
- [x] 智能体筛选：状态栏统计弹窗点击智能体筛选会话列表，筛选时会话行显示 Agent 图标
- [x] 会话天数标签「今天/昨天/N天前」+ 悬浮置顶/归档（不占位）
- [x] 排版统一：小圆角、左右对称、滚动条 4px/55%、浮标压边 -8px

### 输入框底部操作栏（ChatInput）

- [x] 统一为「加号 → 权限 → 模型 → 强度」三段式，移除模式 chip 与折叠设置齿轮，视觉开关保留
- [x] 配置名中文化：`config-option-labels` 映射扩展 + id 兜底 + `mode → 模式`

### 待跟进

- [ ] `message-input.tsx` slash 菜单遗留 3 个未使用变量（`filteredSlashDropdownCommands` / `handleSlashDropdownOpenChange` / `handleSlashPopoverSelect`），等 slash 菜单重构收尾时清理
- [ ] 模型 chip 的模型名为模型 ID（如 gpt-4o），保持英文不翻译

---

## 一、已完成

### 0.9.9.1（当前版本，2026-08-01 发版）

#### 技能仓库系统

- [x] 技能数据源从编译后端切换为远程仓库 URL（GitHub/Gitee 双源 5 秒超时切换）
- [x] 仓库在线/离线信号图标指示（绿色 Wifi / 灰色 WifiOff）
- [x] 自制技能标签页：展示用户通过 VeryAgent 创建的自定义技能，支持编辑/删除/启用/禁用
- [x] 标签页重组为「技能仓库 | 连接器仓库 | 自制 | 已添加」
- [x] 官方技能仓库创建：`github.com/plhys/veryagent-skills` + Gitee 镜像同步
- [x] 预装技能按钮文字统一：添加/移除 → 启用/禁用

#### 设置 & 导航

- [x] 删除设置侧栏的「Skills」和「Skill Packs」入口，技能管理全部集中到工作台
- [x] 当前智能体标签改为绿色激活态

### 0.9.9（2026-07-31 发版）

#### 对话总结气泡重构（[Unreleased] 区）

- [x] 移除标题栏，改用纯文本气泡+更明显背景色和边框
- [x] 气泡位置跟随卡片并实时响应滚动/缩放，宽度自适应小屏
- [x] 跳过斜杠命令（如 `/veryagent-image`）和废话（问候/确认/单字回复/纯表情）
- [x] 用户消息全是命令时改用助手回复作为内容描述
- [x] 修复 AI 总结异步返回后覆盖轮次和时间信息的问题
- [x] 修复 `fetch_provider_models` 命令注册遗漏（`Command not found`）
- [x] 补回 `fetch_provider_models` 的 `#[cfg(feature = "tauri-runtime")]` 门控

#### 侧边栏功能增强

- [x] 置顶对话左侧上箭头标志 + 分割线 + 摘要气泡（提取式+AI 异步）
- [x] 右键菜单「复制对话链接」+ 点击跳转原对话
- [x] 侧边栏对话/项目列表悬停绝对时间旗标
- [x] 文件夹 + 会话双选中；会话点击走 `openTab`

#### 桌面宠物

- [x] 宠物内嵌主窗口，不脱离应用
- [x] 气泡锁定跟随、自下向上生长、缩放与 320 基数对齐
- [x] 全局 `cursor-pointer`；防闪烁处理

#### 模型供应商 & 智能体（0.9.3/0.9.4）

- [x] 共享模型供应商（A计划）：Pi / CodeBuddy 可绑定；聊天仅展示可用模型
- [x] CodeBuddy 自定义模型追加，保留原生中国/海外/iOA
- [x] 智能体默认全关（新建 `agent_setting`）
- [x] Codex 模型供应商 Responses API 边界提示
- [x] 模型供应商 + 视觉桥接合并设置页
- [x] 双更新源管道：GitHub / Gitea 可选；标题栏绿色更新按钮

#### 技能/插件（0.9.4）

- [x] web-search 技能（网页搜索 + 图片搜索，经 MCP 代理）
- [x] doubao-image 技能（豆包出图）
- [x] gemini-image 技能重构（MCP 端点迁移）
- [x] OpenWiki 插件化：技能卡片启用 + 齿轮配置弹窗；npm CLI 安装流
- [x] 恢复 transcripts 图片右键「引用二次创作」

#### OpenClaw / Hermes（0.9.3）

- [x] readiness 探测（安装 ≠ 可用；Gateway 实时可达）
- [x] OpenClaw resident（类 Hermes 常驻进程）
- [x] 欢迎页通用 / 专家模式
- [x] 会话设置中文短标签（思考/快速/工具/插件/推理/用量/提权）
- [x] 修正 off→「拒绝」误映射

#### 其他

- [x] 独立开发启动文档与脚本（`dev-detached.ps1`）
- [x] 移除共享身份/共享记忆（产品决策）
- [x] 设置侧栏分组：通用 / 专家
- [x] 桌宠位置与气泡锚定、缩放尺寸修正
- [x] codeg v0.20.0 → v0.20.2 合并（0.9.2）
- [x] 前端入口改造：技能分类套娃 + 三大技能包合一（0.9.2）
- [x] PPT 技能修复：注册为专家、正确归类、稳定切换

#### 测试修复 & 质量保障

- [x] **修复 30 个预存测试失败**：9 个测试文件，涵盖 `NextIntlClientProvider` 缺失、组件本地化后断言过时、jsdom 兼容性、hydrate 行为变更重写等
- [x] **CI 管道接入**：GitHub Actions 工作流（tsc + eslint + vitest + knip）
- [x] **版本锁定**：`unified@11.0.5`、`streamdown@2.5.0` 锁定
- [x] **清理 1126 个未使用导入**（ESLint `unused-imports` 插件 + 自动修复）
- [x] **清理 21 个死代码文件**（knip 检测）
- [x] **Eslint 配置规范化**：禁止 Prettier 冲突，禁用 React 19 不必要的 hooks 规则
- [x] **补充测试**：`conversation-runtime-helpers` 纯函数 27 个测试用例

---

## 二、待定

### 发版前

- [x] 手动验收矩阵（Claude/Pi/OpenCode/CodeBuddy 原生+A计划；Codex 告警；项目侧栏；新库默认关智能体）— 2026-08-11 验证完毕，所有智能体 OK
- [ ] 正式包构建与安装/升级冒烟
- [x] 提交并推送工作区改动（当前会话仅含 9 个测试文件修复，无未跟踪文件）

### 对话总结

- [ ] AI 总结后端对接（当前提取式摘要已上，AI 异步总结待后续改进）

### OpenClaw 模型鉴权

- [ ] Gateway 可用后，真实对话仍需配置模型供应商 / API Key
- [ ] 空回复「请检查代理配置」多为模型鉴权，不是 HTTP 代理

### 通用模式会话设置密度

- [ ] 短标签已上；是否再默认折叠部分 OpenClaw 开关待产品确认

### 用户偏好记忆系统

- [x] 已移除 shared identity / memory 路径（产品决策）
- [ ] 若后续重做「跨智能体偏好」，需新方案（不再沿用已删模块）

### 待学习（AionCore 借鉴）

- [ ] **启动诊断体系**：结构化启动阶段报告（spawn → port_report → ready），每阶段独立超时/错误分类，前端可展示诊断面板，帮助用户快速定位启动失败原因。
- [ ] **扩展完整性校验**：技能/扩展下载后做 SHA-512 完整性校验，防止下载被篡改，参考 AionHub 的 `integrity` 字段 + `unpackedSize` 验证。

### 项目拆分/重构

- [x] **acp-agent-settings.tsx 拆分**：11853 行 → 7 个模块文件（types/shared/checks/kimi-code-config/opencode-combobox/agent-reorder-item/main.tsx）
- [ ] 其他大文件（mcp-settings.tsx / skills-settings.tsx 等）待后续拆分

---

## 三、不做

- 侧边栏最大宽度 900px（用户排除）
- 智能体版本更新（用户排除）
- 所有 Grok 功能（用户排除）
- Editor 假阳性错误 / Markdown 预览（用户排除）
- QoderWork 性格预设移植（与第三方智能体冲突）
- QoderWork HEARTBEAT 周期任务（缺少基础设施）

---

## 四、协作约定

- **推送 / 合入 main 时必须更新 `CHANGELOG.md`**（至少写清新增 / 变更 / 修复）
- 工作区若可能含其他智能体改动：提交前说明是「全量」还是「仅本会话」
- 日常开发启动优先：`.\dev-detached.ps1`（见 `docs/dev-detached.zh-CN.md`）
