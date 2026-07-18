import { HERMES_PROVIDERS } from "@/lib/types"
import type {
  AcpAgentInfo,
  AgentType,
  CheckStatus,
  OpenClawGatewayDiscovery,
} from "@/lib/types"

/** High-level readiness for agents that get the plain-language status card. */
export type AgentReadinessKind =
  | "checking"
  | "disabled"
  | "not_installed"
  | "dependency_blocked"
  | "config_needed"
  | "ready"
  | "unchecked"

export interface AgentReadiness {
  kind: AgentReadinessKind
  /** Short badge label (e.g. 可用 / 未就绪). */
  badge: string
  /** One-line title for the status card. */
  title: string
  /** Plain-language reason / next step. */
  detail: string
  /** Failed check ids that drove dependency_blocked, if any. */
  blockingCheckIds: string[]
}

/** Minimal draft surface used by readiness (avoids coupling to the full settings draft). */
export interface AgentReadinessDraft {
  enabled: boolean
  apiKey: string
  model: string
  modelProviderId: number | null
  hermesAuthMode: "native" | "model_provider"
  openClawAuthMode: "gateway" | "model_provider"
  hermesProvider: string
  openClawGatewayUrl: string
}

export interface AgentReadinessCheck {
  check_id: string
  status: CheckStatus
  message: string
}

type ReadinessTranslator = (
  key: string,
  values?: Record<string, string | number>
) => string

export function isReadinessPilotAgent(agentType: AgentType): boolean {
  return agentType === "open_claw" || agentType === "hermes"
}

function firstFailedCheck(
  checks: AgentReadinessCheck[],
  preferIds: string[] = []
): AgentReadinessCheck | null {
  for (const id of preferIds) {
    const hit = checks.find((c) => c.check_id === id && c.status === "fail")
    if (hit) return hit
  }
  return checks.find((c) => c.status === "fail") ?? null
}

/**
 * Build a human-readable readiness summary for Hermes / OpenClaw.
 * Separates "package installed" from "actually usable".
 */
