"use client"

import { useMemo, type RefObject } from "react"
import { createPortal } from "react-dom"
import { format } from "date-fns"

/** Horizontal nudge (px) past the host's right edge into the main pane. */
export const TIME_FLAG_RIGHT_OFFSET_PX = 25

export function formatAbsoluteTimestamp(
  raw: string | null | undefined
): string | null {
  if (!raw) return null
  try {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return null
    return format(d, "yyyy-MM-dd HH:mm")
  } catch {
    return null
  }
}

interface SidebarHoverTimeFlagProps {
  /** Element used for vertical/horizontal anchoring. */
  hostRef: RefObject<HTMLElement | null>
  /** Whether the host is currently hovered. */
  isHovered: boolean
  /** ISO timestamp to show as absolute date. */
  rawTimestamp?: string | null
}

/**
 * Absolute date flag for sidebar rows. Portaled to `document.body` so sidebar
 * overflow clipping cannot hide it. Shared by conversation cards and the
 * project-tab list.
 */
export function SidebarHoverTimeFlag({
  hostRef,
  isHovered,
  rawTimestamp,
}: SidebarHoverTimeFlagProps) {
  const formatted = useMemo(
    () => formatAbsoluteTimestamp(rawTimestamp),
    [rawTimestamp]
  )

  if (!isHovered || !formatted || !hostRef.current) return null

  const rect = hostRef.current.getBoundingClientRect()

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] flex items-center"
      style={{
        top: rect.top + rect.height / 2,
        left: rect.right + TIME_FLAG_RIGHT_OFFSET_PX,
        transform: "translateY(-50%)",
      }}
    >
      <div
        className="h-0 w-0"
        style={{
          borderTop: "5px solid transparent",
          borderBottom: "5px solid transparent",
          borderRight: "6px solid hsl(var(--popover))",
        }}
      />
      <span className="whitespace-nowrap rounded-[4px] border border-border bg-popover px-2 py-0.5 text-[11px] leading-[18px] text-popover-foreground shadow-md">
        {formatted}
      </span>
    </div>,
    document.body
  )
}
