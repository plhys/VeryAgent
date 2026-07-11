# TROUBLESHOOTING.md — 踩坑记录与故障排除

> 本文件记录项目开发、编译、启动过程中遇到的典型问题及解决方案。
> **目标读者是 AI 智能体**，遇到类似症状时可直接查阅并执行对应修复步骤。

---

## 目录

| # | 症状 | 根因 | 快速修复 |
|---|------|------|----------|
| 1 | 白屏（窗口打开但内容空白） | 旧 dev server 返回 HTTP 500 | 杀旧进程重启 |
| 2 | `useAcpActions must be used within AcpConnectionsProvider` | layout.tsx 未随路由重构迁移 | 从 HEAD 恢复 |
| 3 | `Cannot find module '../../../../../../src/...'` | `.next` 缓存含旧机器绝对路径 | 删除 `.next` |
| 4 | `Cannot find module tailwindcss/dist/lib.js` | pnpm 符号链接跨机器损坏 | `pnpm clean --deep` |
| 5 | Tauri 窗口闪退/秒关 | 残留 veryagent.exe single-instance 冲突 | 杀残留进程 |
| 6 | `cargo run` 报 `../out doesn't exist` | `out/` 被 clean 删除，生产模式需先 build | 用 `pnpm tauri dev` 开发模式 |
| 7 | `MISSING_MESSAGE: Could not resolve ...` | next-intl 缺少某语言的翻译键 | 补充翻译 |
| 8 | 宠物不出现 | 数据库无宠物数据（installed=0） | 需配置/安装宠物 |
| 9 | `rm -rf node_modules` 后 pnpm install 失败 | Windows 文件锁损坏 NTFS junction | 用 `pnpm purge` 或 `cmd rmdir` |
| 10 | `pnpm clean --deep` 提示 "clean is not a pnpm command" | pnpm 内置 clean 拦截了 `--deep` 参数 | 用 `pnpm clean:deep` |

---

## 详细踩坑记录

### 1. 白屏 — 旧 dev server 返回 500

**症状**：Tauri 窗口打开，但 WebView 内容空白（白屏），无任何 UI 渲染。

**根因**：上一次 `pnpm tauri dev` 或 `pnpm dev` 启动的 Node.js 进程仍占着端口 3000，但该进程状态异常（返回 HTTP 500），新启动的 Tauri 连到了这个旧进程而非新 dev server。

**排查步骤**：
```bash
# 1. 查看端口占用
netstat -ano | findstr ":3000"

# 2. 如果有旧 node.exe 占用，杀掉
taskkill /F /PID <旧进程PID>

# 3. 同时杀 Tauri 残留
taskkill /F /IM veryagent.exe
taskkill /F /IM msedgewebview2.exe

# 4. 重启
pnpm tauri dev
```

**预防**：每次启动前先运行 `pnpm clean`（会自动杀残留进程）。或者确保上一个 `pnpm tauri dev` 进程已完全退出再启动新的。

---

### 2. AcpConnectionsProvider missing

**症状**：React 报错 `useAcpActions must be used within AcpConnectionsProvider`，页面崩溃。

**根因**：路由重构时 `layout.tsx` 没被迁移到新路由目录，导致 workspace 页缺少 Provider 嵌套。

**修复**：
```bash
# 从 HEAD 恢复最新版 layout.tsx（不是从旧 commit，否则样式会变）
git checkout HEAD -- src/app/(main)/workspace/layout.tsx
```

**教训**：路由重构时必须检查每个 `layout.tsx` 的 Provider 鏈是否完整。不要从旧 commit 恢复文件（会导致样式差异），应从 HEAD 恢复。

---

### 3. `.next` 缓存含旧绝对路径

**症状**：TypeScript 编译报错 `Cannot find module '../../../../../../D:/aicodework/...'` 或类似带旧盘符/路径的错误。

**根因**：`.next/dev/types/` 里缓存了上一次编译时的绝对路径。通过同步工具（VerySync/Syncthing）把项目同步到新机器后，新机器路径不同（如 `E:\AIcode\` vs `D:\aicodework\`），但 `.next` 里还存着旧路径。

**修复**：
```bash
pnpm clean      # 自动删除 .next 和 out
# 或手动删除
rm -rf .next out    # Linux/Mac
cmd /c "rmdir /s /q .next & rmdir /s /q out"   # Windows
```

**预防**：`.verysyncignore` 已排除 `.next/`，但需确保同步工具识别了忽略文件。换机器后必须先 `pnpm clean` 再编译。

---

### 4. pnpm 符号链接跨机器损坏

**症状**：`Cannot find module tailwindcss/dist/lib.js` 或 `Cannot find module @/lib/utils` 等模块找不到错误，明明 `node_modules` 里文件存在。

**根因**：pnpm 使用 NTFS junction（符号链接）管理 `node_modules/.pnpm/` 的依赖树。同步工具（VerySync/Syncthing）在跨机器同步时，junction 可能变成死链接或普通文件夹，导致模块解析失败。

**修复**：
```bash
pnpm clean:deep   # 删除 node_modules + 重新 pnpm install
```

**注意**：
- **绝对不要用 `rm -rf node_modules`** 在 Windows 上删（详见踩坑 #9）
- 用 `pnpm purge` 或 `cmd /c "rmdir /s /q node_modules"` 才安全
- 删除后必须重新 `pnpm install`

---

### 5. Tauri 窗口闪退 — single-instance 冲突

**症状**：`pnpm tauri dev` 启动后窗口瞬间关闭，或提示"另一个实例正在运行"。

**根因**：Tauri 使用 single-instance 插件，如果上一个 `veryagent.exe` 没正常退出（或 `msedgewebview2.exe` WebView 渲染进程残留），新实例会检测到旧实例并退出。

**修复**：
```bash
taskkill /F /IM veryagent.exe
taskkill /F /IM msedgewebview2.exe
taskkill /F /IM veryagent-mcp.exe
pnpm tauri dev
```

**预防**：`pnpm clean` 已内置杀残留进程步骤。养成"先杀后启"的习惯。

---

### 6. `cargo run` 报 `../out doesn't exist`

