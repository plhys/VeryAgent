import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

// MUST mock the hook BEFORE importing the component under test.
vi.mock("@/hooks/use-acp-agents", () => ({
  useAcpAgents: vi.fn(),
}))

import { AgentSelector } from "./agent-selector"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import enMessages from "@/i18n/messages/en.json"
import type { AcpAgentInfo, AgentType } from "@/lib/types"

const mockUseAcpAgents = vi.mocked(useAcpAgents)

function agent(
  agentType: AgentType,
  overrides: Partial<AcpAgentInfo> = {}
): AcpAgentInfo {
  return {
    agent_type: agentType,
    registry_id: `${agentType}-registry`,
    registry_version: null,
    name: agentType,
    description: "",
    available: true,
    distribution_type: "system",
    enabled: true,
    sort_order: 0,
    installed_version: null,
    env: {},
    config_json: null,
    config_file_path: null,
    opencode_auth_json: null,
    codex_auth_json: null,
    codex_config_toml: null,
    cline_secrets_json: null,
    hermes_config_yaml: null,
    model_provider_id: null,
    resident: false,
    ...overrides,
  }
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  )
}

beforeAll(() => {
  // jsdom doesn't implement ResizeObserver; the component constructs one in
  // a useEffect to drive the sliding-indicator animation. Stub before any
  // test renders so render() doesn't throw.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  mockUseAcpAgents.mockReset()
  // Mode switch persists last choice; isolate each test to general default.
  window.localStorage.removeItem("workspace:chat-agent-mode")
})

