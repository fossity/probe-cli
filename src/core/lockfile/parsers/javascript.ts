// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import YAML from 'yaml';
import { LockfileResult, emptyResult } from '../types';
import { purl, splitNpmName, isLocalSpecifier } from '../purl';

const TYPE = 'npm';

function push(res: LockfileResult, name: string, version?: string, scope?: string) {
  const { namespace, name: pkg } = splitNpmName(name);
  const p = purl(TYPE, namespace, pkg, version);
  if (p) res.purls.push({ purl: p, requirement: version, scope });
}

/**
 * Parses `npm-shrinkwrap.json`.
 *
 * The format is identical to `package-lock.json`, in both the flat (lockfileVersion 2 and 3) and
 * nested (lockfileVersion 1) layouts. The scanoss SDK registers only the `package-lock.json`
 * filename, so a shrinkwrapped project yields no npm dependencies without this parser.
 */
export async function npmShrinkwrapParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc = JSON.parse(content);
  const packages = doc?.packages;
  if (packages) {
    for (const [key, value] of Object.entries<any>(packages)) {
      if (!key) continue; // "" is the root project itself
      const name = key.replace(/^.*node_modules\//, '');
      if (value?.link) continue; // workspace symlink, not a published package
      push(res, name, value?.version);
    }
    return res;
  }
  // lockfileVersion 1: nested "dependencies" tree
  const walk = (deps: Record<string, any> | undefined) => {
    if (!deps) return;
    for (const [name, value] of Object.entries(deps)) {
      push(res, name, value?.version);
      walk(value?.dependencies);
    }
  };
  walk(doc?.dependencies);
  return res;
}

/**
 * Parses `pnpm-lock.yaml`, versions 5, 6 and 9.
 *
 * Resolved packages appear under `packages`, keyed either as `/name/version` (5 and 6) or
 * `name@version` (9). Direct dependencies are read separately so declared and transitive
 * dependencies remain distinguishable in the output.
 */
export async function pnpmLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc = YAML.parse(content);
  if (!doc) return res;

  // Resolved packages: keys look like '/lodash/4.17.21' (v5/v6) or 'lodash@4.17.21' (v9),
  // and scoped ones like '/@babel/core/7.22.5' or '@babel/core@7.22.5'.
  for (const key of Object.keys(doc.packages ?? {})) {
    const entry = doc.packages[key] ?? {};
    let name: string | undefined;
    let version: string | undefined;

    const k = key.startsWith('/') ? key.slice(1) : key;
    const atIdx = k.lastIndexOf('@');
    if (atIdx > 0) {
      name = k.slice(0, atIdx);
      version = k.slice(atIdx + 1);
    }
    if (name?.includes('/') && !name.startsWith('@')) {
      // v5/v6 slash form: 'lodash/4.17.21'
      const parts = k.split('/');
      version = parts.pop();
      name = parts.join('/');
    }
    name = entry.name ?? name;
    version = entry.version ?? version;
    // v9 peer-suffixed versions: '1.2.3(react@18.0.0)'
    version = version?.replace(/\(.*\)$/, '');
    if (name) push(res, name, version);
  }

  // Direct dependencies, so declared-vs-transitive stays visible. v9 nests these under
  // importers['.']; v5/v6 put them at the top level.
  const importers = doc.importers ?? {
    '.': { dependencies: doc.dependencies, devDependencies: doc.devDependencies },
  };
  for (const importer of Object.values<any>(importers)) {
    for (const scope of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, value] of Object.entries<any>(importer?.[scope] ?? {})) {
        const spec = typeof value === 'string' ? value : (value?.specifier ?? value?.version);
        if (isLocalSpecifier(spec)) continue; // workspace:* / link: sibling, not a published package
        const version = typeof value === 'string' ? value : value?.version;
        push(res, name, String(version ?? '').replace(/\(.*\)$/, ''), scope);
      }
    }
  }
  return dedupe(res);
}

/**
 * Parses `bun.lock`, Bun's JSONC text lockfile.
 *
 * The binary `bun.lockb` cannot be parsed; `LockfileScanner` reports it as a coverage gap instead.
 */
export async function bunLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  // JSONC: strip comments and trailing commas before parsing.
  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  let doc: any;
  try {
    doc = JSON.parse(cleaned);
  } catch {
    return res;
  }
  for (const [key, value] of Object.entries<any>(doc?.packages ?? {})) {
    // value[0] is a descriptor like 'lodash@4.17.21'
    const descriptor = Array.isArray(value) ? value[0] : undefined;
    let name = key;
    let version: string | undefined;
    if (typeof descriptor === 'string') {
      const at = descriptor.lastIndexOf('@');
      if (at > 0) {
        name = descriptor.slice(0, at);
        version = descriptor.slice(at + 1);
      }
    }
    if (isLocalSpecifier(version)) continue;
    push(res, name, version);
  }
  return dedupe(res);
}

function dedupe(res: LockfileResult): LockfileResult {
  const seen = new Set<string>();
  res.purls = res.purls.filter((p) => {
    const k = `${p.purl}|${p.requirement ?? ''}|${p.scope ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return res;
}
