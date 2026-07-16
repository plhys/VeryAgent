import { describe, expect, it } from "vitest"
import { normalizeAppUpdateError } from "./updater"

describe("normalizeAppUpdateError", () => {
  it("classifies GitHub connect failure with source, url, and network reason", () => {
    const err = {
      code: "network_error",
      message:
        "Failed to check for updates from GitHub (latest.json): https://github.com/plhys/VeryAgent/releases/latest/download/latest.json",
      detail:
        "error sending request for url (https://github.com/plhys/VeryAgent/releases/latest/download/latest.json) — GitHub (https://github.com/plhys/VeryAgent/releases/latest/download/latest.json)",
    }
    const info = normalizeAppUpdateError(err)
    expect(info.kind).toBe("source_unreachable")
    expect(info.sourceLabel).toBe("GitHub")
    expect(info.manifestUrl).toBe(
      "https://github.com/plhys/VeryAgent/releases/latest/download/latest.json"
    )
    expect(info.failureReason).toBe("network")
  })

  it("classifies Gitea 404 as not_found with source and url", () => {
    const info = normalizeAppUpdateError({
      code: "network_error",
      message:
        "Update manifest from Gitea returned status 404 (http://10.10.100.233:3030/boss/veryagent/releases/latest/download/latest.json)",
      detail: "Not found.",
    })
    expect(info.kind).toBe("source_unreachable")
    expect(info.sourceLabel).toBe("Gitea")
    expect(info.manifestUrl).toBe(
      "http://10.10.100.233:3030/boss/veryagent/releases/latest/download/latest.json"
    )
    expect(info.failureReason).toBe("not_found")
  })

  it("classifies timeout against a release URL", () => {
    const info = normalizeAppUpdateError({
      code: "network_error",
      message:
        "Failed to check for updates from Gitea (latest.json): http://10.10.100.233:3030/boss/veryagent/releases/latest/download/latest.json",
      detail: "operation timed out",
    })
    expect(info.kind).toBe("source_unreachable")
    expect(info.sourceLabel).toBe("Gitea")
    expect(info.failureReason).toBe("timeout")
  })

  it("classifies plain network without release path", () => {
    const info = normalizeAppUpdateError({
      code: "network_error",
      message: "Network connection failed",
      detail: "connection refused",
    })
    expect(info.kind).toBe("network")
    expect(info.failureReason).toBe("network")
    expect(info.sourceLabel ?? null).toBeNull()
    expect(info.manifestUrl ?? null).toBeNull()
  })

  it("treats empty-channel plugin wording as not_found", () => {
    const info = normalizeAppUpdateError(
      "Could not fetch a valid release JSON from the remote"
    )
    expect(info.kind).toBe("source_unreachable")
    expect(info.failureReason).toBe("not_found")
  })
})