**症状**：直接 `cargo run`（不带 `pnpm tauri dev`）报错 `resource path '../out' doesn't exist`。

**根因**：Tauri 的 build script（`build.rs`）引用 `../out` 作为资源目录，这是 Next.js 静态导出（`output: "export"`）的输出目录。`pnpm clean` 会删除 `out/`，开发模式下 Tauri dev server 不需要 `out/`（它连 dev server），但生产模式的 `cargo run` 需要。

**修复**：
```bash
# 开发模式（推荐，不需要 out/）
pnpm tauri dev

# 如果一定要用 cargo run，先构建前端
pnpm build        # 生成 out/ 目录
cd src-tauri && cargo run --no-default-features --features tauri-runtime
```

**预防**：日常开发永远用 `pnpm tauri dev`，不要直接 `cargo run`。

---

### 7. next-intl 翻译键缺失

**症状**：`MISSING_MESSAGE: Could not resolve Folder.sidebar.removeFromWorkspace in zh` 等翻译键缺失警告。

**根因**：新增了 UI 文本但未同步更新所有 10 种语言的翻译文件。

**修复**：检查 `i18n/messages/` 下对应语言的 JSON 文件，补充缺失的键值。先在 `en.json` 添加原文，再在其他语言文件添加翻译。

**预防**：修改 UI 文本时，同步更新 `i18n/messages/` 所有语言文件。

---

### 8. 宠物不出现

**症状**：宠物气泡窗口空白，日志显示 `installed=0`。

**根因**：数据库中没有宠物数据，宠物功能需要用户手动安装/配置。

**说明**：这不是 bug，是正常行为。日志中 `pet?petId=default` 返回 200 说明路由正常，`installed=0` 只是表示尚未安装任何宠物。

---

### 9. `rm -rf node_modules` 在 Windows 上损坏符号链接

**症状**：`rm -rf node_modules`（或 Git Bash 的 `rm -rf`）执行后，重新 `pnpm install` 报错，或模块找不到。

**根因**：Windows NTFS junction（pnpm 用的符号链接类型）在 `rm -rf` 删除时，会**跟入链接目标**删除源文件，导致 `.pnpm-store` 被损坏。而且 Windows 上常有文件锁（编辑器/终端持有），删除不完整。

**修复**：
```bash
# 正确方式 1：pnpm 自带命令（推荐）
pnpm purge

# 正确方式 2：Windows 原生 rmdir
cmd /c "rmdir /s /q node_modules"

# 正确方式 3：pnpm clean:deep（内含上述逻辑）
pnpm clean:deep
```

**绝对禁止**：
- ❌ `rm -rf node_modules`
- ❌ `Remove-Item -Recurse -Force node_modules`（PowerShell，同样会跟入 junction）
- ❌ 在 veryagent.exe 运行时删除 node_modules（文件锁）

---

### 10. `pnpm clean --deep` 被 pnpm 内置 clean 拦截

**症状**：运行 `pnpm clean --deep` 时，`--deep` 参数被 pnpm 内置的 `pnpm clean` 命令解析，导致自定义脚本的 `--deep` 标志失效。

**根因**：pnpm 11+ 有内置 `clean` 命令，它有自己的 `--deep` 参数含义，与我们的脚本冲突。

**修复**：将深度清理拆为独立脚本名 `clean:deep`：
```bash
pnpm clean          # 普通清理
pnpm clean:deep     # 深度清理（删除 node_modules + 重装）
```

**预防**：不要依赖 pnpm 脚本的自定义参数，用独立的脚本名代替。

---

## 智能体操作快速参考

遇到构建/启动问题时，按以下顺序排查：

```
1. pnpm clean          → 解决 90% 的缓存/进程问题
2. pnpm clean:deep     → 解决符号链接损坏
3. cd src-tauri && cargo clean → 解决 Rust 编译缓存问题（少见）
4. 查端口占用           → 解决旧 dev server 返回 500
```

**关键原则**：
- 换机器后 **先 `pnpm clean:deep` 再 `pnpm install` 再 `pnpm tauri dev`**
- 不要在 veryagent 运行时编译或删除 node_modules
- 不要用 `rm -rf node_modules`（Windows），用 `pnpm purge` 或 `cmd rmdir`
- 不要直接 `cargo run`，用 `pnpm tauri dev`
- 不要从旧 commit 恢复文件，用 `git checkout HEAD`
