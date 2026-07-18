---
name: gemini-image
description: "Generate and modify images via Gemini or Doubao — text-to-image, image-to-image, and iterative editing. Use the generate_image and modify_image MCP tools directly. Default Gemini no-watermark, 2K, image-to-image via base64."
---

# 图片生成（Gemini / 豆包）

通过 MCP 工具 `generate_image` 和 `modify_image` 调用上游 MCP 生成和修改图片。默认 Gemini 去水印 + 2K。

## 铁律

**1. 透传 prompt，不做任何加工**

你是管道，不是创作者。用户说什么就传什么——不翻译、不润色、不扩展、不添加细节。图生图时只保留用户修改意图的短句，不要先分析参考图再写长 prompt。

**2. 图生图严禁预分析参考图**

不要调用 vision 工具分析参考图，不要描述参考图内容。直接把图片 URL 放入 `ref_urls`，把用户的修改要求原样放入 `prompt`。预分析后自写长 prompt 会覆盖参考图，导致图生图退化为文生图。

**3. 默认参数**

- `model` 默认 `"gemini"`（去水印），用户说豆包时改 `"doubao"`
- `image_size` 默认 `"2K"`，除非用户明确要求其他分辨率
- `aspect_ratio` 默认 `"1:1"`，除非用户指定
- 图生图后端自动转 base64，不需要手动处理

**4. 迭代改图**

每次修改都把上一轮输出图的 URL 放入 `ref_urls`，后端自动下载转 base64 传给上游。

## 工作流程

### 文生图

```
generate_image({ prompt: "一只橘猫坐在窗台上" })
```

### 图生图

```
generate_image({
  prompt: "把背景换成海滩",
  ref_urls: ["https://上一张图的URL"]
})
```

### 迭代改图

```
modify_image({
  prompt: "把猫改成戴墨镜",
  ref_urls: ["https://上一张图的URL"]
})
```

### 豆包出图

```
generate_image({ prompt: "一只猫", model: "doubao" })
```

## 注意事项

- 直接用 `generate_image` / `modify_image` 工具，不要写 Python/curl 脚本
- 生成完成后展示图片：`![生成结果](data:image/png;base64,...)`
- 如果 API 返回 error，把错误信息原样告诉用户
- 出图耗时约 30-60 秒，耐心等待