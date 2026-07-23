# WIP: 出图收费模块设计方案

## 状态
- **未开始实现**，只做了规划和设计
- 2026-07-23 保存进度

## 核心需求
用户在 VeryAgent 里出图要收费，方案：
1. **API 地址写死** — 由项目方提供统一端点
2. **密钥兑换次数** — 用户付款后获得一个密钥 K
3. **输入密钥激活** — 在出图设置页填入 K，显示剩余可出图次数
4. **不注册、不登录** — 纯密钥机制

## 架构
```
你卖密钥 K → 用户输入 K → 你的 API 验证 → 返回 {次数, 模型, 过期时间}
                              ↓
                    自动填入网关配置（写死的 URL + 这个 K）
                              ↓
                    用户看到"可出 X 张图"
                              ↓
                    每次出图 → 你的服务器代理扣费 → 更新显示
```

VeryAgent 只负责：
- 密钥输入 UI
- 把密钥和你的 API URL 填进网关配置
- 显示剩余次数

计费逻辑全在你的服务器上。

## 现有代码基础
- `src/lib/api.ts` — 已有 image generation API types (ImageGatewayEntry, etc.)
- `src-tauri/src/db/entities/image_generation.rs` — DB entity，singleton row
- `src-tauri/src/db/service/image_generation_service.rs` — CRUD service
- `src-tauri/src/commands/image_generation.rs` — Tauri commands
- `src/components/skills-and-tools/image-generation-config-dialog.tsx` — 配置弹窗
- `src/components/settings/image-generation-settings.tsx` — 设置页主体

## 需要新增/修改
### 前端
1. 在 ImageGenerationSettingsBody 中增加"激活密钥"区域
2. 密钥输入框 + 验证按钮
3. 成功后的次数展示卡片
4. 可能需要一个新的 Tauri command 来调用你的验证 API

### 后端
1. 新增 Tauri command: `image_license_verify`
   - 调你服务器的 `/v1/licenses/verify`
   - 返回 remaining, model_name, expires_at
2. 可选：代理模式 — 所有出图请求先过你的服务器再转发

### 数据库（可选）
1. 新增 `license_usage` 表记录每次出图
2. 或在现有 `image_generation` 表中扩展字段

## 后续待确认
- [ ] 密钥生成方式（一次性 / 可复用）
- [ ] 验证失败提示文案
- [ ] 密钥过期是否允许续期
- [ ] 是否需要本地缓存剩余次数（离线场景）
- [ ] 付费后自动写入 vs 手动输入
- [ ] 支持多密钥累加额度？
