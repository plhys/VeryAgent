"use client"

import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import {
  closePetWindow,
  showPetContextMenu,
} from "@/lib/pet/api"
import { disposeTauriListener } from "@/lib/tauri-listener"
import { isDesktop } from "@/lib/transport"

type MenuAction = { type: "hide" }

/**
 * Right-click controller. Renders no UI of its own — the menu itself is
 * native (built in Rust via `pet_show_context_menu` and dispatched through
 * Tauri's menu-event bus). HTML popups got clipped to the tiny pet window
 * and were unclosable when they overflowed; the OS-level menu sidesteps
 * both problems and gives us free Escape/click-outside dismiss.
 *
 * Menu items:
 *  - "Quit" — exits the entire application (handled in Rust directly).
 *  - "Hide pet" — closes the pet window (handled via JS → closePetWindow).
 */
export function PetMenu() {
  const t = useTranslations("Pet")

  // Stash translations in a ref so the right-click listener pulls fresh
  // labels at popup time without needing to rebind.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])

  // 1) Hook the right-click and forward to the native menu.
  useEffect(() => {
    if (!isDesktop()) return
    function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      const x = e.clientX
      const y = e.clientY
      const tNow = tRef.current
      void showPetContextMenu(
        {
          quit: tNow("menu.quit"),
          hidePet: tNow("menu.hidePet"),
        },
        x,
        y
      ).catch((err) => {
        console.warn("[Pet] failed to show context menu:", err)
      })
    }
    document.addEventListener("contextmenu", onContextMenu)
    return () => {
      document.removeEventListener("contextmenu", onContextMenu)
    }
  }, [])

  // 2) Listen for "hide" action emitted by the native menu's event handler.
  //    Mount-once subscription — see tRef rationale above.
  useEffect(() => {
    if (!isDesktop()) return
    let unlisten: (() => void) | null = null
    let cancelled = false
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event")
        const off = await listen<MenuAction>("pet://menu-action", (event) => {
          const action = event.payload
          if (!action) return
          if (action.type === "hide") {
            void closePetWindow().catch((err) => {
              console.warn("[Pet] hide failed:", err)
            })
          }
        })
        if (cancelled) {
          disposeTauriListener(off, "Pet")
        } else {
          unlisten = off
        }
      } catch (err) {
        console.warn("[Pet] menu-action subscription failed:", err)
      }
    })()
    return () => {
      cancelled = true
      disposeTauriListener(unlisten, "Pet")
    }
  }, [])

  return null
}
