import { describe, expect, it } from "vitest"
import type { OpenWikiConfig } from "@/lib/api"
import {
  isOpenWikiEnabledForAgent,
  setOpenWikiEnabledForAgent,
} from "./openwiki-agent"

function baseConfig(overrides: Partial<OpenWikiConfig> = {}): OpenWikiConfig {
  return {
    enabled: false,
    modes: { code: true, personal: false },
    agent_types_list: [],
    agent_permissions: [],
    inject: {
      on_session_start: true,
      inject_agents_md: false,
      inject_mode: "summary_and_path",
    },
    auto_update: {
      enabled: false,
      on_git_change: false,
      schedule_cron: null,
    },
    model: {
      use_openwiki_env: true,
      provider: null,
      model_id: null,
      api_key: "",
      base_url: null,
    },
    paths: {
      code_wiki_dirname: "openwiki",
      personal_wiki_root: null,
      executable: "",
    },
    commands: {
      allow_init: true,
      allow_update: true,
      allow_chat: false,
      allow_ingest: false,
      allow_cron: false,
      allow_auth: false,
      advanced_enabled: false,
    },
    ignore_patterns: [],
    ...overrides,
  }
}

describe("openwiki-agent helpers", () => {
  it("enable for agent turns global on and grants read_wiki", () => {
    const next = setOpenWikiEnabledForAgent(baseConfig(), "codex", true)
    expect(next.enabled).toBe(true)
    expect(next.agent_types_list).toEqual(["codex"])
    expect(next.agent_permissions).toEqual([
      { agent_type: "codex", capabilities: ["read_wiki"] },
    ])
    expect(isOpenWikiEnabledForAgent(next, "codex")).toBe(true)
    expect(isOpenWikiEnabledForAgent(next, "claude_code")).toBe(false)
  })

  it("enable is idempotent and preserves other agents", () => {
    const start = baseConfig({
      enabled: true,
      agent_types_list: ["claude_code"],
      agent_permissions: [
        { agent_type: "claude_code", capabilities: ["read_wiki"] },
      ],
    })
    const next = setOpenWikiEnabledForAgent(start, "codex", true)
    expect(next.agent_types_list.sort()).toEqual(["claude_code", "codex"])
    const again = setOpenWikiEnabledForAgent(next, "codex", true)
    expect(again.agent_types_list.filter((a) => a === "codex")).toHaveLength(1)
  })

  it("disable last agent turns global off", () => {
    const start = baseConfig({
      enabled: true,
      agent_types_list: ["codex"],
      agent_permissions: [
        { agent_type: "codex", capabilities: ["read_wiki"] },
      ],
    })
    const next = setOpenWikiEnabledForAgent(start, "codex", false)
    expect(next.enabled).toBe(false)
    expect(next.agent_types_list).toEqual([])
    expect(next.agent_permissions).toEqual([])
  })

  it("disable one agent keeps others and does not touch inject settings", () => {
    const start = baseConfig({
      enabled: true,
      agent_types_list: ["codex", "hermes"],
      agent_permissions: [
        { agent_type: "codex", capabilities: ["read_wiki"] },
        { agent_type: "hermes", capabilities: ["read_wiki"] },
      ],
      inject: {
        on_session_start: false,
        inject_agents_md: true,
        inject_mode: "path_only",
      },
      paths: {
        code_wiki_dirname: "wiki",
        personal_wiki_root: null,
        executable: "/bin/openwiki",
      },
    })
    const next = setOpenWikiEnabledForAgent(start, "codex", false)
    expect(next.enabled).toBe(true)
    expect(next.agent_types_list).toEqual(["hermes"])
    expect(next.inject).toEqual(start.inject)
    expect(next.paths).toEqual(start.paths)
  })
})
