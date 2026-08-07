#!/usr/bin/env node
// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Bundles the program into a single CommonJS file at dist/probe-cli.cjs.
 *
 * Usage:
 *   node scripts/build.mjs              # production bundle
 *   PROBE_MINIFY=1 node scripts/build.mjs
 */
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const brand = JSON.parse(readFileSync(new URL('../brand.config.json', import.meta.url), 'utf-8'));

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const OUT_FILE = path.join(ROOT, `dist/${brand.binaryName}.cjs`);

/**
 * Builds the bundle.
 *
 * @param {{outfile?: string, minify?: boolean, silent?: boolean}} options
 * @returns {Promise<string>} Path to the bundle.
 */
export async function bundle(options = {}) {
  const outfile = options.outfile ?? OUT_FILE;
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

  mkdirSync(path.dirname(outfile), { recursive: true });

  const result = await build({
    entryPoints: [path.join(ROOT, 'src/cli/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile,
    // The shebang comes from src/cli/index.ts and esbuild preserves it.
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    loader: { '.json': 'json' },
    minify: options.minify ?? process.env.PROBE_MINIFY === '1',
    sourcemap: false,
    metafile: true,
    logLevel: options.silent ? 'silent' : 'warning',
  });

  if (!options.silent) {
    const bytes = Object.values(result.metafile.outputs)[0].bytes;
    console.log(`${path.relative(ROOT, outfile)}  ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  }
  return outfile;
}

// Run when invoked directly, stay quiet when imported by another script or by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await bundle();
}
