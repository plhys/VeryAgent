import type { AgentType, CheckStatus, HermesLocalConfig, AcpAgentInfo } from "@/lib/types"
import { toErrorMessage } from "@/lib/app-error"
import type { AgentReadiness, AgentReadinessKind } from "@/lib/agent-readiness"

import { buildConnectedModelOptions, type OpenCodeModelOptionGroup } from "@/lib/opencode-connect"

import type {
  AcpTranslator, UiCheckItem, UiFixAction, AgentDraft,
  ImportantEnvKeys, ClaudeEffortLevel, 
  GeminiImportantValues, ClineImportantValues, OpenClawImportantValues,
  HermesDraftValues,
  OpenCodeConfigView, OpenCodeProviderView, OpenCodeModelView,
  HermesAuthMode, OpenClawAuthMode, ClineAuthMode, OpenCodeAuthMode, PiAuthMode, CodeBuddyAuthMode,
} from "./types"
import { KIMI_BASE_URL_INTERNATIONAL, KIMI_BASE_URL_CHINA, KIMI_MODEL_PLACEHOLDER, KIMI_INTERFACE_TYPES } from "./types"
import { CLAUDE_MODEL_ENV_KEYS, CLAUDE_EFFORT_LEVEL_CONFIG_KEY, CLAUDE_EFFORT_LEVEL_VALUES } from "./types"


let acpTranslator: AcpTranslator | null = null

export function setAcpTranslator(t: AcpTranslator | null) {
  acpTranslator = t
}

export function acpText(
  key: string,
  fallback: string,
  values?: Record<string, string | number>
): string {
  if (!acpTranslator) return fallback
  return acpTranslator(key, values)
}

export function statusTone(status: CheckStatus): string {
  if (status === "pass") return "text-green-500"
  if (status === "warn") return "text-yellow-500"
  return "text-red-500"
}

export function summarizeChecks(checks: UiCheckItem[]): CheckStatus | "unchecked" {
  if (checks.length === 0) return "unchecked"
  if (checks.some((check) => check.status === "fail")) return "fail"
  if (checks.some((check) => check.status === "warn")) return "warn"
  return "pass"
}

// Re-export readiness types for any settings consumers that imported them here.
export type { AgentReadiness, AgentReadinessKind }

export function envMapToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

export function parseEnvText(envText: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const idx = line.indexOf("=")
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!key) continue
    map[key] = value
  }
  return map
}

export function patchEnvText(
  envText: string,
  patch: Record<string, string | undefined>
): string {
  const envMap = parseEnvText(envText)
  for (const [key, value] of Object.entries(patch)) {
    const trimmed = value?.trim() ?? ""
    if (!trimmed) {
      delete envMap[key]
    } else {
      envMap[key] = trimmed
    }
  }
  return envMapToText(envMap)
}

export function normalizeClaudeEffortLevel(value: unknown): ClaudeEffortLevel {
  if (typeof value !== "string") return ""
  const normalized = value.trim().toLowerCase()
  // Upstream claude-agent-acp >=0.37 exposes the sentinel string "default";
  // collapse it to "" so our UI's "默认/Default" placeholder stays
  // canonical regardless of which side wrote the config.
  if (normalized === "" || normalized === "default") return ""
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh"
  ) {
    return normalized
  }
  return ""
}

const GEMINI_AUTH_MODES = [
  "custom",
  "login_google",
  "gemini_api_key",
  "vertex_adc",
  "vertex_service_account",
  "vertex_api_key",
  "model_provider",
] as const

type GeminiAuthMode = (typeof GEMINI_AUTH_MODES)[number]

const GEMINI_ENV_KEYS = {
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

const OPENCLAW_ENV_KEYS = {
  gatewayUrl: "OPENCLAW_GATEWAY_URL",
  gatewayToken: "OPENCLAW_GATEWAY_TOKEN",
  sessionKey: "OPENCLAW_SESSION_KEY",
} as const

const CLINE_PROVIDERS = [
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

type ClineProvider = (typeof CLINE_PROVIDERS)[number]["value"]

type ClaudeModelKey = keyof typeof CLAUDE_MODEL_ENV_KEYS
type ImportantConfigKey = "apiBaseUrl" | "apiKey" | "model" | ClaudeModelKey
type ImportantDraftPatch = Partial<Pick<AgentDraft, ImportantConfigKey>>

interface ConfigParseResult {
  config: Record<string, unknown>
  error: string | null
}

export function importantEnvKeysByAgent(agentType: AgentType): ImportantEnvKeys {
  if (agentType === "claude_code") {
    return {
      apiBaseUrl: ["ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "API_BASE_URL"],
      apiKey: ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
      model: ["ANTHROPIC_MODEL", "OPENAI_MODEL", "MODEL"],
    }
  }
  if (agentType === "gemini") {
    return {
      apiBaseUrl: ["GOOGLE_GEMINI_BASE_URL", "GEMINI_BASE_URL", "API_BASE_URL"],
      apiKey: [
        GEMINI_ENV_KEYS.geminiApiKey,
        GEMINI_ENV_KEYS.googleApiKey,
        GEMINI_ENV_KEYS.legacyGeminiApiKey,
        "API_KEY",
      ],
      model: ["GEMINI_MODEL", "MODEL"],
    }
  }
  return {
    apiBaseUrl: ["OPENAI_BASE_URL", "API_BASE_URL"],
    apiKey: ["OPENAI_API_KEY", "API_KEY"],
    model: ["OPENAI_MODEL", "MODEL"],
  }
}

export function parseConfigJsonText(configText: string): ConfigParseResult {
  const trimmed = configText.trim()
  if (!trimmed) return { config: {}, error: null }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        config: {},
        error: acpText(
          "errors.nativeJsonMustBeObject",
          "Native JSON config must be an object"
        ),
      }
    }
    return { config: parsed as Record<string, unknown>, error: null }
  } catch (err) {
    const message = toErrorMessage(err)
    return {
      config: {},
      error: acpText(
        "errors.nativeJsonInvalid",
        "Native JSON config format error: {message}",
        { message }
      ),
    }
  }
}

export function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function parseOpenCodeAuthJsonText(authJsonText: string): {
  authObject: Record<string, unknown> | null
  error: string | null
} {
  const trimmed = authJsonText.trim()
  if (!trimmed) return { authObject: {}, error: null }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        authObject: null,
        error: acpText(
          "errors.openCodeAuthMustBeObject",
          "OpenCode auth.json must be a JSON object"
        ),
      }
    }
    return { authObject: parsed as Record<string, unknown>, error: null }
  } catch (err) {
    const message = toErrorMessage(err)
    return {
      authObject: null,
      error: acpText(
        "errors.openCodeAuthInvalid",
        "OpenCode auth.json format error: {message}",
        { message }
      ),
    }
  }
}

export function patchOpenCodeAuthJsonText(
  authJsonText: string,
  mutator: (authObject: Record<string, unknown>) => void
): { authJsonText: string; recoveredFromInvalid: boolean } {
  const parsed = parseOpenCodeAuthJsonText(authJsonText)
  const authObject = parsed.error
    ? {}
    : (JSON.parse(JSON.stringify(parsed.authObject ?? {})) as Record<
        string,
        unknown
      >)
  mutator(authObject)
  return {
    authJsonText:
      Object.keys(authObject).length === 0
        ? ""
        : JSON.stringify(authObject, null, 2),
    recoveredFromInvalid: Boolean(parsed.error),
  }
}

export function envFromConfig(
  config: Record<string, unknown>
): Record<string, string> {
  const raw = config.env
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {}
  }

  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue
    const trimmedKey = key.trim()
    const trimmedValue = value.trim()
    if (!trimmedKey || !trimmedValue) continue
    map[trimmedKey] = trimmedValue
  }
  return map
}

