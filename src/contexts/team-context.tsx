"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { teamList } from "@/lib/api"
import { onTransportReconnect, subscribe } from "@/lib/platform"
import type { TeamSummary } from "@/lib/types"

const TEAM_CHANGED_EVENT = "team://changed"

interface TeamContextValue {
  teams: TeamSummary[]
  refetch: () => Promise<void>
  /**
   * Optimistically bind a leader conversation to a team so the member strip
   * appears immediately after `openTab`, without waiting for the backend
   * `team://changed` round-trip (which is what made the strip appear only
   * "sometimes").
   */
  bindLeaderConversation: (teamId: string, conversationId: number) => void
  /**
   * The team whose leader conversation is `conversationId`, or undefined. The
   * TeamSidePanel uses this to decide whether the active chat is a leader chat
   * (and therefore the member windows should be shown).
   */
  teamByLeaderConversation: (
    conversationId: number | null | undefined
  ) => TeamSummary | undefined
}

const TeamContext = createContext<TeamContextValue | null>(null)

/**
 * Data layer for the Team Collaboration feature: the team list + a realtime
 * subscription on `team://changed`, kept always-mounted so the sidebar and the
 * conversation-side panel stay live. Mirrors AutomationsViewProvider.
 */
export function useTeams() {
  const ctx = useContext(TeamContext)
  if (!ctx) {
    throw new Error("useTeams must be used within TeamProvider")
  }
  return ctx
}

export function TeamProvider({ children }: { children: ReactNode }) {
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const reqRef = useRef(0)

  const refetch = useCallback(async () => {
    const id = ++reqRef.current
    try {
      const list = await teamList()
      if (id === reqRef.current) setTeams(list)
    } catch {
      // ignore — a later event/refetch recovers
    }
  }, [])

  useEffect(() => {
    void refetch()
    let unsub: (() => void) | undefined
    let cancelled = false
    void subscribe(TEAM_CHANGED_EVENT, () => {
      void refetch()
    }).then((u: () => void) => {
      if (cancelled) u()
      else unsub = u
    })
    const offReconnect = onTransportReconnect(() => {
      void refetch()
    })
    return () => {
      cancelled = true
      unsub?.()
      offReconnect?.()
    }
  }, [refetch])

  const bindLeaderConversation = useCallback(
    (teamId: string, conversationId: number) => {
      setTeams((prev) =>
        prev.map((t) =>
          t.id === teamId ? { ...t, leader_conversation_id: conversationId } : t
        )
      )
    },
    []
  )

  const teamByLeaderConversation = useCallback(
    (conversationId: number | null | undefined) => {
      if (conversationId == null) return undefined
      return teams.find((t) => t.leader_conversation_id === conversationId)
    },
    [teams]
  )

  const value = useMemo<TeamContextValue>(
    () => ({
      teams,
      refetch,
      bindLeaderConversation,
      teamByLeaderConversation,
    }),
    [teams, refetch, bindLeaderConversation, teamByLeaderConversation]
  )

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
}
