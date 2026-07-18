# VeryAgent 独立开发启动（推荐）

这份文档说明 **日常改代码时怎么编译、怎么启动桌面端**，重点解决两件事：

1. **编译不要每次都冷启动很久**
2. **桌面进程要独立存活**——关掉 agent 会话 / 关掉启动用的终端，应用不要一起被杀

如果你只想出正式可分发的 `release` exe，看另一份：[`build-recovery.zh-CN.md`](./build-recovery.zh-CN.md)。

---

## 一、为什么不要总用 `pnpm tauri dev`

`pnpm tauri dev` / `.\dev.ps1` 的问题：

| 现象 | 原因 |
|---|---|
| 每次启动都很慢 | Tauri 会串起 beforeDev、sidecar、整条 dev 管线，冷启动成本高 |
| 关终端 / 关 agent 会话后，桌面端也没了 | 桌面进程挂在 dev 父进程树下，父进程退出会带走子进程 |
| 端口锁、sidecar 抢跑 | 同一条链路里前端 + Tauri 一起管，冲突更常见 |

**推荐做法：前后端拆开，进程独立。**

```
pnpm dev                         # 前端热更新（可独立终端）
cargo build --manifest-path ...  # 只在改了 Rust 时重编 debug exe
Start-Process veryagent.exe      # 桌面壳独立进程，不挂在当前 shell 上
```

这样：

- 只改前端 → **几乎不重编 Rust**，刷新/热更新即可
- 改了 Rust → **增量编译** debug，通常比整条 `tauri dev` 快
- 桌面端用 `Start-Process` 拉起 → **关掉当前 agent / 终端也不会把 app 杀掉**

---

## 二、最短操作（Windows）

在项目根目录 `veryagent-project/` 下：

### 1. 首次或依赖变了

```powershell
pnpm install
pnpm tauri:prepare-sidecars
```

### 2. 日常开发：一键独立启动

```powershell
.\dev-detached.ps1
```

脚本会：

1. 确保 `3000` 上有前端（没有就后台起 `pnpm dev`）
2. 如需则增量编译 `src-tauri/target/debug/veryagent.exe`
3. 用 `Start-Process` **独立拉起**桌面端

也可以分步手动：

```powershell
# 终端 A：前端（保持开着，方便看日志；也可后台）
pnpm dev

# 只在改了 Rust / Tauri 时：
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features --features tauri-runtime

# 独立启动桌面壳（关键：不要用 & 挂在当前 shell 前台）
Start-Process -FilePath ".\src-tauri\target\debug\veryagent.exe"
```

桌面端 `devUrl` 指向：`http://localhost:3000`（见 `src-tauri/tauri.conf.json`）。

---

## 三、什么时候要重编，什么时候不用

| 你改了什么 | 要不要 cargo build | 桌面端怎么更新 |
|---|---|---|
| React / i18n / CSS / 页面 | **不用** | `pnpm dev` 热更新；必要时刷新窗口 |
| 仅 `src-tauri` Rust 代码 | **要**（debug 增量） | 先停掉正在跑的 `veryagent.exe`，再 build，再 `Start-Process` |
| `Cargo.toml` / 依赖 | **要**（可能较慢） | 同上 |
| sidecar / MCP 二进制 | 跑 `pnpm tauri:prepare-sidecars` | 再启动 exe |
| 正式发包 | 用 `build-exe.bat`（release） | 见 build-recovery 文档 |

> **Windows 注意**：正在运行的 `veryagent.exe` 会锁文件，重编时若提示「拒绝访问」，先结束进程再 `cargo build`。

```powershell
Get-Process veryagent -ErrorAction SilentlyContinue | Stop-Process -Force
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features --features tauri-runtime
Start-Process -FilePath ".\src-tauri\target\debug\veryagent.exe"
```

---

## 四、为什么 `Start-Process` 很关键

| 启动方式 | 结果 |
|---|---|
| `pnpm tauri dev` | 桌面端是 dev 子进程，关终端/agent 常一起死 |
| `.\src-tauri\target\debug\veryagent.exe` 前台跑在当前 shell | 当前会话结束可能带走进程 |
| **`Start-Process ...\veryagent.exe`** | **独立进程**，agent 会话结束、关启动窗口，桌面端仍可继续跑 |

前端 `pnpm dev` 也可以独立：

- 需要看编译日志：单独开一个终端跑 `pnpm dev`
- 只想省事：用 `dev-detached.ps1` 后台起

两端都独立后：

- Agent / 自动化会话结束 → **不影响**桌面端
- 关一个终端 → **不必然**杀另一个进程

---

## 五、和现有脚本的关系

| 脚本 | 适合 | 不适合 |
|---|---|---|
| **`dev-detached.ps1`**（推荐日常） | 开发联调、进程独立、少冷启动 | 正式发包 |
| `start.ps1` | 换机后快速拉起已有 debug exe | 不负责前端热更新 |
| `quick.ps1` | 已有二进制时秒开壳 | 不编 Rust、不启前端 |
| `dev.ps1` / `pnpm tauri dev` | 偶尔要完整 Tauri dev 管线 | 日常反复启动（慢、易被父进程带走） |
| `build-exe.bat` | release 可分发 exe | 日常热更新 |

---

## 六、常见问题

### 1. 窗口开了但是白屏 / 连不上页面

先确认前端在跑：

```powershell
# 浏览器打开
http://localhost:3000
```

没有响应就重新 `pnpm dev`，再开桌面端。

### 2. 端口 3000 被占用

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty OwningProcess |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

然后重新 `pnpm dev`。

### 3. 编译很慢

优先：

1. **不要每次 `pnpm tauri dev`**
2. 只在改 Rust 时 `cargo build`（增量）
3. 前端改动只靠 `pnpm dev`
4. 本机若装了 `sccache` 可在 `.cargo/config.toml` 打开；被 Defender 拦时先关掉 wrapper（本仓库可能已注释）

### 4. 为什么不把桌面端也挂到 agent 里前台跑

Agent 会话一结束，前台子进程容易被回收。  
**产品式本地开发**应：编译产物落盘 + `Start-Process` 独立生命周期。

---

## 七、推荐心智模型

```
┌─────────────────┐     HTTP :3000      ┌──────────────────────────┐
│  pnpm dev       │ ◄────────────────── │  veryagent.exe (debug)   │
│  Next 热更新     │                     │  Start-Process 独立进程   │
└─────────────────┘                     └──────────────────────────┘
        ▲                                         ▲
        │ 只改前端                                 │ 只改 Rust 时 cargo build
        │                                         │
   不重编 Rust                              先停 exe → 增量编 → 再 Start-Process
```

**原则：**

1. 编译和运行拆开  
2. 前端和桌面壳拆开  
3. 用独立进程，不要绑在 agent / 临时 shell 生命周期上  

按这套做，日常会明显快一截，也不会再出现「会话一关，开发板就没了」。
