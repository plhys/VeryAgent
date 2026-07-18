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
