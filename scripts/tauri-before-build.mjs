#!/usr/bin/env node
import { spawnSync } from "node:child_process"

const env = { ...process.env }
const skipFrontend = env.VERYAGENT_SKIP_FRONTEND_BUILD === "1"

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (skipFrontend) {
  console.log(
    "[tauri-before-build] VERYAGENT_SKIP_FRONTEND_BUILD=1 -> skip pnpm build"
  )
} else {
  console.log("[tauri-before-build] building frontend via pnpm build")
  run("pnpm", ["build"])
}

console.log("[tauri-before-build] preparing sidecars")
run("pnpm", ["tauri:prepare-sidecars"])

console.log("[tauri-before-build] preparing bundled Node runtime")
run("pnpm", ["tauri:prepare-node"])
