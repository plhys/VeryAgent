# 技能系统调研报告

> 调研日期：2026-07-07
> 范围：veryagent-plus 中"专家技能"与"办公技能"的完整逻辑，以及"锁"的来源、必要性、当前故障根因。

---

## 一、两种技能是什么

veryagent 里有**两套技能系统**，底层机制完全相同，区别只在技能来源和 UI 呈现：

| 维度 | 专家技能（Experts） | 办公技能（Office Skills） |
|------|---------------------|--------------------------|
| 技能来源 | 编译时打包进二进制（`include_dir!("experts")`） | 运行时从外部 `officecli` 二进制加载 |
| 中央仓库 | `~/.veryagent/skills/<id>/` | 同一个目录（共用） |
| 数量 | 14 个（brainstorming、systematic-debugging 等） | 9 个（pptx、docx、xlsx 等） |
| 安装时机 | 启动时自动解压 + 哈希校验 | 需先安装 officecli 二进制，再手动"同步" |
| 元数据来源 | 打包的 `experts.toml` | 硬编码在 `office_tools.rs` |
| 链接机制 | symlink（Unix）/ junction+复制兜底（Windows）—— **共用** | 完全相同 |
| 设置页 `ready` 标志 | 永远 `true`（已打包） | `installedCentrally`（需先同步） |

**核心理念**：技能的"本体"只存一份在中央仓库 `~/.veryagent/skills/`，给某个智能体启用一个技能 = 在该智能体的技能目录里创建一个指向中央仓库的**符号链接/junction**。禁用 = 删掉这个链接。**没有数据库状态**，链接在就是启用，链接不在就是没启用。

---

## 二、技能系统的三层架构

### 第 1 层：中央仓库（单一真相源）

```
~/.veryagent/skills/
├── .manifest.json          # 记录每个技能的哈希和"用户修改待审核"标志
├── brainstorming/SKILL.md
├── systematic-debugging/SKILL.md
├── officecli-pptx/SKILL.md
└── ...
```

- 专家技能：启动时 `ensure_central_experts_installed()` 自动解压。如果用户改过技能文件，会备份成 `<id>.user-backup-<时间戳>` 而不是直接覆盖。
- 办公技能：调用 `officecli load_skill <id>` 把输出写到 `SKILL.md`。

### 第 2 层：每智能体技能目录（链接落点）

每个智能体有自己的技能目录，启用技能就在这里创建链接：

