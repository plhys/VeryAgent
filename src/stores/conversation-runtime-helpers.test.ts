import { describe, expect, it } from "vitest"
import {
  cleanAgentOutput,
  narrowToolCallStatus,
  extractRevisedPrompt,
  extractAspectToken,
  extractRequestedImageAspect,
  isImageGenerationToolCall,
  isPlatformImageToolName,
  getJoinedChunks,
} from "./conversation-runtime-store"

// ── cleanAgentOutput ───────────────────────────────────────────────

describe("cleanAgentOutput", () => {
  it("returns null for null/empty/whitespace input", () => {
    expect(cleanAgentOutput(null)).toBeNull()
    expect(cleanAgentOutput("")).toBeNull()
    expect(cleanAgentOutput("  ")).toBeNull()
  })

  it("passes through plain text unchanged", () => {
    expect(cleanAgentOutput("hello world")).toBe("hello world")
  })

  it("unwraps JSON array of content blocks", () => {
    const input = '[{"type":"text","text":"Hello"},{"type":"text","text":"World"}]'
    expect(cleanAgentOutput(input)).toBe("Hello\nWorld")
  })

  it("unwraps JSON object with result field", () => {
    expect(cleanAgentOutput('{"result":"done"}')).toBe("done")
    expect(cleanAgentOutput('{"output":"out"}')).toBe("out")
    expect(cleanAgentOutput('{"text":"txt"}')).toBe("txt")
  })

  it("leaves a trailing task_id line as-is (regex needs a following line)", () => {
    // `cleanAgentOutput` trims first, so the trailing `\n` the regex relies on
    // is already gone — the task_id-only line survives.
    expect(cleanAgentOutput("task_id: ses_xxx (for resuming)\n")).toBe(
      "task_id: ses_xxx (for resuming)"
    )
  })

  it("strips task_id prefix before actual content", () => {
    expect(cleanAgentOutput("task_id: ses_1\nactual result")).toBe("actual result")
  })

  it("extracts from <task_result> XML wrapper", () => {
    const input = "<task_result>The answer is 42</task_result>"
    expect(cleanAgentOutput(input)).toBe("The answer is 42")
  })

  it("falls back to trimmed text when nothing special", () => {
    expect(cleanAgentOutput("  just text  ")).toBe("just text")
  })
})

// ── narrowToolCallStatus ───────────────────────────────────────────

describe("narrowToolCallStatus", () => {
  it("returns the status for known ToolCallStatus values", () => {
    expect(narrowToolCallStatus("pending")).toBe("pending")
    expect(narrowToolCallStatus("in_progress")).toBe("in_progress")
    expect(narrowToolCallStatus("completed")).toBe("completed")
    expect(narrowToolCallStatus("failed")).toBe("failed")
  })

  it("returns null for unknown strings", () => {
    expect(narrowToolCallStatus("unknown")).toBeNull()
    expect(narrowToolCallStatus("")).toBeNull()
    expect(narrowToolCallStatus("cancelled")).toBeNull()
  })
})

// ── extractRevisedPrompt ───────────────────────────────────────────

describe("extractRevisedPrompt", () => {
  it("extracts text after 'Revised prompt: '", () => {
    expect(extractRevisedPrompt("Revised prompt: Generate an image of a cat")).toBe(
      "Generate an image of a cat"
    )
  })

  it("falls back to raw content when prefix is absent (fail-open)", () => {
    expect(extractRevisedPrompt("Just some text")).toBe("Just some text")
  })

  it("returns null for null/empty", () => {
    expect(extractRevisedPrompt(null)).toBeNull()
    expect(extractRevisedPrompt("")).toBeNull()
  })
})

// ── extractAspectToken ─────────────────────────────────────────────

describe("extractAspectToken", () => {
  it("extracts --aspect-<N>:<N> token", () => {
    expect(extractAspectToken("--aspect-16:9")).toBe("16:9")
    expect(extractAspectToken("--aspect-1:1")).toBe("1:1")
  })

  it("returns null when no aspect token", () => {
    expect(extractAspectToken("plain text")).toBeNull()
    expect(extractAspectToken("")).toBeNull()
  })
})

// ── extractRequestedImageAspect ────────────────────────────────────

describe("extractRequestedImageAspect", () => {
  it("extracts aspect from revised prompt with --aspect- token", () => {
    const content = "Revised prompt: Create an image --aspect-16:9"
    expect(extractRequestedImageAspect(content)).toBe("16:9")
  })

  it("returns null when content is null", () => {
    expect(extractRequestedImageAspect(null)).toBeNull()
  })
})

// ── isImageGenerationToolCall ──────────────────────────────────────

describe("isImageGenerationToolCall", () => {
  it("returns true when title is 'Image generation'", () => {
    expect(isImageGenerationToolCall({ title: "Image generation" })).toBe(true)
  })

  it("returns true when title contains generate_image", () => {
    expect(isImageGenerationToolCall({ title: "generate_image" })).toBe(true)
  })

  it("returns true when images are present", () => {
    expect(isImageGenerationToolCall({ images: { length: 1 } })).toBe(true)
  })

  it("returns false when no indicators", () => {
    expect(isImageGenerationToolCall({ title: "regular tool" })).toBe(false)
    expect(isImageGenerationToolCall({})).toBe(false)
  })
})

// ── isPlatformImageToolName ────────────────────────────────────────

describe("isPlatformImageToolName", () => {
  it("matches exact names", () => {
    expect(isPlatformImageToolName("generate_image")).toBe(true)
    expect(isPlatformImageToolName("modify_image")).toBe(true)
  })

  it("matches suffixed names", () => {
    expect(isPlatformImageToolName("mcp__generate_image")).toBe(true)
    expect(isPlatformImageToolName("mcp_modify_image")).toBe(true)
  })

  it("rejects unrelated names", () => {
    expect(isPlatformImageToolName("read_file")).toBe(false)
    expect(isPlatformImageToolName("")).toBe(false)
  })
})

// ── getJoinedChunks ────────────────────────────────────────────────

describe("getJoinedChunks", () => {
  it("returns empty string for empty array", () => {
    expect(getJoinedChunks([])).toBe("")
  })

  it("returns single chunk unchanged", () => {
    expect(getJoinedChunks(["hello"])).toBe("hello")
  })

  it("joins multiple chunks", () => {
    expect(getJoinedChunks(["hello", " ", "world"])).toBe("hello world")
  })
})