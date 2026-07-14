# veryAgent 开发状态报告

> 更新日期：2026-07-14

---

## 一、已完成

### codeg v0.20.0 → v0.20.2 合并
- [x] Icon 暗淡修复（agent-icon.tsx）
- [x] Badge 前缀修正（restampSkillPrefixes + 测试）
- [x] Unresumable Session Banner（classify_session_load_failure）
- [x] Science 科研技能（13 个内置技能 + 管理模块）
- [x] Skill Packs Hub（专家/科研/办公三合一设置页）
- [x] 模型选择器滚动条修复（宽视图 + 窄视图）

### 前端入口改造
- [x] "+"菜单技能改为分类套娃（专家/科研/办公 → 分类 → 技能）
- [x] 侧边栏"技能和插件"面板：三大技能包合一 + 分类标签筛选 + 一键启用/禁用
- [x] 办公技能 OfficeAction 加 category 字段

---

## 二、待定

### 项目拆分/重构
- [ ] 状态：**待定**
- [ ] 说明：暂无具体拆分计划，后续根据代码复杂度决定

### 用户偏好记忆系统
- [ ] 状态：**待定**
- [ ] 来源：用户提议 + QoderWork CN 意识功能参考
- [ ] 方案：~/.veryagent/user_profile.md，所有智能体共享，会话启动时注入
- [ ] 分析文件：topics/awareness-feature-analysis.md

---

## 三、不做

- 侧边栏最大宽度 900px（用户排除）
- 智能体版本更新（用户排除）
- 所有 Grok 功能（用户排除）
- Editor 假阳性错误 / Markdown 预览（用户排除）
- QoderWork 性格预设移植（与第三方智能体冲突）
- QoderWork HEARTBEAT 周期任务（缺少基础设施）
