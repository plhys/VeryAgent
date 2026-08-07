import { getTransport } from "../transport"
import type { AgentType } from "../types"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VisionBridgeConfig {
  enabled: boolean
  api_url: string
  api_key: string
  model_name: string
  agent_types_list: string[]
  updated_at: string
}

export interface VisionBridgeConfigUpdate {
  enabled: boolean
  api_url: string
  api_key: string
  model_name: string
  agent_types_list: string[]
}

// ─── API functions ───────────────────────────────────────────────────────────

export async function visionBridgeGetConfig(): Promise<VisionBridgeConfig> {
  return getTransport().call("vision_bridge_get_config", {})
}

export async function visionBridgeSaveConfig(
  settings: VisionBridgeConfigUpdate
): Promise<void> {
  return getTransport().call("vision_bridge_save_config", { settings })
}