import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const isProd = process.env.NODE_ENV === "production"
// Must match tauri.conf.json `build.devUrl` host. Prefer 127.0.0.1 over
// "localhost" on Windows: WebView/DNS may resolve localhost to ::1 while
// the Next dev server only listens on IPv4, which yields connection refused
// or a client-side exception when chunks load from a different origin.
const internalHost = process.env.TAURI_DEV_HOST || "127.0.0.1"
const withNextIntl = createNextIntlPlugin({
  requestConfig: "./src/i18n/request.ts",
  experimental: {
    messages: {
      path: "./src/i18n/messages",
      format: "json",
      locales: [
        "en",
        "zh-CN",
      ],
      precompile: true,
    },
  },
})

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Dev-only absolute prefix so Tauri WebView (loading devUrl) and chunk
  // URLs share the same host. Keep in sync with tauri `devUrl`.
  assetPrefix: isProd ? undefined : `http://${internalHost}:3000`,
  // Next 16 warns on cross-origin /_next/* when page host != asset host.
  allowedDevOrigins: [internalHost, "127.0.0.1", "localhost"],
}

export default withNextIntl(nextConfig)
