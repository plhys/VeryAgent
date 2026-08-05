"use client"

import type { PointerEvent, ReactNode } from "react"
import type {
  AgentType,
  AcpAgentInfo,
  CheckStatus,
  FixAction,
  PreflightResult,
} from "@/lib/types"
import type { AgentReadiness, AgentReadinessKind } from "@/lib/agent-readiness"

export type { AgentReadiness, AgentReadinessKind }

// ── Agent Check State ──────────────────────────────────────────────

export interface AgentCheckState {
  result?: PreflightResult
  error?: string
}

// ── Claude Auth ────────────────────────────────────────────────────
// Claude Code authenticates exclusively through a bound model provider;
// the official subscription login is intentionally not offered.

export const CLAUDE_AUTH_MODES = ["model_provider"] as const
export type ClaudeAuthMode = (typeof CLAUDE_AUTH_MODES)[number]

export const CLAUDE_MODEL_ENV_KEYS = {
  claudeMainModel: "ANTHROPIC_MODEL",
  claudeReasoningModel: "ANTHROPIC_REASONING_MODEL",
  claudeDefaultHaikuModel: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  claudeDefaultSonnetModel: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  claudeDefaultOpusModel: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  claudeCustomModelOption: "ANTHROPIC_CUSTOM_MODEL_OPTION",
  claudeCustomModelOptionName: "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME",
  claudeCustomModelOptionDescription:
    "ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION",
} as const

export const CLAUDE_EFFORT_LEVEL_CONFIG_KEY = "effortLevel"

export type ClaudeEffortLevel = "" | "low" | "medium" | "high" | "xhigh"

export const CLAUDE_EFFORT_LEVEL_VALUES: ReadonlyArray<
  Exclude<ClaudeEffortLevel, "">
> = ["low", "medium", "high", "xhigh"]

export type ClaudeModelKey = keyof typeof CLAUDE_MODEL_ENV_KEYS
export type ImportantConfigKey =
  "apiBaseUrl" | "apiKey" | "model" | ClaudeModelKey

// ── Gemini Auth ────────────────────────────────────────────────────

export const GEMINI_AUTH_MODES = [
  "custom",
  "login_google",
  "gemini_api_key",
  "vertex_adc",
  "vertex_service_account",
  "vertex_api_key",
  "model_provider",
] as const
export type GeminiAuthMode = (typeof GEMINI_AUTH_MODES)[number]

export const GEMINI_ENV_KEYS = {
  baseUrl: "GOOGLE_GEMINI_BASE_URL",
  legacyBaseUrl: "GEMINI_BASE_URL",
  geminiApiKey: "GEMINI_API_KEY",
  legacyGeminiApiKey: "GOOGLE_GEMINI_API_KEY",
  googleApiKey: "GOOGLE_API_KEY",
  cloudProject: "GOOGLE_CLOUD_PROJECT",
  cloudProjectLegacy: "GOOGLE_CLOUD_PROJECT_ID",
  cloudLocation: "GOOGLE_CLOUD_LOCATION",
  applicationCredentials: "GOOGLE_APPLICATION_CREDENTIALS",
  model: "GEMINI_MODEL",
} as const

// ── OpenClaw ───────────────────────────────────────────────────────

export const OPENCLAW_ENV_KEYS = {
  gatewayUrl: "OPENCLAW_GATEWAY_URL",
  gatewayToken: "OPENCLAW_GATEWAY_TOKEN",
  sessionKey: "OPENCLAW_SESSION_KEY",
} as const

// ── Cline ──────────────────────────────────────────────────────────

export const CLINE_PROVIDERS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai-native", label: "OpenAI" },
  { value: "openai", label: "OpenAI Compatible" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "gemini", label: "Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "vertex", label: "GCP Vertex" },
  { value: "ollama", label: "Ollama" },
] as const
export type ClineProvider = (typeof CLINE_PROVIDERS)[number]["value"]

// ── Codex ──────────────────────────────────────────────────────────

export const CODEX_DEFAULT_MODEL_PROVIDER = "veryagent"

export const CODEX_AUTH_MODES = [
  "api_key",
  "chatgpt_subscription",
  "model_provider",
] as const
export type CodexAuthMode = (typeof CODEX_AUTH_MODES)[number]

export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh"

export const CODEX_REASONING_EFFORT_OPTIONS: ReadonlyArray<{
  value: CodexReasoningEffort
  label: string
  description: string
}> = [
  {
    value: "low",
    label: "Low",
    description: "Fast responses with lighter reasoning",
  },
  {
    value: "medium",
    label: "Medium",
    description: "Balances speed and reasoning depth for everyday tasks",
  },
  {
    value: "high",
    label: "High",
    description: "Greater reasoning depth for complex problems",
  },
  {
    value: "xhigh",
    label: "Extra High",
    description: "Extra high reasoning depth for complex problems",
  },
]

