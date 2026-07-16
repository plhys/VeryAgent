# 桌面自动更新发布说明

VeryAgent 支持从两个发布源检查并安装更新，用户可在 **系统管理 → 软件更新** 中选择：

| 源 | 说明 | 仓库 |
| --- | --- | --- |
| **GitHub 仓库** | 公网 | https://github.com/plhys/VeryAgent |
| **Gitea 仓库** | 内网 | http://10.10.100.233:3030/boss/veryagent |

两个源应发布**同一套**签名产物与 `latest.json`，仅托管位置不同。

## 产物要求

桌面更新依赖 Tauri updater：

1. 构建时 `createUpdaterArtifacts: true`（已在 `src-tauri/tauri.conf.json` 开启）
2. 使用与 `plugins.updater.pubkey` 配对的 **私钥** 签名（`TAURI_SIGNING_PRIVATE_KEY` / `tauri signer`）
3. 每个平台的安装包旁生成 `.sig`
4. 在 release 上挂载 **`latest.json`**（Tauri 标准更新清单）

`latest.json` 示例结构（字段以实际 Tauri 生成物为准）：

```json
{
  "version": "0.9.3",
  "notes": "…",
  "pub_date": "2026-07-16T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "…",
      "url": "https://github.com/plhys/VeryAgent/releases/download/v0.9.3/…"
    }
  }
}
```

服务端自更新另需平台 tarball（`veryagent-server-*` + `.sig`），路径约定见 `src-tauri/src/update/install.rs`。

## 签名密钥

- 公钥已写入 `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`，并同步 `src-tauri/src/update/verify.rs`
- 私钥**不入库**。本机发布默认路径：`%USERPROFILE%\.veryagent\keys\veryagent-updater.key`
- 构建前设置：

```bat
set TAURI_SIGNING_PRIVATE_KEY_PATH=%USERPROFILE%\.veryagent\keys\veryagent-updater.key
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
```

丢失私钥后无法再为旧公钥签名；只能换钥并重新发版（旧客户端无法校验新钥签名）。

## 双仓发布步骤

1. 打 tag / 构建 release 产物（桌面 installer + `.sig` + `latest.json`，以及需要的 server 包）
2. 上传到 **GitHub** `plhys/VeryAgent` 的对应 Release
3. 将**相同** `latest.json` 与二进制上传到 **Gitea** `boss/veryagent` 的对应 Release  
   - Gitea 下载 URL 形态：  
     `http://10.10.100.233:3030/boss/veryagent/releases/latest/download/latest.json`
4. 确认两处 `latest.json` 的 `version` 一致；Gitea 上的 `platforms.*.url` 应指向 Gitea 可下载的资产地址（不要仍指向仅公网可达的 GitHub URL，除非内网也能访问 GitHub）

## 客户端行为

- 偏好保存在本地 `app_metadata` 键 `app_update_source`（`github` | `gitea`）
- 桌面：Rust `UpdaterBuilder.endpoints([...])` 覆盖默认 endpoint；Gitea 为 HTTP，配置中已允许 `dangerousInsecureTransportProtocol`
- 服务端：manifest 与 tarball 下载 base 均跟随所选源
- 前端检查更新统一走 `check_app_update` 命令（桌面与服务端同一路径）

## 本地验证清单

- [ ] 选择 GitHub → 检查更新（能连公网时）
- [ ] 选择 Gitea → 检查更新（内网可达时）
- [ ] 有新版本时下载安装并「重启以更新」
- [ ] 切换源后上次检查结果被清空，需重新检查
