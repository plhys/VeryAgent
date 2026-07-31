"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import type { AgentType, AcpAgentInfo } from "@/lib/types"
import { AGENT_LABELS } from "@/lib/types"
import { AgentIcon } from "@/components/agent-icon"
import { cn } from "@/lib/utils"
import {
  isGeneralModeAgent,
  loadChatAgentMode,
  saveChatAgentMode,
  type ChatAgentMode,
} from "@/lib/chat-agent-mode-storage"

interface AgentSelectorProps {
  defaultAgentType?: AgentType | null
  /** Fires on user click. The caller should treat this as confirmation. */
  onSelect: (agentType: AgentType) => void
  /**
   * Fires when `defaultAgentType` is missing/unavailable and the selector
   * had to pick a substitute on its own. Distinct from `onSelect` so the
   * caller can avoid promoting a system pick to a confirmed user choice
   * (which would otherwise mask a stale-default correction upstream).
   * When omitted, falls back to `onSelect` for backwards compatibility.
   *
   * Expert mode with the mode switch on never auto-picks: callers get
   * `null` so the welcome/draft UI stays unselected until the user clicks.
   */
  onFallback?: (agentType: AgentType | null) => void
  onAgentsLoaded?: (agents: AcpAgentInfo[]) => void
  onOpenAgentsSettings?: () => void
  disabled?: boolean
  /**
   * When true (welcome / draft header), show the general/expert mode switch
   * and filter the agent list. Existing conversations keep the full list.
   */
  showModeSwitch?: boolean
}

