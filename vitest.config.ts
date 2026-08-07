// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The end-to-end tests bundle the CLI and spawn it once per case.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    globalSetup: [path.join(__dirname, 'test/globalSetup.ts')],
    pool: 'forks',
  },
});