export function pickFirstString(
  source: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

export function findEnvValue(env: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = env[key]
    if (!value) continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return ""
}

export function extractImportantConfigValues(
  agentType: AgentType,
  env: Record<string, string>,
  configText: string
): {
  apiBaseUrl: string
  apiKey: string
  model: string
  claudeMainModel: string
  claudeReasoningModel: string
  claudeDefaultHaikuModel: string
  claudeDefaultSonnetModel: string
  claudeDefaultOpusModel: string
  claudeCustomModelOption: string
  claudeCustomModelOptionName: string
  claudeCustomModelOptionDescription: string
  claudeEffortLevel: ClaudeEffortLevel
  configError: string | null
} {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.config
  const keys = importantEnvKeysByAgent(agentType)

  const configEnv = envFromConfig(config)
  const mergedEnv = { ...env, ...configEnv }

  const apiBaseUrl =
    pickFirstString(config, ["apiBaseUrl", "api_base_url"]) ??
    findEnvValue(mergedEnv, keys.apiBaseUrl)
  const apiKey =
    pickFirstString(config, ["apiKey", "api_key"]) ??
    findEnvValue(mergedEnv, keys.apiKey)
  const model =
    pickFirstString(config, ["model", "model_name"]) ??
    findEnvValue(mergedEnv, keys.model)
  const claudeMainModel = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeMainModel,
  ])
  const claudeReasoningModel = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeReasoningModel,
  ])
  const claudeDefaultHaikuModel = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeDefaultHaikuModel,
  ])
  const claudeDefaultSonnetModel = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeDefaultSonnetModel,
  ])
  const claudeDefaultOpusModel = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeDefaultOpusModel,
  ])
  const claudeCustomModelOption = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeCustomModelOption,
  ])
  const claudeCustomModelOptionName = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeCustomModelOptionName,
  ])
  const claudeCustomModelOptionDescription = findEnvValue(mergedEnv, [
    CLAUDE_MODEL_ENV_KEYS.claudeCustomModelOptionDescription,
  ])

  const claudeEffortLevel: ClaudeEffortLevel =
    agentType === "claude_code"
      ? normalizeClaudeEffortLevel(config[CLAUDE_EFFORT_LEVEL_CONFIG_KEY])
      : ""

  return {
    apiBaseUrl: apiBaseUrl ?? "",
    apiKey: apiKey ?? "",
    model: model ?? "",
    claudeMainModel: agentType === "claude_code" ? (claudeMainModel ?? "") : "",
    claudeReasoningModel:
      agentType === "claude_code" ? claudeReasoningModel : "",
    claudeDefaultHaikuModel:
      agentType === "claude_code" ? claudeDefaultHaikuModel : "",
    claudeDefaultSonnetModel:
      agentType === "claude_code" ? claudeDefaultSonnetModel : "",
    claudeDefaultOpusModel:
      agentType === "claude_code" ? claudeDefaultOpusModel : "",
    claudeCustomModelOption:
      agentType === "claude_code" ? claudeCustomModelOption : "",
    claudeCustomModelOptionName:
      agentType === "claude_code" ? claudeCustomModelOptionName : "",
    claudeCustomModelOptionDescription:
      agentType === "claude_code" ? claudeCustomModelOptionDescription : "",
    claudeEffortLevel,
    configError: parseResult.error,
  }
}


export function inferGeminiAuthMode(values: {
  apiBaseUrl: string
  geminiApiKey: string
  googleApiKey: string
  googleCloudProject: string
  googleCloudLocation: string
  googleApplicationCredentials: string
}): GeminiAuthMode {
  if (values.apiBaseUrl.trim()) return "custom"
  if (values.geminiApiKey.trim()) return "gemini_api_key"
  if (values.googleApiKey.trim()) return "vertex_api_key"
  if (values.googleApplicationCredentials.trim())
    return "vertex_service_account"
  if (values.googleCloudProject.trim() || values.googleCloudLocation.trim()) {
    return "vertex_adc"
  }
  return "login_google"
}

export function extractGeminiImportantValues(
  env: Record<string, string>,
  configText: string
): GeminiImportantValues {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.config
  const configEnv = envFromConfig(config)
  const mergedEnv = { ...env, ...configEnv }

  const apiBaseUrl = findEnvValue(mergedEnv, [
    GEMINI_ENV_KEYS.baseUrl,
    GEMINI_ENV_KEYS.legacyBaseUrl,
    "API_BASE_URL",
  ])
  const geminiApiKey = findEnvValue(mergedEnv, [
    GEMINI_ENV_KEYS.geminiApiKey,
    GEMINI_ENV_KEYS.legacyGeminiApiKey,
  ])
  const googleApiKey = findEnvValue(mergedEnv, [GEMINI_ENV_KEYS.googleApiKey])
  const googleCloudProject = findEnvValue(mergedEnv, [
    GEMINI_ENV_KEYS.cloudProject,
    GEMINI_ENV_KEYS.cloudProjectLegacy,
  ])
  const googleCloudLocation = findEnvValue(mergedEnv, [
    GEMINI_ENV_KEYS.cloudLocation,
  ])
  const googleApplicationCredentials = findEnvValue(mergedEnv, [
    GEMINI_ENV_KEYS.applicationCredentials,
  ])
  const model = findEnvValue(mergedEnv, [GEMINI_ENV_KEYS.model, "MODEL"])

  return {
    authMode: inferGeminiAuthMode({
      apiBaseUrl,
      geminiApiKey,
      googleApiKey,
      googleCloudProject,
      googleCloudLocation,
      googleApplicationCredentials,
    }),
    apiBaseUrl,
    geminiApiKey,
    googleApiKey,
    googleCloudProject,
    googleCloudLocation,
    googleApplicationCredentials,
    model: model ?? "",
  }
}


export function extractClineImportantValues(configText: string): ClineImportantValues {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.config
  return {
    provider: (typeof config.apiProvider === "string" && config.apiProvider
      ? config.apiProvider
      : "anthropic") as ClineProvider,
    apiKey: typeof config.apiKey === "string" ? config.apiKey : "",
    model: typeof config.model === "string" ? config.model : "",
    baseUrl: typeof config.apiBaseUrl === "string" ? config.apiBaseUrl : "",
  }
}

export function extractOpenClawImportantValues(
  env: Record<string, string>,
  configText: string
): OpenClawImportantValues {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.config
  const configEnv = envFromConfig(config)
  const mergedEnv = { ...env, ...configEnv }

  return {
    gatewayUrl: findEnvValue(mergedEnv, [OPENCLAW_ENV_KEYS.gatewayUrl]),
    gatewayToken: findEnvValue(mergedEnv, [OPENCLAW_ENV_KEYS.gatewayToken]),
    sessionKey: findEnvValue(mergedEnv, [OPENCLAW_ENV_KEYS.sessionKey]),
  }
}

export function patchGeminiConfigText(
  configText: string,
  patch: {
    apiBaseUrl?: string
    model?: string
    geminiApiKey?: string
    googleApiKey?: string
    googleCloudProject?: string
    googleCloudLocation?: string
    googleApplicationCredentials?: string
  }
): {
  configText: string
  recoveredFromInvalid: boolean
} {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.error ? {} : { ...parseResult.config }
  const env =
    typeof config.env === "object" && config.env && !Array.isArray(config.env)
      ? { ...(config.env as Record<string, unknown>) }
      : {}

  const assignOrRemoveEnv = (key: string, value: string | undefined) => {
    if (typeof value !== "string") return
    const trimmed = value.trim()
    if (!trimmed) {
      delete env[key]
      return
    }
    env[key] = trimmed
  }

  if (typeof patch.model === "string") {
    delete config.model
    delete config.model_name
    assignOrRemoveEnv(GEMINI_ENV_KEYS.model, patch.model)
  }
  assignOrRemoveEnv(GEMINI_ENV_KEYS.baseUrl, patch.apiBaseUrl)
  if (typeof patch.apiBaseUrl === "string") {
    assignOrRemoveEnv(GEMINI_ENV_KEYS.legacyBaseUrl, "")
  }
  assignOrRemoveEnv(GEMINI_ENV_KEYS.geminiApiKey, patch.geminiApiKey)
  assignOrRemoveEnv(GEMINI_ENV_KEYS.googleApiKey, patch.googleApiKey)
  if (typeof patch.geminiApiKey === "string") {
    assignOrRemoveEnv(GEMINI_ENV_KEYS.legacyGeminiApiKey, "")
  }
  if (typeof patch.googleCloudProject === "string") {
    const project = patch.googleCloudProject.trim()
    if (!project) {
      delete env[GEMINI_ENV_KEYS.cloudProject]
      delete env[GEMINI_ENV_KEYS.cloudProjectLegacy]
    } else {
      env[GEMINI_ENV_KEYS.cloudProject] = project
      delete env[GEMINI_ENV_KEYS.cloudProjectLegacy]
    }
  }
  assignOrRemoveEnv(GEMINI_ENV_KEYS.cloudLocation, patch.googleCloudLocation)
  assignOrRemoveEnv(
    GEMINI_ENV_KEYS.applicationCredentials,
    patch.googleApplicationCredentials
  )

  if (Object.keys(env).length === 0) {
    delete config.env
  } else {
    config.env = env
  }

  return {
    configText:
      Object.keys(config).length === 0 ? "" : JSON.stringify(config, null, 2),
    recoveredFromInvalid: Boolean(parseResult.error),
  }
}

