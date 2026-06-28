/**
 * @license
 * Copyright 2025 VeryAgent (very.im)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPlatformServices } from '@/common/platform';

/**
 * Returns baseName unchanged in release builds, or baseName + '-dev' in dev builds.
 * When VERYAGENT_MULTI_INSTANCE=1, appends '-2' to isolate the second dev instance.
 * Used to isolate symlink and directory names between environments.
 *
 * @example
 * getEnvAwareName('.veryagent')        // release → '.veryagent',        dev → '.veryagent-dev'
 * getEnvAwareName('.veryagent-config') // release → '.veryagent-config', dev → '.veryagent-config-dev'
 * // with VERYAGENT_MULTI_INSTANCE=1:  dev → '.veryagent-dev-2'
 */
export function getEnvAwareName(baseName: string): string {
  if (getPlatformServices().paths.isPackaged() === true) return baseName;
  const suffix = process.env.VERYAGENT_MULTI_INSTANCE === '1' ? '-dev-2' : '-dev';
  return `${baseName}${suffix}`;
}
