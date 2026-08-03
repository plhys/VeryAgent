"use client"

import { useMemo, type RefObject } from "react"
import { createPortal } from "react-dom"
import { format } from "date-fns"
import { AgentIcon } from "@/components/agent-icon"
import type { AgentType } from "@/lib/types"
import { AGENT_LABELS } from "@/lib/types"

/** Horizontal nudge (px) past the host's right edge into the main pane. */
export const TIME_FLAG_RIGHT_OFFSET_PX = 4

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
  /** Agent type to show the brand icon. */
  agentType?: AgentType | null
}

/**
 * Hover flag for sidebar rows. Portaled to `document.body` so sidebar overflow
 * clipping cannot hide it. Shows the agent icon + name and absolute date in a
 * single card that partially overlaps the sidebar edge for a layered look.
 */
export function SidebarHoverTimeFlag({
  hostRef,
  isHovered,
  rawTimestamp,
  agentType,
}: SidebarHoverTimeFlagProps) {
  const formatted = useMemo(
    () => formatAbsoluteTimestamp(rawTimestamp),
    [rawTimestamp]
  )

  if (!isHovered || !formatted || !hostRef.current) return null

  const rect = hostRef.current.getBoundingClientRect()
  const agentLabel = agentType
    ? AGENT_LABELS[agentType] || agentType
    : null

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] flex items-center"
      style={{
        top: rect.top + rect.height / 2,
        left: rect.right + TIME_FLAG_RIGHT_OFFSET_PX,
        transform: "translateY(-50%)",
      }}
    >
      <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-sidebar px-2 py-0.5 text-[11px] leading-[18px] text-sidebar-foreground shadow-md">
        {agentType && agentLabel && (
          <AgentIcon
            agentType={agentType}
            className="h-[0.875rem] w-[0.875rem] shrink-0"
          />
        )}
        {agentLabel && <span className="font-medium">{agentLabel}</span>}
        <span className="text-muted-foreground/70">{formatted}</span>
      </span>
    </div>,
    document.body
  )
}