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
  /** Full text length of the user message, used to size the nav bar. */
  textLength: number
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

  const BAR_HEIGHT = 3
  const BAR_MIN_WIDTH = 6
  const BAR_MAX_WIDTH = 25

  // Logarithmic scale: maps textLength (0..MAX_TEXT) to width (MIN..MAX)
  // log(1) = 0, so we add 1; log(2049) ≈ 7.6, so 2000 chars ≈ max width
  const MAX_TEXT_LOG = Math.log(2000 + 1)
  const scaleWidth = (len: number): number => {
    if (len <= 0) return BAR_MIN_WIDTH
    const logLen = Math.log(len + 1)
    const t = Math.min(logLen / MAX_TEXT_LOG, 1)
    return Math.round(BAR_MIN_WIDTH + t * (BAR_MAX_WIDTH - BAR_MIN_WIDTH))
  }

  return (
    <div
      ref={railRef}
      className="pointer-events-none absolute start-3 top-4 bottom-4 z-20 flex flex-col items-center justify-center py-2"
    >
      <div className="pointer-events-auto flex flex-col items-start gap-[5px]">
        {dots.map((dot, idx) => {
          const isActive = idx === activeIdx
          const isHovered = idx === hoveredIdx
          const baseWidth = scaleWidth(dot.textLength)
          // Hover/active only slightly wider — not a dramatic jump
          const width = isActive || isHovered ? Math.min(baseWidth + 4, BAR_MAX_WIDTH + 2) : baseWidth
          return (
            <button
              key={dot.threadIndex}
              type="button"
              onClick={() => handleDotClick(dot.threadIndex, idx)}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={cn(
                "relative shrink-0 cursor-pointer rounded-full transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                isActive
                  ? "bg-primary"
                  : isHovered
                    ? "bg-primary/60"
                    : dot.hasChanges
                      ? "bg-muted-foreground/40"
                      : "bg-muted-foreground/25"
              )}
              style={{
                width,
                height: BAR_HEIGHT,
              }}
              title={`#${dot.ordinal} ${dot.label.slice(0, 60)}`}
              aria-label={t("jumpToMessage", { ordinal: dot.ordinal })}
            >
              {/* Tooltip on hover */}
              {isHovered && (
                <span
                  className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
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
