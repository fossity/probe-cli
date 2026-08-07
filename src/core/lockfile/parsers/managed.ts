// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import * as TOML from 'smol-toml';
import YAML from 'yaml';
import { XMLParser } from 'fast-xml-parser';
import { LockfileResult, emptyResult } from '../types';
import { purl, isLocalSpecifier, bareVersion, pinnedVersion, splitPath } from '../purl';

/** composer.lock — PHP; `packages` and `packages-dev`, names are 'vendor/name'. */
export async function composerLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = JSON.parse(content);
  for (const [section, scope] of [
    ['packages', 'dependencies'],
    ['packages-dev', 'devDependencies'],
  ] as const) {
    for (const pkg of doc?.[section] ?? []) {
      const [namespace, name] = String(pkg?.name ?? '').split('/');
      const version = String(pkg?.version ?? '').replace(/^v/, '');
      const p = purl('composer', name ? namespace : undefined, name ?? namespace, version);
      if (p) res.purls.push({ purl: p, requirement: version, scope });
    }
  }
  return res;
}

/** composer.json — `require` / `require-dev`, skipping the php/ext-* platform packages. */
export async function composerJsonParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = JSON.parse(content);
  for (const [section, scope] of [
    ['require', 'dependencies'],
    ['require-dev', 'devDependencies'],
  ] as const) {
    for (const [name, requirement] of Object.entries<any>(doc?.[section] ?? {})) {
      if (name === 'php' || name.startsWith('ext-') || name.startsWith('lib-')) continue;
      const [namespace, pkg] = name.split('/');
      const p = purl('composer', pkg ? namespace : undefined, pkg ?? namespace, pinnedVersion(requirement));
      if (p) res.purls.push({ purl: p, requirement: String(requirement), scope });
    }
  }
  return res;
}

/** gradle.lockfile — 'group:name:version=conf1,conf2' one per line. */
export async function gradleLockfileParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [coords, configurations] = line.split('=');
    const [group, name, version] = coords.split(':');
    if (!group || !name) continue;
    const p = purl('maven', group, name, version);
    if (p) res.purls.push({ purl: p, requirement: version, scope: configurations?.split(',')[0] });
  }
  return res;
}

/** packages.lock.json — NuGet's lock format: frameworks -> package -> { resolved }. */
export async function nugetPackagesLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = JSON.parse(content);
  for (const framework of Object.values<any>(doc?.dependencies ?? {})) {
    for (const [name, value] of Object.entries<any>(framework ?? {})) {
      if (value?.type === 'Project') continue; // sibling project reference, not a package
      const version = value?.resolved ?? value?.requested;
      const p = purl('nuget', undefined, name, bareVersion(version) ?? version);
      if (p) res.purls.push({ purl: p, requirement: version, scope: value?.type });
    }
  }
  return res;
}

/** paket.lock — F#/.NET; indented 'Name (1.2.3)' under NUGET/GITHUB groups. */
export async function paketLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  let type = 'nuget';
  let remoteOwner: string | undefined;
  for (const raw of content.split(/\r?\n/)) {
    if (/^NUGET/i.test(raw)) {
      type = 'nuget';
      remoteOwner = undefined;
      continue;
    }
    if (/^GITHUB/i.test(raw)) {
      type = 'github';
      remoteOwner = undefined;
      continue;
    }
    if (/^(HTTP|GIT)/i.test(raw)) {
      type = 'generic';
      remoteOwner = undefined;
      continue;
    }
    const remote = raw.match(/^\s+remote:\s*(\S+)/);
    if (remote) {
      // 'remote: forki/FsUnit' names the repo the following entries belong to.
      remoteOwner = remote[1].includes('/') ? remote[1].split('/')[0] : undefined;
      continue;
    }
    const m = raw.match(/^\s{4,}([^\s(]+)\s*\(([^)]+)\)/);
    if (!m) continue;
    const version = m[2].split(' ')[0].replace(/^[<>=~\s]*/, '');
    if (type === 'github') {
      const parts = m[1].split('/');
      const namespace = parts.length > 1 ? parts[0] : remoteOwner;
      const name = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
      const p = purl('github', namespace, name, version);
      if (p) res.purls.push({ purl: p, requirement: version });
    } else {
      const p = purl(type, undefined, m[1], version);
      if (p) res.purls.push({ purl: p, requirement: version });
    }
  }
  return res;
}