export const CODEX_DEFAULT_REASONING_EFFORT: CodexReasoningEffort = "high"

// ── OpenCode ───────────────────────────────────────────────────────

export const OPENCODE_PROVIDER_NPM_OPTIONS = [
  { value: "@ai-sdk/openai-compatible", label: "@ai-sdk/openai-compatible" },
  { value: "@ai-sdk/cerebras", label: "@ai-sdk/cerebras" },
  { value: "@ai-sdk/azure", label: "@ai-sdk/azure" },
  { value: "@ai-sdk/xai", label: "@ai-sdk/xai" },
  { value: "@ai-sdk/anthropic", label: "@ai-sdk/anthropic" },
  { value: "@ai-sdk/amazon-bedrock", label: "@ai-sdk/amazon-bedrock" },
  { value: "@ai-sdk/google", label: "@ai-sdk/google" },
  { value: "@ai-sdk/google-vertex", label: "@ai-sdk/google-vertex" },
  { value: "@ai-sdk/deepseek", label: "@ai-sdk/deepseek" },
] as const

// ── Kimi ───────────────────────────────────────────────────────────

export const KIMI_BASE_URL_INTERNATIONAL = "https://api.moonshot.ai/v1"
export const KIMI_BASE_URL_CHINA = "https://api.moonshot.cn/v1"
export const KIMI_MODEL_PLACEHOLDER = "kimi-k2.7-code"

export type KimiAuthMode = "apikey" | "login" | "model_provider"
export type HermesAuthMode = "native" | "model_provider"
export type OpenClawAuthMode = "gateway" | "model_provider"
export type ClineAuthMode = "native" | "model_provider"
export type OpenCodeAuthMode = "apikey" | "model_provider"
export type PiAuthMode = "native" | "model_provider"
export type CodeBuddyAuthMode = "native" | "model_provider"

export type KimiInterfaceType =
  | "kimi"
  | "openai"
  | "openai_responses"
  | "anthropic"
  | "google-genai"
  | "vertexai"
export type KimiNativeAuthType = "api_key" | "env"
export type KimiEndpointRegion = "international" | "china" | "custom"

export interface KimiInterfaceTypeMeta {
  value: KimiInterfaceType
  label: string
  defaultBaseUrl: string
  usesApiKey: boolean
}

export const KIMI_INTERFACE_TYPES: KimiInterfaceTypeMeta[] = [
  {
    value: "kimi",
    label: "Kimi / Moonshot",
    defaultBaseUrl: KIMI_BASE_URL_INTERNATIONAL,
    usesApiKey: true,
  },
  {
    value: "openai",
    label: "OpenAI (Chat Completions)",
    defaultBaseUrl: "https://api.openai.com/v1",
    usesApiKey: true,
  },
  {
    value: "openai_responses",
    label: "OpenAI (Responses)",
    defaultBaseUrl: "https://api.openai.com/v1",
    usesApiKey: true,
  },
  {
    value: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "",
    usesApiKey: true,
  },
  {
    value: "google-genai",
    label: "Google Gemini",
    defaultBaseUrl: "",
    usesApiKey: true,
  },
  {
    value: "vertexai",
    label: "Google Vertex AI",
    defaultBaseUrl: "",
    usesApiKey: false,
  },
]

export interface KimiManagedConfig {
  interfaceType?: KimiInterfaceType
  baseUrl?: string
  key?: string
  authType?: KimiNativeAuthType
  modelId?: string
  maxContextSize?: number
  vertexProject?: string
  vertexLocation?: string
  hasManagedBlock?: boolean
  credentialPresent?: boolean
  credentialSynthetic?: boolean
  rawConfigToml?: string
}

// ── Agent Draft ────────────────────────────────────────────────────

