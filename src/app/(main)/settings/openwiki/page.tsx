"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

/**
 * OpenWiki moved out of Settings into Skills & Plugins as a first-party
 * connector. Keep this route so old bookmarks do not 404.
 */
export default function SettingsOpenWikiPage() {
  const router = useRouter()
  const t = useTranslations("OpenWikiSettings")

  useEffect(() => {
    // Settings lives in its own window/route tree; skills & plugins is the
    // main workbench. Send old deep links back to agents as a safe landing.
    router.replace("/settings/agents")
  }, [router])

  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      {t("movedToPlugins")}
    </div>
  )
}
