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
        className="w-[36rem] whitespace-pre-wrap rounded-2xl border border-border/40 bg-background/80 p-6 text-sm leading-relaxed shadow-2xl backdrop-blur-lg"
      >
        <p className="mb-2 text-xs font-semibold text-muted-foreground/70">
          📝 对话总结
        </p>
        <p className="text-foreground/85">{summary}</p>
      </div>
    </div>,
    document.body
  )
}