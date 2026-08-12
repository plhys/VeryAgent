#!/usr/bin/env node
//
// Prepare the bundled Node.js runtime before `tauri build` bundles it.
//
// What it does:
//   1. Resolves the host platform/arch → Node.js distro id
//      (win-x64 / win-arm64 / darwin-x64 / darwin-arm64 / linux-x64 / linux-arm64).
//   2. Downloads the FULL Node.js distribution (includes `npm` / `npx` —
//      NOT the single-file node.exe) v22.19.0 from nodejs.org.
//   3. Verifies the archive against the official SHASUMS256.txt.
//   4. Extracts it into `src-tauri/resources/node/` in a FLAT layout:
//        Windows → resources/node/{node.exe,npm.cmd,npx.cmd,node_modules/…}
//        Unix     → resources/node/{bin/node,bin/npm,bin/npx,lib/…}
//      so the runtime resolver (`process::resolve_bundled_node`) and PATH
//      injection find node/npm/npx side by side.
//
// Tauri bundles `resources/node` → `<install>/node/` (see tauri.conf.json).
// In dev mode (no bundle), the app falls back to downloading the same
// distribution into `~/.veryagent/runtime/node/` at runtime.
//
// Skippable: `VERYAGENT_SKIP_NODE_PREP=1` when iterating without needing the
// bundled runtime. `--force` re-downloads even when a cached copy exists.
//
// Intentionally Node-only (no shell scripts): runs identically on macOS,
// Linux, Windows GitHub runners. Uses system `tar` for extraction (bsdtar on
// Windows 10+ handles .zip; GNU tar handles .tar.gz on Unix).

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"

const NODE_VERSION = "v22.19.0"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SRC_TAURI = resolve(SCRIPT_DIR, "..")
const RESOURCES_DIR = join(SRC_TAURI, "resources")
const NODE_DIR = join(RESOURCES_DIR, "node")

// Staging MUST be a sibling of NODE_DIR, not inside it — the flatten step
// replaces NODE_DIR wholesale (rmSync) and would otherwise delete its own source.
const DIST_TMP = join(RESOURCES_DIR, ".node-prep")

function log(msg) {
  console.log(`[prepare-node] ${msg}`)
}

function die(msg) {
  console.error(`[prepare-node][ERROR] ${msg}`)
  process.exit(1)
}

// ── Platform / arch → Node distro id ────────────────────────────────────

function nodeDistroId() {
  const { platform, arch } = process
  const osName =
    platform === "win32" ? "win" : platform === "darwin" ? "darwin" : "linux"
  const archName =
    arch === "x64"
      ? "x64"
      : arch === "arm64"
        ? "arm64"
        : arch === "ia32"
          ? "x86"
          : die(`unsupported arch: ${arch}`)
  if (osName === "linux" && !["x64", "arm64"].includes(archName)) {
    die(`unsupported linux arch: ${arch}`)
  }
  if (osName === "darwin" && !["x64", "arm64"].includes(archName)) {
    die(`unsupported darwin arch: ${arch}`)
  }
  if (osName === "win" && !["x64", "arm64"].includes(archName)) {
    die(`unsupported windows arch: ${arch}`)
  }
  return `${osName}-${archName}`
}

function distroFileName(distro) {
  return `node-${NODE_VERSION}-${distro}.${distro.startsWith("win") ? "zip" : "tar.gz"}`
}

// ── Download helpers ────────────────────────────────────────────────────

async function download(url) {
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok) {
    die(`download failed ${res.status} ${res.statusText}: ${url}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

function shasumFor(archiveName, shasums) {
  const line = shasums.split(/\r?\n/).find((l) => l.includes(archiveName))
  if (!line) return null
  return line.split(/\s+/)[0]
}

function verifyChecksum(buffer, expected) {
  if (!expected) return true
  const actual = createHash("sha256").update(buffer).digest("hex")
  return actual.toLowerCase() === expected.toLowerCase()
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  if (process.env.VERYAGENT_SKIP_NODE_PREP === "1") {
    log("VERYAGENT_SKIP_NODE_PREP=1 — skipping node preparation")
    return
  }

  const force = process.argv.includes("--force")
  const distro = nodeDistroId()
  const fileName = distroFileName(distro)

  const nodeProbe = distro.startsWith("win")
    ? join(NODE_DIR, "node.exe")
    : join(NODE_DIR, "bin", "node")
  if (!force && existsSync(nodeProbe)) {
    log(`bundled Node.js already present at ${nodeProbe} (${NODE_VERSION})`)
    return
  }

  const baseUrl = `https://nodejs.org/dist/${NODE_VERSION}`
  const archiveUrl = `${baseUrl}/${fileName}`
  const archiveTmp = join(DIST_TMP, fileName)

  log(`downloading ${archiveUrl}`)
  mkdirSync(DIST_TMP, { recursive: true })

  const shasums = await download(`${baseUrl}/SHASUMS256.txt`)
  const archive = await download(archiveUrl)
  const expected = shasumFor(fileName, shasums.toString("utf8"))
  if (!verifyChecksum(archive, expected)) {
    die(`sha256 mismatch for ${fileName} (expected ${expected ?? "unknown"})`)
  }
  writeFileSync(archiveTmp, archive)
  log(`sha256 verified (${expected.slice(0, 12)}…)`)

  log(`extracting ${fileName} into ${NODE_DIR}`)
  rmSync(NODE_DIR, { recursive: true, force: true })
  mkdirSync(NODE_DIR, { recursive: true })
  // `--strip-components=1` flattens the versioned top dir
  // (`node-v22.19.0-win-x64/…`) straight into NODE_DIR in one pass — avoids
  // per-entry renames, which Windows can reject (EPERM) while Defender scans
  // the freshly-extracted node_modules tree.
  const isZip = distro.startsWith("win")
  // Windows: use the system bsdtar (System32\tar.exe) — it supports .zip and
  // handles Windows paths; a Git Bash `tar` is GNU tar (no zip support).
  const tarCmd = isZip ? "C:/Windows/System32/tar.exe" : "tar"
  const nodeDirArg = NODE_DIR.replace(/\\/g, "/")
  const archiveArg = archiveTmp.replace(/\\/g, "/")
  const stripArgs = isZip
    ? ["-xf", archiveArg, "--strip-components=1", "-C", nodeDirArg]
    : ["-xzf", archiveArg, "--strip-components=1", "-C", nodeDirArg]
  execFileSync(tarCmd, stripArgs, { stdio: "inherit" })

  if (!existsSync(nodeProbe)) {
    die(`extraction produced no node binary at ${nodeProbe}`)
  }
  rmSync(DIST_TMP, { recursive: true, force: true })

  log(`bundled Node.js ready at ${nodeProbe}`)
  const npmProbe = distro.startsWith("win")
    ? join(NODE_DIR, "npm.cmd")
    : join(NODE_DIR, "bin", "npm")
  log(
    npmProbe && existsSync(npmProbe)
      ? "npm/npx present (full distribution)"
      : "[warn] npm/npx missing — will rely on runtime download"
  )
}

main().catch((err) => {
  console.error(`[prepare-node][ERROR] ${err.message}`)
  process.exit(1)
})
