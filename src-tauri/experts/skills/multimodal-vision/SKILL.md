---
name: multimodal-vision
description: Use when you need to analyze images, screenshots, diagrams, charts, or any visual content - this skill gives text-only models the ability to "see" via the vision_analyze MCP tool
---

# Multimodal Vision

You have access to the `vision_analyze` tool, which can analyze images using a vision-capable AI model. This allows you to "see" visual content even if your base model does not support image inputs natively.

## When to use

- When a user sends you a screenshot, photo, diagram, or chart
- When you need to read error messages from screenshots
- When you need to understand UI elements and their layout
- When you need to analyze visual content in any format
- When you want to understand what's shown in an image the user references
- When you encounter a file path to an image in your work context

## How to use

Call `vision_analyze` with:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | **Yes** | What you want to know about the image. Be specific and detailed. |
| `image_data` | No | Base64-encoded image bytes. Use when you already have the bytes. |
| `image_path` | No | Absolute file path to a local image file. Use when the image is on disk. |
| `mime_type` | No | MIME type (e.g. `image/png`). Inferred from file extension when using `image_path`. |

**You must provide either `image_data` or `image_path`** (one of them, not both).

## Prompt tips

Be specific in your prompts. Generic prompts like "describe this image" work, but targeted prompts yield better results:

- "What error message is shown in this dialog box?"
- "Identify the UI components and their layout in this screenshot"
- "Read the data values from this bar chart"
- "What text is visible in this screenshot?"
- "Describe the visual hierarchy and design patterns in this UI"
- "Extract all the text content from this image"

## Example

```
vision_analyze(
  image_path="/tmp/screenshot.png",
  prompt="What error message is shown in this dialog? Include the exact text."
)
```

The tool returns a detailed text description that you can then use in your reasoning and response to the user.

## Workflow

1. **Receive image reference** — the user mentions an image, sends a path, or provides base64 data
2. **Call vision_analyze** — with a specific prompt about what you need to know
3. **Use the description** — incorporate the returned text into your analysis and response
4. **Follow up** — if the initial description lacks detail, call again with a more targeted prompt

## Important notes

- The vision model is a **supplement**, not a replacement for your reasoning. You still process and interpret the text description yourself.
- For large or complex images, break your analysis into multiple targeted prompts.
- The tool works with PNG, JPEG, GIF, WebP, BMP, and SVG formats.
- If the tool returns an error (e.g., "Vision bridge is not enabled"), inform the user that the vision bridge plugin needs to be configured in settings.
