import type { AgentType, AcpAgentInfo, ModelProviderInfo } from "@/lib/types"
import type { AgentCheckState, UiCheckItem, UiFixAction, ImportantDraftPatch, RunningActionKind } from "./types"
import { parseConfigJsonText, acpText, hasComparableVersion, compareVersion } from "./shared"
import { CLAUDE_MODEL_ENV_KEYS } from "./types"

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
