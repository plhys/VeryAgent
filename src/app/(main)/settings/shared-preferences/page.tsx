"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * Shared Identity was removed. Keep this route so old settings-window URLs
 * (and any restored last path) do not land on a blank 404 / white screen.
 */
export default function SettingsSharedPreferencesPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/settings/appearance")
  }, [router])

  return null
}
