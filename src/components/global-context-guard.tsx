"use client"

import { useEffect } from "react"

/**
 * Global context menu guard.
 *
 * Strategy: BLOCKALL-first.
 *   - Every right-click is suppressed by default (e.preventDefault).
 *   - Only elements that EXPLICITLY declare 'data-context-menu="true"' are
 *     allowed to show the native/Radix menu.
 *
 * Why this approach?  Several existing ContextMenuTriggers (notably the chat
 * workspace host in conversation-detail-panel.tsx) wrap large container divs
 * that intentionally allow right-click inside them for copy-selection purposes.
 * Those are NOT meant to expose a native browser menu.  Requiring explicit opt-in
 * is far safer than trying to detect allowed-vs-disallowed targets by DOM walk.
 */
export function GlobalContextMenuGuard() {
  useEffect(() => {
    // Mark any element that explicitly requests a context menu
    const mark = () => {
      document.querySelectorAll('[data-context-menu="true"]').forEach((el) => {
        el.setAttribute("data-context-allow", "true")
      })
    }
    mark()
    const observer = new MutationObserver(mark)
    observer.observe(document.body, { childList: true, subtree: true })

    const handler = (e: MouseEvent) => {
      if (e.button !== 2) return
      const target = e.target as HTMLElement
      let el: HTMLElement | null = target
      while (el) {
        if (
          el.hasAttribute("data-context-allow") &&
          el.getAttribute("data-context-allow") === "true"
        ) {
          return
        }
        el = el.parentElement
      }
      e.preventDefault()
    }

    document.addEventListener("contextmenu", handler, true)
    return () => {
      observer.disconnect()
      document.removeEventListener("contextmenu", handler, true)
    }
  }, [])

  return null
}
