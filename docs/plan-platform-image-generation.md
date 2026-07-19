# 计划：VeryAgent 平台出图能力

**日期**：2026-07-19  
**状态**：草案（已落库，待实现）  
**范围**：把 `generate_image` / `modify_image` 做成 VeryAgent **平台原生能力**——Key 与网关填在应用设置里，所有智能体自动获得出图工具；**不是**技能包，也**不是**用户自装 MCP 连接器。

---

## 0. 背景与结论

### 0.1 现状

| 项 | 现状 | 问题 |
|----|------|------|
| 工具暴露 | companion `veryagent-mcp` 已有 `generate_image` / `modify_image` | 链路本身可用 |
| 后端实现 | `listener.rs` 的 `process_generate_image` / `process_modify_image` **写死** `feishu.ideasir.com` MCP + 内置 token | 不可配置、不可换网关、密钥在代码里 |
| 模型映射 | `gemini` → `generate_image_model1`，`doubao` → `generate_image_model2` | 绑定 ideasir 私有协议，非 OpenAI 标准 |
| 配置/UI | 无 | 用户无法填自己的网关 / Key |
| 技能空壳 | 已清理 `doubao-image` / `gemini-image` 技能与仓库条目 | 正确方向：平台能力，不靠技能壳 |

### 0.2 目标形态（用户已确认）

```
用户在 VeryAgent 设置页填写：
  出图开关 + Base URL + API Key + 默认模型
        ↓
  持久化到 DB（仿 vision_bridge）
        ↓
  companion 启动时按开关注入 image feature
        ↓
  智能体调用 generate_image / modify_image
        ↓
  主进程读配置 → POST OpenAI 兼容 /v1/images/generations（及编辑接口）
        ↓
  返回图片（url 或 b64）给会话渲染
```

**一句话**：Key 填在 VeryAgent；全员尽量支持；不做技能 / 用户 MCP 主路径。

### 0.3 非目标（一期不做）

- 不做「每个智能体单独装一个出图 MCP」
- 不做技能仓库里的出图技能空壳（已清，不再加回）
- 不重造私有协议；一期只认 **OpenAI Images 兼容网关**（如 GPT-image-2 中转）
- 不做多供应商路由表（Azure / 火山 / 即梦各一套适配）——先一个 OpenAI 兼容端点打通
- 不在本期重做会话里的图片气泡 UI（沿用现有渲染）

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| 平台能力 | 配置在应用级，工具由 companion 统一注入 |
| 对齐 Vision Bridge | DB 单例表 + get/save 命令 + runtime 内存配置 + 设置页 |
| 标准协议 | `POST {base_url}/v1/images/generations`（及 edits，若网关支持） |
| 可关可开 | `enabled=false` 时不注入 image feature，工具对智能体不可见 |
| 密钥不进代码 | 去掉 ideasir 硬编码 URL/token |
| 全员尽量支持 | 默认对所有 agent type 开启；若某 agent 不支持 MCP companion，自然拿不到工具（机制层限制，不单列产品开关） |

**机制层 vs 体验层（刻意分开说）**

- **机制层**：配置持久化、OpenAI 调用、companion feature 注入、token 鉴权——这些决定「能不能用、稳不稳」。
- **体验层**：设置页字段、开关文案、错误提示——这些决定「好不好填、好不好懂」。
- 本期优先机制层打通；设置页做到和「多模态路由」同级即可。

---

## 2. 对标：Vision Bridge（抄作业清单）

出图配置几乎 1:1 复用「多模态路由」的分层，避免再发明一套：

| 层 | Vision Bridge 现有 | 出图应对齐 |
|----|-------------------|------------|
| Entity | `db/entities/vision_bridge.rs` | `db/entities/image_generation.rs` |
| Service | `db/service/vision_bridge_service.rs` | `db/service/image_generation_service.rs` |
| Runtime | `acp/vision_bridge.rs` + `VisionBridgeRuntimeConfig` | `acp/image_generation.rs` + `ImageGenerationRuntimeConfig` |
| Commands | `commands/vision_bridge.rs` get/save | `commands/image_generation.rs` get/save |
| Web | `web/handlers/vision_bridge.rs` + router | 同结构挂 `/image_generation_*` |
| 前端 API | `api.ts` `visionBridgeGetConfig/Save` | `imageGenerationGetConfig/Save` |
| 设置页 | `vision-bridge-settings.tsx` | `image-generation-settings.tsx` |
| i18n | `VisionBridgeSettings` / 侧栏 `vision_bridge` | `ImageGenerationSettings` / 侧栏 `image_generation` |
| 注入 | companion `vision` feature + `process_vision_analyze` | companion `image` feature + `process_generate_image` 读配置 |

