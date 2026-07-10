"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { getPet, getPetSettings, readPetSpritesheet } from "@/lib/pet/api"
import type { PetDetail, PetRenderMode, PetWindowConfig } from "@/lib/pet/types"
import {
  createPetSpriteObjectUrl,
  revokePetSpriteObjectUrl,
} from "@/lib/pet/sprite-url"
import { disposeTauriListener } from "@/lib/tauri-listener"
import { getTransport, isDesktop } from "@/lib/transport"
import {
  PET_FRAME_DURATIONS_MS,
  PET_ONESHOT_LOOPS,
  type PetOneShotKind,
  type PetState,
} from "@/lib/pet/animation"
import { usePetState } from "../_hooks/usePetState"
import { usePetOneShot } from "../_hooks/usePetOneShot"
import { usePetDrag } from "../_hooks/usePetDrag"
import { PetSprite } from "./PetSprite"
import { PetMenu } from "./PetMenu"
import { PetBadge } from "./PetBadge"

export interface PetWindowProps {
  petId: string
}

// Hover/click animations loop this many times before resolving back to the
// agent state. The +80ms slack covers tick-rounding in the JS animator so
// we don't cut the last frame.
const INTERACTION_SLACK_MS = 80
const PET_HOVER_ENTER_EVENT = "pet://hover-enter"
const PET_HOVER_LEAVE_EVENT = "pet://hover-leave"
const PET_ACTIVE_CHANGED_EVENT = "pet://active-changed"

function sumDurations(state: PetState): number {
  return PET_FRAME_DURATIONS_MS[state].reduce((acc, d) => acc + d, 0)
}

// Oneshot animations from the backend (`pet://oneshot`) reuse the same
// "hold for N loops then unstick" model as user interactions. Loop counts
// live in `PET_ONESHOT_LOOPS` so designers can tune them without touching
// component code.
function oneShotDuration(state: PetOneShotKind): number {
  return sumDurations(state) * PET_ONESHOT_LOOPS[state] + INTERACTION_SLACK_MS
}

