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

export function PetFloating({ isConversationActive }: { isConversationActive?: boolean }) {
  const [pet, setPet] = useState<PetDetail | null>(null)
  const [spritesheetUrl, setSpritesheetUrl] = useState<string | null>(null)
  const [renderMode, setRenderMode] = useState<PetRenderMode>("webm")
  const [scale, setScale] = useState(0.5)
  const [loaded, setLoaded] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [show, setShow] = useState(false)
  const agentState = usePetState()

  const renderState: PetState = agentState
  const shouldShow = Boolean(isConversationActive && mounted)

  // Detect when this component becomes visible inside a conversation tab
  useEffect(() => {
    if (isConversationActive) {
      const timer = setTimeout(() => {
        setMounted(true)
        setShow(true)
      }, 100)
      return () => clearTimeout(timer)
    } else {
      setMounted(false)
      setShow(false)
    }
  }, [isConversationActive])

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
        setScale((config.scale ?? 1) * 0.5)
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
          setScale(0.5)
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

  if (!loaded || !shouldShow) return null

  return (
    <div
      className="pointer-events-none fixed bottom-9 right-5 z-40 select-none animate-fade-in-scale"
      aria-label="桌面宠物"
    >
      <div className="pointer-events-auto relative">
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
