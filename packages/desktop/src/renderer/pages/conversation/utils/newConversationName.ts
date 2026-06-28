/**
 * @license
 * Copyright 2025 VeryAgent (very.im)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Force new-session entry points to start from the localized default title.
 */
export function applyDefaultConversationName<T extends object>(
  conversation: T,
  defaultName: string
): Omit<T, 'name'> & { name: string } {
  return {
    ...conversation,
    name: defaultName,
  };
}
