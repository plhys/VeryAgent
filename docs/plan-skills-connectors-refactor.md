# 计划：技能 & 连接器系统重构

**日期**：2026-08-08  
**状态**：草案，待评审

---

## 一、现状问题

### 1.1 入口分散

用户找技能要猜入口：

| 入口 | 内容 | 问题 |
|:-----|:------|:-----|
| 设置 → Skill Packs | Experts / Science / Office 三个子标签 | 按来源分类，用户不知道选哪个 |
| 设置 → Skills | 用户自建技能 | 跟 Skill Packs 是什么关系？ |
| 设置 → Connectors | 连接器 | 独立页面，跟技能割裂 |

### 1.2 存储脆弱

当前用 symlink/junction 链接技能到智能体：

- **Windows junction** 跨卷失败、权限问题
- 失败时 fallback 到复制，`copy_mode` 状态不一致
- 代码复杂：`classify_link` 状态机、`junction` crate 依赖、平台分支

### 1.3 代码重复

- `experts.rs`（1114 行）+ `science.rs`（949 行）= 2063 行，几乎相同
- `experts.toml` + `science.toml` 两份配置
- 前端 `experts-settings.tsx` + `science-settings.tsx` 两份组件

### 1.4 分类混乱

当前 9 个子类别：`discovery` / `planning` / `execution` / `quality` / `debugging` / `review` / `meta` / `creative` / `presentations`

用户看不懂 "discovery 跟 meta 有什么区别"。

---

## 二、目标

1. **入口统一** — 一个地方管理所有能力和连接器
2. **存储可靠** — 去掉 symlink，全平台统一用复制
3. **代码精简** — 合并重复模块，减少维护量
4. **分类直观** — 用户一看就知道跟自己有没有关系
5. **全中文** — 技能名称、描述、分类名全部显示中文

---

## 三、入口设计：能力中心

### 3.1 页面结构

```
能力中心
├── 🔽 智能体选择器       ← 当前操作对哪个智能体生效
├── 🔍 搜索技能/连接器
├── [📋 全部] [✅ 已启用]  ← 视图切换
│
├── 📋 技能标签页          🔌 连接器标签页
│   ├── 编程 (14)          ├── 网页工具 (1)
│   ├── 办公 (8)           ├── 图片生成 (2)
│   ├── 学术 (13)          ├── 文件处理 (3)
│   ├── 创意 (2)           ├── 数据库 (2)
│   └── 帮助 (1)           └── 系统 (2)
```

### 3.2 交互流程

```
用户给 Claude Code 加技能：
  1. 选智能体 → Claude Code
  2. 默认看到全部技能 → 按行业分类浏览
  3. 点"启用" → 技能复制到智能体目录，立即生效

用户看已启用的：
  1. 选智能体 → Claude Code
  2. 切到"已启用"视图 → 只看已启用的
  3. 可以批量关闭

用户找连接器：
  1. 切到"连接器"标签页
  2. 按功能分类浏览
  3. 配置 API Key / 连接参数
```

### 3.3 卡片设计

```
┌──────────────────────────────────────┐
│ 🧠 头脑风暴                   [启用]  │
│ 在进行创造性工作之前，充分探索用户      │
│ 意图、需求和设计方案。                │
│                                      │
│ 编程 · 已启用：Claude Code            │
└──────────────────────────────────────┘
```

---

## 四、分类设计

### 4.1 技能：按行业分

| 行业 | 技能数 | 包含技能 | 用户画像 |
|:-----|:------|:---------|:---------|
| **编程** | 14 | 头脑风暴、编写计划、执行计划、子代理驱动开发、并行代理派发、使用 Git Worktree、测试驱动开发、完成前验证、系统化调试、请求代码评审、处理代码评审反馈、收尾开发分支、编写技能文档、使用 Superpowers | 程序员 |
| **办公** | 8 | PPT 幻灯片生成、PPT 生成、Pitch Deck、文档生成、学术论文、表格生成、财务模型、数据看板 | 职场人士 |
| **学术** | 13 | 假设生成、科学头脑风暴、科学批判性思维、实验设计、探索性数据分析、统计分析、统计功效、科学可视化、科学示意图、论文检索、引用管理、同行评审、学者评价 | 研究人员 |
| **创意** | 2 | 出图网关、网页搜索 | 设计师/创作者 |
| **帮助** | 1 | VeryAgent 助手 | 所有用户 |

### 4.2 连接器：按功能分

