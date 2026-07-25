"use client"

import { useEffect } from "react"

interface ThemeProviderProps {
  children: React.ReactNode
}

/**
 * Lightweight theme provider — keeps this file script-tag-free so the
 * browser/WebView SSR check never complains.
 *
 * Handles two things:
 *   1. `data-theme` on <html> — theme color (neutral, blue, …), synced with
 *      AppearanceProvider. Stored under `veryagent-theme`.
 *   2. `class="dark"` on <html> — dark / light mode, synced with the
 *      appearance settings panel. Stored under `theme` (next-themes compat).
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  useEffect(() => {
    const html = document.documentElement

    // --- data-theme (color preset) ---
    const colorStored = localStorage.getItem("veryagent-theme")
    if (colorStored && !html.hasAttribute("data-theme")) {
      html.setAttribute("data-theme", colorStored)
    } else if (colorStored) {
      html.setAttribute("data-theme", colorStored)
    }

    // --- dark / light class ---
    const themeStored = localStorage.getItem("theme") as string | null
    const applyDarkClass = (isDark: boolean) => {
      if (isDark) {
        html.classList.add("dark")
      } else {
        html.classList.remove("dark")
      }
    }

    if (themeStored === "dark") {
      applyDarkClass(true)
    } else if (themeStored === "light") {
      applyDarkClass(false)
    } else {
      // "system" or missing — follow OS preference
      const mq = window.matchMedia("(prefers-color-scheme: dark)")
      applyDarkClass(mq.matches)
      const handler = (e: MediaQueryListEvent) => applyDarkClass(e.matches)
      mq.addEventListener("change", handler)
      return () => mq.removeEventListener("change", handler)
    }
  }, [])

  return <>{children}</>
}
