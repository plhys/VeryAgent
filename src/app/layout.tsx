import type { Metadata, Viewport } from "next"
import "./globals.css"
import { NextIntlClientProvider } from "next-intl"
import { AppI18nProvider } from "@/components/i18n-provider"
import { getMessagesForLocale } from "@/i18n/messages"
import { resolveRequestLocale } from "@/i18n/resolve-request-locale"
import { toIntlLocale } from "@/lib/i18n"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export const metadata: Metadata = {
  title: "veryagent",
  description: "AI Coding Agent Conversation Manager",
  icons: {
    icon: [
      { url: "/icon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: { url: "/icon-128x128.png", sizes: "128x128", type: "image/png" },
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const appLocale = await resolveRequestLocale()
  const initialLocale = toIntlLocale(appLocale)
  const initialMessages = await getMessagesForLocale(appLocale)

  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider
          locale={initialLocale}
          messages={initialMessages}
        >
          <AppI18nProvider
            initialLocale={initialLocale}
            initialMessages={initialMessages}
          >
            {children}
          </AppI18nProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
