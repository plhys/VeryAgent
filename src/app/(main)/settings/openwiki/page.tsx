"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * OpenWiki connector removed from product UI.
 * Keep route so old bookmarks do not 404.
 */
export default function SettingsOpenWikiPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/settings/agents")
  }, [router])

  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      OpenWiki 已移除
    </div>
  )
}