| 智能体 | 技能目录 |
|--------|---------|
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/`（首选），也扫 `~/.agents/skills/` |
| Gemini | `~/.gemini/skills/`，也扫 `~/.agents/skills/` |
| Cline | `~/.agents/skills/`，也扫 `~/.cline/skills/` |
| Pi | `~/.pi/agent/skills/`，也扫 `~/.agents/skills/` |
| …共 10 种 | 见 `acp.rs:4257-4358` |

⚠️ **Codex / Gemini / Cline / Pi 共享 `~/.agents/skills/`**。这是后面"非局部效应"问题的根源——给 Codex 建的链接可能物理上落在共享目录里，影响其他智能体。

### 第 3 层：链接状态机（5 种状态）

后端 `classify_link()` 对每个 (技能, 智能体) 配对检查链接目录，返回 5 种状态：

| 状态 | 含义 | 矩阵里显示为 |
|------|------|-------------|
| `not_linked` | 没有任何东西 | 空格（可启用） |
| `linked_to_codeg` | 链接存在且指向我们的中央仓库 | ✅ 已启用 |
| `linked_elsewhere` | 链接存在但指向别处（别的工具建的） | 🔒 锁定（ForeignLink） |
| `blocked_by_real_directory` | 真实目录/文件占位（非链接） | 🔒 锁定（NameCollision） |
| `broken` | 链接存在但目标已失效 | ⚠️ 损坏 |

> ⚠️ **命名不一致**：后端 Rust 枚举 `LinkedToCodeg` 经 `serde(rename_all="snake_case")` 序列化为 `"linked_to_codeg"`，但前端类型和所有 UI 代码用的是 `"linked_to_veryagent"`。**两者不匹配**——这是当前故障的关键线索之一（见第五节）。

---

## 三、"锁"到底是什么

代码里"锁"这个词出现在**三个完全不同的地方**，必须分开理解：

### 锁 ①：mutation_lock —— 进程级异步互斥锁（必须保留）

```rust
// experts.rs:178-181
fn mutation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}
```

所有链接变更操作（link/unlink/applyLinks）都要先拿到这把锁。目的是**串行化对共享目录 `~/.agents/skills/` 的并发写**，防止多个操作竞态。这是合理的并发安全机制，**不应移除**。它不会导致用户可见的"锁住"问题——拿不到锁只是等待，不是报错。

### 锁 ②：ForeignLink 错误 —— 安全护栏（可商榷）

```rust
// experts.rs:833-841 —— link_one_locked 里
LinkedElsewhere | Broken => {
    return Err(ExpertsError::ForeignLink {
        path: link_path.to_string_lossy().to_string(),
        found: ...,
    })
}
```

当链接目录已经存在一个**指向别处的链接**时，veryagent **拒绝覆盖**它，返回 `ForeignLink` 错误。同样，unlink 时遇到指向别处的链接也拒绝删除。

**设计意图**：保护用户/其他工具创建的链接不被误删。比如用户手动给 Claude 建了一个指向自己技能仓库的链接，veryagent 不应该粗暴覆盖。

**问题**：这个保护过于严格。Windows 上 junction 的行为很不稳定——之前的会话留下的过期 junction、复制模式留下的真实目录副本，都会被判定为 `linked_elsewhere` 或 `blocked_by_real_directory`，导致用户**无法启用也无法禁用**，卡死。

### 锁 ③：前端 UI 锁定显示 —— 用户体验层

设置矩阵里，当某个单元格 `(!ready || blocked) && !enabled` 时，渲染为虚线边框 + 🔒 锁图标，不可点击。聊天页面的技能快捷卡片也有类似的锁定状态（锁图标 + 点击提示去设置页启用）。

这是纯 UI 表现，后端没有"锁"的概念——UI 只是根据状态机的 5 种状态决定怎么渲染。

---

## 四、为什么要有锁？不锁行不行？

### mutation_lock（锁①）—— 必须有
没有它，两个并发的 applyLinks 会互相踩踏共享目录。**不可移除**。

### ForeignLink（锁②）—— 可以放松
| 保留（现状） | 放松（建议） |
|-------------|-------------|
| 不会误删用户手动建的链接 | 用户体验更好，不会被卡死 |
| 但过期 junction / 复制副本会卡死用户 | 需要区分"用户手动建的"和"过期残留"——实际上很难区分 |
| Windows 上极易触发 | — |

**务实建议**：对 `Broken`（断链）自动清理后重链；对 `LinkedElsewhere` 可以加一个"强制覆盖"的二次确认而不是硬报错；对 `blocked_by_real_directory` 保留拒绝（真实目录可能含用户数据）。

### 前端 UI 锁（锁③）—— 看产品定位
- 如果产品想"技能即用即点，不需要手动管理"→ 前端干脆不锁，所有技能卡片都可点击，后端按需自动建链。
- 如果产品想"让用户明确控制哪些技能给哪个智能体"→ 保留锁定 UI 作为引导。

---

## 五、🔥 当前功能损坏的真正根因

**不是 junction 错误，而是 `api.ts` 里的一行 hack。**

### 罪魁祸首

`src/lib/api.ts` 第 729-733 行和第 828-832 行：

```typescript
export async function expertsListAllInstallStatuses() {
  const result = await getTransport().call("experts_list_all_install_statuses")
  // 让所有技能都显示为启用状态        ← 这行注释说明了一切
  return result.map((item: ExpertInstallStatus) => ({
    ...item,
    state: "linked_to_veryagent" as const,   // ← 强制把所有状态改成"已启用"
  }))
}
```

`officecliSkillListAllInstallStatuses` 里有一模一样的覆盖。

### 这导致了什么连锁反应

**1. 矩阵显示与实际完全脱节**
后端返回的真实状态（`not_linked` / `broken` / `linked_elsewhere`）全部被丢弃，矩阵上每个单元格都显示为 ✅ 已启用——即使文件系统里根本没有任何链接。

**2. `toggleCell` 逻辑被搞乱**
矩阵的 `toggleCell` 依赖 `isEnabled(status)` 判断当前是否已启用：

```typescript
const toggleCell = (skillId, agentType) => {
  const enabled = isEnabled(statuses.get(...))  // ← 永远返回 true！
  if (!enabled) {
    // 启用分支：先清所有，再链当前
  } else {
    // 禁用分支：只解链当前    ← 实际走这里
  }
}
```

用户看到一个"已启用"的格子，想启用它，点击后实际执行的是**禁用（unlink）**——对一个根本不存在的链接执行删除，要么 no-op 要么报 ForeignLink。

**3. `useEnabledSkillIds` 失真**
聊天页面的技能快照也走这个被覆盖的 API。虽然 `quick-actions.tsx` 的 `isLocked` 被硬编码成 `false`（所以聊天页技能卡片不锁），但 `message-input.tsx` 里的 `isSkillLocked` 依赖 `enabledIds.has()`，而 `enabledIds` 是从一个全"已启用"的快照算出来的——所有技能都被认为已启用，锁定判断永远不触发。

**4. 用户看到的现象**
- 矩阵里所有格子都打勾，但实际没生效
- 点格子想启用，实际在禁用，报错
- 想禁用的也禁不掉（状态混乱）
- "正常功能都用不了"

### 为什么会有这个 hack

推测：最初为了"让所有技能默认可用，不锁用户"加了这个覆盖，但它把后端的真实状态全丢了。加上 `linked_to_codeg` vs `linked_to_veryagent` 的命名不匹配，覆盖恰好"修"了命名问题（把 `linked_to_codeg` 强制改成 `linked_to_veryagent`），所以看起来"能跑"，实际上状态管理完全失效。

---

## 六、修复方案

### 方案 A：最小修复（推荐，改动最小）

**1. 修 `api.ts`：只做命名映射，不覆盖状态**

```typescript
export async function expertsListAllInstallStatuses() {
  const result = await getTransport().call("experts_list_all_install_statuses")
  return result.map((item: ExpertInstallStatus) => ({
    ...item,
    // 后端序列化为 linked_to_codeg，前端用 linked_to_veryagent —— 只做命名映射
    state: item.state === "linked_to_codeg" ? "linked_to_veryagent" : item.state,
  }))
}
```

办公技能的同名函数同样处理。这样后端的真实状态（`not_linked` / `broken` 等）能正确传到前端。

**2. 修 `quick-actions.tsx`：恢复 `isLocked` 的真实逻辑**（如果想让聊天页也正确反映锁定）

```typescript
const isLocked = useCallback(
  (id: string) => !!agentType && ready && !enabledIds.has(id),
  [agentType, ready, enabledIds]
)
```

如果产品决定"聊天页不锁，所有技能随便点"——那就保持 `() => false`，但至少 `api.ts` 的状态要真实，否则矩阵页还是坏的。

**3.（可选）修后端 `link_one_locked`：遇到 Broken 自动清理**

```rust
// experts.rs link_one_locked，遇到 AlreadyExists 时：
LinkedElsewhere | Broken => {
    // 对 Broken（断链）自动删后重链，不报错
    // 对 LinkedElsewhere 仍报 ForeignLink（保护用户链接）
}
```

### 方案 B：彻底修复命名不一致

把前端的 `linked_to_veryagent` 全部改回 `linked_to_codeg`（和后端对齐），或者把后端的枚举改名为 `LinkedToVeryagent`。改动面较大（types.ts + 所有 UI 组件 + i18n），但根治命名问题。

### 方案 C：后端自动管理（最省心，改动最大）

在 `link_one_locked` 遇到 `ForeignLink` / `Broken` 时自动 unlink 旧链接再建新的，前端不再需要处理锁定状态。但这会失去"保护用户手动链接"的安全性。

---

## 七、结论

| 问题 | 根因 | 严重程度 |
|------|------|---------|
| 技能功能完全用不了 | `api.ts` 强制覆盖所有状态为 `linked_to_veryagent` | 🔴 致命 |
| 矩阵显示与实际不符 | 同上 | 🔴 致命 |
| 点启用实际执行禁用 | 同上导致 `toggleCell` 走错分支 | 🔴 致命 |
| junction os error 183/32 | ForeignLink 拒绝覆盖 + Windows junction 不稳定 | 🟡 次要 |
| 命名不一致 codeg vs veryagent | 重命名遗漏 | 🟡 次要（被 hack 掩盖） |

**当前最该做的一件事**：删掉 `api.ts` 里两个 `ListAllInstallStatuses` 函数中的 `state: "linked_to_veryagent" as const` 覆盖，改成只映射 `linked_to_codeg → linked_to_veryagent`。这一改就能让矩阵恢复真实的状态显示，`toggleCell` 也能正确判断启用/禁用分支。
