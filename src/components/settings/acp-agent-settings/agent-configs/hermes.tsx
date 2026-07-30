// @ts-nocheck
"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import { Reorder, useDragControls } from "motion/react"
import { useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Minus,
  PackagePlus,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Wrench,
} from "lucide-react"
import { isDesktop, openUrl } from "@/lib/platform"
import { getActiveRemoteConnectionId } from "@/lib/transport"
import { toast } from "sonner"
import { AgentIcon } from "@/components/agent-icon"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox"
import { cn, copyTextToClipboard, randomUUID } from "@/lib/utils"
import {
  acpClearBinaryCache,
  acpDetectAgentLocalVersion,
  acpDownloadAgentBinary,
  acpInstallUvTool,
  acpGetAgentStatus,
  acpListAgents,
  acpPreflight,
  acpPrepareNpxAgent,
  acpReorderAgents,
  acpUninstallAgent,
  acpUpdateAgentConfig,
  acpUpdateAgentEnv,
  acpUpdateHermesConfig,
  acpUpdateKimiCodeConfig,
  acpFetchKimiModels,
  acpRevealHermesHome,
  acpOpenHermesSetupTerminal,
  acpDiscoverOpenClawGateway,
  acpEnsureOpenClawGateway,
  codexPollDeviceCode,
  codexRequestDeviceCode,
  fetchModelProviderModels,
  listModelProviders,
  opencodeProviderCatalog,
} from "@/lib/api"
import type {
  AcpAgentInfo,
  AgentType,
  CheckStatus,
  FixAction,
  HermesLocalConfig,
  ModelProviderInfo,
  OpenClawGatewayDiscovery,
  OpenCodeCatalogProvider,
  PreflightResult,
  ProviderModelItem,
} from "@/lib/types"
import { HERMES_PROVIDERS } from "@/lib/types"
import {
  buildAgentReadiness,
  isReadinessPilotAgent,
  readinessToneClass,
  type AgentReadiness,
  type AgentReadinessKind,
} from "@/lib/agent-readiness"
import {
  OpenCodeConnectDialog,
  OpenCodeCustomProviderDialog,
} from "@/components/settings/opencode-connect-dialog"
import {
  buildConnectedModelOptions,
  buildConnectedProviders,
  disconnectProvider,
  formatContextWindow,
  modelReferencesProvider,
  setProviderApiKey,
  setProviderEnabled,
  type OpenCodeModelOptionGroup,
} from "@/lib/opencode-connect"
import { toErrorMessage } from "@/lib/app-error"
import { getInstallErrorHintKey } from "@/lib/agent-install-error"
import { useAgentInstallStream } from "@/hooks/use-agent-install-stream"
import { OpencodePluginsModal } from "./opencode-plugins-modal"
import { CodeBuddyConfigPanel } from "./codebuddy-config-panel"
import { PiConfigPanel } from "./pi-config-panel"
// @ts-nocheck
function parseHermesConfig(configText: string): HermesDraftValues {
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

function buildAgentDraft(agent: AcpAgentInfo): AgentDraft {
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

function compareVersion(a: string, b: string): number {
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

function hasComparableVersion(
  value: string | null | undefined
): value is string {
  return Boolean(value && /\d/.test(value) && value.includes("."))
}

// Mirror of the backend `sanitize_custom_version`: a custom install version
// tolerates a leading `v`, must start with a digit, must be dotted (e.g.
// `1.2.3`), and may only contain `[0-9A-Za-z.-+]` (semver pre-release/build +
// calendar versions). Rejects npm dist-tags like `latest`, bare majors like
// `2`, and anything with spaces / `@`.
function isValidCustomVersion(value: string): boolean {
  const normalized = value.trim().replace(/^[vV]/, "")
  return /^[0-9][0-9A-Za-z.\-+]*$/.test(normalized) && normalized.includes(".")
}

// `uvReady` reports whether the uv runtime (uvx) is installed — only meaningful
// for uvx agents (Hermes). Derived from the uv preflight check by the caller.
// uvx agents need uv installed before their package can be prepared, so when
// uv isn't ready every managed install/upgrade action is surfaced disabled and
// the user is pointed at the separate "Install uv" preflight action.