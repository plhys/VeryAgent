/**
 * Resolve the aioncore binary path.
 *
 * Search order:
 *  1. VeryAgentCore binary name (new branding)
 *  2. Legacy aioncore binary name
 *  3. System PATH
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const BINARY_NAMES = ['veryagent-core', 'aioncore'];
const MAX_DIR_ENTRIES = 20;
const MAX_LOOKUP_TEXT_LENGTH = 1000;

type BackendBinaryResolveDiagnostics = {
  resourcesPath?: string;
  runtimeKey: string;
  binaryName: string;
  checkedBundledPath?: string;
  bundledDirExists?: boolean;
  runtimeDirExists?: boolean;
  resourcesDirEntries?: string[];
  runtimeDirEntries?: string[];
  pathLookupCommand: string;
  pathLookupResult?: string;
  pathLookupError?: string;
};

class BackendBinaryResolveError extends Error {
  readonly diagnostics: BackendBinaryResolveDiagnostics;

  constructor(message: string, diagnostics: BackendBinaryResolveDiagnostics) {
    super(message);
    this.name = 'BackendBinaryResolveError';
    this.diagnostics = diagnostics;
  }
}

function getBinaryNames(): string[] {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return BINARY_NAMES.map((name) => `${name}${suffix}`);
}

function getRuntimeKey(): string {
  return `${process.platform}-${process.arch}`;
}

function listDirEntries(dirPath: string): string[] | undefined {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  } catch {
    return undefined;
  }
}

function trimLookupText(text: string): string {
  return text.trim().slice(0, MAX_LOOKUP_TEXT_LENGTH);
}

/**
 * Resolve the aioncore binary path.
 * Returns the absolute path to the binary, or throws if not found.
 */
export function resolveBinaryPath(): string {
  const runtimeKey = getRuntimeKey();
  const binaryNames = getBinaryNames();
  const diagnostics: BackendBinaryResolveDiagnostics = {
    runtimeKey,
    binaryName: binaryNames[0],
    pathLookupCommand: process.platform === 'win32' ? `where ${BINARY_NAMES[0]}` : `which ${BINARY_NAMES[0]}`,
  };

  const envOverride = process.env.AIONUI_BACKEND_BIN;
  if (envOverride && existsSync(envOverride)) return envOverride;

  for (const binaryName of binaryNames) {
    const bundled = bundledPath(runtimeKey, binaryName, diagnostics);
    if (bundled) return bundled;
  }

  for (const binaryName of binaryNames) {
    const fromPath = resolveFromSystemPATH(binaryName, diagnostics);
    if (fromPath) return fromPath;
  }

  throw new BackendBinaryResolveError(
    `Cannot find binary (${binaryNames.join(', ')}). Checked bundled location and system PATH.`,
    diagnostics
  );
}

/**
 * Check bundled binary in resources directory.
 * Layout: bundled-aioncore/{platform}-{arch}/aioncore[.exe]
 */
function bundledPath(
  runtimeKey: string,
  binaryName: string,
  diagnostics: BackendBinaryResolveDiagnostics
): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return null;
  diagnostics.resourcesPath = resourcesPath;

  const bundledDir = join(resourcesPath, 'bundled-aioncore');
  const runtimeDir = join(bundledDir, runtimeKey);
  const candidate = join(runtimeDir, binaryName);
  diagnostics.checkedBundledPath = candidate;
  diagnostics.bundledDirExists = existsSync(bundledDir);
  diagnostics.runtimeDirExists = existsSync(runtimeDir);
  diagnostics.resourcesDirEntries = listDirEntries(resourcesPath);
  diagnostics.runtimeDirEntries = listDirEntries(runtimeDir);

  if (existsSync(candidate)) return candidate;
  return null;
}

/**
 * Try to find the binary on the system PATH.
 */
function resolveFromSystemPATH(binaryName: string, diagnostics: BackendBinaryResolveDiagnostics): string | null {
  try {
    const lookupCmd = process.platform === 'win32' ? `where ${binaryName}` : `which ${binaryName}`;
    diagnostics.pathLookupCommand = lookupCmd;
    const result = execSync(lookupCmd, { encoding: 'utf-8', timeout: 5000 }).trim();
    diagnostics.pathLookupResult = trimLookupText(result);
    const firstMatch = result.split(/\r?\n/).find((line) => line.trim());
    if (firstMatch && existsSync(firstMatch.trim())) return firstMatch.trim();
  } catch (error) {
    diagnostics.pathLookupError = error instanceof Error ? trimLookupText(error.message) : String(error);
    return null;
  }
  return null;
}

export type { BackendBinaryResolveDiagnostics };
