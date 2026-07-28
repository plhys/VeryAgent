"use client"

import { createPortal } from "react-dom"
import type { RefObject } from "react"

interface SidebarSummaryBubbleProps {
  hostRef: RefObject<HTMLElement | null>
  /** Whether the host is currently hovered. */
  isHovered: boolean
  /** Summary text to display. null / undefined / empty = don't render. */
  summary: string | null | undefined
}

/**
 * Summary bubble for pinned conversations. Portaled to `document.body` so
 * sidebar overflow clipping cannot hide it. Appears centered in the main
 * content area (right of the sidebar), vertically aligned with the card.
 */
export function SidebarSummaryBubble({
  hostRef,
  isHovered,
  summary,
}: SidebarSummaryBubbleProps) {
  if (!isHovered || !summary || !hostRef.current) return null

  const rect = hostRef.current.getBoundingClientRect()

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999]"
      style={{
        top: rect.top + rect.height / 2,
        left: "50%",
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        className="w-[36rem] whitespace-pre-wrap rounded-2xl border border-border/30 bg-popover/95 p-6 text-sm leading-relaxed shadow-2xl backdrop-blur-xl"
      >
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary/70">
          <span>📝</span>
          <span>对话总结</span>
        </p>
        <div className="border-l-2 border-primary/20 pl-4">
          <p className="text-foreground/80 leading-relaxed">{summary}</p>
        </div>
      </div>
    </div>,
    document.body
  )
}