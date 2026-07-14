"use client"

import { useEffect } from "react"
import { isDesktop } from "@/lib/platform"

/**
 * Emits `main://ready` to the Tauri backend once the main layout mounts.
 * The backend creates the main window as hidden (to avoid a white flash
 * while the dev server compiles the first page) and listens for this
 * event to show the window. A 15-second fallback timer in Rust also
 * shows the window in case this component never mounts (e.g. JS error).
 */
export function MainReadySignal() {
  useEffect(() => {
    if (!isDesktop()) return
    try {
      const { emit } = require("@tauri-apps/api/event") as typeof import("@tauri-apps/api/event")
      emit("main://ready")
    } catch {
      // Tauri API not available (web mode) — ignore
    }
  }, [])

  return null
}
