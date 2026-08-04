import { describe, expect, it } from "vitest"
import {
  localizeConfigOptionName,
  mapPermissionKindKey,
} from "@/lib/config-option-labels"

describe("config option labels", () => {
  it("maps OpenClaw session setting names, not as permissions", () => {
    expect(localizeConfigOptionName("Thought level")).toBe("thoughtLevel")
    expect(localizeConfigOptionName("Fast mode")).toBe("fastMode")
    expect(localizeConfigOptionName("Tool verbosity")).toBe("toolVerbosity")
    expect(localizeConfigOptionName("Plugin trace")).toBe("pluginTrace")
    expect(localizeConfigOptionName("Reasoning stream")).toBe("reasoningStream")
    expect(localizeConfigOptionName("Usage detail")).toBe("usageDetail")
    expect(localizeConfigOptionName("Elevated actions")).toBe("elevatedActions")
  })

  it("maps on/off as switches instead of allow/deny", () => {
    expect(localizeConfigOptionName("off")).toBe("switchOff")
    expect(localizeConfigOptionName("On")).toBe("switchOn")
    expect(localizeConfigOptionName("auto")).toBe("switchAuto")
    expect(localizeConfigOptionName("full")).toBe("switchFull")
    expect(localizeConfigOptionName("stream")).toBe("switchStream")
    expect(localizeConfigOptionName("tokens")).toBe("usageTokens")
    expect(localizeConfigOptionName("ask")).toBe("elevatedAsk")
    expect(localizeConfigOptionName("adaptive")).toBe("thinkingAdaptive")
  })

  it("keeps permission wording on allow/deny only", () => {
    expect(localizeConfigOptionName("Allow once")).toBe("allowOnce")
    expect(localizeConfigOptionName("Always allow")).toBe("allowAlways")
    expect(localizeConfigOptionName("deny")).toBe("deny")
    expect(localizeConfigOptionName("reject")).toBe("deny")
    expect(mapPermissionKindKey("allow_once")).toBe("allowOnce")
    expect(mapPermissionKindKey("reject_always")).toBe("dontAsk")
  })

  it("maps reasoning-effort / strength variants (incl. bare protocol ids)", () => {
    expect(localizeConfigOptionName("Reasoning effort")).toBe("reasoningEffort")
    expect(localizeConfigOptionName("Effort level")).toBe("reasoningEffort")
    expect(localizeConfigOptionName("effortLevel")).toBe("reasoningEffort")
    expect(localizeConfigOptionName("reasoningEffort")).toBe("reasoningEffort")
    expect(localizeConfigOptionName("model_reasoning_effort")).toBe(
      "reasoningEffort"
    )
    expect(localizeConfigOptionName("Model strength")).toBe("reasoningEffort")
    expect(localizeConfigOptionName("thinkingLevel")).toBe("thinkingLevel")
  })

  it("maps permission-mode variants (incl. bare protocol ids)", () => {
    expect(localizeConfigOptionName("Approval mode")).toBe("approvalPreset")
    expect(localizeConfigOptionName("approval")).toBe("approvalPreset")
    expect(localizeConfigOptionName("Permission mode")).toBe("toolPermissions")
    expect(localizeConfigOptionName("permissions")).toBe("toolPermissions")
    expect(localizeConfigOptionName("auto_allow_tools")).toBe("autoAllowTools")
    expect(localizeConfigOptionName("ask_before_tools")).toBe("askBeforeTools")
  })

  it("maps a bare mode option name to a label", () => {
    expect(localizeConfigOptionName("mode")).toBe("modeLabel")
    expect(localizeConfigOptionName("Mode")).toBe("modeLabel")
  })

  it("localizes OpenClaw description strings", () => {
    expect(
      localizeConfigOptionName(
        "Controls how much deliberate reasoning OpenClaw requests from the Gateway model."
      )
    ).toBe("thoughtLevelDesc")
    expect(
      localizeConfigOptionName(
        "Controls how aggressively the session allows elevated execution behavior."
      )
    ).toBe("elevatedActionsDesc")
  })
})
