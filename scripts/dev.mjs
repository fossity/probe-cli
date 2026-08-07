#!/usr/bin/env node
// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Runs the CLI from source, forwarding its arguments.
 *
 *   npm run dev -- scan ./some-folder --email you@example.com
 *
 * The sources are bundled to a temporary file and run, rather than executed through a TypeScript
 * loader, so that what runs here is built exactly like what ships.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { bundle } from './build.mjs';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'probe-dev-'));
const outfile = path.join(tmp, 'cli.cjs');

try {
  await bundle({ outfile, silent: true });
  const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
