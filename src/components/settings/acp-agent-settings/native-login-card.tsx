"use client"

/**
 * Universal native-login card for agents with a first-party login.
 *
 * Shows the agent's native-login state (logged in / account / in-flight) and a
 * Login / Cancel / Logout control, backed by the unified backend API
 * (acp_get_native_login_status / acp_start_native_login /
 * acp_cancel_native_login / acp_logout_native_login). Polls while a background
 * login is in flight so the UI converges once the browser/device flow lands.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, LogIn, LogOut, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  acpCancelNativeLogin,
  acpGetNativeLoginStatus,
  acpLogoutNativeLogin,
  acpStartNativeLogin,
} from "@/lib/api/agents"
import type { AgentType, NativeLoginStatus } from "@/lib/types"
import { toErrorMessage } from "@/lib/app-error"

const POLL_MS = 2000

export function NativeLoginCard({ agentType }: { agentType: AgentType }) {
  const t = useTranslations("AcpAgentSettings")
  const [status, setStatus] = useState<NativeLoginStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await acpGetNativeLoginStatus(agentType)
      setStatus(next)
      return next
    } catch (err) {
      console.error("[NativeLoginCard] status probe failed:", err)
      return null
    }
  }, [agentType])

  // Poll while a background login is in flight.
  useEffect(() => {
    void refresh()
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [refresh])

  useEffect(() => {
    if (status?.running && !timerRef.current) {
      timerRef.current = setInterval(() => {
        void refresh().then((next) => {
          if (next && !next.running && timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
        })
      }, POLL_MS)
    } else if (!status?.running && timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [status?.running, refresh])

  const handleStart = useCallback(async () => {
    setStarting(true)
    try {
      await acpStartNativeLogin(agentType)
      await refresh()
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setStarting(false)
    }
  }, [agentType, refresh])

  const handleCancel = useCallback(async () => {
    try {
      await acpCancelNativeLogin(agentType)
      await refresh()
    } catch (err) {
      toast.error(toErrorMessage(err))
    }
  }, [agentType, refresh])

  const handleLogout = useCallback(async () => {
    setLoggingOut(true)
    try {
      await acpLogoutNativeLogin(agentType)
      await refresh()
      toast.success(t("nativeLogin.loggedOut"))
    } catch (err) {
      toast.error(toErrorMessage(err))
    } finally {
      setLoggingOut(false)
    }
  }, [agentType, refresh, t])

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("nativeLogin.checking")}
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-[11px]">
        {status.running ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">
              {agentType === "code_buddy"
                ? t("nativeLogin.waitingCodeBuddy")
                : t("nativeLogin.waiting")}
            </span>
          </>
        ) : status.loggedIn ? (
          <>
            <LogIn className="h-3.5 w-3.5 text-green-600" />
            <span className="font-medium text-green-600">
              {status.accountName
                ? t("nativeLogin.loggedInAs", { name: status.accountName })
                : t("nativeLogin.loggedIn")}
            </span>
            {status.source === "env_key" && (
              <span className="text-muted-foreground">(API Key)</span>
            )}
          </>
        ) : (
          <>
            <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">
              {t("nativeLogin.notLoggedIn")}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        {status.running ? (
          <Button size="sm" variant="outline" onClick={handleCancel}>
            <X className="mr-1 h-3.5 w-3.5" />
            {t("nativeLogin.cancel")}
          </Button>
        ) : status.loggedIn ? (
          <Button
            size="sm"
            variant="outline"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="mr-1 h-3.5 w-3.5" />
            )}
            {t("nativeLogin.logout")}
          </Button>
        ) : (
          <Button size="sm" onClick={handleStart} disabled={starting}>
            {starting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogIn className="mr-1 h-3.5 w-3.5" />
            )}
            {t("nativeLogin.login")}
          </Button>
        )}
      </div>
    </div>
  )
}