export function patchGeminiEnvText(
  envText: string,
  patch: {
    apiBaseUrl?: string
    geminiApiKey?: string
    googleApiKey?: string
    googleCloudProject?: string
    googleCloudLocation?: string
    googleApplicationCredentials?: string
    model?: string
  }
): string {
  const envPatch: Record<string, string | undefined> = {}
  if (typeof patch.apiBaseUrl === "string") {
    envPatch[GEMINI_ENV_KEYS.baseUrl] = patch.apiBaseUrl
    envPatch[GEMINI_ENV_KEYS.legacyBaseUrl] = ""
  }
  if (typeof patch.geminiApiKey === "string") {
    envPatch[GEMINI_ENV_KEYS.geminiApiKey] = patch.geminiApiKey
    envPatch[GEMINI_ENV_KEYS.legacyGeminiApiKey] = ""
  }
  if (typeof patch.googleApiKey === "string") {
    envPatch[GEMINI_ENV_KEYS.googleApiKey] = patch.googleApiKey
  }
  if (typeof patch.googleCloudProject === "string") {
    envPatch[GEMINI_ENV_KEYS.cloudProject] = patch.googleCloudProject
    envPatch[GEMINI_ENV_KEYS.cloudProjectLegacy] = ""
  }
  if (typeof patch.googleCloudLocation === "string") {
    envPatch[GEMINI_ENV_KEYS.cloudLocation] = patch.googleCloudLocation
  }
  if (typeof patch.googleApplicationCredentials === "string") {
    envPatch[GEMINI_ENV_KEYS.applicationCredentials] =
      patch.googleApplicationCredentials
  }
  if (typeof patch.model === "string") {
    envPatch[GEMINI_ENV_KEYS.model] = patch.model
  }
  return patchEnvText(envText, envPatch)
}

export function patchGeminiAuthMode(
  current: GeminiImportantValues,
  mode: GeminiAuthMode
) {
  const next = {
    ...current,
    authMode: mode,
  }
  if (mode === "login_google") {
    next.apiBaseUrl = ""
    next.geminiApiKey = ""
    next.googleApiKey = ""
    next.googleCloudProject = ""
    next.googleCloudLocation = ""
    next.googleApplicationCredentials = ""
    return next
  }
  if (mode === "custom") {
    next.googleApiKey = ""
    next.googleCloudProject = ""
    next.googleCloudLocation = ""
    next.googleApplicationCredentials = ""
    return next
  }
  if (mode === "gemini_api_key") {
    next.apiBaseUrl = ""
    next.googleApiKey = ""
    next.googleCloudProject = ""
    next.googleCloudLocation = ""
    next.googleApplicationCredentials = ""
    return next
  }
  if (mode === "vertex_api_key") {
    next.apiBaseUrl = ""
    next.geminiApiKey = ""
    next.googleApplicationCredentials = ""
    return next
  }
  if (mode === "vertex_service_account") {
    next.apiBaseUrl = ""
    next.geminiApiKey = ""
    next.googleApiKey = ""
    return next
  }
  if (mode === "model_provider") {
    next.googleCloudProject = ""
    next.googleCloudLocation = ""
    next.googleApplicationCredentials = ""
    return next
  }
  next.apiBaseUrl = ""
  next.geminiApiKey = ""
  next.googleApiKey = ""
  next.googleApplicationCredentials = ""
  return next
}

export function geminiAuthModeLabel(mode: GeminiAuthMode): string {
  if (mode === "custom")
    return acpText("authModeCustomEndpoint", "Custom Endpoint")
  if (mode === "login_google")
    return acpText("gemini.mode.loginGoogle", "Google Login (OAuth)")
  if (mode === "gemini_api_key") return "Gemini API Key"
  if (mode === "vertex_adc") return "Vertex AI (ADC)"
  if (mode === "vertex_service_account")
    return acpText(
      "gemini.mode.vertexServiceAccount",
      "Vertex AI (Service Account)"
    )
  if (mode === "model_provider")
    return acpText("authModeModelProvider", "Model Provider")
  return "Vertex AI API Key"
}

export function geminiAuthModeHint(mode: GeminiAuthMode): string {
  if (mode === "custom") {
    return acpText(
      "gemini.hint.custom",
      "Fill API URL, API Key and Model, mapped to GOOGLE_GEMINI_BASE_URL / GEMINI_API_KEY / GEMINI_MODEL."
    )
  }
  if (mode === "login_google") {
    return acpText(
      "gemini.hint.loginGoogle",
      "Run gemini in terminal and complete Google login first; API key is not required."
    )
  }
  if (mode === "gemini_api_key") {
    return acpText(
      "gemini.hint.geminiApiKey",
      "Fill GEMINI_API_KEY when using Gemini API."
    )
  }
  if (mode === "vertex_adc") {
    return acpText(
      "gemini.hint.vertexAdc",
      "Use gcloud ADC; GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are recommended."
    )
  }
  if (mode === "vertex_service_account") {
    return acpText(
      "gemini.hint.vertexServiceAccount",
      "Set service account JSON path to GOOGLE_APPLICATION_CREDENTIALS."
    )
  }
  if (mode === "model_provider") {
    return acpText(
      "modelProviderHint",
      "Use API URL and API Key from a configured model provider."
    )
  }
  return acpText(
    "gemini.hint.vertexApiKey",
    "Fill GOOGLE_API_KEY when using Vertex AI API key."
  )
}

/**
 * Compare original and current config objects. For any key present in
 * original but missing in current, set it to `null` in the result so
 * the backend merge can delete it from the file on disk.
 */
export function markRemovedKeysNull(
  original: Record<string, unknown>,
  current: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...current }
  for (const key of Object.keys(original)) {
    if (!(key in result)) {
      result[key] = null
    } else if (
      original[key] &&
      typeof original[key] === "object" &&
      !Array.isArray(original[key]) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = markRemovedKeysNull(
        original[key] as Record<string, unknown>,
        result[key] as Record<string, unknown>
      )
    }
  }
  return result
}

export function normalizeConfigText(configText: string): string {
  const parseResult = parseConfigJsonText(configText)
  if (parseResult.error) return configText.trim()
  if (Object.keys(parseResult.config).length === 0) return ""
  return JSON.stringify(parseResult.config, null, 2)
}

const OPENCODE_PROVIDER_NPM_OPTIONS = [
  {
    value: "@ai-sdk/openai-compatible",
    label: "@ai-sdk/openai-compatible",
  },
  {
    value: "@ai-sdk/cerebras",
    label: "@ai-sdk/cerebras",
  },
  {
    value: "@ai-sdk/azure",
    label: "@ai-sdk/azure",
  },
  {
    value: "@ai-sdk/xai",
    label: "@ai-sdk/xai",
  },
  {
    value: "@ai-sdk/anthropic",
    label: "@ai-sdk/anthropic",
  },
  {
    value: "@ai-sdk/amazon-bedrock",
    label: "@ai-sdk/amazon-bedrock",
  },
  {
    value: "@ai-sdk/google",
    label: "@ai-sdk/google",
  },
  {
    value: "@ai-sdk/google-vertex",
    label: "@ai-sdk/google-vertex",
  },
  {
    value: "@ai-sdk/deepseek",
    label: "@ai-sdk/deepseek",
  },
] as const

export function buildOpenCodeModelOptions(
  config: OpenCodeConfigView | null
): OpenCodeModelOptionGroup[] {
  if (!config) return []
  const groups: OpenCodeModelOptionGroup[] = []
  for (const providerId of config.providerIds) {
    const provider = config.providers[providerId]
    if (!provider || provider.modelIds.length === 0) continue
    groups.push({
      providerId,
      label: provider.name || providerId,
      models: provider.modelIds.map((modelId) => ({
        value: `${providerId}/${modelId}`,
        label: modelId,
      })),
    })
  }
  return groups
}

export function buildOpenCodeNpmOptions(currentValue: string): string[] {
  const next = new Set<string>(
    OPENCODE_PROVIDER_NPM_OPTIONS.map((v) => v.value)
  )
  const current = currentValue.trim()
  if (current) next.add(current)
  return Array.from(next)
}

