import { useCallback, useRef, useState } from "react"
import { subscribe } from "@/lib/platform"
import type {
  OpenWikiInstallEvent,
  OpenWikiInstallEventKind,
} from "@/lib/types"

const OPENWIKI_INSTALL_EVENT = "app://openwiki-install"

export type OpenWikiInstallStatus = "idle" | "running" | "success" | "failed"

interface OpenWikiInstallStreamState {
  status: OpenWikiInstallStatus
  percent: number
  label: string
  logs: string[]
  error: string | null
}

function parseProgressPayload(payload: string): { percent: number; label: string } | null {
  try {
    const parsed = JSON.parse(payload) as { percent?: unknown; label?: unknown }
    if (typeof parsed.percent !== "number") return null
    return {
      percent: Math.max(0, Math.min(100, Math.round(parsed.percent))),
      label: typeof parsed.label === "string" ? parsed.label : "",
    }
  } catch {
    return null
  }
}

export function useOpenWikiInstallStream() {
  const [state, setState] = useState<OpenWikiInstallStreamState>({
    status: "idle",
    percent: 0,
    label: "",
    logs: [],
    error: null,
  })
  const unsubRef = useRef<(() => void) | null>(null)
  const cancelledRef = useRef(false)

  const start = useCallback(async (taskId: string) => {
    cancelledRef.current = false
    setState({
      status: "running",
      percent: 0,
      label: "",
      logs: [],
      error: null,
    })

    unsubRef.current?.()

    const unsub = await subscribe<OpenWikiInstallEvent>(
      OPENWIKI_INSTALL_EVENT,
      (event) => {
        if (event.task_id !== taskId) return

        switch (event.kind as OpenWikiInstallEventKind) {
          case "started":
            setState((prev) => ({ ...prev, status: "running", percent: 2 }))
            break
          case "progress": {
            const progress = parseProgressPayload(event.payload)
            if (!progress) return
            setState((prev) => ({
              ...prev,
              status: "running",
              percent: progress.percent,
              label: progress.label || prev.label,
            }))
            break
          }
          case "log":
            setState((prev) => ({
              ...prev,
              logs: [...prev.logs, event.payload],
            }))
            break
          case "completed":
            setState((prev) => ({
              ...prev,
              status: "success",
              percent: 100,
              logs: [...prev.logs, event.payload],
            }))
            unsubRef.current?.()
            break
          case "failed":
            setState((prev) => ({
              ...prev,
              status: "failed",
              error: event.payload,
              logs: [...prev.logs, `ERROR: ${event.payload}`],
            }))
            unsubRef.current?.()
            break
        }
      }
    )

    if (cancelledRef.current) {
      unsub()
      return
    }
    unsubRef.current = unsub
  }, [])

  const reset = useCallback(() => {
    cancelledRef.current = true
    unsubRef.current?.()
    unsubRef.current = null
    setState({
      status: "idle",
      percent: 0,
      label: "",
      logs: [],
      error: null,
    })
  }, [])

  /** Force-complete when the invoke returns but a terminal event never arrived. */
  const forceComplete = useCallback((message?: string) => {
    unsubRef.current?.()
    unsubRef.current = null
    setState((prev) => {
      if (prev.status === "success" || prev.status === "failed") return prev
      return {
        ...prev,
        status: "success",
        percent: 100,
        label: message || prev.label || "done",
        logs: message ? [...prev.logs, message] : prev.logs,
      }
    })
  }, [])

  /** Force-fail when the invoke rejects without a Failed stream event. */
  const forceFail = useCallback((message: string) => {
    unsubRef.current?.()
    unsubRef.current = null
    setState((prev) => {
      if (prev.status === "success" || prev.status === "failed") return prev
      return {
        ...prev,
        status: "failed",
        error: message,
        logs: [...prev.logs, `ERROR: ${message}`],
      }
    })
  }, [])

  return { ...state, start, reset, forceComplete, forceFail }
}
