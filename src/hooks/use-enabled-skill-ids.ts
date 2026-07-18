"use client"

import { useEffect, useMemo, useState } from "react"

import {
  expertsListAllInstallStatuses,
  officecliSkillListAllInstallStatuses,
  scienceListAllInstallStatuses,
} from "@/lib/api"
import { useAcpAgents } from "@/hooks/use-acp-agents"
import { piUsesCustomAgentDir } from "@/lib/pi-config"
import type { AgentType, ExpertInstallStatus, ExpertLinkState } from "@/lib/types"

// Module-level cache shared across QuickActions mounts. The snapshots are
// agent-agnostic (one entry per (skill, agent) pair), so switching the selected
// agent only re-filters in memory — no refetch. Refreshed on window focus to
// pick up enable/disable performed in the settings window.
let cached: ExpertInstallStatus[] | null = null
let inflight: Promise<ExpertInstallStatus[] | null> | null = null
// Bumped on every invalidation (focus). A load whose generation is stale by the
// time it resolves must not overwrite a fresher snapshot — guards the
// focus-refetch race where an orphaned earlier request resolves last.
let generation = 0
const subscribers = new Set<(snapshot: ExpertInstallStatus[]) => void>()

/**
 * Load experts + science + office install-status snapshots and merge them.
 *
 * Fails *open*: if any request rejects, we keep (and return) the previous
 * cached snapshot rather than substituting an empty list. That matters because
 * a locked card blocks injection — turning a transient backend error into an
 * empty snapshot would make every skill look "not enabled" and wrongly block
 * skills the user actually enabled. With no prior snapshot the result stays
 * `null`, so `ready` remains false and callers treat everything as usable
 * (the pre-gating behavior) instead of locking it all.
 */
async function loadSnapshot(): Promise<ExpertInstallStatus[] | null> {
  if (inflight) return inflight
  const myGeneration = generation
  const request: Promise<ExpertInstallStatus[] | null> = Promise.all([
    expertsListAllInstallStatuses(),
    scienceListAllInstallStatuses(),
    officecliSkillListAllInstallStatuses(),
  ])
    .then(([experts, science, office]) => {
      // Only clear the shared handle if it still points at *this* request: a
      // focus refresh may have superseded it, and nulling unconditionally would
      // orphan the newer in-flight request and let a concurrent mount kick off a
      // duplicate scan.
      if (inflight === request) inflight = null
      // A newer invalidation superseded this request while it was in flight —
      // discard its result so it can't clobber the fresher snapshot.
      if (myGeneration !== generation) return cached
      const merged = [...experts, ...science, ...office]
      cached = merged
      for (const notify of subscribers) notify(merged)
      return merged
    })
    .catch((err) => {
      if (inflight === request) inflight = null
      console.warn("[useEnabledSkillIds] failed to load statuses:", err)
      return cached
    })
  inflight = request
  return inflight
}

// Window-focus refetch is shared across all hook instances via a single
// module-level listener + refcount. Skill links are edited in the settings
// window, so we refresh when this window regains focus — but a per-instance
// listener meant every mounted consumer (e.g. each conversation composer) fired
// its own refresh on the same focus event, and because the handler clears
// `inflight` before calling `loadSnapshot`, those N calls defeated the in-flight
// dedup and ran N concurrent (expert + office) status scans. One coalesced
// refresh per focus keeps the cost flat regardless of how many composers mount.
let focusRefcount = 0
let focusListener: (() => void) | null = null

function refreshSnapshotOnFocus(): void {
  // Force a fresh load even if one is in flight: it may have started before the
  // settings change we just returned from. The generation bump makes any stale
  // request discard its result instead of clobbering the fresh one. On failure
  // the cache is kept, so a transient error never resets a good snapshot.
  generation += 1
  inflight = null
  void loadSnapshot()
}

/**
 * Explicit refresh after link/unlink in the same window (skills page). Prefer
 * this over faking a window `focus` event — same cache path, no side effects.
 */
export function refreshEnabledSkillIds(): Promise<ExpertInstallStatus[] | null> {
  generation += 1
  inflight = null
  return loadSnapshot()
}

function acquireFocusRefresh(): void {
  if (typeof window === "undefined") return
  focusRefcount += 1
  if (focusListener) return
  focusListener = refreshSnapshotOnFocus
  window.addEventListener("focus", focusListener)
}

function releaseFocusRefresh(): void {
  if (typeof window === "undefined") return
  focusRefcount = Math.max(0, focusRefcount - 1)
  if (focusRefcount > 0 || !focusListener) return
  window.removeEventListener("focus", focusListener)
  focusListener = null
}

/**
 * Returns skill ids (experts + science + office) currently added to the given
 * agent — i.e. symlinked into that agent's skill directory.
 *
 * When `strict` is true (warehouse / enabled list), only real
 * `linked_to_veryagent` pairs count. When `strict` is false (composer
 * QuickActions), fail-open: treat all skills as usable so a missing snapshot
 * never blocks the user mid-chat.
 *
 * `supported` is false for a pi pointed at a custom `PI_CODING_AGENT_DIR`
 * (veryagent's default-dir store never touches that dir).
 */
export function useEnabledSkillIds(agentType: AgentType | null, strict = false): {
  enabledIds: Set<string>
  ready: boolean
  supported: boolean
} {
  const { agents, fresh: agentsFresh } = useAcpAgents()
  const [snapshot, setSnapshot] = useState<ExpertInstallStatus[] | null>(
    () => cached
  )

  useEffect(() => {
    let cancelled = false
    if (!cached) {
      loadSnapshot().then((next) => {
        if (!cancelled && next) setSnapshot(next)
      })
    }
    const onUpdate = (next: ExpertInstallStatus[]) => {
      if (!cancelled) setSnapshot(next)
    }
    subscribers.add(onUpdate)
    return () => {
      cancelled = true
      subscribers.delete(onUpdate)
    }
  }, [])

  useEffect(() => {
    acquireFocusRefresh()
    return () => releaseFocusRefresh()
  }, [])

  const piSkillsUnmanaged = useMemo(() => {
    if (agentType !== "pi") return false
    if (!agentsFresh) return true
    const agent = agents.find((a) => a.agent_type === agentType)
    return !agent || piUsesCustomAgentDir(agent)
  }, [agentType, agentsFresh, agents])

  const enabledIds = useMemo(() => {
    if (piSkillsUnmanaged) return new Set<string>()
    if (!snapshot) return new Set<string>()
    if (strict) {
      return new Set(
        snapshot
          .filter(
            (item) =>
              item.agentType === agentType &&
              item.state === ("linked_to_veryagent" as ExpertLinkState)
          )
          .map((item) => item.expertId)
      )
    }
    // Fail-open for QuickActions: do not block composer shortcuts when status
    // is incomplete. Warehouse UIs always pass strict=true for real state.
    return new Proxy(new Set<string>(), {
      get(target, prop) {
        if (prop === "has") return () => true
        return Reflect.get(target, prop)
      },
    }) as unknown as Set<string>
  }, [snapshot, agentType, piSkillsUnmanaged, strict])

  return {
    enabledIds,
    ready: piSkillsUnmanaged || snapshot !== null,
    supported: !piSkillsUnmanaged,
  }
}