字段建议（单例行，`id=1`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | bool | 总开关；关则不注入 image feature |
| `api_url` | string | Base URL，如 `https://your-gateway.example`（代码拼接 `/v1/images/generations`） |
| `api_key` | string | Bearer Token |
| `model_name` | string | 默认模型，如 `gpt-image-2` / 网关要求的 model id |
| `default_size` | string | 可选，默认 `1024x1024` 或网关约定值 |
| `updated_at` | datetime | 同 vision_bridge |

一期可不做 `agent_types_json` 白名单：默认全员；若日后要按智能体裁剪再加。

---

## 3. 调用链路（改造点）

### 3.1 保持不动

- companion 工具定义：`generate_image` / `modify_image` 名称与参数形状
- UDS/named-pipe broker 协议：`BrokerGenerateImageRequest` / `BrokerModifyImageRequest`
- 前端图片结果渲染（`render_generate_image_result` 等）
- `image_proxy` 本地代理（若结果是远程 URL 时仍可用）

### 3.2 必须改

**文件**：`src-tauri/src/acp/delegation/listener.rs`

- `process_generate_image` / `process_modify_image`：
  1. token 校验（已有）
  2. 读 `ImageGenerationRuntimeConfig`（或 service get_config）
  3. `enabled == false` 或缺 key/url → 返回清晰 `{ error: "..." }`
  4. 组装 OpenAI 兼容请求：
     - generate：`POST {api_url}/v1/images/generations`  
       body 约：`{ model, prompt, n, size, response_format? }`
     - modify / 图生图：优先 `POST {api_url}/v1/images/edits`；若网关只支持 generations + image 字段，则按网关实际字段适配（**实现前用用户网关样例对齐一次**）
  5. Header：`Authorization: Bearer {api_key}`
  6. 解析响应：`data[0].url` 或 `data[0].b64_json` → 统一成现有 outcome 形状给 companion

**去掉**：

- 硬编码 `http://feishu.ideasir.com/mcp/proxy/multimodal-model-prod/mcp`
- 硬编码 token
- `generate_image_model1` / `model2` 的 ideasir 工具名映射

### 3.3 companion feature 注入

- 现状：`session_state` 等处有 `image: true` 写死倾向
- 目标：`enabled` 时注入 `image` feature；关闭时不注入，智能体侧看不到工具
- 改动点：构造 `CompanionFeatures` / 启动 companion 的 `--features` 字符串处（与 vision 开关联动方式对齐）

### 3.4 启动与 runtime

- app / server 启动：`apply_persisted_image_generation_config` 把 DB 灌进 runtime（抄 vision_bridge）
- save 时同步更新 runtime，避免重启才生效

---

## 4. 前端设置页

### 4.1 入口

- 设置壳侧栏：与「多模态路由」同级，文案建议 **「出图能力」** / `Image Generation`
- 路由：`settings/image-generation`（命名可微调，保持 kebab-case）

### 4.2 表单字段（体验层）

| UI | 绑定 | 备注 |
|----|------|------|
| 启用出图 | `enabled` | 关则隐藏/禁用下方字段亦可，保存时仍写库 |
| API Base URL | `api_url` | placeholder 示例网关 |
| API Key | `api_key` | password 输入；不回显完整 key 可选（一期可明文回显本地配置，与 vision 一致即可） |
| 默认模型 | `model_name` | 自由文本 |
| 默认尺寸 | `default_size` | 可选下拉：`1024x1024` / `1792x1024` / `1024x1792` 等，以网关为准 |
| 保存 | save command | 成功 toast；失败展示后端错误 |

可选（二期）：「测试连接」按钮——发一条最小 prompt 或仅校验 URL 可达。

### 4.3 i18n

- `zh-CN.json` / `en.json`：侧栏项 + 设置页文案
- 错误文案要可操作：「未配置 API Key」「出图未启用」「网关返回 401」等

---

## 5. 迁移与兼容

| 场景 | 行为 |
|------|------|
| 老用户无表 | 迁移建表，默认 `enabled=false`，空 url/key |
| 曾依赖 ideasir 硬编码 | 升级后**不再**静默走 ideasir；需用户在设置里填自己的网关 |
| 旧技能 doubao/gemini | 已删除，无迁移 |
| 智能体 prompt 里写死 model=gemini/doubao | 忽略或映射到配置的 `model_name`；工具参数 `model` 可选覆盖默认模型 |

