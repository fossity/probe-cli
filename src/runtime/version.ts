// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/** Single place that answers "what version am I", for both the CLI banner and the package footer. */

// Injected by esbuild --define at build time.
declare const __APP_VERSION__: string;

let cached: string | null = null;

export function getAppVersion(): string {
  if (cached) return cached;
  try {
    cached = __APP_VERSION__;
  } catch {
    // Running from source (tsx / vitest): read package.json.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    cached = require('../../package.json').version as string;
  }
  return cached;
}
