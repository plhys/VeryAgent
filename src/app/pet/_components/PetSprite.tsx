"use client"

import { useEffect, useRef, useCallback } from "react"
import {
  backgroundPositionFor,
  SPRITE_BACKGROUND_SIZE,
  SPRITE_FRAME_HEIGHT,
  SPRITE_FRAME_WIDTH,
  type PetState,
} from "@/lib/pet/animation"
import { usePetAnimator } from "../_hooks/usePetAnimator"

export interface PetSpriteProps {
  /** When present, render the custom Codex-style spritesheet instead of webm. */
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

// Base size of the pet sprite (logical px before scaling). The Codex
// spritesheets use 192×208 logical frames; webm keeps the legacy 320 square.
const PET_WEBM_WIDTH = 320
const PET_WEBM_HEIGHT = 320

/**
 * Pet sprite renderer.
 *
 * Built-in "default" pets still use the webm pipeline, while imported pets
 * keep the original Codex spritesheet animation so custom active pets really
 * show their own artwork instead of falling back to the black cat videos.
 */
export function PetSprite({
  spritesheetUrl,
  state,
  scale,
  label,
}: PetSpriteProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const currentStateRef = useRef<PetState>(state)
  const enterPlayedRef = useRef(false)
  const enterEndedHandlerRef = useRef<(() => void) | null>(null)
  const tick = usePetAnimator(state)
  const useSpritesheet = Boolean(spritesheetUrl)

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
    if (useSpritesheet) return
    if (currentStateRef.current !== state) {
      enterPlayedRef.current = false
    }
    playState(state)
  }, [playState, state, useSpritesheet])

  if (useSpritesheet && spritesheetUrl) {
    return (
      <div
        role="img"
        aria-label={label}
        style={{
          width: `${SPRITE_FRAME_WIDTH * scale}px`,
          height: `${SPRITE_FRAME_HEIGHT * scale}px`,
          overflow: "hidden",
          pointerEvents: "none",
          backgroundImage: `url("${spritesheetUrl}")`,
          backgroundRepeat: "no-repeat",
          backgroundSize: SPRITE_BACKGROUND_SIZE,
          backgroundPosition: backgroundPositionFor(tick.row, tick.col),
          imageRendering: "auto",
        }}
      />
    )
  }

  return (
    <div
      role="img"
      aria-label={label}
      style={{
        width: `${PET_WEBM_WIDTH * scale}px`,
        height: `${PET_WEBM_HEIGHT * scale}px`,
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
