"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { WeatherCard, type WeatherData } from "./WeatherCard"

// ── Helpers ──────────────────────────────────────────────────────

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function sanitizeHtml(html: string): string {
  const div = document.createElement("div")
  div.innerHTML = html
  const scripts = div.querySelectorAll("script")
  scripts.forEach((s) => s.remove())
  const events = [
    "onclick",
    "onerror",
    "onload",
    "onmouseover",
    "onmouseout",
    "onfocus",
    "onblur",
  ]
  const allElements = div.querySelectorAll("*")
  allElements.forEach((el) => {
    events.forEach((evt) => el.removeAttribute(evt))
  })
  return div.innerHTML
}

// ── Tool chip ────────────────────────────────────────────────────

interface ToolChip {
  id: string
  name: string
  phase: string
  actionText: string
  result?: string
}

// ── AI event payloads (from Tauri events) ───────────────────────

interface AIRunStartPayload {
  message?: string
}

interface AIChunkPayload {
  text?: string
  chunk?: string
}

interface AIToolPayload {
  name?: string
  toolCallId?: string
  tool_id?: string
  phase: string
  actionText?: string
  result?: string
}

interface AIDonePayload {
  content?: string
  text?: string
  rendered?: string
  aborted?: boolean
}

// ── PetBubble component ─────────────────────────────────────────

