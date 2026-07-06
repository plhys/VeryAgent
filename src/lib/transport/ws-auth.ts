export const VERYAGENT_WS_PROTOCOL = "veryagent-events"
const VERYAGENT_WS_TOKEN_PROTOCOL_PREFIX = "veryagent-token."

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function buildVeryAgentWebSocketProtocols(token: string): string[] {
  const trimmed = token.trim()
  if (!trimmed) return [VERYAGENT_WS_PROTOCOL]
  return [
    VERYAGENT_WS_PROTOCOL,
    `${VERYAGENT_WS_TOKEN_PROTOCOL_PREFIX}${base64UrlEncode(trimmed)}`,
  ]
}
