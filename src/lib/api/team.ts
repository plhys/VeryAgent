import { getTransport } from "@/lib/transport"
import type {
  Team,
  TeamDraft,
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

export async function teamSetLeaderConversation(
  id: string,
  conversationId: number
): Promise<void> {
  return getTransport().call("team_set_leader_conversation", {
    id,
    conversationId,
  })
}

export async function teamAssignTask(
  teamId: string,
  ownerSlotId: string,
  subject: string,
  description?: string | null
): Promise<TeamTask> {
  return getTransport().call("team_assign_task", {
    teamId,
    ownerSlotId,
    subject,
    description: description ?? null,
  })
}

export async function teamSetTaskStatus(
  taskId: string,
  status: TeamTaskStatus
): Promise<TeamTask> {
  return getTransport().call("team_set_task_status", { taskId, status })
}
