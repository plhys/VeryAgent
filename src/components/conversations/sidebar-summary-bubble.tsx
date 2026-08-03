"use client"

import { createPortal } from "react-dom"
import { useState, useEffect, useRef } from "react"
import ReactMarkdown from "react-markdown"

const MAX_CHARS = 600
const SAFE_MARGIN = 100 // min distance from any viewport edge
const SHOW_DELAY_MS = 1000 // hover 后延迟多久才弹出

interface Props {
  hostRef: React.RefObject<HTMLElement | null>
  isHovered: boolean
  summary: string | null | undefined
}

export function SidebarSummaryBubble({ hostRef, isHovered, summary }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [visible, setVisible] = useState(false)
  const rafRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const calc = () => {
    if (!hostRef.current) return
    const cardRect = hostRef.current.getBoundingClientRect()

    // Horizontal anchor: midpoint between the card's right edge and the viewport
    // right edge, i.e. the centre of the main content area. This keeps the bubble
    // in the content area regardless of monitor width.
    const anchorX = (cardRect.right + window.innerWidth) / 2

    // Vertical anchor: the card's vertical centre line.
    const anchorY = cardRect.top + cardRect.height / 2

    // Clamp the anchor so the bubble's centre stays at least SAFE_MARGIN from
    // any viewport edge. The actual bubble size is handled by transform below.
    const left = Math.max(
      SAFE_MARGIN,
      Math.min(anchorX, window.innerWidth - SAFE_MARGIN)
    )
    const top = Math.max(
      SAFE_MARGIN,
      Math.min(anchorY, window.innerHeight - SAFE_MARGIN)
    )

    setPos({ top, left })
  }

  // 实时计算气泡位置（滚动/缩放时更新）
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

  // 2 秒延迟后再显示（鼠标快速划过时不弹出）
  useEffect(() => {
    if (!isHovered || !summary) {
      setVisible(false)
      return
    }
    timerRef.current = setTimeout(() => {
      setVisible(true)
    }, SHOW_DELAY_MS)
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [isHovered, summary])

  if (!isHovered || !summary || !pos) return null

  const text =
    summary.length > MAX_CHARS ? summary.slice(0, MAX_CHARS) + "…" : summary

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999]"
      style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -50%)" }}
    >
      {/* 滑入动画层：从左侧平移 + 淡入 */}
      <div
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateX(0)" : "translateX(-0.75rem)",
          transition: "opacity 0.3s ease-out, transform 0.3s ease-out",
        }}
      >
        <div className="w-[36rem] max-w-[calc(100vw-4rem)] rounded-xl border border-border/80 bg-muted/90 p-4 text-sm leading-relaxed shadow-2xl backdrop-blur-xl [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_strong]:font-semibold">
          <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/85">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}