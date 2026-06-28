/**
 * @license
 * Copyright 2025 VeryAgent (very.im)
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from '@office-ai/platform';
import { initAllBridges } from '../bridge';

logger.config({ print: true });

initAllBridges();
