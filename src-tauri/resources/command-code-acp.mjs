#!/usr/bin/env node
// VeryAgent × Command Code ACP adapter.
//
// Bridges VeryAgent (an ACP host over stdio JSON-RPC 2.0) to the Command Code
// CLI (`cmdc`). Command Code has no native ACP server mode, so this adapter
// drives its headless NDJSON event stream:
//
//   cmdc <message> -p --output-format json --yolo
//
// and maps the emitted AgentEvent frames onto ACP `session/update`
// notifications (agent_message_chunk / agent_thought_chunk / tool_call /
// tool_call_update) plus `session/request_permission` for tool approvals.
//
// The wire format is pinned to the `sacp` schema used by VeryAgent (the
// `agent-client-protocol-schema` crate, v0.11.x / ACP protocol v1).
//
// SECURITY / PERMISSION MODEL
// ---------------------------
// Command Code's headless mode auto-denies every permission prompt
// (`cmd.ui.confirm → false`) and exposes no external answer channel. We
// therefore launch it with `--yolo` (bypass internal prompts) and enforce
// approvals *here*, at the adapter: each tool the agent queues is surfaced to
// the host as an ACP `session/request_permission`; if the host rejects it, the
// tool's execution events are suppressed (the agent still runs the tool on its
// side, but its result is never delivered back).
//
// This is a *notification-style* permission model, not a sandbox: a rejected
// tool still executes inside `cmdc` (that is a Command Code limitation). The
// UI-facing semantics — "see every tool call, approve or deny" — are complete.
//
// SESSION SEMANTICS
// -----------------
// Each ACP `session/new` hosts a single `session/prompt` (one cold `cmdc`
// invocation), matching Command Code's one-shot headless mode. `session/load`
// / `session/resume` / `session/fork` are not supported and return "method not
// found". The host (VeryAgent) owns conversation history persistence.
//
// PROTOCOL
// --------
// ACP over stdio: one JSON-RPC 2.0 message per line, LF-terminated, UTF-8.
// Responses and notifications go to stdout; diagnostics go to stderr. Set
// VERYAGENT_ACP_DEBUG=1 to log the JSON-RPC traffic on stderr.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

const VERSION = "0.1.1";
const DEBUG = process.env.VERYAGENT_ACP_DEBUG === "1";

function debug(...args) {
  if (DEBUG) {
    process.stderr.write(`[command-code-acp] ${args.join(" ")}\n`);
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 plumbing
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

let pending = new Map(); // id -> { resolve, reject }
let seq = 0;

function send(obj) {
  const line = JSON.stringify(obj);
  process.stdout.write(line + "\n");
  debug("→", line);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function request(method, params, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, timeoutMs);
  });
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    debug("ignoring non-JSON line");
    return;
  }
  if (msg.id != null && msg.method == null) {
    // Response to one of our requests (e.g. session/request_permission).
    const entry = pending.get(msg.id);
    if (entry) {
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message || "JSON-RPC error"));
      else entry.resolve(msg.result);
    }
    return;
  }
  handleRequest(msg).catch((err) => {
    debug("request handler error:", err?.stack || err);
    // Notifications (no id) must not be answered.
    if (msg.id != null) replyError(msg.id, -32603, String(err?.message || err));
  });
});

