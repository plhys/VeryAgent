"use client"

/**
 * Comprehensive localization for ACP config option names and values.
 *
 * The ACP protocol delivers option names/values dynamically from each agent
 * at runtime. This module maps known English strings to i18n keys in the
 * `Folder.chat.configOptions` namespace. Unknown strings fall back to the
 * raw English text.
 *
 * Two normalization modes:
 *   - `normalizeName`: for human-readable strings like "Allow once", "Read-only"
 *     → lowercase + replace underscores with spaces + trim
 *   - `normalizeKind`: for protocol identifiers like "allow_once", "reject_always"
 *     → lowercase + remove underscores entirely + trim
 *
 * Important: OpenClaw advertises session *settings* (thought level, fast mode,
 * verbosity, …) whose values are on/off/auto/full — these are switches, NOT
 * permission allow/deny. Permission option names stay on allow/deny/reject only.
 */

import { useTranslations } from "next-intl"

// ── Normalize helpers ──────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/_/g, " ").trim()
}

function normalizeKind(kind: string): string {
  return kind.toLowerCase().replace(/_/g, "").trim()
}

// ── Mapping tables ─────────────────────────────────────────────────────

/**
 * Maps normalized option/value names to i18n keys in
 * `Folder.chat.configOptions`.
 */
const CONFIG_NAME_MAP: Record<string, string> = {
  // ── Option names (displayed as section labels) ──
  "approval preset": "approvalPreset",
  "approval mode": "approvalPreset",
  approval: "approvalPreset",
  "default thinking mode": "defaultThinkingMode",
  "thinking mode": "defaultThinkingMode",
  "thinking level": "thinkingLevel",
  "thought level": "thoughtLevel",
  thought: "thoughtLevel",
  "fast mode": "fastMode",
  "tool verbosity": "toolVerbosity",
  "plugin trace": "pluginTrace",
  "reasoning stream": "reasoningStream",
  "usage detail": "usageDetail",
  "elevated actions": "elevatedActions",
  bypass: "bypass",
  "reasoning effort": "reasoningEffort",
  "reasoning effort level": "reasoningEffort",
  "effort level": "reasoningEffort",
  effort: "reasoningEffort",
  reasoning: "reasoningEffort",
  "model strength": "reasoningEffort",
  mode: "modeLabel",
  // ── Sandbox / environment options (CodeBuddy & friends) ──
  sandbox: "sandbox",
  "sandbox mode": "sandbox",
  sandboxed: "sandbox",
  "sandbox mode (experimental)": "sandboxExperimental",
  "strict sandbox": "sandboxStrict",
  environment: "environment",
  "run in sandbox": "sandbox",
  // ── Codex / reasoning config ──
  "service tier": "serviceTier",
  "approval policy": "approvalPreset",
  "fast mode (exp)": "fastMode",
  "reasoning effort (exp)": "reasoningEffort",
  // ── Agent / sub-agent options ──
  "subagent model": "subagentModel",
  "subagent provider": "subagentProvider",
  "allow subagent": "allowSubagent",
  // Protocol ids as option names (some agents ship the bare id):
  effortlevel: "reasoningEffort",
  reasoningeffort: "reasoningEffort",
  modelreasoningeffort: "reasoningEffort",
  "model reasoning effort": "reasoningEffort",
  thinkinglevel: "thinkingLevel",
  thoughtlevel: "thoughtLevel",
  sandboxmode: "sandbox",
  service_tier: "serviceTier",
  service_tier_override: "serviceTier",

  // ── Command Code config options ──
  model: "modelLabel",
  "tool permissions": "toolPermissions",
  permission: "toolPermissions",
  "permission mode": "toolPermissions",
  permissions: "toolPermissions",
  "tool permission": "toolPermissions",
  "auto-allow": "autoAllowTools",
  "auto-allow tools": "autoAllowTools",
  "auto allow": "autoAllowTools",
  "auto allow tools": "autoAllowTools",
  "ask before tools": "askBeforeTools",
  "ask before tool use": "askBeforeTools",
  yolo: "yoloMode",
  "bypass all (yolo)": "yoloMode",
  // Protocol ids as option names:
  toolpermissions: "toolPermissions",
  autoallowtools: "autoAllowTools",
  askbeforetools: "askBeforeTools",

  // ── Mode / preset names ──
  default: "modeDefault",
  "accept edits": "modeAcceptEdits",
  auto: "switchAuto",
  "plan mode": "modePlanMode",
  "bypass permissions": "modeBypassPermissions",

  // ── Permission option values (human-readable only) ──
  // Do NOT map on/off/enabled/disabled/true/false here — OpenClaw reuses those
  // for session switches and they must read as 开/关, not 允许/拒绝.
  "allow once": "allowOnce",
  allow: "allowOnce",
  yes: "allowOnce",
  "always allow": "allowAlways",
  "allow always": "allowAlways",
  deny: "deny",
  reject: "deny",
  "reject once": "deny",
  "deny once": "deny",
  no: "deny",
  "don't ask": "dontAsk",
  "dont ask": "dontAsk",
  "do not ask": "dontAsk",
  "never ask": "dontAsk",
  "reject always": "dontAsk",
  "deny always": "dontAsk",

  // ── Switch / level values (OpenClaw + shared) ──
  off: "switchOff",
  on: "switchOn",
  enabled: "switchOn",
  disabled: "switchOff",
  true: "switchOn",
  false: "switchOff",
  full: "switchFull",
  stream: "switchStream",
  tokens: "usageTokens",
  ask: "elevatedAsk",
  adaptive: "thinkingAdaptive",

  // ── Sandbox values ──
  "ask every time": "sandboxAsk",
  "always ask": "alwaysAsk",
  "allow all": "sandboxAllowAll",
  "strict": "sandboxStrict",
  "not sandboxed": "sandboxNotSandboxed",
  "sandboxed (non destructive)": "sandboxNonDestructive",
  "local environment": "sandboxLocalEnv",
  "local env": "sandboxLocalEnv",
  "sandbox environment": "sandboxEnvironment",
  docker: "sandboxDocker",
  container: "sandboxDocker",
  "docker container": "sandboxDocker",
  "background container": "sandboxDocker",
  vm: "sandboxVM",
  "virtual machine": "sandboxVM",

  // ── Thinking / reasoning values ──
  none: "thinkingOff",
  "no thinking": "thinkingOff",
  "no reasoning": "thinkingOff",
  "extra": "thinkingExtraHigh",
  balanced: "thinkingMedium",

  // ── Approval preset values ──
  "on failure": "approvalOnFailure",
  "on-failure": "approvalOnFailure",
  never: "approvalNever",
  "never approve": "approvalNever",
  "always approve": "approvalAlways",
  "untrusted": "approvalUntrusted",

  // ── Service tier values ──
  "standard": "serviceTierStandard",
  "priority": "serviceTierPriority",

  // ── Thinking level values ──
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  "extra high": "thinkingExtraHigh",
  xhigh: "thinkingExtraHigh",
  "x-high": "thinkingExtraHigh",
  max: "thinkingMax",
  minimal: "thinkingMinimal",
  "on (default)": "thinkingOnDefault",
  "model default": "thinkingOnDefault",
  "use model default": "thinkingOnDefault",
  "off (default)": "thinkingOffDefault",
  "auto (default)": "thinkingAutoDefault",

  // ── Mode / preset option values ──
  "read only": "readOnly",
  readonly: "readOnly",
  agent: "agentMode",
  "agent (full access)": "agentFullAccess",
  plan: "modePlanMode",

  // ── Mode / preset descriptions ──
  "ask before edits.": "modeDefaultDesc",
  "auto-allow workspace and /tmp edits; still asks for sensitive paths.":
    "modeAcceptEditsDesc",
  "auto-allow file edits for this session except sensitive paths.":
    "modeDontAskDesc",
  "use a model classifier to approve/deny permission prompts": "modeAutoDesc",
  "standard behavior, prompts for dangerous operations":
    "modeDefaultBehaviorDesc",
  "auto-accept file edit operations": "modeAcceptEditsBehaviorDesc",
  "planning mode, no actual tool execution": "modePlanModeDesc",
  "bypass all permission checks": "modeBypassPermissionsDesc",

  // ── CodeBuddy sandbox value descriptions ──
  "run shell commands inside the sandbox-cli isolation layer":
    "sandboxEnvSandboxCliDesc",
  "bash/powershell commands run inside the sandbox and require escalation to touch the host":
    "sandboxEnvBashDesc",
  "commands run with full user permissions (no sandbox isolation)":
    "sandboxLocalEnvDesc",
  // CodeBuddy joins both lines with a newline into one description.
  "run shell commands inside the sandbox-cli isolation layer bash/powershell commands run inside the sandbox and require escalation to touch the host":
    "sandboxEnvCombinedDesc",

  // ── CodeBuddy reasoning value descriptions ──
  "standard response without extended thinking": "reasoningStandardDesc",
  "briefest reasoning": "reasoningMinimalDesc",
  "light reasoning": "reasoningLowDesc",
  "balanced reasoning": "reasoningMediumDesc",
  "deep reasoning": "reasoningHighDesc",
  "very deep reasoning": "reasoningExtraHighDesc",
  "maximum reasoning effort": "reasoningMaxDesc",
  "use the model default effort": "reasoningOnDefaultDesc",

  // ── CodeBuddy permission value descriptions ──
  "controls how the agent requests permission before making changes":
    "permissionModeDesc",
  "prompts for permission on first use": "permissionAskFirstUseDesc",
  "prompts for permission on first use of each tool":
    "permissionAskFirstUseDesc",
  "of each tool": "permissionOfEachToolDesc",
  "automatically accepts file edit permissions for the session":
    "permissionAcceptEditsDesc",
  "agent can analyze but not modify files or execute commands":
    "permissionPlanDesc",
  "an ai classifier reviews actions that would normally prompt: safe ones are auto-approved, risky ones are denied. if the classifier is unavailable, the action falls back to a prompt (or is denied when prompts cannot be shown)":
    "permissionAutoDesc",

  // ── OpenClaw session setting descriptions (exact agent strings) ──
  "controls how much deliberate reasoning openclaw requests from the gateway model.":
    "thoughtLevelDesc",
  "use the gateway session default thought level.": "thoughtLevelAdaptiveDesc",
  "controls whether openai sessions use the gateway fast-mode profile.":
    "fastModeDesc",
  "controls how much tool progress and output detail openclaw keeps enabled for the session.":
    "toolVerbosityDesc",
  "controls whether plugin-owned trace lines are shown for the session.":
    "pluginTraceDesc",
  "controls whether reasoning-capable models emit reasoning text for the session.":
    "reasoningStreamDesc",
  "controls how much usage information openclaw attaches to responses for the session.":
    "usageDetailDesc",
  "controls how aggressively the session allows elevated execution behavior.":
    "elevatedActionsDesc",
}