export function extractOpenCodeConfigValues(
  configText: string,
  authJsonText: string
): OpenCodeConfigView {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.error ? {} : parseResult.config
  const authParsed = parseOpenCodeAuthJsonText(authJsonText)
  const authObject = authParsed.authObject ?? {}
  const providerRoot = asObjectRecord(config.provider) ?? {}
  const providerIds = Object.keys(providerRoot)
  const providers: Record<string, OpenCodeProviderView> = {}
  const knownModelKeys = new Set(["id", "name"])

  for (const providerId of providerIds) {
    const rawProvider = asObjectRecord(providerRoot[providerId]) ?? {}
    const options = asObjectRecord(rawProvider.options) ?? {}
    const models = asObjectRecord(rawProvider.models) ?? {}
    const modelIds = Object.keys(models)
    const providerModels: Record<string, OpenCodeModelView> = {}
    for (const modelId of modelIds) {
      const rawModel = asObjectRecord(models[modelId]) ?? {}
      providerModels[modelId] = {
        // OpenCode uses `provider.models.<model_id>` as the true model id.
        id: modelId,
        name:
          pickFirstString(rawModel, ["name"]) ??
          pickFirstString(rawModel, ["id"]) ??
          "",
        extraFieldCount: Object.keys(rawModel).filter(
          (key) => !knownModelKeys.has(key)
        ).length,
      }
    }
    const authEntry = asObjectRecord(authObject[providerId]) ?? {}
    const authKey = pickFirstString(authEntry, ["key"]) ?? ""
    providers[providerId] = {
      id: providerId,
      name: pickFirstString(rawProvider, ["name"]) ?? "",
      api: pickFirstString(rawProvider, ["api"]) ?? "",
      npm: pickFirstString(rawProvider, ["npm"]) ?? "",
      baseUrl: pickFirstString(options, ["baseURL", "baseUrl"]) ?? "",
      apiKey: pickFirstString(options, ["apiKey", "api_key"]) ?? authKey,
      modelCount: modelIds.length,
      modelIds,
      models: providerModels,
    }
  }

  return {
    model: pickFirstString(config, ["model"]) ?? "",
    smallModel:
      pickFirstString(config, ["small_model", "smallModel", "small-model"]) ??
      "",
    enabledProviders: Array.isArray(config.enabled_providers)
      ? config.enabled_providers
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    disabledProviders: Array.isArray(config.disabled_providers)
      ? config.disabled_providers
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
    providerIds,
    providers,
  }
}

export function patchOpenCodeConfigText(
  configText: string,
  mutator: (config: Record<string, unknown>) => void
): {
  configText: string
  recoveredFromInvalid: boolean
} {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.error
    ? {}
    : (JSON.parse(JSON.stringify(parseResult.config)) as Record<
        string,
        unknown
      >)
  mutator(config)
  return {
    configText:
      Object.keys(config).length === 0 ? "" : JSON.stringify(config, null, 2),
    recoveredFromInvalid: Boolean(parseResult.error),
  }
}

// Fill in `provider.<id>.npm` with the first option for any providers that
// lack it, so the displayed Select value matches what gets persisted to disk.
export function ensureOpenCodeProviderNpm(configText: string): string {
  if (!configText.trim()) return configText
  const parseResult = parseConfigJsonText(configText)
  if (parseResult.error) return configText
  const config = parseResult.config
  const providerRoot = asObjectRecord(config.provider)
  if (!providerRoot) return configText
  let mutated = false
  for (const providerId of Object.keys(providerRoot)) {
    const provider = asObjectRecord(providerRoot[providerId])
    if (!provider) continue
    const currentNpm =
      typeof provider.npm === "string" ? provider.npm.trim() : ""
    if (!currentNpm) {
      provider.npm = OPENCODE_PROVIDER_NPM_OPTIONS[0].value
      mutated = true
    }
  }
  if (!mutated) return configText
  return JSON.stringify(config, null, 2)
}

interface CodexTomlImportantValues {
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

interface CodexImportantValues {
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

const CODEX_DEFAULT_MODEL_PROVIDER = "veryagent"

const CODEX_AUTH_MODES = [
  "api_key",
  "chatgpt_subscription",
  "model_provider",
] as const
type CodexAuthMode = (typeof CODEX_AUTH_MODES)[number]

type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh"

const CODEX_REASONING_EFFORT_OPTIONS: ReadonlyArray<{
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

const CODEX_DEFAULT_REASONING_EFFORT: CodexReasoningEffort = "high"

export function normalizeCodexReasoningEffort(
  value: string
): CodexReasoningEffort | null {
  const normalized = value.trim().toLowerCase()
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh"
  ) {
    return normalized
  }
  return null
}

export function buildCodexProviderOptions(
  activeProvider: string,
  providerNames: string[]
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of [
    activeProvider,
    ...providerNames,
    CODEX_DEFAULT_MODEL_PROVIDER,
  ]) {
    const provider = raw.trim()
    if (!provider || seen.has(provider)) continue
    seen.add(provider)
    result.push(provider)
  }
  return result
}

export function parseTomlStringLiteral(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null

  if (text.startsWith('"')) {
    let escaped = false
    for (let i = 1; i < text.length; i += 1) {
      const ch = text[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === '"') {
        const literal = text.slice(0, i + 1)
        try {
          return JSON.parse(literal) as string
        } catch {
          return literal.slice(1, -1)
        }
      }
    }
    return null
  }

  if (text.startsWith("'")) {
    const end = text.indexOf("'", 1)
    if (end <= 0) return null
    return text.slice(1, end)
  }

  return null
}

export function parseTomlStringAssignment(
  rawLine: string
): { key: string; value: string } | null {
  const key = parseTomlAssignmentKey(rawLine)
  if (!key) return null
  const line = rawLine.trim()
  const equalsIndex = line.indexOf("=")
  const valueText = line.slice(equalsIndex + 1)
  const value = parseTomlStringLiteral(valueText)
  if (value === null) return null
  return { key, value: value.trim() }
}

export function parseTomlAssignmentKey(rawLine: string): string | null {
  const line = rawLine.trim()
  if (!line || line.startsWith("#")) return null
  const equalsIndex = line.indexOf("=")
  if (equalsIndex <= 0) return null
  const key = line.slice(0, equalsIndex).trim()
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) return null
  return key
}

