"use client"

import { createPortal } from "react-dom"
import type { RefObject } from "react"

/** Distance (px) from the host's right edge into the main pane. */
const SUMMARY_BUBBLE_RIGHT_OFFSET_PX = 25

interface SidebarSummaryBubbleProps {
  hostRef: RefObject<HTMLElement | null>
  /** Whether the host is currently hovered. */
  isHovered: boolean
  /** Summary text to display. null / undefined = not ready → don't render. */
  summary: string | null | undefined
}

/**
 * Summary bubble for pinned conversations. Portaled to `document.body` so
 * sidebar overflow clipping cannot hide it. Appears to the right of the
 * conversation card when the user hovers over it.
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
        left: rect.right + SUMMARY_BUBBLE_RIGHT_OFFSET_PX,
        transform: "translateY(-50%)",
      }}
    >
      <div
        className="w-[32rem] whitespace-pre-wrap rounded-xl border border-border/60 bg-popover p-5 text-sm leading-relaxed shadow-xl"
      >
        <p className="mb-2 text-xs font-semibold text-muted-foreground/80">
          📝 对话总结
        </p>
        <p className="text-foreground/90">{summary}</p>
      </div>
    </div>,
    document.body
  )
}