/**
 * Maps normalized permission `kind` strings (protocol identifiers) to
 * i18n keys. Used by permission-dialog and PanelPermissionCard which
 * receive `opt.kind` instead of `opt.name`.
 */
const PERMISSION_KIND_MAP: Record<string, string> = {
  allowonce: "allowOnce",
  allowalways: "allowAlways",
  rejectonce: "deny",
  rejectalways: "dontAsk",
}

// ── Pure utility (no React dependency) ──────────────────────────────────

/**
 * Map a known config option name or value to an i18n key.
 * Returns the raw name unchanged when no mapping exists.
 *
 * This is the non-hook version for contexts where `useTranslations`
 * is not available (e.g. server components, utility functions).
 */
export function localizeConfigOptionName(name: string): string {
  const directKey = CONFIG_NAME_MAP[normalizeName(name)]
  if (directKey) return directKey
  // CodeBuddy joins some descriptions with newlines; collapse whitespace and
  // retry so the single-line mapping still matches.
  const collapsed = name.replace(/\s+/g, " ").trim()
  if (collapsed !== name) {
    const foldedKey = CONFIG_NAME_MAP[normalizeName(collapsed)]
    if (foldedKey) return foldedKey
  }
  return name
}

/**
 * Map a known permission kind to an i18n key.
 * Returns null when no mapping exists (caller should fall back to opt.name).
 */