| 功能 | 连接器 | 说明 |
|:-----|:-------|:-----|
| 网页工具 | 网页搜索 | 搜索 API 配置 |
| 图片生成 | 出图网关 | 多网关配置 |
| 文件处理 | ... | 文件转换、预览 |
| 数据库 | ... | 数据源连接 |
| 系统 | MCP 服务 | 自定义 MCP 服务 |

---

## 五、存储模型：symlink → 复制

### 5.1 当前机制

```
启用技能：create_link_raw(src, dst)
  ├── Unix:   std::os::unix::fs::symlink
  └── Windows: junction::create → fallback copy_dir_recursive

状态判断：classify_link(link_path, expected_target)
  ├── NotLinked
  ├── LinkedToApp
  ├── LinkedElsewhere
  ├── BlockedByRealDirectory
  └── Broken
```

### 5.2 新机制

```
启用技能：copy_dir_recursive(src, dst) + 写 .veryagent-version（含哈希）
禁用技能：remove_dir_all(dst)
状态判断：dst 存在 && .veryagent-version 哈希匹配
更新提示：中央存储哈希变化 → 标记"可更新"
```

### 5.3 删掉的代码

| 组件 | 行数 | 说明 |
|:-----|:-----|:------|
| `create_link_raw` 平台分支 | ~30 | 不再需要 |
| `classify_link` 状态机 | ~80 | 不再需要 |
| `path_is_symlink` | ~15 | 不再需要 |
| `path_is_reparse_point` | ~15 | 不再需要 |
| `read_link_target` | ~20 | 不再需要 |
| `copy_mode` 字段 | ~10 | 不再需要 |
| `junction` crate 依赖 | 1 | Cargo.toml 删除 |
| **合计** | **~170** | |

### 5.4 迁移兼容

已有用户的 symlink 在升级后：
1. `ensure_central_*_installed` 运行时检测旧 symlink
2. 自动替换为复制（删除 symlink，重新复制）
3. 一次性的，后续不再创建 symlink

---

## 六、代码合并

### 6.1 后端

```
当前：
  src-tauri/src/commands/experts.rs   (1114 行)
  src-tauri/src/commands/science.rs    (949 行)
  src-tauri/experts/experts.toml
  src-tauri/science/science.toml

重构后：
  src-tauri/src/commands/skills.rs     (新建，约 1200 行)
  src-tauri/skills/skills.toml          (合并)
  src-tauri/skills/development/         (编程技能)
  src-tauri/skills/office/              (办公技能)
  src-tauri/skills/academic/            (学术技能)
  src-tauri/skills/creative/            (创意技能)
  src-tauri/skills/help/                (帮助技能)
  (skills/ 目录按行业分，不再按来源分)

保留：
  src-tauri/src/commands/office_tools.rs  (OfficeCLI 机制不同)
```

### 6.2 前端

```
当前：
  src/components/settings/skill-packs-settings.tsx
  src/components/settings/experts-settings.tsx
  src/components/settings/science-settings.tsx
  src/components/settings/skills-settings.tsx
  src/components/settings/skill-agent-matrix.tsx
  src/components/settings/skill-packs-settings.tsx
  src/components/settings/connectors-settings.tsx

重构后：
  src/components/settings/capability-center.tsx   ← 能力中心主页面
  src/components/settings/skills-tab.tsx           ← 技能标签页
  src/components/settings/connectors-tab.tsx       ← 连接器标签页
  src/components/settings/skill-agent-matrix.tsx   ← 保留并适配
```

### 6.3 删除的文件

| 文件 | 说明 |
|:-----|:------|
| `src-tauri/src/commands/experts.rs` | 合并到 skills.rs |
| `src-tauri/src/commands/science.rs` | 合并到 skills.rs |
| `src-tauri/experts/experts.toml` | 合并到 skills.toml |
| `src-tauri/science/science.toml` | 合并到 skills.toml |
| `src-tauri/science/skills/` | 移到 skills/academic/ |
| `src/components/settings/skill-packs-settings.tsx` | 功能合并 |
| `src/components/settings/experts-settings.tsx` | 功能合并 |
| `src/components/settings/science-settings.tsx` | 功能合并 |

---

## 七、i18n 精简

### 7.1 当前

每个技能有 9 语言的名称和描述（en / zh-CN / zh-TW / ja / ko / es / de / fr / pt / ar），维护成本高，实际用户主要用中文。

### 7.2 重构后