---

## 6. 实现阶段（建议顺序）

### P0 — 能出图（机制层）

1. DB entity + migration + service（get/save 单例）
2. Runtime config + 启动 apply + AppState 挂载
3. Tauri commands + web router/handlers 对称注册
4. 改 `process_generate_image`（先 generate；modify 可紧随）
5. 去掉 ideasir 硬编码
6. companion `image` feature 与 `enabled` 联动
7. 前端 API + 设置页 + i18n + 侧栏入口

### P1 — 稳与齐

1. `modify_image` / 图生图完整对齐网关 edits 接口
2. 超时、重试、错误分类（401/429/5xx）
3. 结果统一本地落盘或走 image_proxy（若需要离线可看）
4. 最小集成测试 / mock 网关单测

### P2 — 可选增强

1. 按 agent type 白名单（仿 vision `agent_types_json`）
2. 测试连接按钮
3. 多模型下拉（从配置或网关列表）
4. 用量/日志面板（非必须）

---

## 7. 关键文件索引（实现时对照）

### 后端（参考 / 将改）

| 路径 | 角色 |
|------|------|
| `src-tauri/src/acp/delegation/listener.rs` | **主改**：generate/modify 后端 |
| `src-tauri/src/acp/delegation/companion.rs` | feature 门控、结果渲染 |
| `src-tauri/src/acp/delegation/transport.rs` | 请求类型（尽量不动） |
| `src-tauri/src/acp/vision_bridge.rs` | 抄 runtime/access 模式 |
| `src-tauri/src/db/entities/vision_bridge.rs` | 抄 entity |
| `src-tauri/src/db/service/vision_bridge_service.rs` | 抄 service |
| `src-tauri/src/commands/vision_bridge.rs` | 抄 commands |
| `src-tauri/src/web/handlers/vision_bridge.rs` | 抄 web |
| `src-tauri/src/tauri_setup.rs` / `web/router.rs` / `app_state.rs` | 注册与挂载 |
| `src-tauri/src/acp/session_state.rs` 等 | companion features 注入点 |

### 前端（参考 / 将改）

| 路径 | 角色 |
|------|------|
| `src/components/settings/vision-bridge-settings.tsx` | 抄设置页 |
| `src/lib/api.ts` | get/save API |
| `src/components/settings/settings-shell.tsx` | 侧栏入口 |
| `src/i18n/messages/zh-CN.json` / `en.json` | 文案 |
| `src/hooks/use-vision-bridge-enabled.ts` | 可选：做 enabled 缓存 hook |

---

## 8. 验收标准

1. 设置页可保存 Base URL / Key / 模型 / 开关，重启后仍在。
2. `enabled=true` 且配置完整时，任意支持 companion 的智能体会话里能调用 `generate_image` 并出图。
3. `enabled=false` 时工具不可见或调用返回明确错误。
4. 代码库中**无** ideasir 出图 URL / 硬编码 token（web-search 若仍用 ideasir 属另一议题，本计划不强制）。
5. 不依赖技能仓库、不要求用户装 MCP 连接器。
6. 错误信息能区分：未配置 / 未启用 / 鉴权失败 / 网关错误。

---

## 9. 开干前需用户确认的一点

实现 `process_generate_image` 前，用用户真实网关对齐一次字段样例：

- path 是否严格 `/v1/images/generations`（有的网关 base 已含 `/v1`）
- `size` / `quality` / `response_format` 是否支持
- 图生图是 `images/edits` 还是 generations 带 `image` / `image_url`
- 返回是 `url` 还是 `b64_json`

**没有样例时**：先按标准 OpenAI Images API 实现 generate；modify 做 best-effort，网关不兼容再补适配层。

---

## 10. 明确不做 / 以后再说

| 项 | 说明 |
|----|------|
| 技能主路径 | 已否决；技能仓库不再放空壳出图技能 |
| 用户 MCP 主路径 | 已否决；平台 companion 才是主路径 |
| inject-store 假轨 | 与本期无关；可选后续清理 |
| 设置矩阵砍技能勾选 | 可选后续，不阻塞出图 |
| Ardot / Canva / MasterGo 设计连接器 | 独立议题，不并入本计划 |

---

## 11. 状态机

```
[草案 · 本文档] → 用户确认开干 → P0 实现 → 联调网关 → P1 补 modify/稳 → 关闭本计划
```

**当前**：草案已写入仓库，**未开始编码**。下次会话直接按第 6 节 P0 顺序开工即可。
