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
export function buildVersionCheck(
  agent: AcpAgentInfo,
  uvReady: boolean = true
): UiCheckItem | null {
  if (
    agent.distribution_type !== "binary" &&
    agent.distribution_type !== "npx" &&
    agent.distribution_type !== "uvx"
  )
    return null

  const remoteVersion = agent.registry_version ?? "unknown"
  const localVersion =
    agent.installed_version ?? acpText("version.notInstalled", "Not installed")
  const versionText = acpText(
    "version.remoteLocal",
    "Remote: {remoteVersion} · Local: {localVersion}",
    { remoteVersion, localVersion }
  )
  const installAction: RunningActionKind =
    agent.distribution_type === "binary" ? "download_binary" : "install_npx"
  const upgradeAction: RunningActionKind =
    agent.distribution_type === "binary" ? "upgrade_binary" : "upgrade_npx"
  const uninstallAction: RunningActionKind =
    agent.distribution_type === "binary" ? "uninstall_binary" : "uninstall_npx"

  // uvx agents (Hermes) need the uv runtime before any managed install/upgrade
  // can run. Surface a single blocked state pointing at the separate "Install
  // uv" preflight action below, with the agent-install action shown disabled.
  // This covers both the fresh case (available=false) and the rare system-CLI
  // case (available=true via a global `hermes`, but uvx still missing).
  // Uninstall stays available even without uv — it only clears the prepared
  // marker — so a prepared package can still be removed when uv is gone.
  if (agent.distribution_type === "uvx" && !uvReady) {
    const blockedFixes: UiFixAction[] = [
      {
        label: acpText("actions.install", "Install"),
        kind: installAction,
        payload: agent.agent_type,
        disabled: true,
      },
    ]
    if (agent.installed_version) {
      blockedFixes.push({
        label: acpText("actions.uninstall", "Uninstall"),
        kind: uninstallAction,
        payload: agent.agent_type,
      })
    }
    return {
      check_id: "version_status",
      label: acpText("version.statusLabel", "Version Status"),
      status: "warn",
      message: acpText(
        "version.uvxNotReady",
        "{versionText}. The uv runtime isn't installed — install it from the uv check below to use this agent.",
        { versionText }
      ),
      fixes: blockedFixes,
    }
  }

  // Only binary agents can be genuinely platform-unsupported (no binary for
  // this platform). uvx runs everywhere — a uvx agent that reaches here (uv
  // treated as ready, i.e. preflight unknown) falls through to an actionable
  // install rather than a dead-end "unsupported" message.
  if (!agent.available && agent.distribution_type !== "uvx") {
    return {
      check_id: "version_status",
      label: acpText("version.statusLabel", "Version Status"),
      status: "fail",
      message: acpText(
        "version.platformUnsupported",
        "{versionText}. Current platform does not support this agent.",
        { versionText }
      ),
      fixes: [],
    }
  }

  // Custom-version install is offered in every installable state (and stays
  // available after a version is installed, so users can switch versions).
  // Binary agents need the registry version present to template the download URL.
  // uvx agents pin their version in the package spec, so custom-version
  // install does not apply (the backend ignores the override).
  const supportsCustomInstall =
    agent.distribution_type === "npx" ||
    (agent.distribution_type === "binary" && Boolean(agent.registry_version))
  const customInstallFix: UiFixAction = {
    label: acpText("actions.customInstall", "Custom install"),
    kind: "custom_install",
    payload: agent.agent_type,
  }
  const withCustomInstall = (fixes: UiFixAction[]): UiFixAction[] =>
    supportsCustomInstall ? [...fixes, customInstallFix] : fixes

  if (!agent.installed_version) {
    return {
      check_id: "version_status",
      label: acpText("version.statusLabel", "Version Status"),
      status: "fail",
      message: acpText(
        "version.clickInstall",
        "{versionText}. Click Install on the right.",
        { versionText }
      ),
      fixes: withCustomInstall([
        {
          label: acpText("actions.install", "Install"),
          kind: installAction,
          payload: agent.agent_type,
        },
      ]),
    }
  }

  if (
    agent.registry_version &&
    hasComparableVersion(agent.registry_version) &&
    !hasComparableVersion(agent.installed_version)
  ) {
    return {
      check_id: "version_status",
      label: acpText("version.statusLabel", "Version Status"),
      status: "warn",
      message: acpText(
        "version.localUnrecognized",
        "{versionText}. Local version is not comparable; try upgrade to overwrite install.",
        { versionText }
      ),
      fixes: withCustomInstall([
        {
          label: acpText("actions.upgrade", "Upgrade"),
          kind: upgradeAction,
          payload: agent.agent_type,
        },
        {
          label: acpText("actions.uninstall", "Uninstall"),
          kind: uninstallAction,
          payload: agent.agent_type,
        },
      ]),
    }
  }

  if (
    hasComparableVersion(agent.registry_version) &&
    hasComparableVersion(agent.installed_version) &&
    compareVersion(agent.installed_version, agent.registry_version) < 0
  ) {
    return {
      check_id: "version_status",
      label: acpText("version.statusLabel", "Version Status"),
      status: "warn",
      message: acpText(
        "version.upgradeAvailable",
        "{versionText}. Upgrade available.",
        { versionText }
      ),
      fixes: withCustomInstall([
        {
          label: acpText("actions.upgrade", "Upgrade"),
          kind: upgradeAction,
          payload: agent.agent_type,
        },
        {
          label: acpText("actions.uninstall", "Uninstall"),
          kind: uninstallAction,
          payload: agent.agent_type,
        },
      ]),
    }
  }

  if (!agent.registry_version) {
    return {
      check_id: "version_status",
      label: acpText("version.statusLabel", "Version Status"),
      status: "warn",
      message: acpText(
        "version.remoteUnavailable",
        "{versionText}. Remote version is currently unavailable.",
        { versionText }
      ),
      fixes: withCustomInstall([
        {
          label: acpText("actions.uninstall", "Uninstall"),
          kind: uninstallAction,
          payload: agent.agent_type,
        },
      ]),
    }
  }

  return {
    check_id: "version_status",
    label: acpText("version.statusLabel", "Version Status"),
    status: "pass",
    message: acpText("version.latest", "{versionText}. Already latest.", {
      versionText,
    }),
    fixes: withCustomInstall([
      {
        label: acpText("actions.uninstall", "Uninstall"),
        kind: uninstallAction,
        payload: agent.agent_type,
      },
    ]),
  }
}

