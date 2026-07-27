"use client"

import { useEffect, useState } from "react"
import { getPet, readPetSpritesheet, getPetSettings } from "@/lib/pet/api"
import type { PetDetail, PetRenderMode } from "@/lib/pet/types"
import {
  createPetSpriteObjectUrl,
  revokePetSpriteObjectUrl,
} from "@/lib/pet/sprite-url"
import { PetSprite } from "@/app/pet/_components/PetSprite"
import { usePetState } from "@/app/pet/_hooks/usePetState"
import type { PetState } from "@/lib/pet/animation"
import { PetBadge } from "@/app/pet/_components/PetBadge"
import { useTabStore } from "@/stores/tab-store"

export function PetFloating() {
  const [pet, setPet] = useState<PetDetail | null>(null)
  const [spritesheetUrl, setSpritesheetUrl] = useState<string | null>(null)
  const [renderMode, setRenderMode] = useState<PetRenderMode>("webm")
  const [scale, setScale] = useState(1)
  const [loaded, setLoaded] = useState(false)
  const [animate, setAnimate] = useState(false) // Entrance animation flag
  const agentState = usePetState()

  // Only surface the floating pet inside an active conversation window — not on
  // the welcome/empty state. The welcome page is the draft tab before any
  // conversation exists (conversationId == null); once the user opens/enters a
  // real conversation it becomes non-null, which is our "in a chat window" signal.
  const petVisible = useTabStore((s) => {
    const tab = s.tabs.find((x) => x.id === s.activeTabId)
    return tab != null && tab.conversationId != null
  })

  const renderState: PetState = agentState

  // Load pet data and settings on mount.
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    async function load() {
      try {
        const [detail, config] = await Promise.all([
          getPet("default"),
          getPetSettings(),
        ])
        if (cancelled) return
        setPet(detail)
        setRenderMode(detail.renderMode)
        setScale(config.scale ?? 1)
        setLoaded(true)

        if (detail.renderMode === "spritesheet" && detail.spritesheetPath) {
          const sprite = await readPetSpritesheet("default")
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
        if (!cancelled) {
          setPet(null)
          setSpritesheetUrl(null)
          setRenderMode("webm")
          setScale(1)
          setLoaded(true)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      if (objectUrl) revokePetSpriteObjectUrl(objectUrl)
    }
  }, [])

// Entrance animation: scale up from 0 with easing. Re-plays each time the pet
  // becomes visible (e.g. entering a conversation window from the welcome state),
  // so it "grows" in every time you open a chat.
  useEffect(() => {
    if (loaded && petVisible) {
      setAnimate(false)
      const timer = setTimeout(() => setAnimate(true), 60)
      return () => clearTimeout(timer)
    } else {
      setAnimate(false)
    }
  }, [loaded, petVisible])

  if (!loaded || !petVisible) return null

  return (
    <div
      className="pointer-events-none fixed z-50 select-none transition-all duration-300 ease-out"
      style={{ bottom: "80px", right: "-30px" }}
      aria-label="桌面宠物"
    >
      <div
        className={`pointer-events-auto relative transition-all duration-300 ease-out ${
          animate ? "scale-100 opacity-100" : "scale-0 opacity-0"
        }`}
      >
        <PetBadge />
        <PetSprite
          spritesheetUrl={renderMode === "spritesheet" ? spritesheetUrl : null}
          state={renderState}
          scale={scale}
          label={pet?.displayName ?? "VeryAgent Pet"}
        />
      </div>
    </div>
  )
}
