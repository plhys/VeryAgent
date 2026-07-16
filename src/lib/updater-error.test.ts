import { describe, expect, it } from "vitest"
import { normalizeAppUpdateError } from "./updater"

describe("normalizeAppUpdateError", () => {
  it("classifies missing latest.json as source_unreachable", () => {
    const err = {
      code: "network_error",
      message:
        "Failed to check for updates from GitHub (latest.json): https://github.com/plhys/VeryAgent/releases/latest/download/latest.json",
      detail:
        "error sending request for url (https://github.com/plhys/VeryAgent/releases/latest/download/latest.json)",
    }
    expect(normalizeAppUpdateError(err).kind).toBe("source_unreachable")
  })

  it("classifies 404 as source_unreachable", () => {
    expect(
      normalizeAppUpdateError({
        code: "network_error",
        message: "Update manifest from Gitea returned status 404",
        detail: "Not found.",
      }).kind
    ).toBe("source_unreachable")
  })

  it("classifies plain network without release path", () => {
    expect(
      normalizeAppUpdateError({
        code: "network_error",
        message: "Network connection failed",
        detail: "connection refused",
      }).kind
    ).toBe("network")
  })
})
