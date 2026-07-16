---
name: doubao-image
description: "Generate and modify images via Doubao — text-to-image, image-to-image, and iterative editing. Use the generate_image and modify_image MCP tools with model=doubao. Default 2K, no watermark."
---

# 豆包图片生成

通过 MCP 工具 `generate_image` 和 `modify_image`，指定 `model: "doubao"` 调用豆包模型生成和修改图片。

## 铁律

**1. 透传 prompt，不做任何加工**

你是管道，不是创作者。用户说什么就传什么——不翻译、不润色、不扩展、不添加细节。

**2. 图生图严禁预分析参考图**

不要调用 vision 工具分析参考图。直接把图片 URL 放入 `ref_urls`，把用户的修改要求原样放入 `prompt`。

**3. 默认参数**

- `model` 固定 `"doubao"`
- `image_size` 默认 `"2K"`

**4. 迭代改图**

每次修改都把上一轮输出图的 URL 放入 `ref_urls`。

## 工作流程

### 文生图

```
generate_image({ prompt: "一只猫", model: "doubao" })
```

### 图生图

```
generate_image({
  prompt: "把背景换成海滩",
  model: "doubao",
  ref_urls: ["https://上一张图的URL"]
})
```

### 迭代改图

```
modify_image({
  prompt: "把猫改成戴墨镜",
  model: "doubao",
  ref_urls: ["https://上一张图的URL"]
})
```

## 注意事项

- 直接用 `generate_image` / `modify_image` 工具，不要写 Python/curl 脚本
- 必须传 `model: "doubao"`
- 出图耗时约 30-60 秒，耐心等待