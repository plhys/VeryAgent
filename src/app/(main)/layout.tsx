import { ThemeProvider } from "@/components/theme-provider"
import { AppearanceProvider } from "@/components/appearance-provider"
import { OverlayScrollbarsInit } from "@/components/overlay-scrollbars-init"
import { ClipboardFallbackInit } from "@/components/clipboard-fallback-init"
import { WebConnectionGuard } from "@/components/connection/web-connection-guard"
import { WindowResizeGrips } from "@/components/layout/window-resize-grips"
import { MainReadySignal } from "@/components/main-ready-signal"
import { GlobalContextMenuGuard } from "@/components/global-context-guard"

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {/* CSS-only dark background: applies before JS executes, preventing white flash in dark mode */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@media(prefers-color-scheme:dark){html:not(.light){background-color:#09090b;color-scheme:dark}}`,
        }}
      />
      <ThemeProvider>
        <AppearanceProvider>
          <OverlayScrollbarsInit />
          <ClipboardFallbackInit />
          <WebConnectionGuard />
          <WindowResizeGrips />
          <MainReadySignal />
          <GlobalContextMenuGuard />
          {children}
        </AppearanceProvider>
      </ThemeProvider>
    </>
  )
}
