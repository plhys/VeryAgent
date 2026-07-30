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
export function patchImportantConfigText(
  agentType: AgentType,
  configText: string,
  patch: ImportantDraftPatch
): {
  configText: string
  recoveredFromInvalid: boolean
} {
  const parseResult = parseConfigJsonText(configText)
  const config = parseResult.error ? {} : { ...parseResult.config }

  const assignOrRemove = (key: string, value: string | undefined) => {
    const trimmed = value?.trim() ?? ""
    if (!trimmed) {
      delete config[key]
      return
    }
    config[key] = trimmed
  }

  if (agentType === "claude_code") {
    // Claude Code: write apiBaseUrl/apiKey into config.env, not root
    const env =
      typeof config.env === "object" && config.env && !Array.isArray(config.env)
        ? { ...(config.env as Record<string, unknown>) }
        : {}
    const assignEnv = (key: string, value: string | undefined) => {
      const trimmed = value?.trim() ?? ""
      if (!trimmed) {
        delete env[key]
        return
      }
      env[key] = trimmed
    }
    // Remove root-level apiBaseUrl/apiKey if present (legacy cleanup)
    delete config.apiBaseUrl
    delete config.apiKey
    assignEnv("ANTHROPIC_BASE_URL", patch.apiBaseUrl)
    assignEnv("ANTHROPIC_AUTH_TOKEN", patch.apiKey)

    assignEnv(CLAUDE_MODEL_ENV_KEYS.claudeMainModel, patch.claudeMainModel)
    assignEnv(
      CLAUDE_MODEL_ENV_KEYS.claudeReasoningModel,
      patch.claudeReasoningModel
    )
    assignEnv(
      CLAUDE_MODEL_ENV_KEYS.claudeDefaultHaikuModel,
      patch.claudeDefaultHaikuModel
    )
    assignEnv(
      CLAUDE_MODEL_ENV_KEYS.claudeDefaultSonnetModel,
      patch.claudeDefaultSonnetModel
    )
    assignEnv(
      CLAUDE_MODEL_ENV_KEYS.claudeDefaultOpusModel,
      patch.claudeDefaultOpusModel
    )
    assignEnv(
      CLAUDE_MODEL_ENV_KEYS.claudeCustomModelOption,
      patch.claudeCustomModelOption
    )
    assignEnv(
      CLAUDE_MODEL_ENV_KEYS.claudeCustomModelOptionName,
      patch.claudeCustomModelOptionName
    )
    assignEnv(
      CLAUDE_MODEL_ENV_KEYS.claudeCustomModelOptionDescription,
      patch.claudeCustomModelOptionDescription
    )

    if (Object.keys(env).length === 0) {
      delete config.env
    } else {
      config.env = env
    }
  } else {
    assignOrRemove("apiBaseUrl", patch.apiBaseUrl)
    assignOrRemove("apiKey", patch.apiKey)
    assignOrRemove("model", patch.model)
  }

  return {
    configText:
      Object.keys(config).length === 0 ? "" : JSON.stringify(config, null, 2),
    recoveredFromInvalid: Boolean(parseResult.error),
  }
}

/**
 * Make a Claude agent's native config provider-authoritative. When a provider
 * was bound in an earlier session, the on-disk config loaded into the draft can
 * still carry stale model keys (e.g. a leftover ANTHROPIC_CUSTOM_MODEL_OPTION)
 * that no longer match the provider — `handleModelProviderSelect` only rewrites
 * configText when the dropdown changes, not on reload. A config-management save
 * would otherwise persist that stale text back over the backend bind cascade, so
 * re-derive the provider-controlled keys here (empty => cleared by `assignEnv`)
 * before saving. Unrelated config/env keys are preserved.
 */
export function applyClaudeProviderToConfigText(
  configText: string,
  provider: Pick<ModelProviderInfo, "api_url" | "api_key" | "model">
): string {
  const model = provider.model ?? ""
  return patchImportantConfigText("claude_code", configText, {
    apiBaseUrl: provider.api_url,
    apiKey: provider.api_key,
    claudeMainModel: model,
  }).configText
}

/**
 * Decide the config text to persist for a config-management save. For a bound
 * Claude agent with VALID config JSON, rewrite the provider-controlled keys to be
 * provider-authoritative (see {@link applyClaudeProviderToConfigText}). Anything
 * else — non-Claude, unbound, or INVALID JSON — passes through unchanged. The
 * invalid-JSON passthrough is important: persistConfig must still surface the
 * parse error, otherwise patchImportantConfigText would silently recover the bad
 * text as `{}` and persist provider-derived config over the user's broken edits.
 */
export function configTextForClaudeSave(
  configText: string,
  agentType: AgentType,
  modelProviderId: number | null,
  provider: Pick<ModelProviderInfo, "api_url" | "api_key" | "model"> | undefined
): string {
  if (
    agentType === "claude_code" &&
    modelProviderId != null &&
    provider &&
    !parseConfigJsonText(configText).error
  ) {
    return applyClaudeProviderToConfigText(configText, provider)
  }
  return configText
}

function patchEnvByImportantKey(
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

function applyImportantFieldToDraft(
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

function buildImportantPatchFromDraft(draft: AgentDraft): ImportantDraftPatch {
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

interface HermesDraftValues {
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  hermesHome: string
  setupCommand: string
  modelCommand: string
}

/**
 * Parse the normalized Hermes projection carried in `AcpAgentInfo.config_json`
 * (produced by the backend from ~/.hermes/.env + config.yaml). Falls back to a
 * sensible default provider when nothing is configured yet.
 */