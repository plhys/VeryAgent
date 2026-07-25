# 桌面宠物改造计划

## 1. 背景

当前宠物系统有两个问题：
1. 宠物市场（codex-pets.net）当前网络不可达，用户无法访问
2. 添加宠物只支持上传一整张精灵图（spritesheet），操作不直观
3. 左右跑（running_left / running_right）两个状态从未触发，是无效代码

## 2. 改造目标

### 2.1 去掉宠物市场
- 移除 `pet-marketplace-dialog.tsx` 组件
- 从 `pet-manager-section.tsx` 中去掉"市场"入口按钮
- 保留 `pet-manager-section.tsx` 中的"添加宠物"和列表管理功能

### 2.2 精简动画状态
| 动作 | 保留 | 说明 |
|------|------|------|
| idle | ✅ | 待机，始终显示 |
| running | ✅ | 智能体工作/响应中 |
| waiting | ✅ | 等待授权/输入 |
| failed | ✅ | 出错 |
| jumping | ✅ | 庆祝（一次性） |
| waving | ✅ | 挥手（一次性） |
| review | ✅ | 审核状态 |
| running_right | ❌ 删除 | 从未触发 |
| running_left | ❌ 删除 | 从未触发 |

- 从 Rust `PetState` 枚举删除 `RunningRight` / `RunningLeft`
- 从前端 `PetState` 类型删除 `running_right` / `running_left`
- 精灵图行数从 9 行改为 7 行
- `PetSprite` 的 webm 视频映射表同步更新

### 2.3 添加宠物改为每个状态独立上传文件

**当前问题：** 添加宠物只能上传一整张 1536×1872 的精灵图，7 个动作压缩在一张图里，制作门槛高。

**改造方案：** 每个动画状态独立上传文件。

#### 2.3.1 后端改动

**新增 API：**
- `pet_add_webm` — 接收 7 个独立文件，每个状态对应一个文件
- 存储结构：`~/.veryagent/pets/<id>/states/idle.webm`、`running.webm`、`waiting.webm` 等
- 新增 `pet_replace_state_asset` — 单独替换某个状态的文件

**保留兼容：**
- 原有精灵图模式（spritesheet）继续支持，检测到 `spritesheet.webp` 则走旧路径
- 新格式优先检测 `states/` 目录

#### 2.3.2 前端改动

**PetEditor 改造：**
- 上传界面改为 7 个独立文件上传区域，每个状态标注清楚：
  ```
  ┌──────────────────────────────┐
  │  待机 idle       [选择文件]  │
  │  工作 running    [选择文件]  │
  │  等待 waiting    [选择文件]  │
  │  出错 failed     [选择文件]  │
  │  庆祝 jumping    [选择文件]  │
  │  挥手 waving     [选择文件]  │
  │  审核 review     [选择文件]  │
  └──────────────────────────────┘
  ```
- 每个文件可单独上传，非必填（未上传的状态使用默认 webm 兜底）
- 支持 webm / png / webp 格式

**PetSprite 改造：**
- 检测 `/states/` 目录是否有对应状态的文件
- 有则播放独立文件，无则回退到默认 webm 视频

### 2.4 宠物出现动画

**欢迎页（未打开对话时）：** 不显示宠物

**对话窗口打开时：** 宠物由小到大出现
- 用 CSS 动画实现：`scale(0) → scale(1)` + `opacity(0 → 1)`
- 动画时长 300ms，缓动 `ease-out`
- 仅在对话 tab 切换/打开时触发一次

**实现方式：**
- `PetFloating` 组件加一个 `mounted` 状态，通过 `useEffect` 在对话页面加载时触发
- 对话页面判断：当前 tab 是 conversation 且非空时才显示宠物
- 欢迎页（无 tab 或 tab 为空）不显示宠物

## 3. 文件改动清单

| 文件 | 改动 |
|------|------|
| `src-tauri/src/models/pet.rs` | 删除 `RunningRight`/`RunningLeft`，行数调整 |
| `src-tauri/src/pet_state_mapper.rs` | 删除相关匹配 |
| `src-tauri/src/pets/mod.rs` | 新增 `add_pet_webm` 函数，新增 `states/` 目录存储 |
| `src-tauri/src/commands/pet.rs` | 新增 `pet_add_webm` 命令 |
| `src-tauri/src/tauri_setup.rs` | 注册新命令 |
| `src-tauri/src/web/handlers/pet.rs` | 注册 web 路由 |
| `src/lib/pet/animation.ts` | 删除 `running_right`/`running_left`，行数调整 |
| `src/lib/pet/api.ts` | 新增 `addPetWebm` API |
| `src/lib/pet/types.ts` | 新增 `AddPetWebmInput` 类型 |
| `src/components/layout/pet-floating.tsx` | 添加出现动画，欢迎页隐藏 |
| `src/components/settings/pet-editor.tsx` | 改为 7 个独立文件上传界面 |
| `src/components/settings/pet-manager-section.tsx` | 去掉"市场"按钮 |
| `src/components/settings/pet-marketplace-dialog.tsx` | 删除 |

## 4. 优先级

**第一期（高优先级）：**
- 去掉宠物市场
- 去掉左右跑状态
- 欢迎页不显示宠物，对话页宠物由小到大出现

**第二期（中优先级）：**
- 添加宠物改为每个状态独立上传文件
- 后端新增 `pet_add_webm` API

## 5. 备注

- 第一期改动不涉及后端 Rust 代码，只改前端
- 第二期需要改 Rust 后端，涉及存储结构调整
- 原有精灵图模式保留兼容，不删除