export function parseTomlBooleanAssignment(
  rawLine: string
): { key: string; value: boolean } | null {
  const key = parseTomlAssignmentKey(rawLine)
  if (!key) return null
  const line = rawLine.trim()
  const equalsIndex = line.indexOf("=")
  const valueText = line.slice(equalsIndex + 1).trim()
  const boolMatch = valueText.match(/^(true|false)(?:\s+#.*)?$/)
  if (!boolMatch) return null
  return { key, value: boolMatch[1] === "true" }
}

export function extractCodexTomlImportantValues(
  configTomlText: string
): CodexTomlImportantValues {
  const providerBaseUrls: Record<string, string> = {}
  const providerSupportsWebsockets: Record<string, boolean> = {}
  const providerNames = new Set<string>()
  let model = ""
  let modelProvider = ""
  let modelReasoningEffort: CodexReasoningEffort =
    CODEX_DEFAULT_REASONING_EFFORT
  let featureResponsesWebsocketsV2 = false
  let featureSkills = false
  let serviceTierFast = false
  let currentProviderSection: string | null = null
  let inFeaturesSection = false

  for (const rawLine of configTomlText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const sectionMatch = line.match(
      /^\[\s*model_providers\.([A-Za-z0-9_-]+)\s*\]$/
    )
    if (sectionMatch) {
      currentProviderSection = sectionMatch[1]
      inFeaturesSection = false
      if (currentProviderSection.trim()) {
        providerNames.add(currentProviderSection.trim())
      }
      continue
    }
    if (line.match(/^\[\s*features\s*\]$/)) {
      inFeaturesSection = true
      currentProviderSection = null
      continue
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      currentProviderSection = null
      inFeaturesSection = false
      continue
    }

    const assignment = parseTomlStringAssignment(rawLine)
    if (assignment) {
      if (assignment.key === "model") {
        model = assignment.value
        continue
      }
      if (assignment.key === "model_provider") {
        modelProvider = assignment.value
        continue
      }
      if (assignment.key === "model_reasoning_effort") {
        modelReasoningEffort =
          normalizeCodexReasoningEffort(assignment.value) ??
          CODEX_DEFAULT_REASONING_EFFORT
        continue
      }
      if (
        !currentProviderSection &&
        !inFeaturesSection &&
        assignment.key === "service_tier"
      ) {
        serviceTierFast = assignment.value.toLowerCase() === "fast"
        continue
      }
    }

    const boolAssignment = parseTomlBooleanAssignment(rawLine)
    if (boolAssignment) {
      if (
        currentProviderSection &&
        boolAssignment.key === "supports_websockets"
      ) {
        providerSupportsWebsockets[currentProviderSection] =
          boolAssignment.value
        providerNames.add(currentProviderSection.trim())
        continue
      }
      if (
        inFeaturesSection &&
        boolAssignment.key === "responses_websockets_v2"
      ) {
        featureResponsesWebsocketsV2 = boolAssignment.value
        continue
      }
      if (inFeaturesSection && boolAssignment.key === "skills") {
        featureSkills = boolAssignment.value
        continue
      }
      const dottedProviderWebsocketMatch = boolAssignment.key.match(
        /^model_providers\.([A-Za-z0-9_-]+)\.supports_websockets$/
      )
      if (dottedProviderWebsocketMatch && dottedProviderWebsocketMatch[1]) {
        const providerName = dottedProviderWebsocketMatch[1].trim()
        providerNames.add(providerName)
        providerSupportsWebsockets[providerName] = boolAssignment.value
        continue
      }
      if (boolAssignment.key === "features.responses_websockets_v2") {
        featureResponsesWebsocketsV2 = boolAssignment.value
        continue
      }
      if (boolAssignment.key === "features.skills") {
        featureSkills = boolAssignment.value
        continue
      }
    }

    if (!assignment) continue

    const rawAssignmentKey = parseTomlAssignmentKey(rawLine)
    const dottedProviderMatch = rawAssignmentKey?.match(
      /^model_providers\.([A-Za-z0-9_-]+)\./
    )
    if (dottedProviderMatch && dottedProviderMatch[1]) {
      providerNames.add(dottedProviderMatch[1].trim())
    }
    if (
      currentProviderSection &&
      assignment.key === "base_url" &&
      assignment.value
    ) {
      providerBaseUrls[currentProviderSection] = assignment.value
      providerNames.add(currentProviderSection.trim())
      continue
    }
    const dottedMatch = assignment.key.match(
      /^model_providers\.([A-Za-z0-9_-]+)\.base_url$/
    )
    if (dottedMatch && assignment.value) {
      providerBaseUrls[dottedMatch[1]] = assignment.value
      providerNames.add(dottedMatch[1].trim())
    }
  }
  if (modelProvider.trim()) {
    providerNames.add(modelProvider.trim())
  }
  providerNames.add(CODEX_DEFAULT_MODEL_PROVIDER)
  for (const providerName of Object.keys(providerBaseUrls)) {
    if (providerName.trim()) {
      providerNames.add(providerName.trim())
    }
  }

  return {
    model,
    modelProvider,
    modelReasoningEffort,
    providerNames: Array.from(providerNames),
    providerBaseUrls,
    providerSupportsWebsockets,
    featureResponsesWebsocketsV2,
    featureSkills,
    serviceTierFast,
  }
}

export function parseCodexAuthJsonObject(authJsonText: string): {
  authObject: Record<string, unknown> | null
  error: string | null
} {
  const trimmed = authJsonText.trim()
  if (!trimmed) return { authObject: {}, error: null }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        authObject: null,
        error: acpText(
          "errors.authMustBeObject",
          "auth.json must be a JSON object"
        ),
      }
    }
    return { authObject: parsed as Record<string, unknown>, error: null }
  } catch (err) {
    const message = toErrorMessage(err)
    return {
      authObject: null,
      error: acpText(
        "errors.authInvalid",
        "auth.json format error: {message}",
        {
          message,
        }
      ),
    }
  }
}

export function parseCodexAuthJsonText(authJsonText: string): string | null {
  return parseCodexAuthJsonObject(authJsonText).error
}

export function inferCodexAuthMode(authJsonText: string): CodexAuthMode {
  const { authObject } = parseCodexAuthJsonObject(authJsonText)
  if (authObject) {
    // 官网订阅：auth_mode 为 chatgpt，或没有 OPENAI_API_KEY，或值为 null
    if (
      authObject.auth_mode === "chatgpt" ||
      !("OPENAI_API_KEY" in authObject) ||
      authObject.OPENAI_API_KEY === null
    ) {
      return "chatgpt_subscription"
    }
  }
  return "api_key"
}

export function hasCodexChatgptTokens(authJsonText: string): boolean {
  const { authObject } = parseCodexAuthJsonObject(authJsonText)
  if (!authObject) return false
  const tokens = authObject.tokens as Record<string, unknown> | undefined
  if (tokens && typeof tokens === "object") {
    return (
      typeof tokens.access_token === "string" && tokens.access_token.length > 0
    )
  }
  return false
}

export function extractCodexImportantValues(
  authJsonText: string,
  configTomlText: string
): CodexImportantValues {
  const parsedAuth = parseCodexAuthJsonObject(authJsonText)
  const authObject = parsedAuth.authObject ?? {}
  const toml = extractCodexTomlImportantValues(configTomlText)
  const hasExplicitProvider = Boolean(toml.modelProvider.trim())
  const activeProvider = hasExplicitProvider
    ? toml.modelProvider.trim()
    : CODEX_DEFAULT_MODEL_PROVIDER
  const providerBaseUrl = hasExplicitProvider
    ? (toml.providerBaseUrls[activeProvider] ?? "")
    : (toml.providerBaseUrls[CODEX_DEFAULT_MODEL_PROVIDER] ??
      toml.providerBaseUrls.openai ??
      "")
  const providerSupportsWebsockets =
    toml.providerSupportsWebsockets[activeProvider] ??
    (activeProvider === CODEX_DEFAULT_MODEL_PROVIDER
      ? toml.featureResponsesWebsocketsV2
      : false)
  return {
    apiBaseUrl: providerBaseUrl,
    apiKey:
      parsedAuth.error === null
        ? (pickFirstString(authObject, [
            "OPENAI_API_KEY",
            "OPENAI_API_TOKEN",
            "API_KEY",
          ]) ?? "")
        : null,
    model: toml.model,
    modelProvider: activeProvider,
    reasoningEffort: toml.modelReasoningEffort,
    providerOptions: buildCodexProviderOptions(
      activeProvider,
      toml.providerNames
    ),
    supportsWebsockets: providerSupportsWebsockets,
    skills: toml.featureSkills,
    serviceTierFast: toml.serviceTierFast,
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function findTomlRootEndIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\[.*\]$/.test(lines[i].trim())) return i
  }
  return lines.length
}

export function findTomlRootAssignmentIndex(lines: string[], key: string): number {
  const rootEnd = findTomlRootEndIndex(lines)
  for (let i = 0; i < rootEnd; i += 1) {
    const assignmentKey = parseTomlAssignmentKey(lines[i])
    if (assignmentKey === key) return i
  }
  return -1
}

export function preferredTomlRootInsertionIndex(lines: string[], key: string): number {
  if (key === "model") {
    const providerIndex = findTomlRootAssignmentIndex(lines, "model_provider")
    return providerIndex >= 0 ? providerIndex : 0
  }
  if (key === "model_reasoning_effort") {
    const modelIndex = findTomlRootAssignmentIndex(lines, "model")
    return modelIndex >= 0 ? modelIndex + 1 : 0
  }
  let insertAt = findTomlRootEndIndex(lines)
  while (insertAt > 0 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1
  }
  return insertAt
}

export function updateTomlRootStringKey(
  configTomlText: string,
  key: string,
  value: string
): string {
  const lineText = `${key} = ${JSON.stringify(value)}`
  const lines = configTomlText.split(/\r?\n/)
  const assignmentIndex = findTomlRootAssignmentIndex(lines, key)

  const nextValue = value.trim()
  if (!nextValue) {
    if (assignmentIndex >= 0) {
      lines.splice(assignmentIndex, 1)
    }
    return lines.join("\n").trim()
  }

  const insertAt = preferredTomlRootInsertionIndex(lines, key)
  if (assignmentIndex >= 0) {
    lines[assignmentIndex] = lineText
  } else {
    lines.splice(Math.max(0, insertAt), 0, lineText)
  }
  return lines.join("\n").trim()
}

export function updateTomlRootBooleanKey(
  configTomlText: string,
  key: string,
  value: boolean
): string {
  const lineText = `${key} = ${value ? "true" : "false"}`
  const lines = configTomlText.split(/\r?\n/)
  const assignmentIndex = findTomlRootAssignmentIndex(lines, key)
  if (assignmentIndex >= 0) {
    lines[assignmentIndex] = lineText
  } else {
    lines.splice(0, 0, lineText)
  }
  return lines.join("\n").trim()
}

