"use client"

import { createPortal } from "react-dom"
import { useState, useEffect, useRef } from "react"
import ReactMarkdown from "react-markdown"

const MAX_CHARS = 600
const SAFE_MARGIN = 100 // min distance from any viewport edge
const BUBBLE_W = 448 // ~36rem minus padding
const BUBBLE_H = 280 // typical summary height

interface Props {
  hostRef: React.RefObject<HTMLElement | null>
  isHovered: boolean
  summary: string | null | undefined
}

export function SidebarSummaryBubble({ hostRef, isHovered, summary }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const rafRef = useRef(0)

  const calc = () => {
    if (!hostRef.current) return
    const cardRect = hostRef.current.getBoundingClientRect()

    // Center the bubble horizontally in the viewport (main content area width)
    const centerX = window.innerWidth / 2 - BUBBLE_W / 2

    // Vertically center around the card's center line
    const centerY = cardRect.top + cardRect.height / 2 - BUBBLE_H / 2

    const left = Math.max(
      SAFE_MARGIN,
      Math.min(centerX, window.innerWidth - SAFE_MARGIN - BUBBLE_W)
    )
    const top = Math.max(
      SAFE_MARGIN,
      Math.min(centerY, window.innerHeight - SAFE_MARGIN - BUBBLE_H)
    )

    setPos({ top, left })
  }

  useEffect(() => {
    if (!isHovered || !summary || !hostRef.current) {
      setPos(null)
      return
    }
    const tick = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(calc)
    }
    calc()
    window.addEventListener("scroll", tick, true)
    window.addEventListener("resize", tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener("scroll", tick, true)
      window.removeEventListener("resize", tick)
    }
  }, [isHovered, summary, hostRef])

  if (!isHovered || !summary || !pos) return null

  const text =
    summary.length > MAX_CHARS ? summary.slice(0, MAX_CHARS) + "…" : summary

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999]"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="w-[36rem] max-w-[calc(100vw-4rem)] rounded-xl border border-border/80 bg-muted/90 p-4 text-sm leading-relaxed shadow-2xl backdrop-blur-xl [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_strong]:font-semibold">
        <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/85">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    </div>,
    document.body
  )
}
