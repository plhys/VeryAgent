"use client"

import { Toaster, type ToasterProps } from "sonner"

export function AppToaster(props: ToasterProps) {
  // Theme is read from the <html data-theme="..."> attribute set by
  // AppearanceProvider / the inline hydration script. Avoid next-themes here
  // so the ThemeProvider swap does not break this component.
  const theme =
    props.theme ??
    (typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme")?.startsWith("dark")
      ? "dark"
      : "light")

  return (
    <Toaster
      {...props}
      theme={theme}
      duration={2200}
      // expand=true makes every toast render at full height, stacked
      // vertically with `gap`, instead of collapsing later toasts behind the
      // front one (the default). visibleToasts caps how many are shown.
      expand
      visibleToasts={4}
      gap={10}
      position="top-center"
      // Positioning is delegated to CSS (.veryagent-toaster centers the
      // container in the viewport with a fixed flexbox overlay); leaving
      // offset unset lets sonner's inline transform stay predictable.
      className="veryagent-toaster"
      toastOptions={{
        className: "veryagent-toast",
        style: {
          fontSize: "13px",
          padding: "10px 16px",
        },
      }}
    />
  )
}
