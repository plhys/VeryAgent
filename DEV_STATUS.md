# veryAgent 开发状态报告

> 更新日期：2026-07-15

---

## 一、已完成

### 2026-07-15（已推 main，见 CHANGELOG Unreleased）

- [x] OpenClaw / Hermes readiness：安装 ≠ 可用；Gateway 探测 + auto ensure
- [x] OpenClaw resident（类 Hermes 常驻）
- [x] 欢迎页通用 / 专家模式（通用：Hermes + OpenClaw）
- [x] OpenClaw 会话设置中文短标签 + 说明（思考/快速/工具/插件/推理/用量/提权）
- [x] 修正 off→「拒绝」误映射
- [x] 独立开发启动文档与脚本（`dev-detached.ps1`，进程不随 agent 被杀）
- [x] 工作区全量提交并推送（含其他智能体已落盘的 OpenWiki / shared identity / memory 等）
- [x] 补写 `CHANGELOG.md` 版本更新说明

### codeg v0.20.0 → v0.20.2 合并（0.9.2）

- [x] Icon 暗淡修复（agent-icon.tsx）
- [x] Badge 前缀修正（restampSkillPrefixes + 测试）
- [x] Unresumable Session Banner（classify_session_load_failure）
- [x] Science 科研技能（13 个内置技能 + 管理模块）
- [x] Skill Packs Hub（专家/科研/办公三合一设置页）
- [x] 模型选择器滚动条修复（宽视图 + 窄视图）

### 前端入口改造（0.9.2）

- [x] "+"菜单技能改为分类套娃（专家/科研/办公 → 分类 → 技能）
- [x] 侧边栏"技能和插件"面板：三大技能包合一 + 分类标签筛选 + 一键启用/禁用
- [x] 办公技能 OfficeAction 加 category 字段

---

## 二、待定

### 产品版本号抬升

- [ ] 当前仍为 **0.9.2**；Unreleased 内容是否发 **0.9.3** 待定
- [ ] 发版时同步改：`package.json` / `tauri.conf.json` / `Cargo.toml` + CHANGELOG 章节定稿

### OpenClaw 模型鉴权

- [ ] Gateway 可用后，真实对话仍需配置模型供应商 / API Key
- [ ] 空回复「请检查代理配置」多为模型鉴权，不是 HTTP 代理

### 通用模式会话设置密度

- [ ] 短标签已上；是否再默认折叠部分 OpenClaw 开关待产品确认

### 项目拆分/重构

- [ ] 状态：**待定**

### 用户偏好记忆系统

- [ ] 后端/设置骨架已有 shared identity & memory 路径
- [ ] 与「所有智能体共享、会话启动注入」产品闭环仍待验收

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
