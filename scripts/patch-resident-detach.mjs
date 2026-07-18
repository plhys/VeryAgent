import fs from "fs"

function withEol(text, crlf) {
  return crlf ? text.replace(/\\n/g, "\\r\\n") : text
}

// 1) types.ts
{
  const p = "src/lib/types.ts"
  let t = fs.readFileSync(p, "utf8")
  const crlf = t.includes("\\r\\n")
  const n = (s) => withEol(s, crlf)
  if (t.includes("isResidentAgent")) {
    console.log("types already has isResidentAgent")
  } else {
    const anchor = n(`export const ALL_AGENT_TYPES: AgentType[] = [
  "claude_code",
  "codex",
  "open_code",
  "gemini",
  "open_claw",
  "cline",
  "hermes",
  "code_buddy",
  "kimi_code",
  "pi",
]
`)
    if (!t.includes(anchor)) {
      console.error("ALL_AGENT_TYPES anchor missing")
      process.exit(1)
    }
    const insert = n(`export const ALL_AGENT_TYPES: AgentType[] = [
  "claude_code",
  "codex",
  "open_code",
  "gemini",
  "open_claw",
  "cline",
  "hermes",
  "code_buddy",
  "kimi_code",
  "pi",
]

/** Process-level resident butlers (match backend registry.resident). */
export function isResidentAgent(agentType: AgentType): boolean {
  return agentType === "hermes"
}
`)
    t = t.replace(anchor, insert)
    fs.writeFileSync(p, t)
    console.log("types.ts ok")
  }
}

// 2) context
{
  const p = "src/contexts/acp-connections-context.tsx"
  let t = fs.readFileSync(p, "utf8")
  const crlf = t.includes("\\r\\n")
  const n = (s) => withEol(s, crlf)

  if (!t.includes("isResidentAgent")) {
    let replaced = false
    t = t.replace(
      /import\\s*\\{([^}]+)\\}\\s*from\\s*"@\\/lib\\/types"/g,
      (full, body) => {
        if (!body.includes("AGENT_LABELS") || body.includes("isResidentAgent")) {
          return full
        }
        replaced = true
        if (body.includes("\\n")) {
          return full.replace(
            body,
            body.replace(/\\s*$/, "") + n("\\n  isResidentAgent,")
          )
        }
        return `import {{${body.replace(/\\s*$/, "")}, isResidentAgent } from "@/lib/types"`
      }
    )
   if (!replaced) {
      console.error("failed to add isResidentAgent import")
      process.exit(1)
    }
    console.log("import ok")
  }

  const replacements = [
    [
      `           // A viewer doesn't own the backend connection — detach only, never
                // acpDisconnect (that would kill the owner's agent). Owners are
                // disconnected normally before re-spawning under new params.
                if (!existing.isViewer) {
                  await acpDisconnect(existing.connectionId).catch(() => {})
                }
                reverseMapRef.current.delete(existing.connectionId)
                teardownAttachSubscription(contextKey)
                lastActivityRef.current.delete(contextKey)
                pendingUnmappedEventsRef.current.delete(existing.connectionId)`,
      `            // A viewer doesn't own the backend connection — detach only, never
                // acpDisconnect (that would kill the owner's agent). Resident
                // butlers (Hermes) also stay warm across agent switches: only the
                // frontend mapping is dropped; idle sweep / app exit reaps them.
                // Owners of non-resident agents are disconnected before re-spawn.
                if (!existing.isViewer && !isResidentAgent(existing.agentType)) {
                  await acpDisconnect(existing.connectionId).catch(() => {})
                }
                reverseMapRef.current.delete(existing.connectionId)
                teardownAttachSubscription(contextKey)
                lastActivityRef.current.delete(contextKey)
                pendingUnmappedEventsRef.current.delete(existing.connectionId)`,
      "switch-away",
    ],
  ]

  for (const [oldRaw, newRaw, label] of replacements) {
    const oldText = n(oldRaw)
    const newText = n(newRaw)
    if (!t.includes(oldText)) {
      console.error(`${label} block missing`)
      process.exit(1)
    }
    t = t.replace(oldText, newText)
    console.log(`${label} ok`)
  }

  fs.writeFileSync(p, t)
  console.log("context partial - switch only")
}
