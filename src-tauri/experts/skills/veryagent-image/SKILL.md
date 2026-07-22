---
name: veryagent-image
description: "VeryAgent image generation — generate or edit images via the platform image tools. Configure multiple gateways (note + priority 0–9, 0=highest) with the skill Settings button first. Use generate_image (and modify_image for edits). Do not invent chat models as image models."
---

# 出图网关

通过 **VeryAgent 平台出图工具** 生成或修改图片。网关在技能卡片的 **设置** 里配置。

## 使用前

1. 在 Skills 仓库找到 **出图网关**（分类：**艺术设计**），点 **添加** 挂到当前智能体  
2. 点卡片上的 **设置**：
   - 打开「启用出图」
   - **可添加多个网关**，每个网关填写：
     - **备注**（随意：站名、价格、模型家族等）
     - **优先级 0–9**（**0 最优先**，排最前；失败自动试下一个）
     - API 地址 / API Key / 出图模型
   - 保存  
3. 若会话已在跑，按提示 **重连** 后再出图  

未配置或未启用时，不要假装已经出图。

## 铁律

1. **只调平台工具**  
   使用 `generate_image` / `modify_image`（宿主名可能带前缀，如 `mcp_veryagent_mcp_generate_image`）。  
   **禁止** 自己写 Python/curl、禁止自解 base64、禁止自己落盘。

2. **`model` 一律不传**  
   出图模型以各网关设置里的默认为准；平台按优先级选网关。  
   **禁止** 把聊天模型（`deepseek-*`、`gpt-4o`、`step-*`、`claude-*` 等）当作 `model`。

3. **参数尽量简单**  
   - 文生图：只要用户描述 → `prompt`  
   - 用户说了尺寸（`1024x1024`、`16:9` 等）→ 再传 `image_size`  
   - 改图：`prompt` + `ref_urls`（上一张图的路径或 URL）

4. **UI 负责显示**  
   工具成功后，聊天界面会自动出图。  
   你只做简短自然语言确认。  
   **禁止** 贴 base64、data URL、JSON、文件路径、markdown 图片。  

## 图生图 / 引用二次创作

用户从出图卡右键「引用二次创作」时，输入区会挂上源图。  
此时应调用 `modify_image`（或带 `ref_urls` 的 `generate_image`），用用户的新描述改图。
