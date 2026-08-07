// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Builds the CLI bundle once before the suite runs.
 *
 * The end-to-end tests spawn `dist/probe.cjs`, which is what `npx` and the standalone binary
 * execute, so `npm test` covers the artifact users actually run and stays a single command.
 */
export async function setup(): Promise<void> {
  const { bundle } = (await import('../scripts/build.mjs')) as {
    bundle: (options?: { silent?: boolean }) => Promise<string>;
  };
  await bundle({ silent: true });
}
