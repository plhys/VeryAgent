# 自动更新签名密钥（本机保管说明）

> **目的：** 换机器 / 半年后再发版时，按本文找钥匙，不要再靠记忆。  
> **重要：** 私钥**永不入库**、**永不进安装包**。丢了私钥 = 旧公钥用户无法在线更新，只能重装。

---

## 1. 两把钥匙各干什么

| 东西 | 放哪 | 用途 |
| --- | --- | --- |
| **私钥** `veryagent-updater.key` | **只在发版机** | 给安装包盖章（生成 `.sig`） |
| **密码** `veryagent-updater.password` | **只在发版机** | 解锁私钥（有密码的 key 必填） |
| **公钥**（base64 一行） | 写进客户端源码 | 用户下载更新时验章 |

用户软件里**只有公钥**。从安装包 / AppData **抠不出私钥**——这是正常设计，不是丢了。

---

## 2. 本机固定路径（发版机）

在 **Windows 发版账号**下：

```text
%USERPROFILE%\.veryagent\keys\
  veryagent-updater.key          ← 私钥（保密）
  veryagent-updater.key.pub      ← 公钥文件（可公开）
  veryagent-updater.password     ← 私钥密码（保密，纯文本一行）
```

当前主任机示例：

```text
C:\Users\EVAN\.veryagent\keys\veryagent-updater.key
C:\Users\EVAN\.veryagent\keys\veryagent-updater.key.pub
C:\Users\EVAN\.veryagent\keys\veryagent-updater.password
```

**备份建议（二选一或都做）：**

1. 加密 U 盘 / 私密网盘单独目录（不要和源码仓库混放）
2. 密码管理器里存：路径说明 + password 内容 + 备份日期

换电脑时：把整个 `keys` 文件夹拷到新机同一路径即可。

---

## 3. 客户端里嵌的公钥在哪

两处必须一致（同一串 base64）：

1. `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
2. `src-tauri/src/update/verify.rs` → `TAURI_PUBKEY_B64`

内容 = `veryagent-updater.key.pub` 整文件去掉换行后的 **一行 base64**。

### 当前正式公钥（2026-07-19 换新钥）

- minisign 注释 id：`5282E2A963FB139A`
- 写入版本起：**v0.9.5**（含启动闪窗修复 + 出图网关）

```text
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDUyODJFMkE5NjNGQjEzOUEKUldTYUUvdGpxZUtDVWs0UVpFVVVZdHUva0UvL1RPbHVHYndiV1RGNzhOcFlpL2FGcXQ0UVpuczYK
```

### 已作废的旧公钥（勿再使用）

| 时期 | minisign id | 说明 |
| --- | --- | --- |
| ≤ v0.9.4 | `A6C790B84D04DA0D` | 旧正式钥；私钥已不可用，**无法再签** |
| 本机误生成 | `40469ACB1BE6698F` | 仅 `C:\Users\EVAN\.tauri\veryagent.key`，**从未**写入正式客户端 |

**换钥后果：** 仍在跑 0.9.3 / 0.9.4 的用户**不能**再靠「检查更新」升到新钥版本，必须**手动下载安装包重装**。从 **0.9.5 起**装过的用户，之后可用同一私钥在线更新。

---

## 4. 发版时怎么签

构建前在同一终端设置（路径按本机改）：

```bat
set TAURI_SIGNING_PRIVATE_KEY_PATH=%USERPROFILE%\.veryagent\keys\veryagent-updater.key
set /p TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<%USERPROFILE%\.veryagent\keys\veryagent-updater.password
```

PowerShell：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.veryagent\keys\veryagent-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content "$env:USERPROFILE\.veryagent\keys\veryagent-updater.password" -Raw).Trim()
```

然后正常 `build-release.bat` 或：

```bat
pnpm build
pnpm tauri:prepare-sidecars
cd src-tauri
cargo build --release --bin veryagent --features tauri-runtime
cd ..
pnpm tauri build --no-build
```

产物目录（Windows）：

```text
src-tauri\target\release\bundle\nsis\
  VeryAgent_*_x64-setup.exe
  VeryAgent_*_x64-setup.exe.sig
```

并准备 Tauri 标准 `latest.json`（version / notes / pub_date / platforms.windows-x86_64.url + signature），挂到：

- GitHub：`plhys/VeryAgent` 对应 Release + `latest` 通道可下的 `latest.json`
- Gitea：`http://10.10.100.233:3030/boss/veryagent` 同一套文件；`platforms.*.url` 指向 Gitea 可下地址

细节见 [updater-release.zh-CN.md](./updater-release.zh-CN.md)。

### 单独给已有文件补签

```bat
pnpm exec tauri signer sign path\to\installer.exe -f %USERPROFILE%\.veryagent\keys\veryagent-updater.key -p <password>
```

会在同目录生成 `.sig`。

---

## 5. 以后如果又要换新钥

1. `pnpm exec tauri signer generate -w %USERPROFILE%\.veryagent\keys\veryagent-updater.key -p <新密码> --ci -f`
2. 同步更新 `tauri.conf.json` 与 `verify.rs` 的 pubkey
3. 升版本号，发版说明写清：**旧版必须重装，不能在线更**
4. 旧私钥作废；更新本文「当前正式公钥」一节
5. **立刻备份** 新 key + password 到加密位置

---

## 6. 自检清单

- [ ] `%USERPROFILE%\.veryagent\keys\` 三文件都在
- [ ] `key.pub` 解码后的 id 与文档「当前正式公钥」一致
- [ ] 源码两处 pubkey 字符串完全相同
- [ ] 发版环境变量指向**这一对** key，不是 `.tauri\veryagent.key`
- [ ] 安装包旁有 `.sig`，`latest.json` 的 signature 来自该 `.sig`
- [ ] 私钥 / 密码**未**出现在 git diff 里

---

## 7. 和「软件里怎么配对」一句话

公钥在每个用户客户端里；私钥只在发版机。网上安装包带着私钥盖的章，客户端用公钥验。  
**配对靠算法，不靠软件里藏私钥。**
