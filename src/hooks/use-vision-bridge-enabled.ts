"use client"

/**
 * Read the vision bridge config and check whether it's enabled for a given
 * agent type. Cached at module scope so multiple conversation tabs don't
 * refetch per tab.
 *
 * Cross-window reactive: the settings UI runs in a SEPARATE window
 * (`openSettingsWindow`), so a frontend-only cache would never see its save.
 * The backend broadcasts `vision-bridge-settings://changed` on every save;
 * this hook subscribes to it (once per window) and updates every mounted
 * instance live.
 */

import { useEffect, useState } from "react"

import { visionBridgeGetConfig } from "@/lib/api"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import { VISION_BRIDGE_SETTINGS_CHANGED_EVENT, type AgentType } from "@/lib/types"
import type { VisionBridgeConfig } from "@/lib/api"

let cached: VisionBridgeConfig | null = null
let inflight: Promise<VisionBridgeConfig> | null = null
let saveGeneration = 0
let crossWindowWired = false
const listeners = new Set<(config: VisionBridgeConfig) => void>()

function notify(config: VisionBridgeConfig): void {
  for (const listener of listeners) listener(config)
}

function applyConfig(config: VisionBridgeConfig): void {
  saveGeneration += 1
  cached = config
  notify(config)
}

/** Seed/overwrite the cache and notify all mounted hooks (called by the
 *  settings page after a successful save). */
export function primeVisionBridgeConfig(config: VisionBridgeConfig): void {
  applyConfig(config)
}

function ensureLoaded(): Promise<VisionBridgeConfig> {
  if (inflight) return inflight
  const startGeneration = saveGeneration
  inflight = visionBridgeGetConfig()
    .catch((): VisionBridgeConfig => ({
      enabled: false,
      api_url: "",
      api_key: "",
      model_name: "",
      agent_types_list: [],
      updated_at: "",
    }))
    .then((value) => {
      if (saveGeneration === startGeneration) {
        cached = value
        notify(value)
      }
      return cached ?? value
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

function ensureCrossWindowSync(): void {
  if (crossWindowWired) return
  crossWindowWired = true
  void subscribe<VisionBridgeConfig>(
    VISION_BRIDGE_SETTINGS_CHANGED_EVENT,
    (s) => {
      applyConfig(s)
    }
  ).catch(() => {
    crossWindowWired = false
  })
  onTransportReconnect(() => {
    void visionBridgeGetConfig()
      .then((s) => applyConfig(s))
      .catch(() => {})
  })
}

/** Returns the full vision bridge config. */
export function useVisionBridgeConfig(): VisionBridgeConfig {
  const [config, setConfig] = useState<VisionBridgeConfig>(
    () =>
      cached ?? {
        enabled: false,
        api_url: "",
        api_key: "",
        model_name: "",
        agent_types_list: [],
        updated_at: "",
      }
  )

  useEffect(() => {
    ensureCrossWindowSync()
    listeners.add(setConfig)
    if (cached === null) void ensureLoaded()
    return () => {
      listeners.delete(setConfig)
    }
  }, [])

  return config
}

/** Returns whether the vision bridge is enabled for the given agent type. */
export function useVisionBridgeEnabledForAgent(
  agentType: AgentType | null
): boolean {
  const config = useVisionBridgeConfig()
  if (!agentType) return false
  return config.enabled && config.agent_types_list.includes(agentType)
}