export function PetBubble() {
  const [text, setText] = useState("")
  const [chips, setChips] = useState<ToolChip[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [renderKey, setRenderKey] = useState(0)
  const [cardData, setCardData] = useState<WeatherData | null>(null)

  const [bubbleEl, setBubbleEl] = useState<HTMLDivElement | null>(null)
  const textRef = useRef("")
  // Only process chunk/tool/done events after an ai-run-start has been
  // received. This prevents stale events from already-running sessions
  // from appearing in the bubble on startup.
  const readyRef = useRef(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const visible = text || chips.length > 0 || isThinking || errorMsg || cardData

  // Notify the Rust backend whether the bubble has visible content.
  const notifyBubbleVisible = useCallback((vis: boolean) => {
    if (typeof window === "undefined") return
    void (async () => {
      try {
        const { emit } = await import("@tauri-apps/api/event")
        await emit("pet://set-bubble-visible", vis)
      } catch {
        // Tauri not available (web mode) — ignore
      }
    })()
  }, [])

  useEffect(() => {
    notifyBubbleVisible(!!visible)
  }, [visible, notifyBubbleVisible])

  // Auto-scroll bubble to bottom when content changes
  useEffect(() => {
    if (bubbleEl) {
      bubbleEl.scrollTop = bubbleEl.scrollHeight
    }
  }, [text, chips, isThinking, errorMsg, cardData, bubbleEl])

  // ── Dynamically resize the bubble window to match content ──
  // This eliminates the large transparent gap above the card. The
  // window height is set to content height + padding, then the
  // Rust-side reposition_pet_bubble recalculates the anchor.
  //
  // IMPORTANT: `bubbleEl` is a *state* ref (not a useRef). When the
  // .bubble div mounts, React calls setBubbleEl(el) → state update →
  // this effect re-runs and attaches the ResizeObserver. When the div
  // unmounts (content disappears), React calls setBubbleEl(null) →
  // the cleanup disconnects the observer. This is the only pattern
  // that guarantees the observer is actually set up, because a plain
  // useRef never triggers a re-run and the initial mount finds
  // bubbleRef.current === null.
  useEffect(() => {
    if (typeof window === "undefined" || !bubbleEl) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    function resize() {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        void (async () => {
          try {
            const curEl = bubbleEl
            if (!curEl) return
            const { LogicalSize } = await import("@tauri-apps/api/dpi")
            const { getCurrentWindow } = await import("@tauri-apps/api/window")
            const win = getCurrentWindow()
            // contentHeight in logical px; add padding from .bubble-root
            const contentH = curEl.getBoundingClientRect().height + 8 // 4px top + 4px bottom margin
            const width = 180.0
            await win.setSize(new LogicalSize(width, contentH))
            // Trigger Rust-side reposition after resize completes
            const { emit } = await import("@tauri-apps/api/event")
            await emit("pet://bubble-resized")
          } catch {
            // Tauri not available — ignore
          }
        })()
      }, 50) // 50ms debounce to coalesce rapid layout changes
    }

    const observer = new ResizeObserver(resize)
    observer.observe(bubbleEl)
    // Initial resize on mount
    resize()

    return () => {
      observer.disconnect()
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [bubbleEl])

  // ── Subscribe to Tauri events ──
  useEffect(() => {
    let cancelled = false
    const unlisteners: (() => void)[] = []

    async function subscribe() {
      try {
        const { listen } = await import("@tauri-apps/api/event")

        // pet://ai-run-start — AI begins generating
        const off1 = await listen<AIRunStartPayload>(
          "pet://ai-run-start",
          () => {
            if (cancelled) return
            // Mark as ready — only now will chunk/tool/done events be processed
            readyRef.current = true
            clearTimeout(hideTimerRef.current!)
            clearTimeout(thinkingTimerRef.current!)
            textRef.current = ""
            setText("")
            setChips([])
            setIsThinking(false)
            thinkingTimerRef.current = setTimeout(
              () => setIsThinking(true),
              3000
            )
            setCardData(null)
            clearTimeout(cardTimerRef.current!)
            setRenderKey((k) => k + 1)
          }
        )
        unlisteners.push(off1)

        // pet://ai-chunk — streaming text delta
        const off2 = await listen<AIChunkPayload>("pet://ai-chunk", (ev) => {
          if (cancelled || !readyRef.current) return
          clearTimeout(thinkingTimerRef.current!)
          setIsThinking(false)
          const raw = ev.payload?.text || ev.payload?.chunk || ""
          // Filter out thinking/reasoning content that may leak through
          if (raw.includes("<think>") || raw.includes("</think>")) return
          textRef.current += raw
          setText(textRef.current)
        })
        unlisteners.push(off2)

        // pet://ai-tool — tool call start/progress/complete
        const off3 = await listen<AIToolPayload>("pet://ai-tool", (ev) => {
          if (cancelled || !readyRef.current) return
          const tool = ev.payload
          if (!tool) return
          setIsThinking(false)
          const id = tool.toolCallId || tool.tool_id || `t-${Date.now()}`
          setChips((prev) => {
            const existing = prev.find((c) => c.id === id)
            if (existing) {
              return prev.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      phase: tool.phase || c.phase,
                      actionText:
                        tool.actionText !== undefined
                          ? tool.actionText
                          : c.actionText,
                      result: tool.result || c.result,
                    }
                  : c
              )
            }
            return [
              ...prev,
              {
                id,
                name: tool.name || tool.actionText || "tool",
                phase: tool.phase || "start",
                actionText:
                  tool.actionText !== undefined ? tool.actionText : (tool.name || "tool"),
              },
            ]
          })
        })
        unlisteners.push(off3)

        // pet://ai-done — AI generation complete
        const off4 = await listen<AIDonePayload>("pet://ai-done", (ev) => {
          if (cancelled || !readyRef.current) return
          const result = ev.payload
          clearTimeout(thinkingTimerRef.current!)
          setIsThinking(false)
          clearTimeout(hideTimerRef.current!)
          if (result?.aborted) {
            textRef.current = ""
            setText("")
            setChips([])
            setCardData(null)
          } else {
            const content =
              result?.content || result?.text || result?.rendered || ""
            if (content) {
              // Try parsing weather card JSON
              try {
                const parsed = JSON.parse(content)
                if (parsed.type === "weather" && parsed.data) {
                  const d = parsed.data
                  setCardData({
                    city: d.city || "",
                    temperature: d.temperature || 0,
                    condition: d.condition || "",
                    type: d.weatherType || d.type || "sunny",
                    humidity: d.humidity || 0,
                    windSpeed: d.windSpeed || 0,
                    feelsLike: d.feelsLike || 0,
                  })
                  setText("")
                  clearTimeout(cardTimerRef.current!)
                  cardTimerRef.current = setTimeout(
                    () => setCardData(null),
                    60000
                  )
                  return
                }
              } catch {
                // Not JSON — treat as text
              }
              // Strip any <think>...</think> blocks that leaked through
              const cleaned = content
                .replace(/<think>[\s\S]*?<\/think>/g, "")
                .trim()
              textRef.current = cleaned
              setText(cleaned)
            }
            const len = content.length
            const delay = len <= 10 ? 7000 : 15000
            hideTimerRef.current = setTimeout(() => {
              setText("")
              setChips([])
              readyRef.current = false
            }, delay)
          }
        })
        unlisteners.push(off4)

        // pet://api-error — API error
        const off5 = await listen<{ message?: string }>(
          "pet://api-error",
          (ev) => {
            if (cancelled || !readyRef.current) return
            const msg = ev.payload?.message || "Something went wrong"
            setErrorMsg(msg)
            clearTimeout(errorTimerRef.current!)
            errorTimerRef.current = setTimeout(() => setErrorMsg(""), 5000)
          }
        )
        unlisteners.push(off5)
      } catch (err) {
        console.warn("[PetBubble] subscription failed:", err)
      }
    }

    void subscribe()

    return () => {
      cancelled = true
      unlisteners.forEach((off) => off())
    }
  }, [])

  // ── Render ──
  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { background: transparent !important; overflow: hidden; }
        *:focus, *:focus-visible { outline: none !important; }
        .bubble-root {
          position: fixed; inset: 0; display: flex; align-items: flex-start;
          padding: 4px 0 0 8px; pointer-events: none;
        }
        .bubble {
          display: inline-block; max-width: 170px; max-height: 180px; min-height: 28px; overflow-y: auto;
          background: linear-gradient(160deg, #2a2a2a 0%, #1e1e1e 40%, #181818 100%);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; padding: 4px 6px 6px 6px;
          backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
          box-shadow: none;
          pointer-events: auto; position: relative;
          animation: bubbleIn 0.3s cubic-bezier(0.16,1,0.3,1);
        }
        .bubble::-webkit-scrollbar { width: 3px; }
        .bubble::-webkit-scrollbar-track { background: transparent; }
        .bubble::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
        @keyframes bubbleIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .bubble-tail {
          position: absolute; bottom: -5px; left: 50%; transform: translateX(-50%);
          width: 0; height: 0;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-top: 5px solid #1e1e1e;
          background: none;
        }
        .bubble-tools { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; margin-bottom: 2px; flex-shrink: 0; }
        .bubble-chip {
          display: inline-flex; align-items: center; gap: 1px;
          font-size: 6px; font-weight: 500; padding: 0px 2px;
          border-radius: 3px; white-space: nowrap; border: none;
          letter-spacing: 0px; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
          line-height: 1.4;
        }
        .bubble-chip-dot { width: 2px; height: 2px; border-radius: 50%; flex-shrink: 0; }
        .bubble-chip.done { background: rgba(74,222,128,0.1); color: rgba(74,222,128,0.85); border-color: rgba(74,222,128,0.15); }
        .bubble-chip.done .bubble-chip-dot { background: rgba(74,222,128,0.7); }
        .bubble-chip.running { background: rgba(96,165,250,0.08); color: rgba(96,165,250,0.85); border-color: rgba(96,165,250,0.12); animation: chipBlink 0.8s steps(1) infinite; }
        .bubble-chip.running .bubble-chip-dot { background: rgba(96,165,250,0.7); }
        @keyframes chipBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        .bubble-dots { display: flex; gap: 4px; padding: 4px 2px; }
        .bubble-dots span { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.3); animation: dotPulse 1.2s ease-in-out infinite; }
        .bubble-dots span:nth-child(2) { animation-delay: 0.2s; }
        .bubble-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dotPulse { 0%,80%,100% { opacity: 0.2; transform: scale(0.75); } 40% { opacity: 1; transform: scale(1); } }
        .bubble-text { font-size: 11.5px; line-height: 1.5; color: rgba(255,255,255,0.92); word-break: break-word; font-family: inherit; }
        .bubble-text p { margin: 0 0 4px; }
        .bubble-text p:last-child { margin: 0; }
        .bubble-text strong { color: #fff; font-weight: 600; }
        .bubble-text code { background: rgba(255,255,255,0.1); padding: 1px 5px; border-radius: 4px; font-size: 10px; font-family: 'SF Mono', Menlo, monospace; color: rgba(255,255,255,0.8); }
        .bubble-text a { color: #60a5fa; text-decoration: none; }
        .pet-short { display: flex; align-items: center; gap: 8px; }
        .pet-short-emoji {
          font-size: 14px; line-height: 1; flex-shrink: 0;
          width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.08); border-radius: 8px;
        }
        .pet-short-text { font-size: 12.5px; font-weight: 500; color: rgba(255,255,255,0.95); line-height: 1.35; }
        .pet-card {
          display: flex; flex-direction: column; gap: 4px;
          padding-left: 10px;
          border-left: 2px solid rgba(255,255,255,0.2);
        }
        .pet-card-label {
          font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px;
          color: rgba(255,255,255,0.5); margin-bottom: 1px;
        }
        .pet-title { font-size: 12.5px; font-weight: 500; color: rgba(255,255,255,0.95); line-height: 1.4; }
        .pet-summary { font-size: 10.5px; color: rgba(255,255,255,0.7); line-height: 1.45; }
        .pet-emoji { display: none; }
        .pet-card--code { border-left-color: rgba(74,222,128,0.5); }
        .pet-card--search { border-left-color: rgba(167,139,250,0.5); }
        .pet-card--profile { border-left-color: rgba(251,191,36,0.5); }
        .pet-card--error { border-left-color: rgba(239,68,68,0.5); }
        .pet-card--file { border-left-color: rgba(52,211,153,0.5); }
        .pet-card--chart { border-left-color: rgba(251,146,60,0.5); }
        .pet-card--stock { border-left-color: rgba(248,113,113,0.5); padding-left: 0; border-left: none; }
        .pet-stock-price { font-size: 24px; font-weight: 700; color: rgba(255,255,255,0.9); line-height: 1; letter-spacing: -0.5px; }
        .pet-stock-change { font-size: 12px; font-weight: 600; margin-top: 3px; }
        .pet-stock-change.up { color: rgba(74,222,128,0.85); }
        .pet-stock-change.down { color: rgba(248,113,113,0.85); }
        .pet-stock-ticker { font-size: 9.5px; color: rgba(255,255,255,0.35); margin-top: 4px; letter-spacing: 0.3px; }
        .bubble--error { border-color: rgba(239,68,68,0.25); }
        .bubble-error-text { font-size: 11px; color: rgba(248,113,113,0.9); font-weight: 500; }
        .bubble--card { background: transparent; border: none; border-radius: 0; padding: 0; max-width: none; max-height: none; overflow: visible; backdrop-filter: none; -webkit-backdrop-filter: none; box-shadow: none; pointer-events: auto; }
      `}</style>
      <div className="bubble-root">
        {errorMsg && (
          <div className="bubble bubble--error" ref={setBubbleEl}>
            <span className="bubble-error-text">{escapeHtml(errorMsg)}</span>
            <div className="bubble-tail" />
          </div>
        )}
        {!errorMsg && visible && cardData ? (
          <div ref={setBubbleEl}>
            <WeatherCard
              data={cardData}
              onDismiss={() => {
                setCardData(null)
                clearTimeout(cardTimerRef.current!)
              }}
            />
          </div>
        ) : (
          !errorMsg &&
          visible && (
            <div className="bubble" key={renderKey} ref={setBubbleEl}>
              {chips.length > 0 && !text.includes('data-type="card"') && (
                <div className="bubble-tools">
                  {chips.slice(-5).map((chip) => {
                    const isDone =
                      chip.phase === "done" ||
                      chip.phase === "end" ||
                      !!chip.result
                    // Truncate chip text to keep chips uniform size
                    const label = (chip.actionText || chip.name || "tool").length > 10
                      ? (chip.actionText || chip.name || "tool").slice(0, 9) + "…"
                      : (chip.actionText || chip.name || "tool")
                    return (
                      <span
                        key={chip.id}
                        className={`bubble-chip ${isDone ? "done" : "running"}`}
                      >
                        <span className="bubble-chip-dot" />
                        {escapeHtml(label)}
                      </span>
                    )
                  })}
                </div>
              )}
              {isThinking && !text ? (
                <div className="bubble-dots">
                  <span />
                  <span />
                  <span />
                </div>
              ) : text ? (
                <div
                  className="bubble-text"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(text),
                  }}
                />
              ) : null}
              <div className="bubble-tail" />
            </div>
          )
        )}
      </div>
    </>
  )
}