export interface AgentDraft {
  enabled: boolean
  envText: string
  configText: string
  apiBaseUrl: string
  apiKey: string
  model: string
  claudeAuthMode: ClaudeAuthMode
  modelProviderId: number | null
  geminiAuthMode: GeminiAuthMode
  geminiApiKey: string
  googleApiKey: string
  googleCloudProject: string
  googleCloudLocation: string
  googleApplicationCredentials: string
  codexAuthMode: CodexAuthMode
  codexModelProvider: string
  codexProviderOptions: string[]
  codexReasoningEffort: CodexReasoningEffort
  codexSupportsWebsockets: boolean
  codexSkills: boolean
  codexServiceTierFast: boolean
  claudeMainModel: string
  claudeReasoningModel: string
  claudeDefaultHaikuModel: string
  claudeDefaultSonnetModel: string
  claudeDefaultOpusModel: string
  claudeCustomModelOption: string
  claudeCustomModelOptionName: string
  claudeCustomModelOptionDescription: string
  claudeEffortLevel: ClaudeEffortLevel
  codexAuthJsonText: string
  codexConfigTomlText: string
  openCodeAuthJsonText: string
  openClawGatewayUrl: string
  openClawGatewayToken: string
  openClawSessionKey: string
  clineProvider: ClineProvider
  clineApiKey: string
  clineModel: string
  clineBaseUrl: string
  hermesAuthMode: HermesAuthMode
  openClawAuthMode: OpenClawAuthMode
  clineAuthMode: ClineAuthMode
  openCodeAuthMode: OpenCodeAuthMode
  piAuthMode: PiAuthMode
  codeBuddyAuthMode: CodeBuddyAuthMode
  hermesProvider: string
  hermesConfigYaml: string
  hermesHome: string
  hermesSetupCommand: string
  hermesModelCommand: string
}

export type ImportantDraftPatch = Partial<Pick<AgentDraft, ImportantConfigKey>>

// ── Running Action / UI Fix / Check ────────────────────────────────

export type RunningActionKind =
  | "download_binary"
  | "upgrade_binary"
  | "install_npx"
  | "upgrade_npx"
  | "uninstall_binary"
  | "uninstall_npx"
  | "redownload_binary"
  | "custom_install"
  | "install_uv"

export type UiFixAction =
  | FixAction
  | {
      label: string
      kind:
        | "download_binary"
        | "upgrade_binary"
        | "install_npx"
        | "upgrade_npx"
        | "uninstall_binary"
        | "uninstall_npx"
        | "install_opencode_plugins"
        | "custom_install"
      payload: string
      disabled?: boolean
    }

export interface UiCheckItem {
  check_id: string
  label: string
  status: CheckStatus
  message: string
  fixes: UiFixAction[]
}

export type AcpTranslator = (
  key: string,
  values?: Record<string, string | number>
) => string

// ── Config Parse ───────────────────────────────────────────────────

export interface ConfigParseResult {
  config: Record<string, unknown>
  error: string | null
}

// ── Auth Mode Values ───────────────────────────────────────────────

export interface ImportantEnvKeys {
  apiBaseUrl: string[]
  apiKey: string[]
  model: string[]
}

export interface GeminiImportantValues {
  authMode: GeminiAuthMode
  apiBaseUrl: string
  geminiApiKey: string
  googleApiKey: string
  googleCloudProject: string
  googleCloudLocation: string
  googleApplicationCredentials: string
  model: string
}

export interface OpenClawImportantValues {
  gatewayUrl: string
  gatewayToken: string
  sessionKey: string
}

export interface ClineImportantValues {
  provider: ClineProvider
  apiKey: string
  model: string
  baseUrl: string
}

// ── OpenCode View ──────────────────────────────────────────────────

export interface OpenCodeProviderView {
  id: string
  name: string
  api: string
  npm: string
  baseUrl: string
  apiKey: string
  modelCount: number
  modelIds: string[]
  models: Record<string, OpenCodeModelView>
}

export interface OpenCodeModelView {
  id: string
  name: string
  extraFieldCount: number
}

export interface OpenCodeConfigView {
  model: string
  smallModel: string
  enabledProviders: string[]
  disabledProviders: string[]
  providerIds: string[]
  providers: Record<string, OpenCodeProviderView>
}

// ── Codex TOML ─────────────────────────────────────────────────────

export interface CodexTomlImportantValues {
  model: string
  modelProvider: string
  modelReasoningEffort: CodexReasoningEffort
  providerNames: string[]
  providerBaseUrls: Record<string, string>
  providerSupportsWebsockets: Record<string, boolean>
  featureResponsesWebsocketsV2: boolean
  featureSkills: boolean
  serviceTierFast: boolean
}

export interface CodexImportantValues {
  apiBaseUrl: string
  apiKey: string | null
  model: string
  modelProvider: string
  reasoningEffort: CodexReasoningEffort
  providerOptions: string[]
  supportsWebsockets: boolean
  skills: boolean
  serviceTierFast: boolean
}

// ── Hermes ─────────────────────────────────────────────────────────

export interface HermesDraftValues {
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  hermesHome: string
  setupCommand: string
  modelCommand: string
}

// ── Agent Reorder Item Props ───────────────────────────────────────

export interface AgentReorderItemProps {
  agent: AcpAgentInfo
  selected: boolean
  reordering: boolean
  dragging: AgentType | null
  inactive?: boolean
  onDragStart: (agentType: AgentType) => void
  onDragEnd: () => void
  onSelect: (agentType: AgentType) => void
  children: (
    startDrag: (event: PointerEvent<HTMLButtonElement>) => void
  ) => ReactNode
}
