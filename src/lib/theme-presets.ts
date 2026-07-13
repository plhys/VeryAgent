// src/lib/theme-presets.ts

/**
 * 主题色预设标识符。当前仅保留 neutral（默认灰阶）。
 * 实际 CSS 变量值定义在 src/app/globals.css 的 [data-theme="..."] 选择器中。
 */
export const THEME_COLORS = [
  "neutral",
] as const

export type ThemeColor = (typeof THEME_COLORS)[number]

export const FOLDER_THEME_COLOR_INHERIT = "inherit" as const

export type FolderThemeColor = ThemeColor | typeof FOLDER_THEME_COLOR_INHERIT

const THEME_COLOR_SET = new Set<string>(THEME_COLORS)

/**
 * 早期版本的文件夹颜色存储的是十六进制值；迁移映射到最接近的主题预设。
 * 现在只有 neutral 可选，所有旧颜色统一映射到 neutral。
 */
const LEGACY_FOLDER_COLOR_MAP: Record<string, FolderThemeColor> = {
  foreground: FOLDER_THEME_COLOR_INHERIT,
  "#ef4444": "neutral",
  "#f97316": "neutral",
  "#eab308": "neutral",
  "#84cc16": "neutral",
  "#22c55e": "neutral",
  "#06b6d4": "neutral",
  "#8b5cf6": "neutral",
  "#d946ef": "neutral",
  "#ec4899": "neutral",
}

/**
 * 把 FolderDetail.color 的原始存储值（预设名或遗留十六进制）规约成
 * FolderThemeColor。未知值回退 inherit。
 */
export function normalizeFolderThemeColor(
  color: string | null | undefined
): FolderThemeColor {
  if (!color) return FOLDER_THEME_COLOR_INHERIT
  const normalized = color.toLowerCase()
  if (normalized === FOLDER_THEME_COLOR_INHERIT) {
    return FOLDER_THEME_COLOR_INHERIT
  }
  if (THEME_COLOR_SET.has(normalized)) return normalized as ThemeColor
  return LEGACY_FOLDER_COLOR_MAP[normalized] ?? FOLDER_THEME_COLOR_INHERIT
}

/**
 * 默认主题色。选用 "neutral" 是因为它对应当前 globals.css 的现存 :root 值
 * （所有 chroma=0 的纯灰阶），可保证升级后视觉零差异。
 */
export const DEFAULT_THEME_COLOR: ThemeColor = "neutral"

/**
 * UI 预览用的代表色（OKLch 字符串，对应各预设的 primary 色 light 版本）。
 * 仅用于 Appearance 页面的"色盘圆点"按钮渲染，不会被写入真实样式。
 */
export const THEME_COLOR_PREVIEW: Record<ThemeColor, string> = {
  neutral: "oklch(0.205 0 0)",
}

/**
 * 缩放档位（百分比）。100 是默认。
 * 选用离散档位而非连续滑块，是为了与现有 ThemeMode 选择器保持视觉一致。
 */
export const ZOOM_LEVELS = [80, 90, 100, 110, 125, 150] as const

export type ZoomLevel = (typeof ZOOM_LEVELS)[number]

export const DEFAULT_ZOOM_LEVEL: ZoomLevel = 100
