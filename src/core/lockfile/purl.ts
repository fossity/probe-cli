// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { PackageURL } from 'packageurl-js';

/**
 * Build a purl string, returning null instead of throwing on junk input — a single malformed
 * lockfile entry must never abort a scan.
 */
export function purl(
  type: string,
  namespace: string | undefined,
  name: string,
  version?: string,
): string | null {
  if (!name) return null;
  try {
    return new PackageURL(
      type,
      namespace || undefined,
      name,
      version || undefined,
      undefined,
      undefined,
    ).toString();
  } catch {
    return null;
  }
}

/** '@scope/pkg' -> { namespace: '@scope', name: 'pkg' } */
export function splitNpmName(dep: string): { namespace?: string; name: string } {
  const i = dep.indexOf('/');
  if (i === -1) return { name: dep };
  return { namespace: dep.slice(0, i), name: dep.slice(i + 1) };
}

/**
 * Specifiers that do not describe a published package: workspace siblings, local paths,
 * tarballs and VCS checkouts. Emitting purls for these produces components that exist in no
 * registry, so they are skipped and counted separately.
 */
const LOCAL_SPECIFIER = /^(workspace:|file:|link:|portal:|path:|\.{1,2}\/|\/|~\/|[a-zA-Z]:[\\/])/;
const VCS_SPECIFIER = /^(git@|git:|git\+[a-z]+:|hg\+|svn\+|bzr\+|github:|gitlab:|bitbucket:)/;
const URL_SPECIFIER = /^https?:\/\//;

export function isLocalSpecifier(spec?: string): boolean {
  if (!spec) return false;
  const s = spec.trim();
  return LOCAL_SPECIFIER.test(s) || VCS_SPECIFIER.test(s) || URL_SPECIFIER.test(s);
}

/** Strip a leading comparator so '==2.31.0' / '^1.2.3' / '~> 7.0' yield a bare version. */
export function bareVersion(requirement?: string): string | undefined {
  if (!requirement) return undefined;
  const m = requirement.trim().match(/^[=<>~^!\s]*v?(\d[\w.\-+]*)$/);
  return m ? m[1] : undefined;
}

/**
 * Version for a *manifest* entry: only exact pins ('1.2.3', '==1.2.3', '=1.2.3') become part of the
 * purl. A range like '^4.18.2' or '>=2.0' stays in `requirement` only, so the purl never asserts a
 * version that was never resolved. This matches how scanoss emits package.json entries.
 */
export function pinnedVersion(requirement?: string, bareIsExact = true): string | undefined {
  if (!requirement) return undefined;
  const trimmed = requirement.trim();
  // Cargo (and Composer's '1.0.*') treat a bare version as a caret range, not a pin, so callers in
  // those ecosystems pass bareIsExact=false and only '=1.2.3' counts.
  const re = bareIsExact ? /^(?:==|=)?v?(\d[\w.\-+]*)$/ : /^=\s*v?(\d[\w.\-+]*)$/;
  const m = trimmed.match(re);
  return m ? m[1] : undefined;
}

/** Split a Go module path / any slash-delimited name into purl namespace + name. */
export function splitPath(fullName: string): { namespace?: string; name: string } {
  const parts = String(fullName).split('/').filter(Boolean);
  if (parts.length <= 1) return { name: parts[0] ?? '' };
  return { namespace: parts.slice(0, -1).join('/'), name: parts[parts.length - 1] };
}
