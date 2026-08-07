// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import * as TOML from 'smol-toml';
import YAML from 'yaml';
import { LockfileResult, emptyResult } from '../types';
import { purl, isLocalSpecifier, bareVersion, pinnedVersion } from '../purl';

/** Cargo.lock — [[package]] with name/version; path-only entries have no `source`. */
export async function cargoLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = TOML.parse(content);
  for (const pkg of doc?.package ?? []) {
    if (!pkg?.source) continue; // no source == this workspace's own crate
    const p = purl('cargo', undefined, pkg?.name, pkg?.version);
    if (p) res.purls.push({ purl: p, requirement: pkg?.version });
  }
  return res;
}

/** Cargo.toml — [dependencies], [dev-dependencies], [build-dependencies]. */
export async function cargoTomlParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = TOML.parse(content);
  for (const [section, scope] of [
    ['dependencies', 'dependencies'],
    ['dev-dependencies', 'devDependencies'],
    ['build-dependencies', 'buildDependencies'],
  ] as const) {
    for (const [name, value] of Object.entries<any>(doc?.[section] ?? {})) {
      if (typeof value === 'object' && (value?.path || value?.git || value?.workspace)) continue;
      const requirement = typeof value === 'string' ? value : value?.version;
      const p = purl('cargo', undefined, name, pinnedVersion(requirement, false));
      if (p) res.purls.push({ purl: p, requirement, scope });
    }
  }
  return res;
}

/** conan.lock (v1 and v2) — requires look like 'zlib/1.2.13#revision%timestamp'. */
export async function conanLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = JSON.parse(content);
  const refs: string[] = [];
  for (const key of ['requires', 'build_requires', 'python_requires']) {
    if (Array.isArray(doc?.[key])) refs.push(...doc[key]);
  }
  // v1 keeps them under graph_lock.nodes[].ref
  for (const node of Object.values<any>(doc?.graph_lock?.nodes ?? {})) {
    if (node?.ref) refs.push(node.ref);
  }
  for (const ref of refs) {
    const clean = String(ref).split('#')[0];
    const [name, version] = clean.split('/');
    const p = purl('conan', undefined, name, version);
    if (p) res.purls.push({ purl: p, requirement: version });
  }
  return res;
}

/** vcpkg.json — manifest mode. */
export async function vcpkgParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = JSON.parse(content);
  const entries = [...(doc?.dependencies ?? []), ...(doc?.['test-dependencies'] ?? [])];
  for (const entry of entries) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    const version = typeof entry === 'object' ? (entry?.['version>='] ?? entry?.version) : undefined;
    const p = purl('generic', 'vcpkg', name, version);
    if (p) res.purls.push({ purl: p, requirement: version });
  }
  return res;
}

/** Podfile.lock — CocoaPods; the PODS: block is YAML-ish with 'Name (1.2.3)' entries. */
export async function podfileLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc = YAML.parse(content, { logLevel: 'silent' }) as any;
  const seen = new Set<string>();
  const add = (spec: string) => {
    const m = String(spec).match(/^\s*([^\s(]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return;
    const name = m[1].split('/')[0]; // subspecs: 'Firebase/Auth' -> 'Firebase'
    const version = m[2]?.replace(/^[~><=\s]*/, '');
    const key = `${name}@${version ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const p = purl('cocoapods', undefined, name, version);
    if (p) res.purls.push({ purl: p, requirement: version });
  };
  for (const entry of doc?.PODS ?? []) {
    if (typeof entry === 'string') add(entry);
    else if (entry && typeof entry === 'object') Object.keys(entry).forEach(add);
  }
  if (!doc?.PODS) {
    // Fall back to a line scan when the file is not valid YAML.
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s{2,}-\s+(.+)$/);
      if (m) add(m[1].replace(/["']/g, ''));
    }
  }
  return res;
}

/** Package.resolved — SwiftPM v1 (object.pins) and v2/v3 (pins). */
export async function swiftPackageResolvedParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = JSON.parse(content);
  const pins = doc?.pins ?? doc?.object?.pins ?? [];
  for (const pin of pins) {
    const location: string = pin?.location ?? pin?.repositoryURL ?? '';
    const identity: string = pin?.identity ?? pin?.package ?? '';
    const version = pin?.state?.version ?? pin?.state?.revision;
    // Derive namespace/name from the repo URL so the purl is resolvable.
    const m = location.replace(/\.git$/, '').match(/[/:]([^/]+)\/([^/]+)$/);
    const namespace = m ? m[1] : undefined;
    const name = m ? m[2] : identity;
    const p = purl('swift', namespace ? `github.com/${namespace}` : undefined, name, version);
    if (p) res.purls.push({ purl: p, requirement: version });
  }
  return res;
}

/** Cartfile.resolved — Carthage; `github "Alamofire/Alamofire" "5.6.4"`. */
export async function cartfileResolvedParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  for (const line of content.split(/\r?\n/)) {
    const m = line.trim().match(/^(github|git|binary)\s+"([^"]+)"\s+"?([^"\s]+)"?/);
    if (!m) continue;
    const [, kind, ref, version] = m;
    if (kind === 'github') {
      const [namespace, name] = ref.split('/');
      const p = purl('github', namespace, name, version);
      if (p) res.purls.push({ purl: p, requirement: version });
    } else if (!isLocalSpecifier(ref)) {
      const name =
        ref
          .replace(/\.git$/, '')
          .split('/')
          .pop() ?? ref;
      const p = purl('generic', undefined, name, version);
      if (p) res.purls.push({ purl: p, requirement: version });
    }
  }
  return res;
}
