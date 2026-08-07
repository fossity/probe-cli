#!/usr/bin/env node
// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Propagates brand.config.json into the files that cannot read it at runtime:
 * package.json (name, bin, description, homepage, bugs) and the install scripts' defaults.
 *
 * Run after editing brand.config.json:  npm run brand:apply
 * Then verify with:                     npm run brand:check && npm test
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const brandPath = path.join(root, 'brand.config.json');
const brand = JSON.parse(readFileSync(brandPath, 'utf-8'));

const required = ['productName', 'binaryName', 'packageExtension', 'versionFooterTag', 'publicKeyPem'];
const missing = required.filter((k) => !brand[k]);
if (missing.length) {
  console.error(`✖ brand.config.json is missing: ${missing.join(', ')}`);
  process.exit(1);
}
if (brand.publicKeyPem.includes('REPLACE-WITH-YOUR-KEY')) {
  console.error('✖ brand.config.json still holds the placeholder public key.');
  console.error('  Put the RSA public key your back end decrypts with into publicKeyPem.');
  process.exit(1);
}
if (Buffer.from(`${brand.versionFooterTag}:99.99.99`).length > 100) {
  console.error('✖ versionFooterTag is too long: the footer field is a fixed 100 bytes.');
  process.exit(1);
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(brand.binaryName)) {
  console.error('✖ binaryName must be a plain command name (letters, digits, . _ -).');
  process.exit(1);
}

// --- package.json ---
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const npmName = brand.npmPackageName ?? `${brand.binaryName}-cli`;

pkg.name = npmName;
pkg.description = brand.tagline ?? pkg.description;
pkg.bin = { [brand.binaryName]: `dist/${brand.binaryName}.cjs` };
pkg.main = `dist/${brand.binaryName}.cjs`;
if (brand.websiteUrl) pkg.homepage = brand.websiteUrl;
if (brand.issuesUrl) pkg.bugs = { url: brand.issuesUrl };
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

// --- install scripts: keep their defaults in step with the binary name ---
for (const script of ['install.sh', 'install.ps1']) {
  const file = path.join(root, script);
  if (!existsSync(file)) continue;
  let text = readFileSync(file, 'utf-8');
  text = text
    .replace(/^BINARY_NAME=.*$/m, `BINARY_NAME="${brand.binaryName}"`)
    .replace(/^\$BinaryName\s*=.*$/m, `$BinaryName = "${brand.binaryName}"`);
  if (brand.repository) {
    text = text
      .replace(/^REPO="\$\{REPO:-[^}]*\}"$/m, `REPO="\${REPO:-${brand.repository}}"`)
      .replace(/(\$env:PROBE_REPO \} else \{ ")[^"]*(" \})/, `$1${brand.repository}$2`);
  }
  writeFileSync(file, text);
}

console.log(`✔ applied brand "${brand.productName}"`);
console.log(`  npm package : ${npmName}`);
console.log(`  command     : ${brand.binaryName}`);
console.log(`  package ext : ${brand.packageExtension}`);
console.log(`  footer tag  : ${brand.versionFooterTag}`);
console.log('\nNext: npm run brand:check && npm test && npm run build:binary');
