"use client"

import { memo, useCallback, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import type { MessageScrollContextValue } from "@/components/message/message-scroll-context"
import { cn } from "@/lib/utils"

/** A lightweight dot representing one user message in the nav rail. */
export interface NavDotEntry {
  /** Index into the rendered threadItems array — fed to scrollToIndex. */
  threadIndex: number
  /** 1-based position among user messages. */
  ordinal: number
  /** Short label for the tooltip (first line of the user message). */
  label: string
  /** Whether this message has file changes. */
  hasChanges: boolean
}

interface MessageNavDotsProps {
  /** Per-user-message dots. Always computed (not lazy) — lightweight. */
  dots: NavDotEntry[]
  /** Scroll API for jumping to a message. */
  scrollApiRef: React.RefObject<MessageScrollContextValue | null>
}

/**
 * Right-edge dot rail for message navigation.
 * Each dot = one user message. Click to jump. Active dot highlights.
 * Solid dots = messages with file changes; hollow dots = no changes.
 */
export const MessageNavDots = memo(function MessageNavDots({
  dots,
  scrollApiRef,
}: MessageNavDotsProps) {
  const t = useTranslations("Folder.chat.messageNav")
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const railRef = useRef<HTMLDivElement>(null)

  const handleDotClick = useCallback(
    (threadIndex: number, dotIdx: number) => {
      scrollApiRef.current?.scrollToIndex(threadIndex, {
        align: "start",
        smooth: true,
      })
      setActiveIdx(dotIdx)
    },
    [scrollApiRef]
  )

  if (dots.length === 0) return null

  const DOT_SIZE = 8
  const DOT_ACTIVE_SIZE = 10

  return (
    <div
      ref={railRef}
      className="pointer-events-none absolute end-4 top-4 bottom-4 z-20 flex flex-col items-center justify-center py-2"
    >
      <div className="pointer-events-auto flex flex-col items-center gap-1">
        {dots.map((dot, idx) => {
          const isActive = idx === activeIdx
          const isHovered = idx === hoveredIdx
          const size = isActive || isHovered ? DOT_ACTIVE_SIZE : DOT_SIZE
          return (
            <button
              key={dot.threadIndex}
              type="button"
              onClick={() => handleDotClick(dot.threadIndex, idx)}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={cn(
                "relative shrink-0 rounded-full transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                isActive
                  ? "bg-primary"
                  : isHovered
                    ? "bg-primary/50"
                    : dot.hasChanges
                      ? "bg-muted-foreground/40"
                      : "bg-muted-foreground/25"
              )}
              style={{
                width: size,
                height: size,
              }}
              title={`#${dot.ordinal} ${dot.label.slice(0, 60)}`}
              aria-label={t("jumpToMessage", { ordinal: dot.ordinal })}
            >
              {/* Tooltip on hover */}
              {isHovered && (
                <span
                  className="pointer-events-none absolute right-[calc(100%+8px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                >
                  <span className="font-medium text-muted-foreground">
                    #{dot.ordinal}
                  </span>{" "}
                  {dot.label.slice(0, 50)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
})