export function PetWindow({ petId }: PetWindowProps) {
  const t = useTranslations("Pet")
  const [pet, setPet] = useState<PetDetail | null>(null)
  const [spritesheetUrl, setSpritesheetUrl] = useState<string | null>(null)
  const [renderMode, setRenderMode] = useState<PetRenderMode>("webm")
  const [scale, setScale] = useState<number>(1)
  const [error, setError] = useState<string | null>(null)
  // The URL only carries the *initial* pet id (the active one when the
  // window was opened). After that, settings can switch the active pet
  // and we want the live window to swap sprites without close/reopen, so
  // the rendered id has to be reactive state rather than the prop.
  const [activePetId, setActivePetId] = useState<string>(petId)
  const agentState = usePetState()
  const oneShot = usePetOneShot()

  useEffect(() => {
    setActivePetId(petId)
  }, [petId])

  // Interaction-driven state takes priority over the agent-driven state so
  // a drag, hover, or click immediately wins over the ambient ACP animation.
  // The override is cleared either by the drag-idle timer (held still during
  // drag) or by the post-action timeout (after waving/jumping finishes).
  const [interactionState, setInteractionState] = useState<PetState | null>(
    null
  )
  const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerDownRef = useRef(false)

  // Drag direction changes are ignored for the webm sprite — there are no
  // dedicated running-right/left video files. The sprite stays in its
  // current agent-driven state during drag.
  const handleDragDirection = useCallback((_s: PetState | null) => {
    // No-op: webm pet does not change animation on drag direction
  }, [])

  const playOneShot = useCallback((state: PetState, durationMs: number) => {
    if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current)
    setInteractionState(state)
    interactionTimerRef.current = setTimeout(() => {
      setInteractionState(null)
      interactionTimerRef.current = null
    }, durationMs)
  }, [])

  const cancelInteraction = useCallback(() => {
    handleDragDirection(null)
  }, [handleDragDirection])

  // Single click does nothing. Double-click toggles the main window visibility.
  const lastClickRef = useRef(0)

  const handleClick = useCallback(() => {
    if (!isDesktop()) return
    const now = Date.now()
    if (now - lastClickRef.current < 400) {
      // Double-click: toggle main window visibility
      lastClickRef.current = 0
      void (async () => {
        try {
          const { Window } = await import("@tauri-apps/api/window")
          const mainWindow = await Window.getByLabel("main")
          if (mainWindow) {
            const visible = await mainWindow.isVisible()
            if (visible) {
              await mainWindow.hide()
            } else {
              await mainWindow.show()
              await mainWindow.setFocus()
            }
          }
        } catch (err) {
          console.warn("[Pet] failed to toggle main window:", err)
        }
      })()
    } else {
      lastClickRef.current = now
    }
  }, [])

  // Track held-mouse-button state so hover-driven waving stays out of the
  // way of any active interaction (drag, click-and-hold). Listening on
  // `window` rather than the root div catches pointerup even when it
  // happens off-window mid-drag.
  //
  // Only the primary (left) button matters here — drag is left-only, and
  // right-click is consumed by the native context menu, which eats the
  // paired `pointerup`. If we tracked all buttons we'd get stuck "down"
  // after every right-click and hover-waving would silently break until
  // the user clicked again to clear it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      pointerDownRef.current = true
    }
    const onUp = () => {
      pointerDownRef.current = false
    }
    window.addEventListener("pointerdown", onDown)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointerdown", onDown)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [])

  // Hover detection runs in Rust (`spawn_pet_hover_watcher` polls the
  // global cursor position and emits enter/leave events). Going through
  // the OS window event system from JS is unreliable when the pet isn't
  // the key window, so we listen for the backend events instead. Leaving
  // the window cancels any in-flight one-shot so the pet returns to its
  // ambient state immediately.
  useEffect(() => {
    if (!isDesktop()) return
    let unlistenEnter: (() => void) | null = null
    let unlistenLeave: (() => void) | null = null
    let cancelled = false
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event")
        const [offEnter, offLeave] = await Promise.all([
          listen(PET_HOVER_ENTER_EVENT, () => {
            // Webm pet: skip hover-triggered waving — the enter→loop
            // video transition is jarring on every mouse pass. The hover
            // leave still cancels any in-flight interaction so the pet
            // returns to its ambient state promptly.
            if (cancelled || pointerDownRef.current) return
            // No waving animation on hover
          }),
          listen(PET_HOVER_LEAVE_EVENT, () => {
            if (cancelled || pointerDownRef.current) return
            cancelInteraction()
          }),
        ])
        if (cancelled) {
          disposeTauriListener(offEnter, "Pet")
          disposeTauriListener(offLeave, "Pet")
        } else {
          unlistenEnter = offEnter
          unlistenLeave = offLeave
        }
      } catch (err) {
        console.warn("[Pet] hover subscription failed:", err)
      }
    })()
    return () => {
      cancelled = true
      disposeTauriListener(unlistenEnter, "Pet")
      disposeTauriListener(unlistenLeave, "Pet")
    }
  }, [playOneShot, cancelInteraction])

  // Backend-driven oneshot animations. Skipped while the user is actively
  // pressing the mouse (drag / click-and-hold) so we don't yank a sprite
  // out from under their finger; the backend event is fire-and-forget
  // anyway, missing one mid-drag is fine. Reacts to `oneShot.key` rather
  // than `oneShot.kind` so two same-kind events back-to-back replay.
  useEffect(() => {
    if (!oneShot) return
    if (pointerDownRef.current) return
    playOneShot(oneShot.kind, oneShotDuration(oneShot.kind))
  }, [oneShot, playOneShot])

  useEffect(() => {
    return () => {
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current)
    }
  }, [])

  const drag = usePetDrag({
    onDragDirection: handleDragDirection,
    onClick: handleClick,
  })

  const renderState: PetState = interactionState ?? agentState

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setError(null)

    async function load() {
      try {
        const [detail, config] = await Promise.all([
          getPet(activePetId),
          getPetSettings(),
        ])
        if (cancelled) return

        setPet(detail)
        setRenderMode(detail.renderMode)
        setScale(config.scale ?? 1)

        // Only load spritesheet for spritesheet-mode pets.
        if (detail.renderMode === "spritesheet" && detail.spritesheetPath) {
          const sprite = await readPetSpritesheet(activePetId)
          objectUrl = createPetSpriteObjectUrl(sprite)
          if (cancelled) {
            revokePetSpriteObjectUrl(objectUrl)
            return
          }
          setSpritesheetUrl(objectUrl)
        } else {
          setSpritesheetUrl(null)
        }
      } catch {
        // Pet data may not exist when using the webm video renderer.
        // The webm PetSprite doesn't need these assets at all, so
        // swallow the error and render with defaults.
        if (!cancelled) {
          setPet(null)
          setSpritesheetUrl(null)
          setRenderMode("webm")
          try {
            const config = await getPetSettings()
            if (!cancelled) setScale(config.scale ?? 1)
          } catch {
            // Use default scale
          }
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      revokePetSpriteObjectUrl(objectUrl)
    }
  }, [activePetId])

  // Settings UI emits `pet://active-changed` when the user picks a new
  // active pet. Swap the rendered id in place; the loader effect above
  // re-runs and pulls the new sprite/config. A null id (e.g. active
  // pet deleted) is ignored — no current UI path to deactivate without
  // also closing the window.
  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void (async () => {
      try {
        const off = await getTransport().subscribe<PetWindowConfig>(
          PET_ACTIVE_CHANGED_EVENT,
          (payload) => {
            if (cancelled) return
            const next = payload?.activePetId
            if (next) setActivePetId(next)
          }
        )
        if (cancelled) off()
        else unlisten = off
      } catch (err) {
        console.warn("[Pet] active-changed subscription failed:", err)
      }
    })()
    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [])

  // Keep the document title clean. macOS hides it via title_bar_style anyway,
  // but server-mode preview shows it.
  useEffect(() => {
    document.title = pet ? `${pet.displayName} - veryAgent pet` : "veryagent pet"
  }, [pet])

  // Fully transparent body so the OS chrome is invisible. Done in JS to keep
  // the global stylesheet untouched.
  useEffect(() => {
    const prevBg = document.body.style.background
    const prevHtmlBg = document.documentElement.style.background
    document.body.style.background = "transparent"
    document.documentElement.style.background = "transparent"
    document.body.classList.add("pet-body")
    // Remove focus outlines from the transparent pet window
    const style = document.createElement("style")
    style.textContent = "*:focus, *:focus-visible { outline: none !important; }"
    document.head.appendChild(style)
    return () => {
      document.body.style.background = prevBg
      document.documentElement.style.background = prevHtmlBg
      document.body.classList.remove("pet-body")
      style.remove()
    }
  }, [])

  if (error) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center text-xs text-destructive"
        style={{ background: "transparent" }}
        title={error}
      >
        {t("loadError")}
      </div>
    )
  }

  // Render the pet sprite immediately. The webm video renderer does not
  // need a spritesheet or pet manifest, so we don't gate on `pet` or
  // `spritesheetUrl` being loaded for webm pets. When renderMode is
  // "spritesheet", the spritesheetUrl must be present; PetSprite currently
  // always uses webm rendering (the spritesheetUrl prop is ignored), but the
  // renderMode field is tracked for future spritesheet renderer integration.
  return (
    <div
      className="relative flex h-screen w-screen select-none items-center justify-center cursor-grab active:cursor-grabbing"
      style={{ background: "transparent" }}
      onPointerDown={drag.onPointerDown}
    >
      <PetSprite
        spritesheetUrl={renderMode === "spritesheet" ? spritesheetUrl : null}
        state={renderState}
        scale={scale}
        label={pet?.displayName ?? "VeryAgent Pet"}
      />
      <PetBadge />
      <PetMenu />
    </div>
  )
}