/** *.fsproj / *.vbproj — same <PackageReference> shape as csproj, which scanoss covers. */
export async function dotnetProjectParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });
  const doc: any = parser.parse(content);
  const itemGroups = doc?.Project?.ItemGroup;
  const groups = Array.isArray(itemGroups) ? itemGroups : itemGroups ? [itemGroups] : [];
  for (const group of groups) {
    const refs = Array.isArray(group?.PackageReference)
      ? group.PackageReference
      : group?.PackageReference
        ? [group.PackageReference]
        : [];
    for (const ref of refs) {
      const name = ref?.['@Include'];
      const version = ref?.['@Version'] ?? ref?.Version;
      const p = purl(
        'nuget',
        undefined,
        name,
        pinnedVersion(String(version ?? '')) ?? bareVersion(String(version ?? '')),
      );
      if (p) res.purls.push({ purl: p, requirement: version ? String(version) : undefined });
    }
  }
  return res;
}

/** pubspec.lock — Dart/Flutter. */
export async function pubspecLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = YAML.parse(content, { logLevel: 'silent' });
  for (const [name, value] of Object.entries<any>(doc?.packages ?? {})) {
    if (value?.source === 'path' || value?.source === 'sdk') continue;
    const p = purl('pub', undefined, name, value?.version);
    if (p) res.purls.push({ purl: p, requirement: value?.version, scope: value?.dependency });
  }
  return res;
}

/** pubspec.yaml — Dart/Flutter manifest. */
export async function pubspecYamlParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = YAML.parse(content, { logLevel: 'silent' });
  for (const [section, scope] of [
    ['dependencies', 'dependencies'],
    ['dev_dependencies', 'devDependencies'],
  ] as const) {
    for (const [name, value] of Object.entries<any>(doc?.[section] ?? {})) {
      if (value && typeof value === 'object' && (value.path || value.sdk || value.git)) continue;
      const requirement = typeof value === 'string' ? value : undefined;
      const p = purl('pub', undefined, name, pinnedVersion(requirement));
      if (p) res.purls.push({ purl: p, requirement, scope });
    }
  }
  return res;
}

/** mix.lock — Elixir; `"phoenix": {:hex, :phoenix, "1.7.7", ...},` */
export async function mixLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const re = /"([^"]+)":\s*\{\s*:(\w+)\s*,\s*:([^,\s]+)\s*,\s*"([^"]+)"/g;
  for (const m of content.matchAll(re)) {
    const [, key, source, , version] = m;
    if (source !== 'hex') continue; // :git / :path deps are not on hex.pm
    const p = purl('hex', undefined, key, version);
    if (p) res.purls.push({ purl: p, requirement: version });
  }
  return res;
}

/** Gopkg.lock — pre-modules `dep` tool. */
export async function gopkgLockParser(content: string, filePath: string): Promise<LockfileResult> {
  const res = emptyResult(filePath);
  const doc: any = TOML.parse(content);
  for (const project of doc?.projects ?? []) {
    const name = project?.name;
    const version = project?.version ?? project?.revision;
    if (isLocalSpecifier(name)) continue;
    // Go module paths carry their own namespace: github.com/pkg + errors.
    const { namespace, name: pkg } = splitPath(name);
    const p = purl('golang', namespace, pkg, version);
    if (p) res.purls.push({ purl: p, requirement: version });
  }
  return res;
}
