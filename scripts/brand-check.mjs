#!/usr/bin/env node
// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Fails if a brand name is hardcoded anywhere outside brand.config.json.
 *
 * This is what makes the rebranding instructions in the README trustworthy: if a vendor name
 * is added to a source file, CI catches it instead of a forked build shipping a mixed identity.
 *
 * Run: npm run brand:check
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const brand = JSON.parse(readFileSync(path.join(root, 'brand.config.json'), 'utf-8'));

/**
 * Generic words that appear both in ordinary prose and inside a brand name (e.g. the word
 * "audit" in a product called "<Vendor> Audit Probe"). Flagging them would make the check useless.
 */
const STOPWORDS = new Set([
  'probe',
  'audit',
  'auditor',
  'auditing',
  'scan',
  'scanner',
  'code',
  'source',
  'open',
  'software',
  'tool',
  'tools',
  'cli',
  'app',
  'inc',
  'ltd',
  'llc',
  'gmbh',
  'corp',
  'labs',
  'the',
  'and',
  'for',
  'security',
  'compliance',
  'platform',
]);

/** Words that must only ever appear in brand.config.json. */
const BRAND_WORDS = [
  ...new Set(
    [brand.vendor, brand.shortName, brand.productName]
      .flatMap((v) => String(v).split(/\s+/))
      .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  ),
];

/** Files that legitimately mention the brand: docs, config, attribution. */
const ALLOWED = new Set([
  'brand.config.json',
  path.join('scripts', 'brand-check.mjs'),
  'brand-check.mjs',
  'README.md',
  'ARCHITECTURE.md',
  'NOTICE',
  'LICENSE',
  'package.json',
  'package-lock.json',
  'install.sh',
  'install.ps1',
]);

// test/ is excluded on purpose: fixtures and rebranding tests use invented company names.
const SEARCH_DIRS = ['src', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'bin', 'build', '.git', 'fixtures']);

/**
 * Attribution notices are exempt. Copyright and SPDX headers must name the original author of
 * ported code: the GPL requires it, and a rebrand does not remove that obligation.
 */
const ATTRIBUTION = /SPDX-FileCopyrightText|SPDX-FileContributor|^\s*[/*#\s]*Copyright\b/i;

const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|cjs|json|yml|yaml)$/.test(entry)) continue;
    const relative = path.relative(root, full);
    if (ALLOWED.has(relative) || ALLOWED.has(entry)) continue;

    const lines = readFileSync(full, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      if (ATTRIBUTION.test(line)) return;
      const lower = line.toLowerCase();
      for (const word of BRAND_WORDS) {
        if (lower.includes(word)) violations.push({ file: relative, line: i + 1, word, text: line.trim() });
      }
    });
  }
}

for (const dir of SEARCH_DIRS) {
  try {
    walk(path.join(root, dir));
  } catch {
    /* directory may not exist in a trimmed checkout */
  }
}

// The footer tag and workspace dir are derived from the brand, not literals: verify they are not
// baked in anywhere either.
if (violations.length) {
  console.error(`✖ ${violations.length} hardcoded brand reference(s) found.`);
  console.error('  Move the value into brand.config.json and read it from src/runtime/brand.ts.\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  "${v.word}"  ${v.text.slice(0, 100)}`);
  }
  process.exit(1);
}

console.log(`✔ no hardcoded brand references (checked for: ${BRAND_WORDS.join(', ') || '—'})`);
