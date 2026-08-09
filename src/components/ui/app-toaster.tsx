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
      duration={1500}
      visibleToasts={3}
      position="top-center"
      toastOptions={{
        style: {
          opacity: 0.8,
          fontSize: "13px",
          padding: "8px 12px",
          gap: "6px",
        },
      }}
      closeButton
    />
  )
}
