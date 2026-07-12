---
name: gemini-image
description: Use when the user wants to generate, modify, or compose images — text-to-image, image-to-image, or iterative editing with Gemini
version: 1.4.0
---

# Gemini 图片生成

你已经有 `generate_image` 和 `modify_image` 两个 MCP 工具。**直接调用工具出图，不需要写 curl/Python 代码。**

## ⛔ 禁止事项

| 禁止操作 | 原因 | 正确做法 |
|-----------|------|----------|
| 写 curl/Python 脚本调 API | 工具已经封装好了 | 直接调用 `generate_image` 工具 |
| 翻译/润色/优化用户的 prompt | 会覆盖参考图片信息 | 直接透传用户原话 |
| 先分析参考图再写 prompt | 会把图生图降级成文生图 | 把参考图直接传给工具 |
| 传入 DALL-E 参数（quality/style/n） | Gemini 不识别 | 不要传这些参数 |

## 🛠️ 工具用法

### `generate_image` — 文生图 / 图生图

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | ✅ | 用户原话，直接透传，不做任何修改 |
| `image_size` | string | ❌ | `"1K"` / `"2K"` / `"4K"`，默认 2K |
| `aspect_ratio` | string | ❌ | `"1:1"` / `"4:3"` / `"16:9"` / `"9:16"` / `"3:4"`，默认 16:9 |
| `ref_urls` | string[] | ❌ | 参考图片 URL（图生图时传入） |
| `session_id` | string | ❌ | 会话 ID（用于迭代改图） |

**文生图示例：**
```
generate_image(prompt="一只在月光下奔跑的猫", image_size="4K")
```

**图生图示例：**
```
generate_image(prompt="把这张图的背景改成星空", ref_urls=["https://example.com/photo.jpg"])
```

**图生图（内网参考图）：**
```
generate_image(prompt="把这张图的风格改成水彩画", ref_urls=["http://10.10.100.233:1666/cache/upload_xxx.png"])
```

工具返回图片 URL，你直接用 markdown 渲染：
```
![生成图片](返回的URL)
```

### `modify_image` — 迭代改图

基于上次生成的图片继续修改。需要用同一个 `session_id`。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | ✅ | 修改指令，直接透传 |
| `session_id` | string | ❌ | 上次 generate_image 的 session_id |

**示例：**
```
# 先生成一张图
generate_image(prompt="一只黑猫", session_id="cat-session")
# → 返回 URL

# 然后迭代修改
modify_image(prompt="把猫的颜色改成白色", session_id="cat-session")
# → 返回新 URL
```

## 📤 返图铁律

工具返回的是内网 URL（如 `http://10.10.100.233:1666/cache/xxx.jpg`）。

**直接用 markdown 图片语法渲染：**
```
![生成图片](http://10.10.100.233:1666/cache/xxx.jpg)
```

veryAgent 支持 `http://` / `https://` URL 的图片渲染。所有用户在内网环境，图片 URL 可直接访问。这是最快的方式——4K 图片 URL 渲染远比 base64 快。

### 🚫 绝对禁止

| 禁止做法 | 用户会看到什么 |
|----------|---------------|
| 贴 base64 数据 URL | 一屏乱码 |
| 贴纯 URL 文本 | 无法打开的链接 |
| 贴 raw JSON | `"{"data":[...]}"` 乱码 |
| 只说"图片已生成，链接是 xxx" | 文字，不是图片 |

**用户看到的是文字/代码/乱码，你就做错了。用户屏幕上最终出现的必须是一张图片。**

## 📋 Prompt 规则

**核心原则：直接透传用户原话，不做任何修改。**

`prompt` 参数必须传用户的原话，不要翻译、润色、优化。Gemini 模型能从参考图片中直接理解构图和风格。智能体"优化"prompt 会覆盖参考图片信息，把图生图降级成文生图。

### ⚠️ 用户纠正案例（2026-07-02）

**错误做法**：收到用户的参考图后，先用 `vision_analyze` 分析图片风格、配色、布局，然后基于分析结果写 prompt。

**正确做法**：
1. 用户发图 → 直接传给 `generate_image` 的 `ref_urls`
2. 透传用户原话作为 `prompt`，不做预分析

## 🖼️ 参考图处理

### 公网 URL（推荐）

```
generate_image(prompt="用户原话", ref_urls=["https://example.com/photo.jpg"])
```

Gemini 可以直接下载公网 URL，速度最快。

### 内网 URL

容器自动处理内网 URL：
1. **优先上传到 Oracle OCI 图床** → 得到公网 URL → Gemini 直接下载
2. **OCI 失败则上传到 uguu.se** → 得到公网 URL
3. **uguu.se 失败则上传到 imgbb.com** → 得到公网 URL
4. **三个图床都失败** → 自动下载内网图片 → 转 base64 → 传给 Gemini（fallback）

### 本地文件

如果参考图在本地磁盘，先用 `/upload` 端点上传到容器缓存（通过 curl），然后把返回的内网 URL 传给 `ref_urls`。

## 🔧 故障排查

### 图片生成失败 — Fleet MCP 连接问题

**症状**：工具返回错误信息，API 返回 500 或超时。

**根因**：Fleet 网关在 VPN 内网，VPN 隧道断开后不可达。

**修复**：重启 EasyTier VPN，确认 `tun` 接口恢复后再试。

### 图片 URL 无法渲染

如果返回的图片 URL 在 veryAgent 聊天中无法显示为图片：
- 确认用了 markdown 图片语法：`![描述](URL)` 而不是纯 URL 文本
- 确认用户是否在内网环境

## 📎 仅部署人员参考

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `API_PORT` | `1666` | API 端口 |
| `OCI_PREAUTH_URL` | （空） | Oracle 存储桶预认证 URL |
| `FLEET_URL` | Fleet 网关地址 | MCP Fleet 网关 |
| `MCP_TIMEOUT` | `300` | 超时时间（秒） |
