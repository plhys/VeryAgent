import { getTransport } from "../transport"
import type { ProviderModelItem } from "../types"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImageGatewayEntry {
  id: string
  note: string
  priority: number
  enabled: boolean
  api_url: string
  api_key: string
  model_name: string
  default_size: string
}

export interface ImageGenerationConfig {
  enabled: boolean
  gateways: ImageGatewayEntry[]
  api_url: string
  api_key: string
  model_name: string
  default_size: string
  updated_at: string
}

export interface ImageGenerationModelItem {
  id: string
  name: string
}

export interface ImageGenerationSettings {
  enabled: boolean
  gateways: ImageGatewayEntry[]
  api_url: string
  api_key: string
  model_name: string
  default_size: string
}

export interface ImageGenerationModelsResult {
  models: ProviderModelItem[]
  used_fallback: boolean
}

export interface ImageGenerationSaveResult {
  config: ImageGenerationConfig
  affectedRunningSessions: number
}

// ─── API functions ───────────────────────────────────────────────────────────

export async function imageGenerationGetConfig(): Promise<ImageGenerationConfig> {
  return getTransport().call("image_generation_get_config", {})
}

export async function imageGenerationSaveConfig(
  settings: ImageGenerationSettings
): Promise<ImageGenerationSaveResult> {
  return getTransport().call("image_generation_save_config", { settings })
}

export async function imageGenerationFetchModels(params: {
  apiUrl: string
  apiKey: string
}): Promise<ImageGenerationModelsResult> {
  return getTransport().call("image_generation_fetch_models", {
    apiUrl: params.apiUrl,
    apiKey: params.apiKey,
  })
}
