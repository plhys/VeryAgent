import { getTransport } from "@/lib/transport"
import type {
  Team,
  TeamDraft,
  TeamSlot,
  TeamSlotStatus,
  TeamSummary,
  TeamTask,
  TeamTaskStatus,
} from "@/lib/types"

export async function teamList(): Promise<TeamSummary[]> {
  return getTransport().call("team_list")
}

export async function teamGet(id: string): Promise<Team> {
  return getTransport().call("team_get", { id })
}

export async function teamCreate(draft: TeamDraft): Promise<Team> {
  return getTransport().call("team_create", { draft })
}

export async function teamDelete(id: string): Promise<void> {
  return getTransport().call("team_delete", { id })
}

/**
 * 解散团队（软归档）：团队从侧边栏消失，但所有记录保留；同一工作区新建团队
 * 时自动恢复原团队（成员/任务/历史对话全回来）。
 */
export async function teamDisband(id: string): Promise<void> {
  return getTransport().call("team_disband", { id })
}

export async function teamSetLeaderConversation(
  id: string,
  conversationId: number
): Promise<void> {
  return getTransport().call("team_set_leader_conversation", {
    id,
    conversationId,
  })
}

/**
 * Assign a task to a member slot. `conversationId` (the member conversation
 * minted for this task) is attached to the task AND the slot in one call — the
 * backend also flips the member to `working`.
 */
export async function teamAssignTask(
  teamId: string,
  ownerSlotId: string,
  subject: string,
  description?: string | null,
  conversationId?: number | null
): Promise<TeamTask> {
  return getTransport().call("team_assign_task", {
    teamId,
    ownerSlotId,
    subject,
    description: description ?? null,
    conversationId: conversationId ?? null,
  })
}

export async function teamSetSlotStatus(
  slotId: string,
  status: TeamSlotStatus
): Promise<TeamSlot> {
  return getTransport().call("team_set_slot_status", { slotId, status })
}

export async function teamSetTaskStatus(
  taskId: string,
  status: TeamTaskStatus
): Promise<TeamTask> {
  return getTransport().call("team_set_task_status", { taskId, status })
}
