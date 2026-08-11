"use client"

import { useState, useEffect } from "react"
import { LayoutGrid, Type } from "lucide-react"
import { useTranslations } from "next-intl"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useZoomLevel, useWelcomeQuickActions } from "@/hooks/use-appearance"
import {
  DEFAULT_ZOOM_LEVEL,
  ZOOM_LEVELS,
  type ZoomLevel,
} from "@/lib/theme-presets"
import { PetManagerSection } from "./pet-manager-section"
import { FontSettingsSection } from "./font-settings-section"

type ThemeMode = "system" | "light" | "dark"

export function AppearanceSettings() {
  const t = useTranslations("AppearanceSettings")
  const { zoomLevel, setZoomLevel } = useZoomLevel()
  const { showWelcomeQuickActions, setShowWelcomeQuickActions } =
    useWelcomeQuickActions()

  const [theme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system"
    return (localStorage.getItem("theme") as ThemeMode | null) ?? "system"
  })

  const applyTheme = (mode: ThemeMode) => {
    const html = document.documentElement
    const isDark =
      mode === "dark" ||
      (mode === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    if (isDark) {
      html.classList.add("dark")
    } else {
      html.classList.remove("dark")
    }
  }

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem("theme", theme)
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      import("@/lib/tauri").then((t) =>
        t.updateAppearanceMode(theme).catch(() => {})
      )
    }
  }, [theme])

  // Listen for OS theme changes when in "system" mode
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => applyTheme("system")
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [theme])

  return (
    <ScrollArea className="h-full">
      <div className="w-full space-y-4 p-3 md:p-4">
        {/* ===== Fonts ===== */}
        <FontSettingsSection />

        {/* ===== Zoom Level ===== */}
        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              {t("zoomLevel.sectionTitle")}
            </h2>
          </div>

          <p className="text-xs text-muted-foreground leading-5">
            {t("zoomLevel.sectionDescription")}
          </p>

          <div className="space-y-2">
            <Select
              value={String(zoomLevel)}
              onValueChange={(value) =>
                setZoomLevel(parseInt(value, 10) as ZoomLevel)
              }
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder={t("zoomLevel.placeholder")} />
              </SelectTrigger>
              <SelectContent align="start">
                {ZOOM_LEVELS.map((z) => (
                  <SelectItem key={z} value={String(z)}>
                    {z}%
                    {z === DEFAULT_ZOOM_LEVEL
                      ? ` (${t("zoomLevel.default")})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {t("zoomLevel.current", { zoom: zoomLevel })}
            </p>
          </div>
        </section>

        {/* ===== Fonts ===== */}
        <FontSettingsSection />

        {/* ===== New conversation — mode selection area ===== */}
        <section className="rounded-xl border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              {t("welcomePanel.sectionTitle")}
            </h2>
          </div>

          <p className="text-xs text-muted-foreground leading-5">
            {t("welcomePanel.sectionDescription")}
          </p>

          <label className="flex items-center gap-2">
            <Switch
              checked={showWelcomeQuickActions}
              onCheckedChange={setShowWelcomeQuickActions}
            />
            <span className="text-xs text-muted-foreground">
              {t("welcomePanel.showQuickActions")}
            </span>
          </label>
        </section>

        {/* ===== Desktop Pet ===== */}
        <PetManagerSection />
      </div>
    </ScrollArea>
  )
}
