import { ThemeProvider } from "@/components/theme-provider"
import { APPEARANCE_INIT_SCRIPT } from "@/lib/appearance-script"
import { AppearanceProvider } from "@/components/appearance-provider"
import { OverlayScrollbarsInit } from "@/components/overlay-scrollbars-init"
import { ClipboardFallbackInit } from "@/components/clipboard-fallback-init"
import { WebConnectionGuard } from "@/components/connection/web-connection-guard"
import { WindowResizeGrips } from "@/components/layout/window-resize-grips"

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
      {/* Apply appearance preferences (theme color + zoom + dark class) before first paint to prevent FOUC */}
      <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
      {/* Suppress benign ResizeObserver loop warnings (W3C spec §3.3) */}
      <script>{`window.addEventListener("error",function(e){if(e.message&&e.message.indexOf("ResizeObserver")!==-1){e.stopImmediatePropagation();e.preventDefault()}});window.onerror=function(m){if(typeof m==="string"&&m.indexOf("ResizeObserver")!==-1)return true}`}</script>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <AppearanceProvider>
          <OverlayScrollbarsInit />
          <ClipboardFallbackInit />
          <WebConnectionGuard />
          <WindowResizeGrips />
          {children}
        </AppearanceProvider>
      </ThemeProvider>
    </>
  )
}
