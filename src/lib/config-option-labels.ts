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
  "default thinking mode": "defaultThinkingMode",
  "thinking level": "thinkingLevel",
  "thought level": "thoughtLevel",
  "fast mode": "fastMode",
  "tool verbosity": "toolVerbosity",
  "plugin trace": "pluginTrace",
  "reasoning stream": "reasoningStream",
  "usage detail": "usageDetail",
  "elevated actions": "elevatedActions",
  bypass: "bypass",
  "reasoning effort": "reasoningEffort",

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

  // ── Mode / preset option values ──
  "read only": "readOnly",
  readonly: "readOnly",
  agent: "agentMode",
  "agent (full access)": "agentFullAccess",

  // ── Thinking level values ──
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  "extra high": "thinkingExtraHigh",
  xhigh: "thinkingExtraHigh",

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
  const key = CONFIG_NAME_MAP[normalizeName(name)]
  return key ?? name
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
    const key = CONFIG_NAME_MAP[normalizeName(raw)]
    if (!key) return raw
    // @ts-expect-error — key comes from the known mapping table, guaranteed valid
    return t(key)
  }

  function localizePermissionKind(kind: string, fallbackName: string): string {
    const key = mapPermissionKindKey(kind)
    if (!key) return fallbackName
    // @ts-expect-error — key comes from the known mapping table, guaranteed valid
    return t(key)
  }

  return { localize, localizePermissionKind }
}