rl.on("close", () => {
  // stdin EOF — the host went away; tear down the cmdc child if any.
  teardown();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// cmdc NDJSON parsing
// ---------------------------------------------------------------------------

let activeChild = null; // current cmdc child process
let pendingPromptId = null; // JSON-RPC id of the in-flight session/prompt

function resolvePendingPromptCancelled() {
  if (pendingPromptId != null) {
    const id = pendingPromptId;
    pendingPromptId = null;
    reply(id, { stopReason: "cancelled" });
  }
}

function killChild() {
  if (activeChild) {
    const c = activeChild;
    activeChild = null;
    try {
      c.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  }
}

function teardown() {
  killChild();
}

// ---------------------------------------------------------------------------
// ACP session state
// ---------------------------------------------------------------------------

let session = null; // { id, cwd, model, permissionMode } // Command Code ACP session state

// Cache for model list discovered from `cmdc --list-models`.
let cachedModels = null; // [{value, name}, ...]

function resolveModelEntry() {
  const { command, args: entryArgs } = resolveCmdcLaunch();
  return { command, args: entryArgs };
}

async function discoverModels() {
  const { command, args } = resolveModelEntry();
  const listArgs = [...args, "--list-models"];
  return new Promise((resolve) => {
    const child = spawn(command, listArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.on("close", (code) => {
      if (code !== 0) { resolve(null); return; }
      const models = [];
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Skip headers, separators, blank lines, section titles, and usage lines
        if (trimmed.startsWith("Available") || trimmed.startsWith("---") || trimmed.startsWith("──") || trimmed.endsWith(":") || trimmed.startsWith("cmdc") || trimmed.startsWith("Docs:") || trimmed.startsWith("Pass the")) continue;
        const match = trimmed.match(/^(\S+)\s+/);
        if (match) {
          const id = match[1];
          // Skip non-model lines (section headers, usage hints, etc.)
          if (id.includes("/") || id.includes("-") || (id === id.toLowerCase() && id.length > 2)) {
            models.push({ value: id, name: id });
          }
        }
      }
      resolve(models.length > 0 ? models : null);
    });
    child.on("error", () => resolve(null));
  });
}

// Shut down stdin processing until model discovery completes.
// Hold incoming lines in a buffer, replay after initialization.
const pendingLines = [];
const origLineHandler = rl.listeners("line")[0];
rl.removeAllListeners("line");
rl.on("line", (line) => { pendingLines.push(line); });

// Run model discovery synchronously at startup, then replay buffered lines.
const initPromise = discoverModels().then((models) => {
  cachedModels = models;
  // Replay buffered lines (initialize, etc.)
  rl.removeAllListeners("line");
  rl.on("line", origLineHandler);
  for (const line of pendingLines) {
    origLineHandler(line);
  }
  pendingLines.length = 0;
}).catch(() => {
  rl.removeAllListeners("line");
  rl.on("line", origLineHandler);
  for (const line of pendingLines) {
    origLineHandler(line);
  }
  pendingLines.length = 0;
});

function commandCodeConfigOptions() {
  const configuredModel = process.env.COMMAND_CODE_MODEL || "deepseek/deepseek-v4-flash";
  const models = cachedModels || [
    { value: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { value: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { value: "moonshotai/kimi-k2.5", name: "Kimi K2.5" },
    { value: "moonshotai/kimi-k3", name: "Kimi K3" },
    { value: "qwen/qwen3.7-plus", name: "Qwen 3.7 Plus" },
    { value: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash" },
    { value: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { value: "gpt-5.5", name: "GPT-5.5" },
  ];
  return [
    {
      id: "model",
      name: "Model",
      description: "Choose the native Command Code model for the next prompt",
      category: "model",
      type: "select",
      currentValue: session?.model || configuredModel,
      options: models.map((m) => ({ value: m.value, name: m.name })),
    },
    {
      id: "permission_mode",
      name: "Permission",
      description: "Tool call approval mode",
      category: "permissions",
      type: "select",
      currentValue: session?.permissionMode || "auto",
      options: [
        { value: "auto", name: "Auto-allow" },
        { value: "ask", name: "Ask" },
        { value: "yolo", name: "YOLO" },
      ],
    },
  ];
}

// Track tool ids whose permission was denied by the host. Their execution
// events are suppressed.
let deniedTools = new Set();
// Whether the current run already streamed assistant text (text_delta); used
// to avoid re-emitting finalText as a duplicate message on the result frame.
let streamedText = false;

// ---------------------------------------------------------------------------
// ACP wire helpers (pinned to sacp schema, ACP v1)
// ---------------------------------------------------------------------------

function contentBlockText(text) {
  return { type: "text", text };
}

function sendSessionUpdate(update) {
  notify("session/update", {
    sessionId: session?.id ?? "",
    update,
  });
}

function emitTextChunk(text) {
  sendSessionUpdate({
    sessionUpdate: "agent_message_chunk",
    content: contentBlockText(text),
  });
}

function emitThoughtChunk(text) {
  sendSessionUpdate({
    sessionUpdate: "agent_thought_chunk",
    content: contentBlockText(text),
  });
}

// Map a cmdc tool frame onto an ACP ToolCallUpdate payload
// (`{toolCallId, title, kind, status, rawInput, rawOutput, ...}`).
// SessionUpdate is a tagged enum (`#[serde(tag = "sessionUpdate")]`), so the
// ToolCall / ToolCallUpdate fields MUST be flat (not nested under a key) and
// use camelCase to match `#[serde(rename_all = "camelCase")]` on the structs.
function toolCallUpdateFromFrame(event) {
  const id = event.toolCallId || event.id || `tool-${seq++}`;
  const name = event.toolName || event.name || "tool";
  const input = event.input ?? event.args ?? {};
  return {
    toolCallId: id,
    title: name,
    kind: toolKindForName(name),
    status: "pending",
    ...(input !== undefined ? { rawInput: input } : {}),
  };
}

function emitToolCall(frame) {
  sendSessionUpdate({
    sessionUpdate: "tool_call",
    ...toolCallUpdateFromFrame(frame),
  });
}

function emitToolCallUpdate(toolCallId, fields) {
  sendSessionUpdate({
    sessionUpdate: "tool_call_update",
    toolCallId,
    ...fields,
  });
}

function toolKindForName(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("read") || n.includes("cat") || n.includes("view") || n.includes("list")) return "read";
  if (n.includes("edit") || n.includes("write") || n.includes("patch") || n.includes("apply")) return "edit";
  if (n.includes("del") || n.includes("rm") || n.includes("remove")) return "delete";
  if (n.includes("move") || n.includes("rename") || n.includes("mv")) return "move";
  if (n.includes("search") || n.includes("grep") || n.includes("find")) return "search";
  if (n.includes("bash") || n.includes("shell") || n.includes("exec") || n.includes("run") || n.includes("terminal") || n.includes("command")) return "execute";
  if (n.includes("fetch") || n.includes("curl") || n.includes("http") || n.includes("web")) return "fetch";
  return "other";
}

// ---------------------------------------------------------------------------
// ACP request handlers
// ---------------------------------------------------------------------------

async function handleRequest(msg) {
  const { method, params, id } = msg;

  switch (method) {
    case "initialize": {
      // InitializeResponse: { protocolVersion, agentCapabilities, authMethods, agentInfo }
      reply(id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: {
            text: true,
            resourceLinks: false,
            embeddedContext: false,
            image: false,
            audio: false,
          },
          mcpCapabilities: { supported: false },
          sessionCapabilities: {},
        },
        authMethods: [],
        agentInfo: {
          name: "command-code-acp",
          version: VERSION,
        },
      });
      return;
    }
    case "session/new": {
      const cwd = params?.cwd || process.cwd();
      const sessionId = `command-code-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const models = cachedModels || [];
      const defaultModel = models.length > 0 ? models[0].value : "deepseek/deepseek-v4-flash";
      session = { id: sessionId, cwd, model: defaultModel, permissionMode: "auto" };
      reply(id, { sessionId, configOptions: commandCodeConfigOptions() });
      return;
    }
    case "session/set_config_option": {
      if (!session) {
        replyError(id, -32002, "No active session; call session/new first");
        return;
      }
      const configId = params?.configId;
      const value = params?.value;
      if (configId === "model") {
        const models = cachedModels || [];
        const isValid = models.length === 0 || models.some((m) => m.value === value);
        if (isValid) {
          session.model = value;
        } else {
          replyError(id, -32602, `Unsupported model: ${value}`);
          return;
        }
      } else if (configId === "permission_mode" && (value === "auto" || value === "ask" || value === "yolo")) {
        session.permissionMode = value;
      } else {
        replyError(id, -32602, `Unsupported Command Code config: ${configId}=${value}`);
        return;
      }
      reply(id, { configOptions: commandCodeConfigOptions() });
      return;
    }
    case "session/load":
    case "session/resume":
    case "session/fork":
      replyError(id, -32601, `Method not found: ${method}`);
      return;
    case "session/prompt": {
      if (!session) {
        replyError(id, -32002, "No active session; call session/new first");
        return;
      }
      await handleSessionPrompt(id, params);
      return;
    }
    case "session/cancel": {
      // Kill the in-flight cmdc run. Per ACP, the prompt response MUST then
      // report stopReason "cancelled". Acknowledge the request if it has an
      // id (some hosts send it as a request, others as a notification).
      killChild();
      resolvePendingPromptCancelled();
      if (id != null) reply(id, {});
      return;
    }
    default:
      // Notifications (no id) are not answered; unknown requests get -32601.
      if (id != null) replyError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// session/prompt: spawn cmdc and translate NDJSON → ACP
// ---------------------------------------------------------------------------

// Resolve how to launch the Command Code CLI. Returns { command, args } where
// `command` is a direct executable (node on Windows, the shim name on Unix).
//
// On Windows `cmdc` is an npm `.cmd` shim which cannot be exec'd directly and
// `shell: true` mangles args (quotes are lost, multi-word messages split).
// Instead we resolve the shim's real target — `node <npm-dir>/node_modules/
// command-code/dist/index.mjs` — and spawn node directly with an argv array.
function resolveCmdcLaunch() {
  const envCmd = process.env.COMMAND_CODE_ACP_CMD;
  if (envCmd) {
    return { command: envCmd, args: [] };
  }

  if (process.platform === "win32") {
    // The npm global bin dir containing cmdc.cmd.
    const npmDir = process.env.APPDATA
      ? join(process.env.APPDATA, "npm")
      : null;
    if (npmDir) {
      const entry = join(npmDir, "node_modules", "command-code", "dist", "index.mjs");
      if (existsSync(entry)) {
        return { command: process.execPath, args: [entry] };
      }
      // Fall back to the shim itself; requires a shell (unusual).
      const shim = join(npmDir, "cmdc.cmd");
      if (existsSync(shim)) return { command: shim, args: [] };
    }
  }

  // Unix (or a bare cmdc on PATH): spawn directly, argv is preserved.
  return { command: "cmdc", args: [] };
}

function cmdcArgs(message, cwd) {
  const args = ["-p", "--output-format", "json", "--yolo"];
  if (session?.model) args.push("--model", session.model);
  // Run inside the session cwd so relative file paths resolve there.
  if (cwd) args.push("--add-dir", cwd);
  // The query argument must come last — commander treats everything after
  // the query as part of it, so flags must precede the message.
  if (message) args.push(message);
  return args;
}

// Extract the user's text from an ACP PromptRequest (`{sessionId, prompt: [ContentBlock]}`).
function extractPromptText(params) {
  const prompt = params?.prompt;
  if (!Array.isArray(prompt)) return "";
  return prompt
    .map((block) => {
      if (!block) return "";
      if (block.type === "text") return block.text ?? "";
      if (typeof block === "string") return block;
      return "";
    })
    .filter((s) => s)
    .join("\n");
}

function handleEventFrame(event) {
  const type = event?.type;

  switch (type) {
    case "text_delta":
      emitTextChunk(event.delta ?? event.text ?? "");
      streamedText = true;
      break;
    case "thinking_delta":
      emitThoughtChunk(event.delta ?? "");
      break;
    case "thinking_end":
      if (event.text) emitThoughtChunk(event.text);
      break;
    case "tool_queued": {
      const id = event.toolCallId || event.id;
      if (!id) break;
      deniedTools.delete(id);
      emitToolCall(event);
      // Request host approval via session/request_permission. The host
      // responds on the SAME JSON-RPC id (no separate response method).
      const reqParams = {
        sessionId: session?.id ?? "",
        toolCall: {
          toolCallId: id,
          title: event.toolName || event.name || "tool",
          kind: toolKindForName(event.toolName),
          status: "pending",
          ...(event.input !== undefined ? { rawInput: event.input } : {}),
        },
        options: [
          { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
          { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
          { optionId: "reject_once", name: "Reject once", kind: "reject_once" },
          { optionId: "reject_always", name: "Reject always", kind: "reject_always" },
        ],
      };
      if (session?.permissionMode === "yolo") {
        // YOLO mode: bypass all permission checks, don't emit any tool call
        // events. The cmdc child already runs with --yolo, so this just
        // suppresses the ACP-level tool call cards entirely.
        break;
      }
      if (session?.permissionMode === "auto") {
        emitToolCallUpdate(id, { status: "in_progress" });
        break;
      }
      request("session/request_permission", reqParams)
        .then((result) => {
          // result = { outcome: { outcome: "selected", option_id } | "cancelled" }
          const outcome = result?.outcome;
          const selected = outcome?.option_id;
          if (
            selected === "reject_once" ||
            selected === "reject_always" ||
            selected === "deny"
          ) {
            deniedTools.add(id);
            emitToolCallUpdate(id, {
              status: "failed",
              rawOutput: { error: "Permission denied by host" },
            });
          }
        })
        .catch(() => {
          // Host never answered — default to denied to be safe.
          deniedTools.add(id);
          emitToolCallUpdate(id, {
            status: "failed",
            rawOutput: { error: "Permission request unanswered" },
          });
        });
      break;
    }
    case "tool_running": {
      const id = event.toolCallId;
      if (id && !deniedTools.has(id)) {
        emitToolCallUpdate(id, { status: "in_progress" });
      }
      break;
    }
    case "tool_completed": {
      const id = event.toolCallId;
      if (id && !deniedTools.has(id)) {
        const out = Array.isArray(event.result)
          ? event.result.map((p) => (p?.type === "text" ? p.text : "")).join("\n")
          : event.result ?? event.output ?? "";
        emitToolCallUpdate(id, {
          status: "completed",
          ...(out ? { rawOutput: out } : {}),
        });
      }
      deniedTools.delete(id);
      break;
    }
    case "tool_errored": {
      const id = event.toolCallId;
      if (id && !deniedTools.has(id)) {
        emitToolCallUpdate(id, {
          status: "failed",
          rawOutput: { error: event.error?.message || event.error || "Tool error" },
        });
      }
      deniedTools.delete(id);
      break;
    }
    case "turn_start":
    case "turn_end":
    case "message_start":
    case "message_end":
    case "message_update":
    case "model_request_start":
    case "model_request_end":
    case "model_trace":
    case "run_start":
    case "run_end":
      // No ACP equivalent; the host derives run/turn boundaries from session/prompt.
      break;
    default:
      debug("unhandled event type:", type);
  }
}

function handleResultFrame(result) {
  // The `result` line carries finalText / stopReason / usage. The final text
  // was already streamed via text_delta, so only use finalText as a fallback
  // when nothing was streamed.
  const finalText = result?.finalText ?? "";
  if (finalText && !streamedText) emitTextChunk(finalText);
  streamedText = false;
  // PromptResponse: { stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled" }
  const stop = result?.stopReason || "end_turn";
  let stopReason = "end_turn";
  if (stop === "max_turns" || stop === "max_tokens") stopReason = "max_turn_requests";
  else if (stop === "refusal" || stop === "refused") stopReason = "refusal";
  else if (stop === "cancelled" || stop === "canceled") stopReason = "cancelled";
  return { stopReason };
}

async function handleSessionPrompt(id, params) {
  const message = extractPromptText(params);
  const cwd = session?.cwd || process.cwd();
  const { command: cmd, args: entryArgs } = resolveCmdcLaunch();
  const args = [...entryArgs, ...cmdcArgs(message, cwd)];

  debug("spawning:", cmd, args.join(" "));

  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  activeChild = child;

  let childError = null;
  let stderrBuf = "";
  child.on("error", (err) => {
    childError = err;
    debug("cmdc spawn error:", err.message);
  });

  const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      killChild();
    }
  };

  pendingPromptId = id;
  stdout.on("line", (line) => {
    if (!line.trim()) return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      debug("ignoring non-JSON line from cmdc");
      return;
    }
    if (frame.type === "event") {
      handleEventFrame(frame.event);
    } else if (frame.type === "result") {
      const resultInfo = handleResultFrame(frame);
      finish();
      pendingPromptId = null;
      reply(id, resultInfo);
    }
  });

  child.stderr.on("data", (chunk) => {
    const s = chunk.toString();
    stderrBuf = (stderrBuf + s).slice(-4096); // keep the tail for error reporting
    process.stderr.write(`[cmdc] ${s}`);
  });

  child.on("close", (code) => {
    if (!done) {
      done = true;
      activeChild = null;
      const wasCancelled = pendingPromptId === null;
      pendingPromptId = null;
      if (wasCancelled) {
        // session/cancel already resolved the prompt with stopReason
        // "cancelled"; nothing more to send.
        return;
      }
      if (childError) {
        replyError(id, -32003, `Failed to spawn cmdc: ${childError.message}`);
      } else if (code !== 0) {
        // Exit code 3 = not authenticated (cmdc login). Surface the agent's
        // own stderr tail so the user sees why the run failed.
        const detail = stderrBuf.trim() ? `: ${stderrBuf.trim()}` : "";
        const hint =
          code === 3
            ? ". Command Code is not logged in — run `cmdc login` in a terminal first."
            : "";
        replyError(id, -32004, `cmdc exited with code ${code}${hint}${detail}`);
      } else {
        // Should not normally happen (result frame precedes close), but be safe.
        reply(id, { stopReason: "end_turn" });
      }
    }
  });

  // Ensure the child doesn't outlive us if the host disconnects mid-turn.
  const cleanup = () => {
    if (activeChild === child) activeChild = null;
    killChild();
  };
  child.once("exit", cleanup);
}

// ---------------------------------------------------------------------------
// CLI bootstrap
// ---------------------------------------------------------------------------

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(
    [
      "command-code-acp — ACP adapter for Command Code CLI",
      "",
      "Usage: node command-code-acp.mjs [--help|--version]",
      "",
      "Speaks the Agent Client Protocol (ACP) over stdio JSON-RPC 2.0.",
      "Spawns `cmdc -p --output-format json --yolo` per session/prompt and maps",
      "its NDJSON event stream to ACP session/update notifications.",
      "",
      "Environment:",
      "  COMMAND_CODE_ACP_CMD   cmdc binary/command to drive (default: cmdc)",
      "  VERYAGENT_ACP_DEBUG=1  log JSON-RPC traffic to stderr",
      "",
    ].join("\n"),
  );
  process.exit(0);
}
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  process.stdout.write(`command-code-acp ${VERSION}\n`);
  process.exit(0);
}

// Keep alive until stdin closes.
process.stdin.resume();
