import {
  getTransport,
} from "../transport"
import { TurnBusyError, isTurnInProgressRejection } from "../turn-busy"
import type {
  AgentType,
  ConnectionInfo,
  ConversationConnectionInfo,
  LiveSessionSnapshot,
  QuestionAnswer,
  PromptInputBlock,
} from "../types"


export async function acpConnect(
  agentType: AgentType,
  workingDir?: string,
  sessionId?: string,
  preferredModeId?: string | null,
  preferredConfigValues?: Record<string, string> | null
): Promise<string> {
  return getTransport().call("acp_connect", {
    agentType,
    workingDir: workingDir ?? null,
    sessionId: sessionId ?? null,
    preferredModeId: preferredModeId ?? null,
    preferredConfigValues: preferredConfigValues ?? null,
  })
}


export async function acpPrompt(
  connectionId: string,
  blocks: PromptInputBlock[],
  folderId: number | null = null,
  conversationId: number | null = null,
  clientMessageId: string | null = null
): Promise<void> {
  try {
    await getTransport().call("acp_prompt", {
      connectionId,
      blocks,
      folderId,
      conversationId,
      clientMessageId,
    })
  } catch (e) {
    if (isTurnInProgressRejection(e)) throw new TurnBusyError()
    throw e
  }
}


export async function acpSetMode(
  connectionId: string,
  modeId: string
): Promise<void> {
  return getTransport().call("acp_set_mode", { connectionId, modeId })
}


export async function acpSetConfigOption(
  connectionId: string,
  configId: string,
  valueId: string
): Promise<void> {
  return getTransport().call("acp_set_config_option", {
    connectionId,
    configId,
    valueId,
  })
}


export async function acpCancel(connectionId: string): Promise<void> {
  return getTransport().call("acp_cancel", { connectionId })
}


export interface ForkResult {
  forkedSessionId: string
  originalSessionId: string
  siblingConversationId: number
}


export async function acpFork(connectionId: string): Promise<ForkResult> {
  try {
    return await getTransport().call("acp_fork", { connectionId })
  } catch (e) {
    // A fork is serialized with prompts on the backend: it returns
    // TurnInProgress while a turn is in flight. Surface it as TurnBusyError so
    // callers can treat it as transient (re-queue) rather than a fork failure.
    if (isTurnInProgressRejection(e)) throw new TurnBusyError()
    throw e
  }
}


export async function acpRespondPermission(
  connectionId: string,
  requestId: string,
  optionId: string
): Promise<void> {
  return getTransport().call("acp_respond_permission", {
    connectionId,
    requestId,
    optionId,
  })
}

/**
 * Submit the user's answer to a blocking `ask_user_question`. Resolves the
 * parked tool call on the backend (and clears the card on every client via the
 * `question_resolved` event). Idempotent: answering an already-resolved /
 * unknown `questionId` is a no-op success.
 */

export async function acpAnswerQuestion(
  connectionId: string,
  questionId: string,
  answer: QuestionAnswer
): Promise<void> {
  return getTransport().call("acp_answer_question", {
    connectionId,
    questionId,
    answer,
  })
}


export async function acpDisconnect(connectionId: string): Promise<void> {
  return getTransport().call("acp_disconnect", { connectionId })
}


export async function acpTouchConnection(
  connectionId: string
): Promise<boolean> {
  return getTransport().call("acp_touch_connection", { connectionId })
}


export async function acpListConnections(): Promise<ConnectionInfo[]> {
  return getTransport().call("acp_list_connections")
}


export async function acpGetSessionSnapshot(
  connectionId: string
): Promise<LiveSessionSnapshot | null> {
  return getTransport().call("acp_get_session_snapshot", { connectionId })
}


export async function acpGetSessionSnapshotByConversation(
  conversationId: number
): Promise<LiveSessionSnapshot | null> {
  return getTransport().call("acp_get_session_snapshot_by_conversation", {
    conversationId,
  })
}


export async function acpFindConnectionForConversation(
  conversationId: number,
  sessionId: string | undefined,
  agentType: AgentType
): Promise<ConversationConnectionInfo | null> {
  return getTransport().call("acp_find_connection_for_conversation", {
    conversationId,
    sessionId,
    agentType,
  })
}