export function AgentSelector({
  defaultAgentType,
  onSelect,
  onFallback,
  onAgentsLoaded,
  onOpenAgentsSettings,
  disabled = false,
  showModeSwitch = false,
}: AgentSelectorProps) {
  const t = useTranslations("Folder.chat.agentSelector")
  const { agents: rawAgents } = useAcpAgents()
  const [mode, setMode] = useState<ChatAgentMode>("general")

  useEffect(() => {
    if (!showModeSwitch) return
    setMode(loadChatAgentMode())
  }, [showModeSwitch])

  const handleModeChange = useCallback((next: ChatAgentMode) => {
    setMode(next)
    saveChatAgentMode(next)
  }, [])

  // Expert mode never auto-selects — user must pick a coding agent.
  const autoSelectEnabled = !showModeSwitch || mode === "general"

  // Activation switch rules for the chat picker:
  // 1. Not activated (`!enabled`) → hide completely.
  // 2. Activated but unavailable → keep visible, grayed out, not selectable.
  // Only enabled+available agents are selectable / auto-picked.
  const agents = useMemo<AcpAgentInfo[]>(() => {
    const activated = rawAgents.filter((a) => a.enabled)
    const filtered = !showModeSwitch
      ? activated
      : mode === "general"
        ? activated.filter((a) => isGeneralModeAgent(a.agent_type))
        : activated.filter((a) => !isGeneralModeAgent(a.agent_type))
    return filtered.slice().sort((a, b) => {
      // Usable first, then resident butlers, keep relative order otherwise.
      const usableA = Number(a.available)
      const usableB = Number(b.available)
      if (usableA !== usableB) return usableB - usableA
      return Number(!!b.resident) - Number(!!a.resident)
    })
  }, [rawAgents, showModeSwitch, mode])
  const onSelectRef = useRef(onSelect)
  const onFallbackRef = useRef(onFallback)
  const onAgentsLoadedRef = useRef(onAgentsLoaded)

  const isUsable = useCallback((a: AcpAgentInfo) => a.available, [])

  // Effective selection. Priority: prop default (when still usable) →
  // first usable (general / full list only). Expert mode stays null
  // until the user clicks. Click handling lives on the parent —
  // `handleSelect` just forwards via `onSelect`.
  const selected = useMemo<AgentType | null>(() => {
    const found = defaultAgentType
      ? agents.find((a) => a.agent_type === defaultAgentType && isUsable(a))
      : null
    if (found) return found.agent_type
    if (!autoSelectEnabled) return null
    const first = agents.find(isUsable)
    return first?.agent_type ?? null
  }, [agents, defaultAgentType, autoSelectEnabled, isUsable])

  // Sliding indicator state
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<AgentType, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState<{
    left: number
    width: number
  } | null>(null)

  // Use ResizeObserver to track button size changes during CSS transitions
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      if (!selected) {
        setIndicator(null)
        return
      }
      const btn = itemRefs.current.get(selected)
      if (!btn || !container) {
        setIndicator(null)
        return
      }
      const containerRect = container.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      setIndicator({
        left: btnRect.left - containerRect.left,
        width: btnRect.width,
      })
    }

    const ro = new ResizeObserver(() => {
      measure()
    })

    // Observe all button elements so indicator updates as they resize
    for (const btn of itemRefs.current.values()) {
      ro.observe(btn)
    }
    ro.observe(container)

    // Initial measurement
    measure()

    const onResize = () => measure()
    window.addEventListener("resize", onResize)

    return () => {
      ro.disconnect()
      window.removeEventListener("resize", onResize)
    }
  }, [selected, agents])

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    onFallbackRef.current = onFallback
  }, [onFallback])

  useEffect(() => {
    onAgentsLoadedRef.current = onAgentsLoaded
  }, [onAgentsLoaded])

  // Notify parent when the agent list changes, and emit a *fallback* event
  // (not onSelect) when the requested preferred agent is unusable and
  // we had to pick a substitute. Splitting the channel matters: the caller
  // treats `onSelect` as a confirmed user choice and clears any "this is a
  // provisional default" flag upstream — if the auto-fallback came through
  // the same path, a hydrated draft whose old agent is now disabled would
  // be silently locked onto sortedTypes[0] before TabProvider's correction
  // effect has a chance to apply the folder's saved default. Callers that
  // don't supply `onFallback` get the legacy behavior (fallback as
  // onSelect) so this prop stays optional.
  //
  // Expert mode is intentional "no default": when the preferred agent is
  // outside the expert list, the `selected` memo already returns null so
  // nothing is highlighted — no onFallback(null) needed. Silently skipping
  // lets the parent keep its draftAgentType, which preserves the user's
  // general-mode pick across a mode round-trip (general → expert → general).
  useEffect(() => {
    // Parent "available agents" consumers still want usable-only lists.
    onAgentsLoadedRef.current?.(agents.filter(isUsable))
    const found = defaultAgentType
      ? agents.find((a) => a.agent_type === defaultAgentType && isUsable(a))
      : null
    if (found) return

    // Expert / non-auto-select mode: visual shows nothing (via `selected`
    // memo), parent keeps its state — no fallback to emit.
    if (!autoSelectEnabled) return

    const first = agents.find(isUsable)
    if (!first) return
    const fallback = onFallbackRef.current
    if (fallback) {
      fallback(first.agent_type)
    } else {
      onSelectRef.current(first.agent_type)
    }
  }, [agents, defaultAgentType, autoSelectEnabled, isUsable])

  const handleSelect = (agent: AcpAgentInfo) => {
    if (!isUsable(agent)) return
    onSelect(agent.agent_type)
  }

  const setItemRef = useCallback(
    (agentType: AgentType) => (el: HTMLButtonElement | null) => {
      if (el) {
        itemRefs.current.set(agentType, el)
      } else {
        itemRefs.current.delete(agentType)
      }
    },
    []
  )

  const modeSwitch = showModeSwitch ? (
    <div
      role="tablist"
      aria-label={t("modeSwitchAria")}
      className="inline-flex items-center self-center rounded-full border border-border/50 bg-muted/40 p-0.5"
    >
      {(
        [
          ["general", t("modeGeneral")] as const,
          ["expert", t("modeExpert")] as const,
        ] as const
      ).map(([value, label]) => {
        const active = mode === value
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => handleModeChange(value)}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              active
                ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  ) : null

  const hasUsableAgent = agents.some(isUsable)

  if (agents.length === 0 || !hasUsableAgent) {
    return (
      <div className="flex flex-col items-center gap-3">
        {modeSwitch}
        {agents.length > 0 ? (
          <div
            ref={containerRef}
            className="relative inline-flex items-center self-center rounded-full bg-muted/50 p-0.5 border border-border/50"
          >
            {agents.map((agent) => {
              const label = AGENT_LABELS[agent.agent_type]
              // List already excludes inactive agents; remaining entries are
              // activated but unavailable (or empty usable set).
              const reason = t("agentUnavailable")
              return (
                <button
                  key={agent.agent_type}
                  ref={setItemRef(agent.agent_type)}
                  type="button"
                  title={`${label} · ${reason}`}
                  disabled
                  className="relative z-10 inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-medium text-muted-foreground cursor-not-allowed opacity-50"
                >
                  <AgentIcon
                    agentType={agent.agent_type}
                    muted
                    className="w-4 h-4 shrink-0"
                  />
                </button>
              )
            })}
          </div>
        ) : null}
        <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground">
          <div>
            {showModeSwitch
              ? mode === "general"
                ? t("noGeneralAgents")
                : t("noExpertAgents")
              : t("noEnabledAgents")}
          </div>
          {onOpenAgentsSettings ? (
            <button
              type="button"
              onClick={onOpenAgentsSettings}
              className="mt-2 inline-flex items-center rounded-md border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent cursor-pointer"
            >
              {t("openAgentsSettings")}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {modeSwitch}
      <div
        ref={containerRef}
        className="relative inline-flex items-center self-center rounded-full bg-muted/50 p-0.5 border border-border/50"
      >
        {/* Sliding droplet indicator */}
        {indicator && (
          <div
            className="absolute top-0.5 bottom-0.5 rounded-full bg-background shadow-sm ring-1 ring-border/50 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{
              left: indicator.left,
              width: indicator.width,
            }}
          />
        )}
        {agents.map((agent) => {
          const isSelected = selected === agent.agent_type
          const usable = isUsable(agent)
          const label = AGENT_LABELS[agent.agent_type]
          // Activated-but-unavailable only — disabled agents are filtered out.
          const inactiveReason = !agent.available ? t("agentUnavailable") : null
          const title = (() => {
            if (inactiveReason) return `${label} · ${inactiveReason}`
            if (!isSelected) {
              return agent.resident ? `${label} · ${t("residentBadge")}` : label
            }
            return agent.resident ? t("residentBadge") : undefined
          })()
          return (
            <button
              key={agent.agent_type}
              ref={setItemRef(agent.agent_type)}
              type="button"
              title={title}
              disabled={disabled || !usable}
              onClick={() => handleSelect(agent)}
              className={cn(
                "relative z-10 inline-flex items-center justify-center gap-1.5 rounded-full text-xs font-medium transition-all duration-300",
                isSelected ? "px-3 py-2" : "px-2 py-2",
                disabled || !usable
                  ? "cursor-not-allowed opacity-50 text-muted-foreground"
                  : "cursor-pointer",
                usable && isSelected
                  ? "text-foreground"
                  : usable
                    ? "text-muted-foreground hover:text-foreground/70"
                    : null
              )}
            >
              <span className="relative inline-flex shrink-0">
                <AgentIcon
                  agentType={agent.agent_type}
                  muted={!usable}
                  className="w-4 h-4 shrink-0"
                />
                {agent.resident && usable ? (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-background"
                    title={t("residentBadge")}
                    aria-label={t("residentBadge")}
                  />
                ) : null}
              </span>
              <span
                className={cn(
                  "grid transition-[grid-template-columns] duration-300",
                  isSelected ? "grid-cols-[1fr]" : "grid-cols-[0fr]"
                )}
              >
                <span
                  className={cn(
                    "min-w-0 overflow-hidden whitespace-nowrap transition-opacity duration-300",
                    isSelected ? "opacity-100" : "opacity-0"
                  )}
                >
                  {label}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
