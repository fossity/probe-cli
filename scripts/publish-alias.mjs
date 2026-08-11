#!/usr/bin/env node
// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Publishes the same build under a short, unscoped name.
 *
 * `npx @fossity/probe-cli@latest scan .` is a mouthful, and the scope cannot be dropped from a
 * scoped package. Publishing the identical bundle as `fossity` gives `npx fossity@latest scan .`.
 *
 * The alias is generated from the real package at publish time rather than maintained beside it, so
 * the two cannot drift: same version, same bundle, same brand configuration. Only the package name
 * and the command it installs differ.
 *
 *   npm run release:alias
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const brand = JSON.parse(readFileSync(path.join(root, 'brand.config.json'), 'utf-8'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));

const aliasName = brand.npmAliasName;
if (!aliasName) {
  console.error('No npmAliasName in brand.config.json; nothing to publish.');
  process.exit(1);
}

const tokenFile =
  process.env.NPM_TOKEN_FILE ??
  ['/root/npm.secret', '/root/.npm-token', path.join(os.homedir(), '.npm-token')].find((candidate) =>
    existsSync(candidate),
  );

let token;
try {
  token = readFileSync(tokenFile, 'utf-8').trim();
} catch {
  console.error(`No npm token found (looked at ${tokenFile ?? '/root/npm.secret'}).`);
  process.exit(1);
}

// Build first: the alias ships the same bundle, not a rebuild of a possibly different tree.
execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { stdio: 'inherit' });

const bundle = path.join(root, `dist/${brand.binaryName}.cjs`);
const staging = mkdtempSync(path.join(os.tmpdir(), 'alias-publish-'));
const auth = mkdtempSync(path.join(os.tmpdir(), 'alias-auth-'));

try {
  mkdirSync(path.join(staging, 'dist'));
  copyFileSync(bundle, path.join(staging, 'dist', path.basename(bundle)));
  for (const file of ['brand.config.json', 'README.md', 'LICENSE', 'NOTICE']) {
    copyFileSync(path.join(root, file), path.join(staging, file));
  }

  writeFileSync(
    path.join(staging, 'package.json'),
    `${JSON.stringify(
      {
        name: aliasName,
        version: pkg.version,
        // Says plainly that this is the same program, so the duplicate listing is not a puzzle.
        description: `${pkg.description} Short alias for ${pkg.name}.`,
        license: pkg.license,
        author: pkg.author,
        homepage: pkg.homepage,
        repository: pkg.repository,
        bugs: pkg.bugs,
        keywords: pkg.keywords,
        type: pkg.type,
        // Named after the package: `npx fossity` runs the bin matching the package name.
        bin: { [aliasName]: `dist/${path.basename(bundle)}` },
        main: `dist/${path.basename(bundle)}`,
        // An allowlist rather than an ignore list: anything not named here cannot be published by
        // accident, whatever ends up in the staging directory.
        files: ['dist/', 'brand.config.json', 'README.md', 'LICENSE', 'NOTICE'],
        engines: pkg.engines,
      },
      null,
      2,
    )}\n`,
  );

  // The credential lives outside the staged package. npm publishes the directory it is given, so
  // anything written inside it ships: a dry run showed this file listed in the tarball.
  const npmrc = path.join(auth, '.npmrc');
  writeFileSync(npmrc, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 });
  const env = { ...process.env, NPM_CONFIG_USERCONFIG: npmrc };

  console.log(`publishing ${aliasName}@${pkg.version} (alias of ${pkg.name})`);
  execFileSync('npm', ['publish', '--access', 'public'], { env, stdio: 'inherit', cwd: staging });
  console.log(`\npublished ${aliasName}@${pkg.version}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
  rmSync(auth, { recursive: true, force: true });
}
