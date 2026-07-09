import { create } from "zustand"

export interface ConversationSkillInjectPayload {
  text: string
  skill?: { id: string; label: string }
}

interface ConversationSkillInjectRequest {
  requestId: number
  targetTabId: string
  payload: ConversationSkillInjectPayload
}

interface ConversationSkillInjectStore {
  request: ConversationSkillInjectRequest | null
  queueInject: (
    targetTabId: string,
    payload: ConversationSkillInjectPayload
  ) => void
  clearRequest: (requestId: number) => void
}

let nextRequestId = 1

export const useConversationSkillInjectStore =
  create<ConversationSkillInjectStore>((set) => ({
    request: null,
    queueInject: (targetTabId, payload) =>
      set({
        request: {
          requestId: nextRequestId++,
          targetTabId,
          payload,
        },
      }),
    clearRequest: (requestId) =>
      set((state) =>
        state.request?.requestId === requestId ? { request: null } : state
      ),
  }))
