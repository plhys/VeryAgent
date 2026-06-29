# ZCode 设计参考

从 ZCode 安装目录 (`C:\Users\EVAN\AppData\Local\Programs\ZCode`) 提取的设计模式分析。

## 1. 设计 Token 体系

ZCode 使用完整的 CSS 自定义属性体系，覆盖所有交互状态：

```css
/* 输入框相关 */
--color-input: var(--color-white)              /* 默认背景 */
--color-input-focused: var(--color-neutral-50) /* 聚焦背景微变 */
--color-input-border: var(--color-border)      /* 默认边框 */
--color-input-border-hover: var(--color-border-hover)   /* 悬停边框 */
--color-input-border-focused: var(--color-brand)        /* 聚焦边框（品牌色）*/

/* 卡片相关 */
--color-card: var(--color-white)
--color-card-selected: var(--color-neutral-200)
--color-card-border: var(--color-border)

/* 弹出层 */
--color-popover: var(--color-white)
--color-popover-border: var(--color-border)
```

**借鉴点**: VeryAgent 的 UnoCSS 配置 (`uno.config.ts`) 可以定义类似的设计 token，统一输入框的交互状态颜色。

## 2. 聚焦态渐进过渡

ZCode 的输入框聚焦态设计：

```
默认:     border-color: --color-input-border
悬停:     border-color: --color-input-border-hover
聚焦:     border-color: --color-input-border-focused (品牌色)
         background: --color-input-focused (微变)
```

使用 `focus-within` 实现容器级聚焦：

```css
.focus-within\:\!border-input-border-focused:focus-within {
  border-color: var(--color-input-border-focused) !important;
}
.focus-within\:bg-input-focused:focus-within {
  background-color: var(--color-input-focused);
}
```

**借鉴点**: VeryAgent 的 SendBox 目前聚焦态不够明显，可以：
- 外层容器加 `focus-within` 边框高亮
- 聚焦时背景微微变化（不是大变，是 subtle 的）

## 3. 响应式 Composer

ZCode 使用 Container Queries 控制聊天输入框的响应式布局：

```css
.@container\/composer {
  container: composer / inline-size;
}

/* 宽度 >= 32rem 时显示更多工具栏 */
@container composer (width >= 32rem) {
  .@lg\/composer\:inline-flex { display: inline-flex; }
}

/* 宽度 >= 36rem 时进一步展开 */
@container composer (width >= 36rem) {
  .@xl\/composer\:inline-flex { display: inline-flex; }
}
```

**借鉴点**: VeryAgent 目前用媒体查询，可以考虑容器查询（更精确）。

## 4. 条件样式

ZCode 使用 `has-[...]` 伪类实现条件样式：

```css
/* 当容器内有 textarea 时，自动调整圆角和高度 */
.has-[textarea]\:rounded-md:has(:is(textarea)) {
  border-radius: var(--radius-md);
}
.has-[>textarea]\:h-auto:has(>textarea) {
  height: auto;
}
```

**借鉴点**: SendBox 的单行/多行切换可以用 CSS `has()` 简化。

## 5. 阴影体系

ZCode 有完整的阴影层级：

| Class | 用途 |
|-------|------|
| `shadow-xs` | 微妙提升（卡片） |
| `shadow-sm` | 轻微提升（下拉菜单） |
| `shadow-md` | 中等提升（弹出层） |
| `shadow-lg` | 较大提升（对话框） |
| `shadow-xl` | 最大提升（模态框） |

支持透明度变体：`shadow-lg/20`（20% 透明度）、`shadow-xl/5`（5%）。

**借鉴点**: VeryAgent 的"正在处理中"卡片可以用 `shadow-xs` 或 `shadow-sm` 增加层次感。

## 6. Ring 外框线

ZCode 用 `ring` 代替传统 `border` 实现聚焦环：

```css
.ring-1      /* 1px ring */
.ring-2      /* 2px ring */
.ring-brand  /* 品牌色 ring */
.ring-border /* 边框色 ring */
```

**借鉴点**: 输入框聚焦态可以用 `ring` + 品牌色，比 `border` 更现代。

## 7. 圆角体系

```css
--radius-sm:  0.25rem   /* 4px */
--radius-md:  0.375rem  /* 6px */
--radius-lg:  0.5rem    /* 8px */
--radius-xl:  0.75rem   /* 12px */
--radius-2xl: 1rem      /* 16px */
--radius-3xl: 1.5rem    /* 24px */
```

**借鉴点**: VeryAgent 的 SendBox 和卡片可以使用一致的圆角变量。

## 总结：VeryAgent 可优化的点

1. **输入框聚焦态**：加 `focus-within` 边框高亮 + 背景微变
2. **阴影层次**：卡片/输入框用 `shadow-xs` 增加立体感
3. **Ring 替代 border**：聚焦态更现代
4. **统一圆角**：用 CSS 变量管理圆角大小
5. **设计 Token**：输入框的交互状态颜色统一管理