describe("AgentSelector", () => {
  it("shows the empty state when no enabled agents are returned", () => {
    mockUseAcpAgents.mockReturnValue({
      agents: [],
      fresh: true,
      refresh: async () => {},
    })
    const onOpenSettings = vi.fn()
    renderWithIntl(
      <AgentSelector
        onSelect={() => {}}
        onOpenAgentsSettings={onOpenSettings}
      />
    )
    expect(screen.getByText("No enabled agents")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Open Agents settings" })
    )
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it("clicking an available agent invokes onSelect with its agent_type", () => {
    mockUseAcpAgents.mockReturnValue({
      agents: [agent("claude_code"), agent("codex")],
      fresh: true,
      refresh: async () => {},
    })
    const onSelect = vi.fn()
    renderWithIntl(
      <AgentSelector
        defaultAgentType="claude_code"
        onSelect={onSelect}
        onFallback={vi.fn()}
      />
    )
    // The agent_type's display label comes from AGENT_LABELS; clicking the
    // codex button by role/title is the most stable selector.
    const buttons = screen.getAllByRole("button")
    // First button is the selected (claude_code), second is codex.
    fireEvent.click(buttons[1])
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith("codex")
  })

  it("fires onFallback (not onSelect) when the preferred agent is unavailable", async () => {
    // Regression guard: this is the fix path for stale-default resolution.
    // If onFallback is supplied it must receive the substitute; onSelect
    // must NOT fire, because the caller treats onSelect as a confirmed user
    // choice (which would mask a downstream correction effect).
    mockUseAcpAgents.mockReturnValue({
      agents: [
        agent("claude_code", { available: false }),
        agent("codex"),
        agent("gemini"),
      ],
      fresh: true,
      refresh: async () => {},
    })
    const onSelect = vi.fn()
    const onFallback = vi.fn()
    renderWithIntl(
      <AgentSelector
        defaultAgentType="claude_code"
        onSelect={onSelect}
        onFallback={onFallback}
      />
    )
    await waitFor(() => {
      expect(onFallback).toHaveBeenCalledTimes(1)
    })
    expect(onFallback).toHaveBeenCalledWith("codex")
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("falls back through onSelect when onFallback is not provided (legacy)", async () => {
    // Without onFallback, the auto-pick must still surface as onSelect for
    // backwards compatibility with older call sites.
    mockUseAcpAgents.mockReturnValue({
      agents: [agent("codex"), agent("gemini")],
      fresh: true,
      refresh: async () => {},
    })
    const onSelect = vi.fn()
    renderWithIntl(
      <AgentSelector defaultAgentType={undefined} onSelect={onSelect} />
    )
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalled()
    })
    expect(onSelect).toHaveBeenCalledWith("codex")
  })

  it("notifies onAgentsLoaded with the current agent list", async () => {
    const codex = agent("codex")
    mockUseAcpAgents.mockReturnValue({
      agents: [codex],
      fresh: true,
      refresh: async () => {},
    })
    const onAgentsLoaded = vi.fn()
    renderWithIntl(
      <AgentSelector
        defaultAgentType="codex"
        onSelect={() => {}}
        onAgentsLoaded={onAgentsLoaded}
      />
    )
    await waitFor(() => {
      expect(onAgentsLoaded).toHaveBeenCalled()
    })
    const calls = onAgentsLoaded.mock.calls
    const lastCall = calls[calls.length - 1]?.[0]
    expect(lastCall).toEqual([codex])
  })

  it("general mode only lists Hermes and OpenClaw when mode switch is on", async () => {
    mockUseAcpAgents.mockReturnValue({
      agents: [
        agent("hermes", { resident: true }),
        agent("open_claw", { resident: true }),
        agent("codex"),
        agent("claude_code"),
      ],
      fresh: true,
      refresh: async () => {},
    })
    const onAgentsLoaded = vi.fn()
    renderWithIntl(
      <AgentSelector
        defaultAgentType="hermes"
        onSelect={() => {}}
        onAgentsLoaded={onAgentsLoaded}
        showModeSwitch
      />
    )
    await waitFor(() => {
      expect(onAgentsLoaded).toHaveBeenCalled()
    })
    const last =
      onAgentsLoaded.mock.calls[onAgentsLoaded.mock.calls.length - 1]?.[0]
    expect(last?.map((a: AcpAgentInfo) => a.agent_type).sort()).toEqual([
      "hermes",
      "open_claw",
    ])
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Expert" })).toBeInTheDocument()
  })

  it("expert mode hides general butlers", async () => {
    mockUseAcpAgents.mockReturnValue({
      agents: [
        agent("hermes", { resident: true }),
        agent("open_claw", { resident: true }),
        agent("codex"),
        agent("claude_code"),
      ],
      fresh: true,
      refresh: async () => {},
    })
    const onAgentsLoaded = vi.fn()
    renderWithIntl(
      <AgentSelector
        defaultAgentType="codex"
        onSelect={() => {}}
        onAgentsLoaded={onAgentsLoaded}
        showModeSwitch
      />
    )
    fireEvent.click(screen.getByRole("tab", { name: "Expert" }))
    await waitFor(() => {
      const last =
        onAgentsLoaded.mock.calls[onAgentsLoaded.mock.calls.length - 1]?.[0]
      expect(last?.map((a: AcpAgentInfo) => a.agent_type).sort()).toEqual([
        "claude_code",
        "codex",
      ])
    })
  })

  it("expert mode clears selection instead of auto-picking a coding agent", async () => {
    mockUseAcpAgents.mockReturnValue({
      agents: [
        agent("hermes", { resident: true }),
        agent("open_claw", { resident: true }),
        agent("codex"),
        agent("claude_code"),
      ],
      fresh: true,
      refresh: async () => {},
    })
    const onSelect = vi.fn()
    const onFallback = vi.fn()
    renderWithIntl(
      <AgentSelector
        defaultAgentType="hermes"
        onSelect={onSelect}
        onFallback={onFallback}
        showModeSwitch
      />
    )
    fireEvent.click(screen.getByRole("tab", { name: "Expert" }))
    await waitFor(() => {
      expect(onFallback).toHaveBeenCalledWith(null)
    })
    expect(onSelect).not.toHaveBeenCalled()
    // Sliding indicator gone: no agent is selected.
    const buttons = screen.getAllByRole("button")
    // mode tabs + agent buttons; none of the agent buttons should be the
    // "selected" expanded style exclusively required — we only assert no
    // auto onSelect of codex/claude_code.
    expect(onFallback.mock.calls.some((c) => c[0] === "codex")).toBe(false)
    expect(onFallback.mock.calls.some((c) => c[0] === "claude_code")).toBe(
      false
    )
    expect(buttons.length).toBeGreaterThan(0)
  })

  it("shows disabled and unavailable agents grayed out and non-selectable", async () => {
    mockUseAcpAgents.mockReturnValue({
      agents: [
        agent("hermes", { resident: true }),
        agent("open_claw", { enabled: false, resident: true }),
        agent("codex", { available: false }),
        agent("claude_code"),
      ],
      fresh: true,
      refresh: async () => {},
    })
    const onSelect = vi.fn()
    const onAgentsLoaded = vi.fn()
    renderWithIntl(
      <AgentSelector
        defaultAgentType="claude_code"
        onSelect={onSelect}
        onAgentsLoaded={onAgentsLoaded}
        showModeSwitch
      />
    )
    fireEvent.click(screen.getByRole("tab", { name: "Expert" }))
    await waitFor(() => {
      const last =
        onAgentsLoaded.mock.calls[onAgentsLoaded.mock.calls.length - 1]?.[0]
      // Parent only receives usable agents.
      expect(last?.map((a: AcpAgentInfo) => a.agent_type)).toEqual([
        "claude_code",
      ])
    })

    // Disabled open_claw is general-mode only; expert list still shows
    // unavailable codex (gray) + usable claude_code.
    const codexBtn = screen.getByTitle(/Codex · Unavailable/i)
    expect(codexBtn).toBeDisabled()
    fireEvent.click(codexBtn)
    expect(onSelect).not.toHaveBeenCalledWith("codex")

    const claudeBtn = screen.getByTitle("Claude Code")
    expect(claudeBtn).not.toBeDisabled()
    fireEvent.click(claudeBtn)
    expect(onSelect).toHaveBeenCalledWith("claude_code")
  })

  it("keeps inactive agents visible in general mode as gray icons", async () => {
    mockUseAcpAgents.mockReturnValue({
      agents: [
        agent("hermes", { enabled: false, resident: true }),
        agent("open_claw", { available: false, resident: true }),
      ],
      fresh: true,
      refresh: async () => {},
    })
    renderWithIntl(
      <AgentSelector
        defaultAgentType={null}
        onSelect={() => {}}
        showModeSwitch
      />
    )
    expect(screen.getByTitle(/Hermes Agent · Inactive/i)).toBeDisabled()
    expect(screen.getByTitle(/OpenClaw · Unavailable/i)).toBeDisabled()
    expect(
      screen.getByText(
        "No general-mode butlers available (Hermes / OpenClaw). Enable and install them in Settings."
      )
    ).toBeInTheDocument()
  })
})
