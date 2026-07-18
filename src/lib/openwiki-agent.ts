import type { AgentType } from "@/lib/types"
import type { OpenWikiConfig } from "@/lib/api"

/** Whether OpenWiki is enabled for a specific agent. */
export function isOpenWikiEnabledForAgent(
  config: OpenWikiConfig,
  agentType: AgentType
): boolean {
  if (!config.enabled) return false
  return config.agent_types_list.includes(agentType)
}

/**
 * Toggle OpenWiki for one agent.
 * - Enable: add agent + read_wiki, force global enabled=true.
 * - Disable: drop agent grants; if none remain, global enabled=false.
 * Does not touch inject/paths/model settings.
 */
export function setOpenWikiEnabledForAgent(
  config: OpenWikiConfig,
  agentType: AgentType,
  enable: boolean
): OpenWikiConfig {
  const key = agentType
  let agent_types_list = [...config.agent_types_list]
  let agent_permissions = config.agent_permissions.map((p) => ({
    ...p,
    capabilities: [...p.capabilities],
  }))

  if (enable) {
    if (!agent_types_list.includes(key)) {
      agent_types_list = [...agent_types_list, key]
    }
    const existing = agent_permissions.find((p) => p.agent_type === key)
    if (existing) {
      if (!existing.capabilities.includes("read_wiki")) {
        existing.capabilities = [...existing.capabilities, "read_wiki"]
      }
    } else {
      agent_permissions = [
        ...agent_permissions,
        { agent_type: key, capabilities: ["read_wiki"] },
      ]
    }
    return {
      ...config,
      enabled: true,
      agent_types_list,
      agent_permissions,
    }
  }

  agent_types_list = agent_types_list.filter((a) => a !== key)
  agent_permissions = agent_permissions.filter((p) => p.agent_type !== key)
  return {
    ...config,
    enabled: agent_types_list.length > 0,
    agent_types_list,
    agent_permissions,
  }
}
