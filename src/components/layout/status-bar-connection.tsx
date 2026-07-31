"use client"

import { useCallback, useState, useSyncExternalStore } from "react"
import { RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  useAcpActions,
  useConnectionStore,
} from "@/contexts/acp-connections-context"
import { useTabStore } from "@/contexts/tab-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { AgentIcon } from "@/components/agent-icon"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AGENT_LABELS } from "@/lib/types"
import { cn } from "@/lib/utils"

type ConnectionStatusLabelKey =
  "connected" | "connecting" | "prompting" | "error"

const STATUS_STYLE: Record<
  string,
  { className: string; labelKey: ConnectionStatusLabelKey }
> = {
  connected: { className: "opacity-100", labelKey: "connected" },
  connecting: {
    className: "opacity-100 animate-pulse",
    labelKey: "connecting",
  },
  prompting: {
    className: "opacity-100 animate-pulse",
    labelKey: "prompting",
  },
  error: { className: "opacity-50", labelKey: "error" },
}

export function StatusBarConnection() {
  const t = useTranslations("Folder.statusBar.connection")
  const store = useConnectionStore()
  const { reapplyConfig } = useAcpActions()
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const [reconnecting, setReconnecting] = useState(false)

  // Subscribe to activeKey changes
  const subscribeActiveKey = useCallback(
    (cb: () => void) => store.subscribeActiveKey(cb),
    [store]
  )
  const getActiveKey = useCallback(() => store.getActiveKey(), [store])
  const activeKey = useSyncExternalStore(
    subscribeActiveKey,
    getActiveKey,
    getActiveKey
  )

  // Subscribe to the active connection's changes
  const subscribeConn = useCallback(
    (cb: () => void) => {
      if (!activeKey) return () => {}
      return store.subscribeKey(activeKey, cb)
    },
    [store, activeKey]
  )
  const getConnSnapshot = useCallback(
    () => (activeKey ? store.getConnection(activeKey) : undefined),
    [store, activeKey]
  )
  const activeConn = useSyncExternalStore(
    subscribeConn,
    getConnSnapshot,
    getConnSnapshot
  )

  const status = activeConn?.status ?? null
  const agentType = activeConn?.agentType ?? null
  const configStale = activeConn?.configStale ?? false
  const isViewer = activeConn?.isViewer ?? false
  const isDelegationChild = activeConn?.isDelegationChild ?? false

  // Selecting the primitive model string keeps this component inert to every
  // unrelated conversation update.
  const model = useAppWorkspaceStore((s) => {
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab || tab.kind !== "conversation") return null
    const conv = s.conversations.find(
      (c) => c.id === tab.conversationId && c.agent_type === tab.agentType
    )
    return conv?.model ?? null
  })

  const turnInFlight = status === "prompting"
  const busy = reconnecting || status === "connecting"
  // Owners only — viewers / broker children don't own the process.
  const canReconnect =
    !!activeKey &&
    !!agentType &&
    !!status &&
    status !== "disconnected" &&
    !isViewer &&
    !isDelegationChild
  const actionDisabled = !canReconnect || turnInFlight || busy

  const handleReconnect = useCallback(async () => {
    if (!activeKey || actionDisabled) return
    setReconnecting(true)
    try {
      const ok = await reapplyConfig(activeKey)
      if (ok) toast.success(t("reconnectApplied"))
    } catch (error) {
      toast.error(t("reconnectFailed"), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setReconnecting(false)
    }
  }, [activeKey, actionDisabled, reapplyConfig, t])

  const reconnectButton = canReconnect ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Wrapper so tooltip still fires while the button is disabled. */}
          <span className="inline-flex">
            <button
              type="button"
              disabled={actionDisabled}
              onClick={() => void handleReconnect()}
              aria-label={
                busy
                  ? t("reconnecting")
                  : configStale
                    ? t("reconnectStale")
                    : t("reconnect")
              }
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-sm transition-colors",
                "disabled:pointer-events-none disabled:opacity-40",
                configStale
                  ? "text-amber-600 hover:bg-amber-500/15 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} />
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {turnInFlight
            ? t("reconnectDisabledDuringTurn")
            : configStale
              ? t("reconnectStaleTooltip")
              : t("reconnectTooltip")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : null

  if (!agentType || !status || status === "disconnected") {
    return (
      <div className="flex items-center gap-1.5">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  if (activeKey) void reapplyConfig(activeKey)
                }}
                className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 transition-colors hover:bg-muted/50"
              >
                <span className="relative flex size-3 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                </span>
                {model && <span>{model}</span>}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{t("disconnected")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    )
  }

  const style = STATUS_STYLE[status]
  if (!style) return null

  const label = AGENT_LABELS[agentType]
  const statusLabel = t(style.labelKey)
  const tooltipText =
    status === "error" && activeConn?.error
      ? t("tooltipError", { agent: label, error: activeConn.error })
      : t("tooltip", { agent: label, status: statusLabel })

  return (
    <div className="flex items-center gap-1.5">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "flex items-center gap-1",
                configStale && "text-amber-700 dark:text-amber-300"
              )}
            >
              <AgentIcon
                agentType={agentType}
                className={cn("size-3", style.className)}
              />
              {model && <span>{model}</span>}
              {configStale && (
                <span className="text-[10px] font-medium leading-none">
                  {t("staleBadge")}
                </span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            {configStale ? t("staleTooltip", { agent: label }) : tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {reconnectButton}
    </div>
  )
}
