# veryAgent UI 改造记录 — v1

> **日期**：2026-07-06 ~ 2026-07-07
> **版本**：v0.19.0
> **用途**：记录首次 UI 改造的所有变更，方便后续版本升级、回溯、换机器重建。

---

## 目录

1. [编译提速](#1-编译提速)
2. [暗色主题颜色](#2-暗色主题颜色)
3. [浅色主题颜色](#3-浅色主题颜色)
4. [分割线调整](#4-分割线调整)
5. [去掉会话标签页 TabBar](#5-去掉会话标签页-tabbar)
6. [侧边栏会话/项目 tab 切换](#6-侧边栏会话项目-tab-切换)
7. [平铺显示功能移植](#7-平铺显示功能移植)
8. [侧边栏项目列表组件](#8-侧边栏项目列表组件)
9. [文件夹打开按钮迁移](#9-文件夹打开按钮迁移)
10. [侧边栏布局清理](#10-侧边栏布局清理)
11. [i18n 新增翻译](#11-i18n-新增翻译)
12. [换机器重建步骤](#12-换机器重建步骤)

---

## 1. 编译提速

**目的**：减少日常开发和换机器时的编译时间。

### 文件变更

| 文件 | 变更 |
|------|------|
| `src-tauri/Cargo.toml` | 新增 `[profile.dev]`、`[profile.dev.package."*"]`、`[profile.release]` 配置 |
| `.cargo/config.toml` | 配置 `[build] rustc-wrapper = "sccache"` |
| `.gitignore` | 新增忽略 `*.exe`、`src-tauri/target/`、`.sccache/` |
| `docs/BUILD-SPEED.md` | 新增编译提速指南文档 |
| `scripts/setup-dev.sh` | 新增一键初始化脚本 (Git Bash) |
| `scripts/setup-dev.ps1` | 新增一键初始化脚本 (PowerShell) |

### 关键配置

**`src-tauri/Cargo.toml`** — dev profile 提速：
```toml
[profile.dev]
incremental = true
opt-level = 0
debug = 0

[profile.dev.package."*"]
opt-level = 0
debug = 0

[profile.release]
codegen-units = 8
lto = false
incremental = false
```

**`.cargo/config.toml`** — sccache 编译缓存：
```toml
[build]
rustc-wrapper = "sccache"
```

**安装 sccache**（一次性）：
```bash
cargo install sccache
```

---

## 2. 暗色主题颜色

**目的**：统一暗色模式下侧边栏、分割线、对话区的背景色。

### 文件变更

`src/app/globals.css` — 所有 14 个 dark 块（12 个主题 + 1 个兜底 + 1 个 @media 兜底）的以下变量：

| CSS 变量 | 旧值 | 新值 | 对应色值 |
|----------|------|------|----------|
| `--sidebar` | 各主题不同（~oklch(0.205)） | `oklch(0.2891 0 0)` | `#2B2B2B` |
| `--sidebar-border` | 各主题不同（~oklch(1 0 0 / 10%)） | `oklch(0.3012 0 0)` | `#2E2E2E` |
| `--background` | 各主题不同（~oklch(0.145)） | `oklch(0.2002 0 0)` | `#161616` |

### 影响范围

- 侧边栏背景 → `#2B2B2B`
- 侧边栏垂直分割线 → `#2E2E2E`
- 主对话区域背景 → `#161616`

---

## 3. 浅色主题颜色

**目的**：统一浅色模式下侧边栏、分割线、对话区的背景色。

### 文件变更

`src/app/globals.css` — 所有 13 个浅色块的以下变量：

| CSS 变量 | 旧值 | 新值 | 对应色值 |
|----------|------|------|----------|
| `--sidebar` | 各主题不同（~oklch(0.985)） | `oklch(0.9431 0 0)` | `#ECECEC` |
| `--sidebar-border` | 各主题不同（~oklch(0.922)） | `oklch(0.9067 0 0)` | `#E0E0E0` |
| `--background` | `oklch(1 0 0)` (白色) | `oklch(0.9791 0 0)` | `#F8F8F8` |

### 影响范围

- 侧边栏背景 → `#ECECEC`
- 侧边栏垂直分割线 → `#E0E0E0`
- 主对话区域背景 → `#F8F8F8`

---

## 4. 分割线调整

**目的**：去掉标题栏底部和状态栏顶部的水平分割线，垂直分割线不再 hover 高亮。

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/components/ui/resizable.tsx` | 去掉 `data-[resize-handle-state=hover]` 和 `data-[resize-handle-state=drag]` 的变粗/变色逻辑，保持 1px + `before:bg-border` |
| `src/components/layout/app-title-bar.tsx` | 去掉根 div 的 `border-b` |
| `src/components/layout/status-bar.tsx` | 去掉移动端和桌面端的 `border-t border-border` |

### 关键代码

**`resizable.tsx`** — 去掉 hover 高亮：
```
// 旧：hover 时 5px + foreground/40，drag 时 5px + foreground/60
// 新：始终 w-px + bg-border，保留 after 拖拽热区
```

---

## 5. 去掉会话标签页 TabBar

**目的**：标题栏下方的会话标签页与左侧侧边栏会话列表功能重复，去掉以腾出空间。

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/app/workspace/layout.tsx` | 删除桌面端（原 249 行）和移动端（原 320 行）的 `<TabBar />` 渲染，移除 `TabBar` import |

### 影响

- 标题栏下方不再显示会话标签页
- 会话切换完全由左侧侧边栏会话列表承担
- 平铺显示功能保留在侧边栏会话卡片右键菜单中（见第 7 节）

---

## 6. 侧边栏会话/项目 tab 切换

**目的**：侧边栏分成"聊天"和"项目"两个选项卡，聊天显示会话列表，项目显示文件夹列表。

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/components/layout/sidebar.tsx` | 大量改造，详见下方 |

### 关键变更

**Tab 控件**（在"新建会话/搜索/自动化"按钮下方）：

```tsx
// 分段控件风格，选中凸起、未选中凹陷
// 边框：light #E0E0E0, dark #4A4A4A
// 选中背景：light #F8F8F8, dark #4A4A4A
// 选中阴影：light 0_1px_2px_rgba(0,0,0,0.06), dark 0_1px_2px_rgba(0,0,0,0.15)
```

**Tab 状态**：
```tsx
const [activeTab, setActiveTab] = useState<"conversations" | "projects">("conversations")
```

**列表区切换**：
```tsx
{activeTab === "conversations" ? (
  <SidebarConversationList hideFolderSections ... />
) : (
  <SidebarProjectList />
)}
```

**hideFolderSections** — 聊天 tab 下隐藏文件夹分组头和聊天分组头，避免与外部 tab 重复。

**颜色对照表**：

| 元素 | 浅色 | 暗色 |
|------|------|------|
| tab 边框 | `#E0E0E0` | `#4A4A4A` |
| tab 选中背景 | `#F8F8F8` | `#4A4A4A` |
| 列表 hover/选中 | `#E0E0E0` | `#3D3D3D` |
| 按钮 hover | `#E0E0E0` | `#3D3D3D` |
| 侧边栏左右内边距 | `px-2.5` (10px) | 同 |
| "新建会话"上边距 | `pt-5` (20px) | 同 |

---

## 7. 平铺显示功能移植

**目的**：TabBar 去掉后，将 TabBar 右键菜单中的"平铺显示/取消平铺"功能移到侧边栏会话卡片右键菜单中。

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/components/conversations/sidebar-conversation-card.tsx` | 在右键菜单"详情"和"状态"之间插入"平铺显示/取消平铺"菜单项 |

### 关键代码

```tsx
// 新增 import
import { LayoutGrid } from "lucide-react"
import { useTabStore } from "@/contexts/tab-context"

// 组件内新增
const tTabs = useTranslations("Folder.tabs")
const isTileMode = useTabStore((s) => s.isTileMode)
const toggleTileMode = useTabStore((s) => s.toggleTileMode)

// 右键菜单新增项
<ContextMenuItem onSelect={toggleTileMode}>
  <LayoutGrid className="h-4 w-4" />
  {isTileMode ? tTabs("untileDisplay") : tTabs("tileDisplay")}
</ContextMenuItem>
```

---

## 8. 侧边栏项目列表组件

**目的**：新建 `SidebarProjectList` 组件，在"项目"tab 下展示可展开的文件夹列表，每个文件夹展开后显示其下的会话。

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/components/conversations/sidebar-project-list.tsx` | **新建** |
| `src/components/conversations/sidebar-conversation-list.tsx` | 新增 `hideFolderSections?: boolean` prop |
| `src/components/conversations/sidebar-conversation-grouping.ts` | 新增 `hideFolderSections` 参数，为 true 时跳过文件夹分组和聊天分组标题 |

### SidebarProjectList 功能

- **文件夹项**：显示文件夹名 + git 分支 + 主题色圆点
- **展开/折叠**：点击切换，默认全部展开（`collapsed` state，默认 false）
- **子弹线**：`border-l-2 border-sidebar-border` 垂直连接线串联会话子项
- **会话子项**：`text-[0.875rem]`，间距 `gap-1`
- **hover/选中**：light `bg-sidebar-border` (#E0E0E0), dark `bg-[#3D3D3D]`
- **双击文件夹**：切换到对话工作区
- **hover 操作**：显示新建会话按钮 + 移除按钮
- **空状态**：显示"还没有打开的项目"提示

### SidebarConversationList 新增 prop

```tsx
export interface SidebarConversationListProps {
  // ... 原有 ...
  hideFolderSections?: boolean  // 新增
}
```

### SidebarConversationGrouping 新增逻辑

```tsx
// buildRows 函数新增参数
hideFolderSections?: boolean

// 当 hideFolderSections = true：
// 1. 跳过 pushFolders() — 不显示文件夹分组
// 2. pushChats() 跳过 section header — 不显示"聊天"分组标题
// 3. 聊天内容始终展开显示（showChatContent = hideFolderSections || chatsExpanded）
```

---

## 9. 文件夹打开按钮迁移

**目的**：标题栏的 FolderPlus（打开文件夹/克隆仓库/项目启动器）按钮移到侧边栏"聊天/项目"tab 行的最右边。

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/components/layout/sidebar.tsx` | 新增 `NewFolderDropdown` import，在 tab 行右侧用 `ml-auto` 推到最右边 |
| `src/components/layout/folder-title-bar.tsx` | 移除 `NewFolderDropdown` import 和两处使用（移动端 + 桌面端） |
| `src/components/layout/new-folder-dropdown.tsx` | 下拉菜单紧凑化：`min-w-44`、图标 `h-3 w-3`、`py-1.5` |

---

## 10. 侧边栏布局清理

**目的**：去掉侧边栏顶部的"会话"标题、右边 3 个按钮（定位/展开/筛选）及水平分割线。

### 文件变更

`src/components/layout/sidebar.tsx`：

**删除的内容**：
- `<h2>{t("title")}</h2>` — "会话"标题
- `Crosshair` 按钮 — 定位当前会话
- `ChevronsDownUp/Down` 按钮 — 全部展开/折叠
- `Funnel` 下拉菜单 — 视图选项（showCompleted / sortBy / sectionOrder）
- `border-b border-border` — 水平分割线
- 相关的 state：`allExpanded`, `viewOptionsLabel`, `toggleExpandLabel`
- 相关的 handler：`handleToggleExpandAll`, `handleSetShowCompleted`, `handleSetSortMode`, `handleSetSectionOrder`
- 不再使用的 import：`ChevronsDownUp`, `ChevronsUpDown`, `Crosshair`, `Funnel`, `Button`, `DropdownMenu*`, `saveShowCompleted`, `saveSortMode`, `saveSectionOrder`

---

## 11. i18n 新增翻译

**目的**：新增 tab 切换和项目列表相关翻译 key。

### 新增 key（`Folder.sidebar` 命名空间）

| Key | zh-CN | en |
|-----|-------|-----|
| `projects` | 项目 | Projects |
| `chats` | 聊天 | Chats |
| `noFolders` | 还没有打开的项目 | No projects opened yet |
| `noFoldersHint` | 点击标题栏的文件夹图标打开一个项目 | Click the folder icon in the title bar to open a project |
| `openProject` | 打开项目 | Open Project |
| `removeFromWorkspace` | 从工作区移除 | Remove from Workspace |
| `untitledConversation` | 未命名会话 | Untitled |

### 影响文件

所有 10 个 locale JSON：`zh-CN`, `zh-TW`, `en`, `ja`, `ko`, `es`, `de`, `fr`, `pt`, `ar`

---

## 12. 换机器重建步骤

如果在新的机器上需要重建项目，按以下步骤操作：

### 1. 克隆仓库

```bash
git clone https://github.com/plhys/veryagent-plus.git
cd veryagent-plus
```

### 2. 一键初始化

```bash
# PowerShell
powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1

# 或 Git Bash
bash scripts/setup-dev.sh
```

脚本会自动：安装 sccache → `pnpm install` → `cargo fetch` → 启动 sccache 服务器。

### 3. 启动开发

```bash
pnpm tauri dev
```

### 4. 发布构建

```bash
pnpm tauri build --no-bundle
```

### 可选：迁移 sccache 缓存

如果想在新机器上也秒编译，从旧机器拷贝 sccache 缓存目录：
```
旧机器：C:\Users\<用户名>\AppData\Local\Mozilla\sccache\cache
→ 新机器同路径
```

详见 `docs/BUILD-SPEED.md`。

---

## 变更文件清单

| 文件 | 操作 |
|------|------|
| `.cargo/config.toml` | 修改 |
| `.gitignore` | 修改 |
| `src-tauri/Cargo.toml` | 修改 |
| `src-tauri/Cargo.lock` | 修改 |
| `src/app/globals.css` | 修改（14 dark + 13 light 块颜色） |
| `src/app/workspace/layout.tsx` | 修改（去掉 TabBar） |
| `src/components/ui/resizable.tsx` | 修改（分割线不高亮） |
| `src/components/layout/app-title-bar.tsx` | 修改（去掉 border-b） |
| `src/components/layout/status-bar.tsx` | 修改（去掉 border-t） |
| `src/components/layout/sidebar.tsx` | **大量修改**（tab 切换、布局清理、颜色） |
| `src/components/layout/folder-title-bar.tsx` | 修改（移除 NewFolderDropdown） |
| `src/components/layout/new-folder-dropdown.tsx` | 修改（紧凑化） |
| `src/components/conversations/sidebar-conversation-card.tsx` | 修改（加平铺显示） |
| `src/components/conversations/sidebar-conversation-list.tsx` | 修改（hideFolderSections prop） |
| `src/components/conversations/sidebar-conversation-grouping.ts` | 修改（hideFolderSections 逻辑） |
| `src/components/conversations/sidebar-project-list.tsx` | **新建** |
| `src/i18n/messages/*.json` (10 个) | 修改（新增翻译 key） |
| `docs/BUILD-SPEED.md` | 新建 |
| `scripts/setup-dev.sh` | 新建 |
| `scripts/setup-dev.ps1` | 新建 |
| `src-tauri/src/commands/backup/mod.rs` | 修改（codeg→veryagent 遗漏修复） |
| `src-tauri/src/commands/experts.rs` | 修改（codeg→veryagent 遗漏修复） |
