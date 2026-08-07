#!/usr/bin/env node
// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Builds a standalone single-file executable using Node's Single Executable Application support
 * (Node >= 20). No Node install needed on the target machine.
 *
 *   node scripts/build-binary.mjs                 # for the host platform
 *   node scripts/build-binary.mjs --node <path>   # cross-build using a downloaded node binary
 *
 * The scanoss winnowing worker is created with `new Worker(src, { eval: true })`, so there is no
 * separate worker file to ship — the whole scanner fits in the blob.
 */
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, chmodSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));
const brand = JSON.parse(readFileSync(path.join(root, 'brand.config.json'), 'utf-8'));

const args = process.argv.slice(2);
const nodeArgIndex = args.indexOf('--node');
const nodeBinary = nodeArgIndex >= 0 ? args[nodeArgIndex + 1] : process.execPath;
const targetOs = args.includes('--target-os') ? args[args.indexOf('--target-os') + 1] : process.platform;

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`Node >= 20 is required to build a binary (running ${process.versions.node}).`);
  process.exit(1);
}

const distDir = path.join(root, 'dist');
const binDir = path.join(root, 'bin');
mkdirSync(binDir, { recursive: true });

// 1. Bundle.
const { bundle, OUT_FILE } = await import('./build.mjs');
await bundle();

// 2. SEA config + blob.
const seaConfig = path.join(distDir, 'sea-config.json');
writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: OUT_FILE,
      output: path.join(distDir, 'sea-prep.blob'),
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2,
  ),
);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// 3. Copy the host (or downloaded) node binary and inject the blob.
const suffix = targetOs === 'win32' ? '.exe' : '';
const arch = process.env.TARGET_ARCH ?? os.arch();
const outName = `${brand.binaryName}-${pkg.version}-${targetOs}-${arch}${suffix}`;
const outPath = path.join(binDir, outName);
copyFileSync(nodeBinary, outPath);

// The official Node binary is signed. Injecting the blob invalidates that signature, and macOS
// refuses to execute a binary whose signature is invalid — on Apple Silicon it is killed on sight.
// Strip it first, then re-sign below. This is ad-hoc signing: no certificate, no Apple account.
if (targetOs === 'darwin' && process.platform === 'darwin') {
  spawnSync('codesign', ['--remove-signature', outPath], { stdio: 'inherit' });
}

const postject = path.join(root, 'node_modules/postject/dist/cli.js');
if (!existsSync(postject)) {
  console.error('postject is not installed: npm install');
  process.exit(1);
}
const postjectArgs = [
  postject,
  outPath,
  'NODE_SEA_BLOB',
  path.join(distDir, 'sea-prep.blob'),
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (targetOs === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
execFileSync(process.execPath, postjectArgs, { stdio: 'inherit' });

if (targetOs !== 'win32') chmodSync(outPath, 0o755);

// Ad-hoc signature, required for the binary to run at all on Apple Silicon. It asserts no identity,
// so it needs no certificate and no Apple Developer account.
if (targetOs === 'darwin' && process.platform === 'darwin') {
  const signed = spawnSync('codesign', ['--sign', '-', '--force', outPath], { stdio: 'inherit' });
  if (signed.status !== 0) {
    console.error('codesign failed: the binary will not run on Apple Silicon');
    process.exit(1);
  }
  execFileSync('codesign', ['--verify', '--verbose', outPath], { stdio: 'inherit' });
}

console.log(`\n${outPath}`);
