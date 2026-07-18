"use client"

import type { AgentType } from "@/lib/types"

const CHAT_AGENT_MODE_KEY = "workspace:chat-agent-mode"

/** Welcome-page agent list mode: general butlers vs expert coding agents. */
export type ChatAgentMode = "general" | "expert"

/** Agents shown in general (butler) mode. */
export const GENERAL_MODE_AGENT_TYPES: readonly AgentType[] = [
  "hermes",
  "open_claw",
]

export function isGeneralModeAgent(agentType: AgentType): boolean {
  return (GENERAL_MODE_AGENT_TYPES as readonly string[]).includes(agentType)
}

/**
 * Last-picked chat agent mode on the welcome / draft selector.
 * Defaults to "general" so newcomers only see Hermes + OpenClaw.
 */
export function loadChatAgentMode(): ChatAgentMode {
  if (typeof window === "undefined") return "general"
  try {
    const raw = localStorage.getItem(CHAT_AGENT_MODE_KEY)
    if (raw === "general" || raw === "expert") return raw
  } catch {
    /* ignore */
  }
  return "general"
}

export function saveChatAgentMode(value: ChatAgentMode): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(CHAT_AGENT_MODE_KEY, value)
  } catch {
    /* ignore */
  }
}