export function findTomlSectionRange(
  lines: string[],
  sectionName: string
): { start: number; end: number } | null {
  const headerText = `[${sectionName}]`
  let sectionStart = -1
  let sectionEnd = lines.length
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (sectionStart < 0) {
      if (trimmed === headerText) {
        sectionStart = i
      }
      continue
    }
    if (/^\[.*\]$/.test(trimmed)) {
      sectionEnd = i
      break
    }
  }
  if (sectionStart < 0) return null
  return { start: sectionStart, end: sectionEnd }
}

export function removeTomlSection(
  configTomlText: string,
  sectionName: string
): string {
  const lines = configTomlText.split(/\r?\n/)
  const range = findTomlSectionRange(lines, sectionName)
  if (!range) return configTomlText
  // Remove blank line before section header if present
  const removeStart =
    range.start > 0 && lines[range.start - 1].trim() === ""
      ? range.start - 1
      : range.start
  lines.splice(removeStart, range.end - removeStart)
  return lines.join("\n").trim()
}

export function upsertTomlSectionBooleanKey(
  configTomlText: string,
  sectionName: string,
  key: string,
  value: boolean | null
): string {
  const lines = configTomlText.split(/\r?\n/)
  const section = findTomlSectionRange(lines, sectionName)

  if (section) {
    let assignmentIndex = -1
    for (let i = section.start + 1; i < section.end; i += 1) {
      const assignmentKey = parseTomlAssignmentKey(lines[i])
      if (assignmentKey === key) {
        assignmentIndex = i
        break
      }
    }

    if (value === null) {
      if (assignmentIndex >= 0) {
        lines.splice(assignmentIndex, 1)
      }
      const refreshedSection = findTomlSectionRange(lines, sectionName)
      if (refreshedSection) {
        const hasEntries = lines
          .slice(refreshedSection.start + 1, refreshedSection.end)
          .some((rawLine) => {
            const line = rawLine.trim()
            return line !== "" && !line.startsWith("#")
          })
        if (!hasEntries) {
          const before = lines.slice(0, refreshedSection.start)
          const after = lines.slice(refreshedSection.end)
          while (before.length > 0 && before[before.length - 1].trim() === "") {
            before.pop()
          }
          while (after.length > 0 && after[0].trim() === "") {
            after.shift()
          }
          const merged =
            before.length > 0 && after.length > 0
              ? [...before, "", ...after]
              : [...before, ...after]
          return merged.join("\n").trim()
        }
      }
      return lines.join("\n").trim()
    }

    const lineText = `${key} = ${value ? "true" : "false"}`
    if (assignmentIndex >= 0) {
      lines[assignmentIndex] = lineText
    } else {
      let insertAt = section.end
      for (let i = section.end - 1; i > section.start; i -= 1) {
        if (lines[i].trim() !== "") {
          insertAt = i + 1
          break
        }
      }
      lines.splice(insertAt, 0, lineText)
    }
    return lines.join("\n").trim()
  }

  if (value === null) {
    return configTomlText.trim()
  }

  const lineText = `${key} = ${value ? "true" : "false"}`
  const insertAt = findTomlRootEndIndex(lines)
  const prefixBlank =
    insertAt > 0 && lines[insertAt - 1].trim() !== "" ? [""] : []
  const suffixBlank =
    insertAt < lines.length && lines[insertAt].trim() !== "" ? [""] : []
  lines.splice(
    insertAt,
    0,
    ...prefixBlank,
    `[${sectionName}]`,
    lineText,
    ...suffixBlank
  )
  return lines.join("\n").trim()
}

/** Codex appends `/chat/completions` or `/responses` itself — force `/v1`. */
export function normalizeOpenAiCompatibleBaseUrl(apiBaseUrl: string): string {
  let base = apiBaseUrl.trim().replace(/\/+$/, "")
  if (!base) return ""
  for (const suffix of [
    "/chat/completions",
    "/completions",
    "/responses",
    "/models",
  ]) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length).replace(/\/+$/, "")
      break
    }
  }
  if (base.endsWith("/v1")) return base
  return `${base}/v1`
}

export function patchCodexProviderBaseUrl(
  configTomlText: string,
  provider: string,
  apiBaseUrl: string
): string {
  const trimmedProvider = provider.trim()
  if (!trimmedProvider) return configTomlText.trim()

  const nextApiBaseUrl = apiBaseUrl.trim()
    ? normalizeOpenAiCompatibleBaseUrl(apiBaseUrl)
    : ""
  const lines = configTomlText.split(/\r?\n/)
  const sectionPattern = new RegExp(
    `^\\[\\s*model_providers\\.${escapeRegExp(trimmedProvider)}\\s*\\]$`
  )
  let sectionStart = -1
  let sectionEnd = lines.length
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (sectionStart < 0) {
      if (sectionPattern.test(trimmed)) {
        sectionStart = i
      }
      continue
    }
    if (/^\[.*\]$/.test(trimmed)) {
      sectionEnd = i
      break
    }
  }

  if (sectionStart >= 0) {
    let baseUrlIndex = -1
    for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
      const assignment = parseTomlStringAssignment(lines[i])
      if (!assignment || assignment.key !== "base_url") continue
      baseUrlIndex = i
      break
    }
    if (!nextApiBaseUrl) {
      if (baseUrlIndex >= 0) {
        lines.splice(baseUrlIndex, 1)
      }
      return lines.join("\n").trim()
    }

    const lineText = `base_url = ${JSON.stringify(nextApiBaseUrl)}`
    if (baseUrlIndex >= 0) {
      lines[baseUrlIndex] = lineText
    } else {
      lines.splice(sectionEnd, 0, lineText)
    }
    return lines.join("\n").trim()
  }

  if (!nextApiBaseUrl) return configTomlText.trim()

  const appended = configTomlText.trimEnd()
  const sectionText = `[model_providers.${trimmedProvider}]\nbase_url = ${JSON.stringify(nextApiBaseUrl)}`
  if (!appended) return sectionText
  return `${appended}\n\n${sectionText}`.trim()
}

export function patchCodexProviderField(
  configTomlText: string,
  provider: string,
  key: string,
  lineText: string
): string {
  const trimmedProvider = provider.trim()
  if (!trimmedProvider) return configTomlText.trim()

  const lines = configTomlText.split(/\r?\n/)
  const sectionPattern = new RegExp(
    `^\\[\\s*model_providers\\.${escapeRegExp(trimmedProvider)}\\s*\\]$`
  )
  let sectionStart = -1
  let sectionEnd = lines.length
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (sectionStart < 0) {
      if (sectionPattern.test(trimmed)) {
        sectionStart = i
      }
      continue
    }
    if (/^\[.*\]$/.test(trimmed)) {
      sectionEnd = i
      break
    }
  }

  if (sectionStart >= 0) {
    let fieldIndex = -1
    for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
      const assignmentKey = parseTomlAssignmentKey(lines[i])
      if (assignmentKey !== key) continue
      fieldIndex = i
      break
    }
    if (fieldIndex >= 0) {
      lines[fieldIndex] = lineText
    } else {
      let insertAt = sectionEnd
      while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === "") {
        insertAt -= 1
      }
      lines.splice(insertAt, 0, lineText)
    }
    return lines.join("\n").trim()
  }

  const appended = configTomlText.trimEnd()
  const sectionText = `[model_providers.${trimmedProvider}]\n${lineText}`
  if (!appended) return sectionText
  return `${appended}\n\n${sectionText}`.trim()
}

export function ensureCodexProviderDefaults(
  configTomlText: string,
  provider: string
): string {
  if (provider.trim() !== CODEX_DEFAULT_MODEL_PROVIDER) {
    return configTomlText
  }
  let next = configTomlText
  const current = extractCodexTomlImportantValues(next)
  const veryagentBaseUrl =
    current.providerBaseUrls[CODEX_DEFAULT_MODEL_PROVIDER] ?? ""
  next = patchCodexProviderField(
    next,
    CODEX_DEFAULT_MODEL_PROVIDER,
    "base_url",
    `base_url = ${JSON.stringify(veryagentBaseUrl)}`
  )
  next = patchCodexProviderField(
    next,
    CODEX_DEFAULT_MODEL_PROVIDER,
    "name",
    'name = "veryagent"'
  )
  next = patchCodexProviderField(
    next,
    CODEX_DEFAULT_MODEL_PROVIDER,
    "wire_api",
    // Current Codex rejects `chat` at config load; only `responses` is valid.
    'wire_api = "responses"'
  )
  next = patchCodexProviderField(
    next,
    CODEX_DEFAULT_MODEL_PROVIDER,
    "requires_openai_auth",
    "requires_openai_auth = true"
  )
  return next
}