export function mapPermissionKindKey(kind: string): string | null {
  const k = normalizeKind(kind)
  // Exact match
  if (PERMISSION_KIND_MAP[k]) return PERMISSION_KIND_MAP[k]
  // Fuzzy match (mirrors existing permission-dialog logic)
  if (k.includes("allowalways")) return "allowAlways"
  if (k.includes("allow")) return "allowOnce"
  if (k.includes("rejectalways") || k.includes("dontask")) return "dontAsk"
  if (k.includes("reject") || k.includes("deny")) return "deny"
  return null
}

// ── React Hook ──────────────────────────────────────────────────────────

/**
 * Provides localized config option name/value strings via the
 * `Folder.chat.configOptions` i18n namespace.
 *
 * Usage:
 *   const localizer = useConfigOptionLocalizer()
 *   localizer.localize("Allow once")        → "允许本次" (zh-CN)
 *   localizer.localize("Approval Preset")   → "审批预设"
 *   localizer.localize("Some unknown")       → "Some unknown" (fallback)
 *   localizer.localizePermissionKind("allow_once", "Allow once") → "允许本次"
 */
export function useConfigOptionLocalizer() {
  const t = useTranslations("Folder.chat.configOptions")

  function localize(raw: string): string {
    // Direct hit first (exact whitespace, including embedded newlines).
    const directKey = CONFIG_NAME_MAP[normalizeName(raw)]
    if (directKey) {
      // @ts-expect-error — key comes from the known mapping table, guaranteed valid
      return t(directKey)
    }
    // Fallback: some agents (CodeBuddy) join a value's description with
    // newlines ("Run … layer\nBash … host"). Collapse all whitespace runs to
    // single spaces and retry so the single-line mapping still matches.
    const collapsed = raw.replace(/\s+/g, " ").trim()
    if (collapsed !== raw) {
      const foldedKey = CONFIG_NAME_MAP[normalizeName(collapsed)]
      if (foldedKey) {
        // @ts-expect-error — key comes from the known mapping table, guaranteed valid
        return t(foldedKey)
      }
    }
    return raw
  }

  function localizePermissionKind(kind: string, fallbackName: string): string {
    const key = mapPermissionKindKey(kind)
    if (!key) return fallbackName
    // @ts-expect-error — key comes from the known mapping table, guaranteed valid
    return t(key)
  }

  return { localize, localizePermissionKind }
}