export function getAgentChecks(
  agent: AcpAgentInfo,
  current?: AgentCheckState
): UiCheckItem[] {
  // For uvx agents, only treat uv as not-ready when the preflight result is
  // present AND its uv check isn't passing. With no result yet (or an errored
  // preflight) stay optimistic — otherwise we'd block the version-status
  // install while the "Install uv" button (which lives in that same preflight
  // result) is absent, a dead end. When the result IS present, the button is
  // present alongside it, so blocking is always paired with an actionable fix.
  const uvCheck = current?.result?.checks?.find(
    (check) => check.check_id === "uv_available"
  )
  const uvReady =
    agent.distribution_type !== "uvx" || !uvCheck || uvCheck.status === "pass"
  const versionCheck = buildVersionCheck(agent, uvReady)
  const remoteChecks: UiCheckItem[] = (current?.result?.checks ?? []).map(
    (check) => ({
      ...check,
      fixes: [...check.fixes],
    })
  )
  return versionCheck ? [versionCheck, ...remoteChecks] : remoteChecks
}

interface AgentReorderItemProps {
  agent: AcpAgentInfo
  selected: boolean
  reordering: boolean
  dragging: AgentType | null
  /** Gray presentation for inactive or unusable agents. */
  inactive?: boolean
  onDragStart: (agentType: AgentType) => void
  onDragEnd: () => void
  onSelect: (agentType: AgentType) => void
  children: (
    startDrag: (event: PointerEvent<HTMLButtonElement>) => void
  ) => ReactNode
}
