#!/usr/bin/env node
// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Publishes the package from a workstation, for when the release workflow cannot.
 *
 * Reads the token from a file rather than an argument or an environment variable, so it never
 * appears in shell history or in the process list. The registry credential is written to a
 * temporary npm config that is deleted afterwards, leaving nothing behind on disk.
 *
 *   npm run release:npm            # token from /root/.npm-token or $NPM_TOKEN_FILE
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** First existing candidate wins; $NPM_TOKEN_FILE overrides all of them. */
const tokenFile =
  process.env.NPM_TOKEN_FILE ??
  ['/root/npm.secret', '/root/.npm-token', path.join(os.homedir(), '.npm-token')].find((candidate) =>
    existsSync(candidate),
  );

let token;
try {
  token = readFileSync(tokenFile, 'utf-8').trim();
} catch {
  console.error(`No npm token found (looked at ${tokenFile ?? '/root/npm.secret and ~/.npm-token'}).`);
  console.error("Create it with:  printf '%s' 'npm_...' > " + tokenFile + ' && chmod 600 ' + tokenFile);
  process.exit(1);
}
if (!token) {
  console.error(`${tokenFile} is empty.`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));

/**
 * Refuses to publish a tarball containing anything but the expected files.
 *
 * The `files` field lists directories, so whatever a build step happens to leave in one of them
 * ships too. That is how build intermediates carrying absolute build paths reached the registry
 * once. Enumerating the tarball is the only check that sees what is actually about to be sent.
 */
function assertTarballIsClean() {
  const listing = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf-8' }),
  );
  const names = listing[0].files.map((f) => f.path).sort();
  const allowed = new Set([
    `dist/${path.basename(pkg.bin[Object.keys(pkg.bin)[0]])}`,
    'brand.config.json',
    'package.json',
    'README.md',
    'LICENSE',
    'NOTICE',
  ]);
  const unexpected = names.filter((n) => !allowed.has(n));
  if (unexpected.length) {
    console.error('Refusing to publish: the tarball contains files that are not part of the package.');
    unexpected.forEach((n) => console.error(`  ${n}`));
    console.error('Remove them from dist/ (or widen the allowlist in this script) and try again.');
    process.exit(1);
  }
  console.log(`tarball contents checked: ${names.length} files, all expected`);
}

assertTarballIsClean();

const tmp = mkdtempSync(path.join(os.tmpdir(), 'npm-publish-'));
const npmrc = path.join(tmp, '.npmrc');

try {
  writeFileSync(npmrc, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 });
  const env = { ...process.env, NPM_CONFIG_USERCONFIG: npmrc };

  const who = execFileSync('npm', ['whoami'], { env, encoding: 'utf-8' }).trim();
  console.log(`publishing ${pkg.name}@${pkg.version} as ${who}`);

  execFileSync('npm', ['publish', '--access', 'public'], { env, stdio: 'inherit', cwd: root });
  console.log(`\npublished ${pkg.name}@${pkg.version}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