- 技能名称/描述/分类名：**只保留中文**
- 英文 ID 保留用于内部逻辑（如 `brainstorming`）
- 前端 UI 文案（按钮、标签、提示）：保留中英双语

---

## 八、实施步骤

### Phase 1：后端存储改复制（止血）

**改动量**：约 200 行
**风险**：低，替换 symlink 逻辑，不改变 API

1. 修改 `experts.rs`：`create_link_raw` → 直接用 `copy_dir_recursive`
2. 删掉 `classify_link` 状态机、`junction` 依赖、`copy_mode`
3. 添加版本哈希文件 `.veryagent-version`
4. 添加旧 symlink 迁移检测
5. 编译验证 + 手动测试

### Phase 2：合并 experts + science 模块

**改动量**：约 500 行
**风险**：中，涉及文件结构调整

1. 新建 `skills.rs`，抽公共逻辑
2. 合并 `experts.toml` + `science.toml` 为 `skills.toml`
3. 按行业分类整理技能目录
4. 注册新 Tauri 命令
5. 更新 `tauri_setup.rs` 和 `veryagent_server.rs`

### Phase 3：前端重构能力中心

**改动量**：约 800 行
**风险**：中，涉及 UI 重构

1. 新建 `capability-center.tsx` 主页面
2. 新建 `skills-tab.tsx` 技能标签页
3. 新建 `connectors-tab.tsx` 连接器标签页
4. 适配 `skill-agent-matrix.tsx`
5. 删除旧文件
6. 更新路由和侧栏导航
7. 更新 i18n

### Phase 4：i18n 精简

**改动量**：约 200 行
**风险**：低

1. `zh-CN.json`：技能名称/描述全中文
2. `en.json`：精简，只保留 UI 文案
3. 删除多余语言的技能翻译

---

## 九、不做的事

- ❌ 不做技能市场/社区分享
- ❌ 不做导入/导出技能
- ❌ 不拆独立后端进程
- ❌ 不保留 symlink 兼容层
- ❌ 不碰 OfficeCLI 技能机制（保持独立）
- ❌ 不碰用户自建技能（Settings → Skills，走 ACP 命令）

---

## 十、文件清单

### 新建

| 文件 | 说明 |
|:-----|:------|
| `src-tauri/src/commands/skills.rs` | 统一技能管理后端模块 |
| `src-tauri/skills/skills.toml` | 合并后的技能配置 |
| `src-tauri/skills/development/` | 编程技能目录 |
| `src-tauri/skills/office/` | 办公技能目录 |
| `src-tauri/skills/academic/` | 学术技能目录 |
| `src-tauri/skills/creative/` | 创意技能目录 |
| `src-tauri/skills/help/` | 帮助技能目录 |
| `src/components/settings/capability-center.tsx` | 能力中心主页面 |
| `src/components/settings/skills-tab.tsx` | 技能标签页 |
| `src/components/settings/connectors-tab.tsx` | 连接器标签页 |

### 删除

| 文件 | 说明 |
|:-----|:------|
| `src-tauri/src/commands/experts.rs` | 合并到 skills.rs |
| `src-tauri/src/commands/science.rs` | 合并到 skills.rs |
| `src-tauri/experts/experts.toml` | 合并到 skills.toml |
| `src-tauri/science/science.toml` | 合并到 skills.toml |
| `src-tauri/science/skills/` | 移到 skills/academic/ |
| `src/components/settings/skill-packs-settings.tsx` | 功能合并 |
| `src/components/settings/experts-settings.tsx` | 功能合并 |
| `src/components/settings/science-settings.tsx` | 功能合并 |

### 修改

| 文件 | 改动 |
|:-----|:------|
| `src-tauri/src/commands/mod.rs` | 注册 skills，取消 experts/science |
| `src-tauri/src/tauri_setup.rs` | 更新命令注册和启动安装流程 |
| `src-tauri/src/bin/veryagent_server.rs` | 同步更新 |
| `src-tauri/Cargo.toml` | 去掉 `junction` 依赖 |
| `src/components/settings/skill-agent-matrix.tsx` | 适配新分类 |
| `src/components/settings/connectors-settings.tsx` | 适配新入口 |
| `src/lib/api/agents.ts` | 更新 API 调用 |
| `src/i18n/messages/zh-CN.json` | 技能名称/描述全中文 |
| `src/i18n/messages/en.json` | 精简 |
| `src/app/(main)/settings/` | 更新路由 |
| `CHANGELOG.md` | 记录重构 |
| `DEV_STATUS.md` | 更新状态 |