// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { describe, it, expect } from 'vitest';
import {
  purl,
  splitNpmName,
  splitPath,
  isLocalSpecifier,
  bareVersion,
  pinnedVersion,
} from '../src/core/lockfile/purl';

describe('purl', () => {
  it('builds a package URL from its parts', () => {
    expect(purl('npm', undefined, 'lodash', '4.17.21')).toBe('pkg:npm/lodash@4.17.21');
    expect(purl('maven', 'org.slf4j', 'slf4j-api', '2.0.7')).toBe('pkg:maven/org.slf4j/slf4j-api@2.0.7');
  });

  it('omits an absent version', () => {
    expect(purl('npm', undefined, 'lodash')).toBe('pkg:npm/lodash');
    expect(purl('npm', undefined, 'lodash', '')).toBe('pkg:npm/lodash');
  });

  it('returns null rather than throwing on unusable input', () => {
    // One malformed lockfile entry must not abort a scan.
    expect(purl('npm', undefined, '')).toBeNull();
    expect(purl('', undefined, 'lodash')).toBeNull();
  });
});

describe('splitNpmName', () => {
  it('separates an npm scope from the package name', () => {
    expect(splitNpmName('@babel/core')).toEqual({ namespace: '@babel', name: 'core' });
  });

  it('leaves an unscoped name alone', () => {
    expect(splitNpmName('lodash')).toEqual({ name: 'lodash' });
  });
});

describe('splitPath', () => {
  it('splits a module path into namespace and name', () => {
    expect(splitPath('github.com/pkg/errors')).toEqual({ namespace: 'github.com/pkg', name: 'errors' });
  });

  it('treats a single segment as a bare name', () => {
    expect(splitPath('errors')).toEqual({ name: 'errors' });
  });
});

describe('isLocalSpecifier', () => {
  it.each([
    'workspace:*',
    'workspace:^1.0.0',
    'file:../shared',
    'link:./local',
    'portal:./local',
    './relative',
    '../parent',
    '/absolute',
    'C:\\windows\\path',
    'git@github.com:acme/repo.git',
    'git+ssh://git@github.com/acme/repo.git',
    'github:acme/repo',
    'https://example.com/pkg.tgz',
  ])('treats %s as local or remote-source, not a registry package', (spec) => {
    expect(isLocalSpecifier(spec)).toBe(true);
  });

  it.each(['1.2.3', '^4.18.2', '~> 7.0', '>=2.0', 'github.com/pkg/errors', 'gitlab-ci-tools'])(
    'treats %s as a registry package',
    (spec) => {
      // 'github.com/...' and 'gitlab-ci-tools' are regression cases: an earlier pattern matched any
      // string beginning with "git" and discarded valid Go modules and npm packages.
      expect(isLocalSpecifier(spec)).toBe(false);
    },
  );

  it('treats an absent specifier as not local', () => {
    expect(isLocalSpecifier(undefined)).toBe(false);
    expect(isLocalSpecifier('')).toBe(false);
  });
});

describe('bareVersion', () => {
  it('strips comparators', () => {
    expect(bareVersion('==2.31.0')).toBe('2.31.0');
    expect(bareVersion('^1.2.3')).toBe('1.2.3');
    expect(bareVersion('v1.2.3')).toBe('1.2.3');
  });

  it('gives up on compound ranges', () => {
    expect(bareVersion('>=1.0,<2.0')).toBeUndefined();
    expect(bareVersion('*')).toBeUndefined();
    expect(bareVersion(undefined)).toBeUndefined();
  });
});

describe('pinnedVersion', () => {
  it('accepts exact pins', () => {
    expect(pinnedVersion('1.2.3')).toBe('1.2.3');
    expect(pinnedVersion('==1.2.3')).toBe('1.2.3');
    expect(pinnedVersion('=1.2.3')).toBe('1.2.3');
  });

  it('rejects ranges, so the purl never asserts an unresolved version', () => {
    expect(pinnedVersion('^4.18.2')).toBeUndefined();
    expect(pinnedVersion('>=2.0')).toBeUndefined();
    expect(pinnedVersion('~1.2')).toBeUndefined();
  });

  it('treats a bare version as a range where the ecosystem does', () => {
    // In Cargo, "1.0" means ^1.0; only "=1.0" is a pin.
    expect(pinnedVersion('1.0', false)).toBeUndefined();
    expect(pinnedVersion('=1.0', false)).toBe('1.0');
  });
});