export function patchCodexAuthJsonText(
  authJsonText: string,
  patch: { apiKey?: string; authMode?: "chatgpt" | null }
): {
  authJsonText: string
  recoveredFromInvalid: boolean
} {
  const parsed = parseCodexAuthJsonObject(authJsonText)
  const authObject =
    parsed.error === null && parsed.authObject ? { ...parsed.authObject } : {}
  if (typeof patch.apiKey === "string") {
    const apiKey = patch.apiKey.trim()
    if (apiKey) {
      authObject.OPENAI_API_KEY = apiKey
      delete authObject.API_KEY
    } else {
      delete authObject.OPENAI_API_KEY
      delete authObject.OPENAI_API_TOKEN
      delete authObject.API_KEY
    }
  }
  if ("authMode" in patch) {
    if (patch.authMode === "chatgpt") {
      authObject.auth_mode = "chatgpt"
      authObject.OPENAI_API_KEY = null
    } else {
      delete authObject.auth_mode
    }
  }
  return {
    authJsonText:
      Object.keys(authObject).length === 0
        ? ""
        : JSON.stringify(authObject, null, 2),
    recoveredFromInvalid: Boolean(parsed.error),
  }
}

export function patchCodexConfigTomlText(
  configTomlText: string,
  patch: {
    apiBaseUrl?: string
    model?: string
    modelProvider?: string
    modelReasoningEffort?: string
    supportsWebsockets?: boolean
    skills?: boolean
    serviceTierFast?: boolean
  }
): string {
  let nextTomlText = configTomlText
  if (typeof patch.modelProvider === "string") {
    const modelProvider = patch.modelProvider.trim()
    if (modelProvider) {
      nextTomlText = updateTomlRootStringKey(
        nextTomlText,
        "model_provider",
        modelProvider
      )
      nextTomlText = ensureCodexProviderDefaults(nextTomlText, modelProvider)
    }
  }
  if (typeof patch.model === "string") {
    nextTomlText = updateTomlRootStringKey(nextTomlText, "model", patch.model)
  }
  if (typeof patch.modelReasoningEffort === "string") {
    const reasoningEffort =
      normalizeCodexReasoningEffort(patch.modelReasoningEffort) ??
      CODEX_DEFAULT_REASONING_EFFORT
    nextTomlText = updateTomlRootStringKey(
      nextTomlText,
      "model_reasoning_effort",
      reasoningEffort
    )
  }
  if (typeof patch.apiBaseUrl === "string") {
    const tomlValues = extractCodexTomlImportantValues(nextTomlText)
    const modelProvider =
      patch.modelProvider?.trim() ||
      tomlValues.modelProvider.trim() ||
      CODEX_DEFAULT_MODEL_PROVIDER
    if (!tomlValues.modelProvider.trim() && patch.apiBaseUrl.trim()) {
      nextTomlText = updateTomlRootStringKey(
        nextTomlText,
        "model_provider",
        modelProvider
      )
    }
    nextTomlText = patchCodexProviderBaseUrl(
      nextTomlText,
      modelProvider,
      patch.apiBaseUrl
    )
    nextTomlText = ensureCodexProviderDefaults(nextTomlText, modelProvider)
  }
  if (typeof patch.supportsWebsockets === "boolean") {
    const tomlValues = extractCodexTomlImportantValues(nextTomlText)
    const modelProvider =
      patch.modelProvider?.trim() ||
      tomlValues.modelProvider.trim() ||
      CODEX_DEFAULT_MODEL_PROVIDER
    if (!tomlValues.modelProvider.trim()) {
      nextTomlText = updateTomlRootStringKey(
        nextTomlText,
        "model_provider",
        modelProvider
      )
    }
    nextTomlText = patchCodexProviderField(
      nextTomlText,
      modelProvider,
      "supports_websockets",
      `supports_websockets = ${patch.supportsWebsockets ? "true" : "false"}`
    )
    nextTomlText = ensureCodexProviderDefaults(nextTomlText, modelProvider)
  }
  const normalizedTomlValues = extractCodexTomlImportantValues(nextTomlText)
  if (normalizedTomlValues.model.trim()) {
    nextTomlText = updateTomlRootStringKey(
      nextTomlText,
      "model",
      normalizedTomlValues.model
    )
  }
  nextTomlText = updateTomlRootStringKey(
    nextTomlText,
    "model_reasoning_effort",
    normalizedTomlValues.modelReasoningEffort
  )
  const activeProvider =
    normalizedTomlValues.modelProvider.trim() || CODEX_DEFAULT_MODEL_PROVIDER
  const shouldEnableFeature = Boolean(
    normalizedTomlValues.providerSupportsWebsockets[activeProvider]
  )
  nextTomlText = upsertTomlSectionBooleanKey(
    nextTomlText,
    "features",
    "responses_websockets_v2",
    shouldEnableFeature ? true : null
  )
  if (typeof patch.skills === "boolean") {
    nextTomlText = upsertTomlSectionBooleanKey(
      nextTomlText,
      "features",
      "skills",
      patch.skills ? true : null
    )
  }
  if (typeof patch.serviceTierFast === "boolean") {
    nextTomlText = updateTomlRootStringKey(
      nextTomlText,
      "service_tier",
      patch.serviceTierFast ? "fast" : ""
    )
  }
  nextTomlText = updateTomlRootBooleanKey(
    nextTomlText,
    "disable_response_storage",
    true
  )
  const trimmed = nextTomlText.trim()
  return trimmed ? `${trimmed}\n` : ""
}

/**
 * Parse the normalized Hermes projection carried in `AcpAgentInfo.config_json`
 * (produced by the backend from ~/.hermes/.env + config.yaml). Falls back to a
 * sensible default provider when nothing is configured yet.
 */
export function parseHermesConfig(configText: string): HermesDraftValues {
  let parsed: HermesLocalConfig = {}
  if (configText.trim()) {
    try {
      parsed = JSON.parse(configText) as HermesLocalConfig
    } catch {
      parsed = {}
    }
  }
  return {
    provider: parsed.provider ?? "openrouter",
    model: parsed.model ?? "",
    baseUrl: parsed.baseUrl ?? "",
    apiKey: parsed.apiKey ?? "",
    hermesHome: parsed.hermesHome ?? "",
    setupCommand: parsed.setupCommand ?? "",
    modelCommand: parsed.modelCommand ?? "",
  }
}

