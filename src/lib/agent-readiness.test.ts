import { describe, expect, it } from "vitest"
import {
  buildAgentReadiness,
  isReadinessPilotAgent,
  type AgentReadinessDraft,
} from "./agent-readiness"
import type { AcpAgentInfo, OpenClawGatewayDiscovery } from "./types"

function t(key: string, values?: Record<string, string | number>): string {
  if (!values) return key
  return `${key}:${JSON.stringify(values)}`
}

function agent(
  partial: Partial<AcpAgentInfo> & Pick<AcpAgentInfo, "agent_type" | "name">
): Pick<
  AcpAgentInfo,
  "agent_type" | "name" | "available" | "installed_version" | "enabled"
> {
  return {
    agent_type: partial.agent_type,
    name: partial.name,
    available: partial.available ?? false,
    installed_version: partial.installed_version ?? null,
    enabled: partial.enabled ?? true,
  }
}

function draft(
  partial: Partial<AgentReadinessDraft> = {}
): AgentReadinessDraft {
  return {
    enabled: true,
    apiKey: "",
    model: "",
    modelProviderId: null,
    hermesAuthMode: "native",
    openClawAuthMode: "gateway",
    hermesProvider: "openrouter",
    openClawGatewayUrl: "",
    ...partial,
  }
}

const passChecks = [
  { check_id: "node_available", status: "pass" as const, message: "Node ok" },
  { check_id: "node_version", status: "pass" as const, message: "Node 22.19" },
  { check_id: "npm_available", status: "pass" as const, message: "npm ok" },
]

describe("isReadinessPilotAgent", () => {
  it("covers only OpenClaw and Hermes", () => {
    expect(isReadinessPilotAgent("open_claw")).toBe(true)
    expect(isReadinessPilotAgent("hermes")).toBe(true)
    expect(isReadinessPilotAgent("claude_code")).toBe(false)
    expect(isReadinessPilotAgent("codex")).toBe(false)
  })
})

describe("buildAgentReadiness", () => {
  it("marks OpenClaw package-only install blocked by old Node", () => {
    const result = buildAgentReadiness({
      agent: agent({
        agent_type: "open_claw",
        name: "OpenClaw",
        installed_version: "2026.6.11",
        available: true,
      }),
      draft: draft({ openClawGatewayUrl: "ws://127.0.0.1:18789" }),
      checks: [
        {
          check_id: "node_available",
          status: "pass",
          message: "Node found",
        },
        {
          check_id: "node_version",
          status: "fail",
          message: "Node v22.16.0 is below required 22.19.0",
        },
        {
          check_id: "npm_available",
          status: "pass",
          message: "npm found",
        },
      ],
      isChecking: false,
      t,
    })
    expect(result.kind).toBe("dependency_blocked")
    expect(result.blockingCheckIds).toEqual(["node_version"])
    expect(result.detail).toContain("22.16.0")
  })

  it("marks OpenClaw config_needed when gateway URL is missing", () => {
    const discovery: OpenClawGatewayDiscovery = {
      gatewayUrl: null,
      gatewayUrlSource: null,
      gatewayToken: null,
      gatewayTokenSource: null,
      configPath: "C:\\Users\\me\\.openclaw\\openclaw.json",
      configExists: false,
      configParsed: false,
      gatewayPort: null,
      gatewayPortSource: null,
      gatewayMode: null,
      gatewayReachable: false,
    }
    const result = buildAgentReadiness({
      agent: agent({
        agent_type: "open_claw",
        name: "OpenClaw",
        installed_version: "2026.6.11",
        available: true,
      }),
      draft: draft({ openClawAuthMode: "gateway", openClawGatewayUrl: "" }),
      checks: passChecks,
      isChecking: false,
      openClawDiscovery: discovery,
      t,
    })
    expect(result.kind).toBe("config_needed")
    expect(result.detail).toContain("openClawNeedGateway")
    expect(result.detail).toContain("openclaw.json")
  })

  it("does not mark OpenClaw ready when URL exists but gateway is down", () => {
    const result = buildAgentReadiness({
      agent: agent({
        agent_type: "open_claw",
        name: "OpenClaw",
        installed_version: "2026.6.11",
        available: true,
      }),
      draft: draft({
        openClawGatewayUrl: "ws://127.0.0.1:18789",
      }),
      checks: passChecks,
      isChecking: false,
      openClawDiscovery: {
        gatewayUrl: "ws://127.0.0.1:18789",
        gatewayUrlSource: "config_port",
        gatewayToken: null,
        gatewayTokenSource: null,
        configPath: "~/.openclaw/openclaw.json",
        configExists: true,
        configParsed: true,
        gatewayPort: 18789,
        gatewayPortSource: "config",
        gatewayMode: "local",
        gatewayReachable: false,
      },
      t,
    })
    expect(result.kind).toBe("config_needed")
    expect(result.detail).toContain("openClawGatewayDown")
    expect(result.detail).toContain("18789")
  })

  it("marks OpenClaw ready only when gateway probe succeeds", () => {
    const result = buildAgentReadiness({
      agent: agent({
        agent_type: "open_claw",
        name: "OpenClaw",
        installed_version: "2026.6.11",
        available: true,
      }),
      draft: draft({ openClawGatewayUrl: "" }),
      checks: passChecks,
      isChecking: false,
      openClawDiscovery: {
        gatewayUrl: "ws://127.0.0.1:19001",
        gatewayUrlSource: "config.remote",
        gatewayToken: "tok",
        gatewayTokenSource: "config",
        configPath: "~/.openclaw/openclaw.json",
        configExists: true,
        configParsed: true,
        gatewayPort: 19001,
        gatewayPortSource: "config",
        gatewayMode: "local",
        gatewayReachable: true,
      },
      t,
    })
    expect(result.kind).toBe("ready")
  })

  it("does not require API key for Hermes oauth providers", () => {
    const result = buildAgentReadiness({
      agent: agent({
        agent_type: "hermes",
        name: "Hermes",
        installed_version: "0.1.0",
        available: true,
      }),
      draft: draft({
        hermesAuthMode: "native",
        hermesProvider: "minimax-oauth",
        model: "MiniMax-M2.5",
        apiKey: "",
      }),
      checks: [
        {
          check_id: "uv_available",
          status: "pass",
          message: "uv ok",
        },
      ],
      isChecking: false,
      t,
    })
    expect(result.kind).toBe("ready")
  })

  it("requires provider selection for Hermes model_provider mode", () => {
    const result = buildAgentReadiness({
      agent: agent({
        agent_type: "hermes",
        name: "Hermes",
        installed_version: "0.1.0",
        available: true,
      }),
      draft: draft({
        hermesAuthMode: "model_provider",
        modelProviderId: null,
      }),
      checks: [
        {
          check_id: "uv_available",
          status: "pass",
          message: "uv ok",
        },
      ],
      isChecking: false,
      t,
    })
    expect(result.kind).toBe("config_needed")
    expect(result.detail).toContain("hermesNeedProvider")
  })

  it("returns not_installed before dependency details", () => {
    const result = buildAgentReadiness({
      agent: agent({
        agent_type: "open_claw",
        name: "OpenClaw",
        installed_version: null,
        available: false,
      }),
      draft: draft(),
      checks: [
        {
          check_id: "node_version",
          status: "fail",
          message: "Node too old",
        },
      ],
      isChecking: false,
      t,
    })
    expect(result.kind).toBe("not_installed")
  })
})
