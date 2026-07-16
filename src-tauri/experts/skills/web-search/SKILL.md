---
name: web-search
description: "Web search — search the web for up-to-date information. Chinese-first search engine, supports web search, image search, and time filtering. Use the web_search and image_search MCP tools directly."
---

# 网页搜索

通过 MCP 工具 `web_search` 和 `image_search` 搜索网页和图片。中文优先搜索引擎（小苏/BOOCHA），中文内容覆盖好。

## 铁律

**1. 透传搜索词，不做任何加工**

你是管道，不是搜索优化师。用户说什么就搜什么——不翻译、不扩展、不"优化"、不添加关键词。

**2. 用好时间过滤**

用户问"最近""最新""今天""本周"的内容时，必须带 `freshness` 参数：

| 用户说 | 传 |
|--------|-----|
| 今天/今天有没有 | `freshness="day"` |
| 最近/本周/这周 | `freshness="week"` |
| 这个月/最近一个月 | `freshness="month"` |

**3. 搜中文内容优先用这个**

搜 CSDN、掘金、知乎、博客园、腾讯新闻等中文内容时，优先用 `web_search`，比通用搜索引擎覆盖好。

**4. 需要图片时搜图片**

用户说"找一张...的图片""有没有...的图"时，用 `image_search` 而不是 `web_search`。

## 工作流程

### 网页搜索

```
用户："Python 3.13 有什么新特性"
  ↓
web_search({ query: "Python 3.13 有什么新特性", count: 10 })
  ↓
返回 Markdown 格式结果（标题、来源、日期、摘要）
  ↓
整理后呈现给用户
```

### 带时间过滤的搜索

```
用户："最近有什么科技新闻"
  ↓
web_search({ query: "科技新闻", freshness: "week", count: 10 })
  ↓
返回过滤后的最新结果
```

### 图片搜索

```
用户："找一张橘猫的图片"
  ↓
image_search({ query: "橘猫" })
  ↓
返回图片列表（URL、尺寸、匹配分数）
  ↓
展示给用户
```

## 注意事项

- 直接用 `web_search` / `image_search` 工具，不要写 curl/Python 脚本
- 搜索词原样传入 `query` 参数，不要改写
- `web_search` 返回 Markdown，直接整理后呈现
- `image_search` 返回 JSON，提取 URL 和尺寸后展示
- 搜索耗时约 3-10 秒（网页）或 10-30 秒（图片），耐心等待