export function buildAgentDraft(agent: AcpAgentInfo): AgentDraft {
  const configText =
    typeof agent.config_json === "string" && agent.config_json.trim()
      ? agent.config_json
      : ""
  const hermesValues =
    agent.agent_type === "hermes" ? parseHermesConfig(configText) : null
  const openCodeAuthJsonText = agent.opencode_auth_json ?? ""
  const codexAuthJsonText = agent.codex_auth_json ?? ""
  const codexConfigTomlText =
    agent.agent_type === "codex"
      ? updateTomlRootBooleanKey(
          agent.codex_config_toml ?? "",
          "disable_response_storage",
          true
        )
      : (agent.codex_config_toml ?? "")
  const important = extractImportantConfigValues(
    agent.agent_type,
    agent.env,
    configText
  )
  const geminiImportant = extractGeminiImportantValues(agent.env, configText)
  const openClawImportant = extractOpenClawImportantValues(
    agent.env,
    configText
  )
  const codexImportant = extractCodexImportantValues(
    codexAuthJsonText,
    codexConfigTomlText
  )
  const openCodeImportant = extractOpenCodeConfigValues(
    configText,
    openCodeAuthJsonText
  )
  const clineImportant = extractClineImportantValues(configText)
  const codexAuthMode: CodexAuthMode =
    agent.agent_type === "codex" && agent.model_provider_id != null
      ? "model_provider"
      : agent.agent_type === "codex"
        ? inferCodexAuthMode(codexAuthJsonText)
        : "api_key"
  const rawEnvText = envMapToText(agent.env)
  // When codex is in official subscription mode, clean up API keys/URLs from env
  const envText =
    agent.agent_type === "codex" && codexAuthMode === "chatgpt_subscription"
      ? patchEnvText(rawEnvText, {
          OPENAI_API_KEY: "",
          OPENAI_BASE_URL: "",
        })
      : rawEnvText
  return {
    enabled: agent.enabled,
    envText,
    configText,
    apiBaseUrl:
      agent.agent_type === "hermes"
        ? (hermesValues?.baseUrl ?? "")
        : agent.agent_type === "codex"
          ? codexImportant.apiBaseUrl
          : agent.agent_type === "gemini"
            ? geminiImportant.apiBaseUrl
            : important.apiBaseUrl,
    apiKey:
      agent.agent_type === "hermes"
        ? (hermesValues?.apiKey ?? "")
        : agent.agent_type === "codex"
          ? (codexImportant.apiKey ?? "")
          : agent.agent_type === "gemini"
            ? geminiImportant.geminiApiKey || geminiImportant.googleApiKey
            : important.apiKey,
    model:
      agent.agent_type === "hermes"
        ? (hermesValues?.model ?? "")
        : agent.agent_type === "codex"
          ? codexImportant.model
          : agent.agent_type === "gemini"
            ? geminiImportant.model
            : agent.agent_type === "open_code"
              ? openCodeImportant.model
              : important.model,
    claudeAuthMode:
      agent.agent_type === "claude_code" && agent.model_provider_id != null
        ? "model_provider"
        : agent.agent_type === "claude_code" &&
            (important.apiBaseUrl || important.apiKey)
          ? "custom"
          : "official_subscription",
    modelProviderId: agent.model_provider_id ?? null,
    geminiAuthMode:
      agent.agent_type === "gemini" && agent.model_provider_id != null
        ? "model_provider"
        : geminiImportant.authMode,
    geminiApiKey: geminiImportant.geminiApiKey,
    googleApiKey: geminiImportant.googleApiKey,
    googleCloudProject: geminiImportant.googleCloudProject,
    googleCloudLocation: geminiImportant.googleCloudLocation,
    googleApplicationCredentials: geminiImportant.googleApplicationCredentials,
    codexAuthMode,
    codexModelProvider: codexImportant.modelProvider,
    codexProviderOptions: codexImportant.providerOptions,
    codexReasoningEffort: codexImportant.reasoningEffort,
    codexSupportsWebsockets: codexImportant.supportsWebsockets,
    codexSkills: codexImportant.skills,
    codexServiceTierFast: codexImportant.serviceTierFast,
    claudeMainModel: important.claudeMainModel,
    claudeReasoningModel: important.claudeReasoningModel,
    claudeDefaultHaikuModel: important.claudeDefaultHaikuModel,
    claudeDefaultSonnetModel: important.claudeDefaultSonnetModel,
    claudeDefaultOpusModel: important.claudeDefaultOpusModel,
    claudeCustomModelOption: important.claudeCustomModelOption,
    claudeCustomModelOptionName: important.claudeCustomModelOptionName,
    claudeCustomModelOptionDescription:
      important.claudeCustomModelOptionDescription,
    claudeEffortLevel: important.claudeEffortLevel,
    codexAuthJsonText,
    codexConfigTomlText,
    openCodeAuthJsonText,
    hermesAuthMode:
      agent.agent_type === "hermes" && agent.model_provider_id != null
        ? ("model_provider" as HermesAuthMode)
        : "native",
    openClawAuthMode:
      agent.agent_type === "open_claw" && agent.model_provider_id != null
        ? ("model_provider" as OpenClawAuthMode)
        : "gateway",
    clineAuthMode:
      agent.agent_type === "cline" && agent.model_provider_id != null
        ? ("model_provider" as ClineAuthMode)
        : "native",
    openCodeAuthMode:
      agent.agent_type === "open_code" && agent.model_provider_id != null
        ? ("model_provider" as OpenCodeAuthMode)
        : "native",
    piAuthMode:
      agent.agent_type === "pi" && agent.model_provider_id != null
        ? ("model_provider" as PiAuthMode)
        : "native",
    codeBuddyAuthMode:
      agent.agent_type === "code_buddy" && agent.model_provider_id != null
        ? ("model_provider" as CodeBuddyAuthMode)
        : "native",
    openClawGatewayUrl: openClawImportant.gatewayUrl,
    openClawGatewayToken: openClawImportant.gatewayToken,
    openClawSessionKey: openClawImportant.sessionKey,
    clineProvider: clineImportant.provider,
    clineApiKey: clineImportant.apiKey,
    clineModel: clineImportant.model,
    clineBaseUrl: clineImportant.baseUrl,
    hermesProvider: hermesValues?.provider ?? "openrouter",
    hermesConfigYaml: agent.hermes_config_yaml ?? "",
    hermesHome: hermesValues?.hermesHome ?? "",
    hermesSetupCommand: hermesValues?.setupCommand ?? "",
    hermesModelCommand: hermesValues?.modelCommand ?? "",
  }
}

export function compareVersion(a: string, b: string): number {
  const toParts = (value: string): number[] => {
    const normalized = value.trim().replace(/^[^\d]*/, "")
    return normalized.split(".").map((part) => Number.parseInt(part, 10) || 0)
  }
  const left = toParts(a)
  const right = toParts(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const lv = left[i] ?? 0
    const rv = right[i] ?? 0
    if (lv !== rv) return lv > rv ? 1 : -1
  }
  return 0
}

export function hasComparableVersion(
  value: string | null | undefined
): value is string {
  return Boolean(value && /\d/.test(value) && value.includes("."))
}

// Mirror of the backend `sanitize_custom_version`: a custom install version
// tolerates a leading `v`, must start with a digit, must be dotted (e.g.
// `1.2.3`), and may only contain `[0-9A-Za-z.-+]` (semver pre-release/build +
// calendar versions). Rejects npm dist-tags like `latest`, bare majors like
// `2`, and anything with spaces / `@`.
export function isValidCustomVersion(value: string): boolean {
  const normalized = value.trim().replace(/^[vV]/, "")
  return /^[0-9][0-9A-Za-z.\-+]*$/.test(normalized) && normalized.includes(".")
}

// `uvReady` reports whether the uv runtime (uvx) is installed — only meaningful
// for uvx agents (Hermes). Derived from the uv preflight check by the caller.
// uvx agents need uv installed before their package can be prepared, so when
// uv isn't ready every managed install/upgrade action is surfaced disabled and
// the user is pointed at the separate "Install uv" preflight action.

export function patchEnvByImportantKey(
  agentType: AgentType,
  envText: string,
  key: ImportantConfigKey,
  value: string
): string {
  const keys = importantEnvKeysByAgent(agentType)
  if (key === "apiBaseUrl") {
    return patchEnvText(envText, { [keys.apiBaseUrl[0]]: value })
  }
  if (key === "apiKey") {
    return patchEnvText(envText, { [keys.apiKey[0]]: value })
  }
  if (key === "model") {
    return patchEnvText(envText, { [keys.model[0]]: value })
  }
  return patchEnvText(envText, { [CLAUDE_MODEL_ENV_KEYS[key]]: value })
}
export function applyImportantFieldToDraft(
  draft: AgentDraft,
  key: ImportantConfigKey,
  value: string
): AgentDraft {
  if (key === "apiBaseUrl") return { ...draft, apiBaseUrl: value }
  if (key === "apiKey") return { ...draft, apiKey: value }
  if (key === "model") return { ...draft, model: value }
  if (key === "claudeMainModel") return { ...draft, claudeMainModel: value }
  if (key === "claudeReasoningModel") {
    return { ...draft, claudeReasoningModel: value }
  }
  if (key === "claudeDefaultHaikuModel") {
    return { ...draft, claudeDefaultHaikuModel: value }
  }
  if (key === "claudeDefaultSonnetModel") {
    return { ...draft, claudeDefaultSonnetModel: value }
  }
  if (key === "claudeDefaultOpusModel") {
    return { ...draft, claudeDefaultOpusModel: value }
  }
  if (key === "claudeCustomModelOption") {
    return { ...draft, claudeCustomModelOption: value }
  }
  if (key === "claudeCustomModelOptionName") {
    return { ...draft, claudeCustomModelOptionName: value }
  }
  return { ...draft, claudeCustomModelOptionDescription: value }
}

export function buildImportantPatchFromDraft(draft: AgentDraft): ImportantDraftPatch {
  return {
    apiBaseUrl: draft.apiBaseUrl,
    apiKey: draft.apiKey,
    model: draft.model,
    claudeMainModel: draft.claudeMainModel,
    claudeReasoningModel: draft.claudeReasoningModel,
    claudeDefaultHaikuModel: draft.claudeDefaultHaikuModel,
    claudeDefaultSonnetModel: draft.claudeDefaultSonnetModel,
    claudeDefaultOpusModel: draft.claudeDefaultOpusModel,
    claudeCustomModelOption: draft.claudeCustomModelOption,
    claudeCustomModelOptionName: draft.claudeCustomModelOptionName,
    claudeCustomModelOptionDescription:
      draft.claudeCustomModelOptionDescription,
  }
}
