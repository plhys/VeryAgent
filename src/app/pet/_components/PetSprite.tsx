"use client"

import { useEffect, useRef, useCallback } from "react"
import type { PetState } from "@/lib/pet/animation"

export interface PetSpriteProps {
  /** Ignored for webm mode — the state is handled by PetVideo internally. */
  spritesheetUrl?: string | null
  state: PetState
  scale: number
  /** Aria-label for screen readers. */
  label: string
}

// PetState → webm video mapping.
// The webm sprites follow Hermes pet-agent naming:
//   static, begin, sleep-start, sleep-loop, sleep-leave,
//   task-start, task-loop, task-leave
// We map PetState (idle/running/waiting/failed/…) to the closest webm.
const STATE_VIDEO_MAP: Record<PetState, string> = {
  idle: "static.webm",
  running: "task-loop.webm",
  running_right: "task-loop.webm",
  running_left: "task-loop.webm",
  waiting: "sleep-loop.webm",
  failed: "sleep-loop.webm",
  waving: "begin.webm",
  jumping: "begin.webm",
  review: "task-loop.webm",
}

// The "enter" animation to play once before looping.
// e.g. running → play task-start.webm once, then task-loop.webm on loop.
const STATE_ENTER_VIDEO: Partial<Record<PetState, string>> = {
  running: "task-start.webm",
  running_right: "task-start.webm",
  running_left: "task-start.webm",
  waiting: "sleep-start.webm",
  failed: "sleep-start.webm",
}

// Base size of the pet sprite (logical px before scaling).
const PET_WIDTH = 320
const PET_HEIGHT = 320

/**
 * Webm-based pet sprite renderer.
 *
 * Replaces the original spritesheet-based PetSprite with video playback.
 * Each PetState maps to a specific .webm file. States that have an "enter"
 * animation (e.g. running → task-start → task-loop) will play the enter video
 * once, then seamlessly switch to the loop video.
 */
export function PetSprite({
  state,
  scale,
  label,
}: PetSpriteProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const currentStateRef = useRef<PetState>(state)
  const enterPlayedRef = useRef(false)
  const enterEndedHandlerRef = useRef<(() => void) | null>(null)

  // When state changes, decide whether to play an enter animation first.
  const playState = useCallback((newState: PetState) => {
    const video = videoRef.current
    if (!video) return

    const prevState = currentStateRef.current
    currentStateRef.current = newState

    // If the state hasn't actually changed, don't restart.
    if (prevState === newState && enterPlayedRef.current) return

    // Clean up any pending enter-ended handler from a previous state.
    if (enterEndedHandlerRef.current) {
      video.removeEventListener("ended", enterEndedHandlerRef.current)
      enterEndedHandlerRef.current = null
    }

    const enterVideo = STATE_ENTER_VIDEO[newState]
    const loopVideo = STATE_VIDEO_MAP[newState]

    if (enterVideo && !enterPlayedRef.current) {
      // Play the enter animation once, then switch to loop.
      video.src = `/pet-assets/${enterVideo}`
      video.loop = false
      enterPlayedRef.current = true

      const onEnded = () => {
        video.removeEventListener("ended", onEnded)
        enterEndedHandlerRef.current = null
        video.src = `/pet-assets/${loopVideo}`
        video.loop = true
        video.play().catch(() => {})
      }
      enterEndedHandlerRef.current = onEnded
      video.addEventListener("ended", onEnded)
      video.play().catch(() => {})
    } else {
      // Directly play the loop video.
      const targetSrc = `/pet-assets/${loopVideo}`
      // Use includes() instead of endsWith() — the browser may add
      // the full origin (http://localhost:3000/...) to video.src.
      if (!video.src.includes(targetSrc) || !video.loop) {
        video.src = targetSrc
        video.loop = true
        video.play().catch(() => {})
      }
    }
  }, [])

  // Reset enter tracking when state changes to a different state.
  useEffect(() => {
    if (currentStateRef.current !== state) {
      enterPlayedRef.current = false
    }
    playState(state)
  }, [state, playState])

  return (
    <div
      role="img"
      aria-label={label}
      style={{
        width: `${PET_WIDTH * scale}px`,
        height: `${PET_HEIGHT * scale}px`,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </div>
  )
}
