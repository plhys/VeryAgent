"use client"

import { useMemo, useCallback } from "react"
import { BarChart3, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { useShallow } from "zustand/react/shallow"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { AGENT_LABELS, type AgentType } from "@/lib/types"
import { AgentIcon } from "@/components/agent-icon"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function StatusBarStats() {
  const t = useTranslations("Folder.statusBar.stats")
  const { stats, agentFilter, setAgentFilter } = useAppWorkspaceStore(
    useShallow((s) => ({
      stats: s.stats,
      agentFilter: s.agentFilter,
      setAgentFilter: s.setAgentFilter,
    }))
  )

  const activeAgents = useMemo(
    () => stats?.by_agent.filter((a) => a.conversation_count > 0) ?? [],
    [stats]
  )

  const handleToggleFilter = useCallback(
    (agentType: string) => {
      if (agentFilter === agentType) {
        setAgentFilter(null)
      } else {
        setAgentFilter(agentType as AgentType)
      }
    },
    [agentFilter, setAgentFilter]
  )

  const handleClearFilter = useCallback(() => {
    setAgentFilter(null)
  }, [setAgentFilter])

  if (!stats) return null

  const displayCount = agentFilter
    ? (activeAgents.find((a) => a.agent_type === agentFilter)
        ?.conversation_count ?? 0)
    : stats.total_conversations

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 hover:text-foreground transition-colors">
          <BarChart3 className="h-3 w-3" />
          <span>{t("conversations", { count: displayCount })}</span>
          <span className="flex items-center gap-1 ml-1">
            {activeAgents.map((a) => (
              <AgentIcon
                key={a.agent_type}
                agentType={a.agent_type}
                className="w-3 h-3"
              />
            ))}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium">
            {t("summary", {
              conversations: stats.total_conversations,
              messages: stats.total_messages,
            })}
          </div>
          {agentFilter && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="text-[0.625rem] text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer shrink-0 ml-2"
            >
              清除筛选
            </button>
          )}
        </div>
        <div className="space-y-1">
          {activeAgents.map((a) => {
            const isActive = agentFilter === a.agent_type
            return (
              <button
                key={a.agent_type}
                type="button"
                onClick={() => handleToggleFilter(a.agent_type)}
                className={[
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                  "transition-colors cursor-pointer text-left",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted text-muted-foreground",
                ].join(" ")}
              >
                <AgentIcon
                  agentType={a.agent_type}
                  className="w-3.5 h-3.5 shrink-0"
                />
                <span className="truncate">{AGENT_LABELS[a.agent_type]}</span>
                <span className="ml-auto">{a.conversation_count}</span>
                {isActive && <X className="h-3 w-3 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
