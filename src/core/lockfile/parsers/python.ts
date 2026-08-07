// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import * as TOML from 'smol-toml';
import YAML from 'yaml';
import { LockfileResult, emptyResult } from '../types';
import { purl, isLocalSpecifier, bareVersion, pinnedVersion } from '../purl';

const TYPE = 'pypi';

function push(res: LockfileResult, name: string, version?: string, scope?: string, requirement?: string) {
  const p = purl(TYPE, undefined, name, version);
  if (p) res.purls.push({ purl: p, requirement: requirement ?? version, scope });
}

/** poetry.lock — [[package]] tables with name/version. */
export async function poetryLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = TOML.parse(content);
  for (const pkg of doc?.package ?? []) {
    if (pkg?.source?.type === 'directory' || pkg?.source?.type === 'file') continue; // local path dep
    push(res, pkg?.name, pkg?.version, pkg?.category);
  }
  return res;
}

/** Pipfile.lock — JSON with `default` and `develop` sections. */
export async function pipfileLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc = JSON.parse(content);
  for (const [section, scope] of [
    ['default', 'dependencies'],
    ['develop', 'devDependencies'],
  ] as const) {
    for (const [name, value] of Object.entries<any>(doc?.[section] ?? {})) {
      if (value?.path || value?.file || value?.git) continue;
      push(res, name, bareVersion(value?.version) ?? value?.version, scope);
    }
  }
  return res;
}

/** Pipfile — TOML manifest with [packages] / [dev-packages]. */
export async function pipfileParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = TOML.parse(content);
  for (const [section, scope] of [
    ['packages', 'dependencies'],
    ['dev-packages', 'devDependencies'],
  ] as const) {
    for (const [name, value] of Object.entries<any>(doc?.[section] ?? {})) {
      const requirement = typeof value === 'string' ? value : (value?.version ?? '*');
      if (typeof value === 'object' && (value?.path || value?.file || value?.git)) continue;
      push(res, name, pinnedVersion(requirement), scope, requirement);
    }
  }
  return res;
}

/**
 * Parses `requirements*.txt`.
 *
 * The scanoss SDK registers only the exact name `requirements.txt`, so the common
 * `requirements-dev.txt` and `requirements/prod.txt` conventions need this parser.
 */
export async function requirementsParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split(/\s+#/)[0].trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue; // -r/-e/--flags
    if (isLocalSpecifier(line)) continue;
    // name[extras]==1.2.3 ; python_version < "3.10"
    const m = line
      .split(';')[0]
      .trim()
      .match(/^([A-Za-z0-9._-]+)\s*(\[[^\]]*\])?\s*(.*)$/);
    if (!m) continue;
    const name = m[1];
    const requirement = m[3]?.trim() || undefined;
    push(res, name, pinnedVersion(requirement), 'dependencies', requirement);
  }
  return res;
}

/** environment.yml — conda; `dependencies:` mixes conda specs and a nested pip list. */
export async function condaEnvParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc = YAML.parse(content);
  for (const entry of doc?.dependencies ?? []) {
    if (typeof entry === 'string') {
      const [name, version] = entry.split(/[=<>!~]+/);
      if (!name?.trim() || name.trim() === 'python') continue;
      const p = purl('conda', undefined, name.trim(), version?.trim());
      if (p) res.purls.push({ purl: p, requirement: version?.trim(), scope: 'dependencies' });
    } else if (entry && typeof entry === 'object' && Array.isArray(entry.pip)) {
      for (const spec of entry.pip) {
        const [name, version] = String(spec).split(/[=<>!~]+/);
        push(res, name?.trim(), version?.trim(), 'pip');
      }
    }
  }
  return res;
}
