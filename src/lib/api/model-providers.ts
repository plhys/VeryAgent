import { getTransport } from "../transport"
import type {
  DeleteModelProviderResult,
  ModelProviderInfo,
  ModelProviderTestResult,
  ProviderModelItem,
  UpdateModelProviderResult,
} from "../types"

export async function listModelProviders(): Promise<ModelProviderInfo[]> {
  return getTransport().call("list_model_providers")
}

export async function createModelProvider(params: {
  name: string
  apiUrl: string
  apiKey: string
}): Promise<ModelProviderInfo> {
  return getTransport().call("create_model_provider", {
    name: params.name,
    apiUrl: params.apiUrl,
    apiKey: params.apiKey,
  })
}

export async function updateModelProvider(params: {
  id: number
  name?: string | null
  apiUrl?: string | null
  apiKey?: string | null
}): Promise<UpdateModelProviderResult> {
  return getTransport().call("update_model_provider", {
    id: params.id,
    name: params.name ?? null,
    apiUrl: params.apiUrl ?? null,
    apiKey: params.apiKey ?? null,
  })
}

export async function deleteModelProvider(
  id: number
): Promise<DeleteModelProviderResult> {
  return getTransport().call("delete_model_provider", { id })
}

/**
 * List models a saved provider can serve (GET `<api_url>/models` with its key).
 * Used by agent settings after a model provider is selected.
 */

export async function fetchModelProviderModels(
  id: number
): Promise<ProviderModelItem[]> {
  return getTransport().call("fetch_provider_models", { id })
}

/**
 * Run the full connectivity test for a saved model provider. Probes the
 * OpenAI chat endpoint, the Anthropic messages endpoint (with tools — the
 * exact shape Claude Code sends), and the /models list. Surfaces gateway
 * defects before the user wires the provider to an agent.
 */
export async function testModelProvider(
  id: number
): Promise<ModelProviderTestResult> {
  return getTransport().call("test_model_provider", { id })
}

// ─── Delegation settings ───────────────────────────────────────────────
