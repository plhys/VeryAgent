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

export function PetFloating() {
  const [pet, setPet] = useState<PetDetail | null>(null)
  const [spritesheetUrl, setSpritesheetUrl] = useState<string | null>(null)
  const [renderMode, setRenderMode] = useState<PetRenderMode>("webm")
  const [scale, setScale] = useState(0.35)
  const agentState = usePetState()

  const renderState: PetState = agentState

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
        setScale((config.scale ?? 1) * 0.35)

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
          setScale(0.35)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      revokePetSpriteObjectUrl(objectUrl)
    }
  }, [])

  return (
    <div
      className="pointer-events-none fixed bottom-8 right-4 z-40 select-none"
      aria-label="桌面宠物"
    >
      <div className="pointer-events-auto">
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
