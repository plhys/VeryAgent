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
  "bypass": "bypass",
  "reasoning effort": "reasoningEffort",

  // ── Mode / preset names ──
  "default": "modeDefault",
  "accept edits": "modeAcceptEdits",
  "auto": "modeAuto",
  "plan mode": "modePlanMode",
  "bypass permissions": "modeBypassPermissions",

  // ── Permission option values (human-readable) ──
  "allow once": "allowOnce",
  "allow": "allowOnce",
  "yes": "allowOnce",
  "true": "allowOnce",
  "on": "allowOnce",
  "enabled": "allowOnce",
  "always allow": "allowAlways",
  "allow always": "allowAlways",
  "deny": "deny",
  "reject": "deny",
  "reject once": "deny",
  "deny once": "deny",
  "no": "deny",
  "false": "deny",
  "off": "deny",
  "disabled": "deny",
  "don't ask": "dontAsk",
  "dont ask": "dontAsk",
  "do not ask": "dontAsk",
  "never ask": "dontAsk",
  "reject always": "dontAsk",
  "deny always": "dontAsk",

  // ── Mode / preset option values ──
  "read only": "readOnly",
  "readonly": "readOnly",
  "agent": "agentMode",
  "agent (full access)": "agentFullAccess",

  // ── Thinking level values ──
  // "off" is ambiguous — could be "disabled" (permission context) or
  // "thinking off" (thought-level context). The permission mapping above
  // maps "off" → "deny". For thought-level, agents typically send the
  // full phrase like "Off" or the value id "off" which the localizer
  // processes; we add thought-level entries only for unambiguous labels.
  "low": "thinkingLow",
  "medium": "thinkingMedium",
  "high": "thinkingHigh",
  "extra high": "thinkingExtraHigh",
  "xhigh": "thinkingExtraHigh",

  // ── Mode / preset descriptions ──
  "ask before edits.": "modeDefaultDesc",
  "auto-allow workspace and /tmp edits; still asks for sensitive paths.": "modeAcceptEditsDesc",
  "auto-allow file edits for this session except sensitive paths.": "modeDontAskDesc",
  "use a model classifier to approve/deny permission prompts": "modeAutoDesc",
  "standard behavior, prompts for dangerous operations": "modeDefaultBehaviorDesc",
  "auto-accept file edit operations": "modeAcceptEditsBehaviorDesc",
  "planning mode, no actual tool execution": "modePlanModeDesc",
  "bypass all permission checks": "modeBypassPermissionsDesc",
}

/**
 * Maps normalized permission `kind` strings (protocol identifiers) to
 * i18n keys. Used by permission-dialog and PanelPermissionCard which
 * receive `opt.kind` instead of `opt.name`.
 */
const PERMISSION_KIND_MAP: Record<string, string> = {
  "allowonce": "allowOnce",
  "allowalways": "allowAlways",
  "rejectonce": "deny",
  "rejectalways": "dontAsk",
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