export function buildAgentReadiness(params: {
  agent: Pick<
    AcpAgentInfo,
    "agent_type" | "name" | "available" | "installed_version" | "enabled"
  >
  draft: AgentReadinessDraft | null
  checks: AgentReadinessCheck[]
  isChecking: boolean
  openClawDiscovery?: OpenClawGatewayDiscovery | null
  t: ReadinessTranslator
}): AgentReadiness {
  const { agent, draft, checks, isChecking, openClawDiscovery, t } = params
  const enabled = draft?.enabled ?? agent.enabled

  if (isChecking) {
    return {
      kind: "checking",
      badge: t("readiness.badge.checking"),
      title: t("readiness.title.checking"),
      detail: t("readiness.detail.checking"),
      blockingCheckIds: [],
    }
  }

  if (!enabled) {
    return {
      kind: "disabled",
      badge: t("readiness.badge.disabled"),
      title: t("readiness.title.disabled"),
      detail: t("readiness.detail.disabled"),
      blockingCheckIds: [],
    }
  }

  if (checks.length === 0) {
    return {
      kind: "unchecked",
      badge: t("readiness.badge.unchecked"),
      title: t("readiness.title.unchecked"),
      detail: t("readiness.detail.unchecked"),
      blockingCheckIds: [],
    }
  }

  const installed = Boolean(agent.installed_version) || agent.available
  if (!installed) {
    return {
      kind: "not_installed",
      badge: t("readiness.badge.notInstalled"),
      title: t("readiness.title.notInstalled", { name: agent.name }),
      detail: t("readiness.detail.notInstalled"),
      blockingCheckIds: [],
    }
  }

  // Dependency failures (Node/uv/npm) block runtime even after package install.
  const depPrefer =
    agent.agent_type === "hermes"
      ? ["uv_available", "uv_version"]
      : agent.agent_type === "open_claw"
        ? ["node_version", "node_available", "npm_available"]
        : []
  const failedDep = firstFailedCheck(checks, depPrefer)
  if (failedDep) {
    return {
      kind: "dependency_blocked",
      badge: t("readiness.badge.notReady"),
      title: t("readiness.title.dependencyBlocked", { name: agent.name }),
      detail: t("readiness.detail.dependencyBlocked", {
        reason: failedDep.message,
      }),
      blockingCheckIds: [failedDep.check_id],
    }
  }

  // Soft dependency warnings that still block managed install (e.g. uv missing
  // while a system hermes exists) — treat as not ready with next step.
  const uvWarn = checks.find(
    (c) =>
      (c.check_id === "uv_available" || c.check_id === "version_status") &&
      c.status === "warn" &&
      /uv/i.test(c.message)
  )
  if (agent.agent_type === "hermes" && uvWarn && !agent.available) {
    return {
      kind: "dependency_blocked",
      badge: t("readiness.badge.notReady"),
      title: t("readiness.title.dependencyBlocked", { name: agent.name }),
      detail: t("readiness.detail.dependencyBlocked", {
        reason: uvWarn.message,
      }),
      blockingCheckIds: [uvWarn.check_id],
    }
  }

  // Auth / gateway configuration — installed but not yet usable.
  if (agent.agent_type === "hermes" && draft) {
    if (draft.hermesAuthMode === "model_provider") {
      if (draft.modelProviderId == null) {
        return {
          kind: "config_needed",
          badge: t("readiness.badge.notReady"),
          title: t("readiness.title.configNeeded", { name: agent.name }),
          detail: t("readiness.detail.hermesNeedProvider"),
          blockingCheckIds: [],
        }
      }
    } else {
      const hasModel = Boolean(draft.model?.trim())
      const hasKey = Boolean(draft.apiKey?.trim())
      const providerOption = HERMES_PROVIDERS.find(
        (p) => p.id === draft.hermesProvider
      )
      const keyOptional =
        providerOption?.kind === "oauth" || providerOption?.kind === "aws"

      if (!hasModel && !hasKey && !keyOptional) {
        return {
          kind: "config_needed",
          badge: t("readiness.badge.notReady"),
          title: t("readiness.title.configNeeded", { name: agent.name }),
          detail: t("readiness.detail.hermesNeedNativeConfig"),
          blockingCheckIds: [],
        }
      }
      if (!hasModel && keyOptional) {
        // OAuth/AWS still need a model id selected in the panel.
        return {
          kind: "config_needed",
          badge: t("readiness.badge.notReady"),
          title: t("readiness.title.configNeeded", { name: agent.name }),
          detail: t("readiness.detail.hermesNeedNativeConfig"),
          blockingCheckIds: [],
        }
      }
      if (!hasKey && hasModel && !keyOptional) {
        return {
          kind: "config_needed",
          badge: t("readiness.badge.notReady"),
          title: t("readiness.title.configNeeded", { name: agent.name }),
          detail: t("readiness.detail.hermesNeedApiOrOauth", {
            provider: draft.hermesProvider || "provider",
          }),
          blockingCheckIds: [],
        }
      }
    }
  }

  if (agent.agent_type === "open_claw" && draft) {
    if (draft.openClawAuthMode === "model_provider") {
      if (draft.modelProviderId == null) {
        return {
          kind: "config_needed",
          badge: t("readiness.badge.notReady"),
          title: t("readiness.title.configNeeded", { name: agent.name }),
          detail: t("readiness.detail.openClawNeedProvider"),
          blockingCheckIds: [],
        }
      }
    } else {
      // Gateway mode is only "ready" when the process is actually reachable.
      // A filled URL alone used to mark ready while ACP still got ECONNREFUSED.
      const hasUrl = Boolean(draft.openClawGatewayUrl.trim())
      const discoveredUrl = Boolean(openClawDiscovery?.gatewayUrl)
      const reachable = Boolean(openClawDiscovery?.gatewayReachable)

      if (reachable) {
        // Live probe passed — continue to remaining hard fails / ready.
      } else if (!hasUrl && !discoveredUrl) {
        return {
          kind: "config_needed",
          badge: t("readiness.badge.notReady"),
          title: t("readiness.title.configNeeded", { name: agent.name }),
          detail: t("readiness.detail.openClawNeedGateway", {
            path:
              openClawDiscovery?.configPath ?? "~/.openclaw/openclaw.json",
          }),
          blockingCheckIds: [],
        }
      } else {
        const target =
          draft.openClawGatewayUrl.trim() ||
          openClawDiscovery?.gatewayUrl ||
          "ws://127.0.0.1:18789"
        return {
          kind: "config_needed",
          badge: t("readiness.badge.notReady"),
          title: t("readiness.title.configNeeded", { name: agent.name }),
          detail: t("readiness.detail.openClawGatewayDown", {
            url: target,
          }),
          blockingCheckIds: [],
        }
      }
    }
  }

  // Any remaining hard fails (non-dep) still block "ready".
  const otherFail = checks.find((c) => c.status === "fail")
  if (otherFail) {
    return {
      kind: "dependency_blocked",
      badge: t("readiness.badge.notReady"),
      title: t("readiness.title.dependencyBlocked", { name: agent.name }),
      detail: t("readiness.detail.dependencyBlocked", {
        reason: otherFail.message,
      }),
      blockingCheckIds: [otherFail.check_id],
    }
  }

  return {
    kind: "ready",
    badge: t("readiness.badge.ready"),
    title: t("readiness.title.ready", { name: agent.name }),
    detail: t("readiness.detail.ready"),
    blockingCheckIds: [],
  }
}

export function readinessToneClass(kind: AgentReadinessKind): string {
  switch (kind) {
    case "ready":
      return "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
    case "checking":
      return "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400"
    case "not_installed":
    case "dependency_blocked":
    case "config_needed":
      return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
    case "disabled":
    case "unchecked":
    default:
      return "border-muted-foreground/30 bg-muted/40 text-muted-foreground"
  }
}
