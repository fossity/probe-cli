// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import fs from 'fs';
import path from 'path';
import { LockfileDefinition, LockfileResult } from './types';
import * as js from './parsers/javascript';
import * as py from './parsers/python';
import * as native from './parsers/native';
import * as managed from './parsers/managed';

/**
 * Filenames the scanoss SDK parses itself.
 *
 * `getDefinition()` declines these so a file is never parsed twice, once by each engine. The SDK
 * also handles `*.csproj`, which needs no entry here because no definition below claims it.
 */
export const SCANOSS_NATIVE_FILES = new Set([
  'requirements.txt',
  'pom.xml',
  'package.json',
  'package-lock.json',
  'gemfile',
  'gemfile.lock',
  'go.mod',
  'go.sum',
  'yarn.lock',
  'packages.config',
  'build.gradle',
  'pyproject.toml',
]);

/**
 * The dependency files this CLI adds on top of the SDK's coverage.
 *
 * Matching is by basename, case-insensitively; exact names win over `*` patterns. The order of this
 * array affects nothing but readability.
 */
export const LOCKFILE_DEFINITIONS: LockfileDefinition[] = [
  // --- JavaScript / TypeScript ---
  { match: 'pnpm-lock.yaml', ecosystem: 'npm', resolved: true, parse: js.pnpmLockParser },
  { match: 'npm-shrinkwrap.json', ecosystem: 'npm', resolved: true, parse: js.npmShrinkwrapParser },
  { match: 'bun.lock', ecosystem: 'npm', resolved: true, parse: js.bunLockParser },

  // --- Python ---
  { match: 'poetry.lock', ecosystem: 'pypi', resolved: true, parse: py.poetryLockParser },
  { match: 'pipfile.lock', ecosystem: 'pypi', resolved: true, parse: py.pipfileLockParser },
  { match: 'pipfile', ecosystem: 'pypi', resolved: false, parse: py.pipfileParser },
  { match: 'requirements*.txt', ecosystem: 'pypi', resolved: false, parse: py.requirementsParser },
  { match: 'environment.yml', ecosystem: 'conda', resolved: false, parse: py.condaEnvParser },
  { match: 'environment.yaml', ecosystem: 'conda', resolved: false, parse: py.condaEnvParser },

  // --- Rust / C / C++ ---
  { match: 'cargo.lock', ecosystem: 'cargo', resolved: true, parse: native.cargoLockParser },
  { match: 'cargo.toml', ecosystem: 'cargo', resolved: false, parse: native.cargoTomlParser },
  { match: 'conan.lock', ecosystem: 'conan', resolved: true, parse: native.conanLockParser },
  { match: 'vcpkg.json', ecosystem: 'vcpkg', resolved: false, parse: native.vcpkgParser },

  // --- PHP ---
  { match: 'composer.lock', ecosystem: 'composer', resolved: true, parse: managed.composerLockParser },
  { match: 'composer.json', ecosystem: 'composer', resolved: false, parse: managed.composerJsonParser },

  // --- JVM ---
  { match: 'gradle.lockfile', ecosystem: 'maven', resolved: true, parse: managed.gradleLockfileParser },

  // --- .NET ---
  { match: 'packages.lock.json', ecosystem: 'nuget', resolved: true, parse: managed.nugetPackagesLockParser },
  { match: 'paket.lock', ecosystem: 'nuget', resolved: true, parse: managed.paketLockParser },
  { match: '*.fsproj', ecosystem: 'nuget', resolved: false, parse: managed.dotnetProjectParser },
  { match: '*.vbproj', ecosystem: 'nuget', resolved: false, parse: managed.dotnetProjectParser },

  // --- Apple ---
  { match: 'podfile.lock', ecosystem: 'cocoapods', resolved: true, parse: native.podfileLockParser },
  { match: 'package.resolved', ecosystem: 'swift', resolved: true, parse: native.swiftPackageResolvedParser },
  { match: 'cartfile.resolved', ecosystem: 'carthage', resolved: true, parse: native.cartfileResolvedParser },

  // --- Dart / Elixir / Go(dep) ---
  { match: 'pubspec.lock', ecosystem: 'pub', resolved: true, parse: managed.pubspecLockParser },
  { match: 'pubspec.yaml', ecosystem: 'pub', resolved: false, parse: managed.pubspecYamlParser },
  { match: 'mix.lock', ecosystem: 'hex', resolved: true, parse: managed.mixLockParser },
  { match: 'gopkg.lock', ecosystem: 'golang', resolved: true, parse: managed.gopkgLockParser },
];

/**
 * Lockfiles in binary formats, which are detected but cannot be parsed.
 *
 * They are reported as a coverage gap rather than passed over silently, so the auditor knows
 * dependency data is missing rather than absent.
 */
export const UNPARSEABLE_FILES = new Set(['bun.lockb']);

/** What a lockfile scan found, reported by the CLI and returned in `--json` output. */
export interface LockfileScanStats {
  /** Absolute file path to the number of package URLs read from it. */
  perFile: Record<string, number>;

  /** Ecosystem label to the number of package URLs attributed to it. */
  perEcosystem: Record<string, number>;

  /** Files that matched a definition but could not be parsed, with the reason. */
  failures: Array<{ file: string; error: string }>;

  /** Binary lockfiles found in the tree; see `UNPARSEABLE_FILES`. */
  unparseable: string[];

  /** Total package URLs across every file, excluding those the SDK parsed. */
  totalPurls: number;
}

function globMatch(basename: string, pattern: string): boolean {
  if (!pattern.includes('*')) return basename === pattern;
  const re = new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  return re.test(basename);
}

/**
 * Parses the dependency files the scanoss SDK does not recognise.
 *
 * The interface mirrors the SDK's `LocalDependencies` (`filterFiles()` then `search()`) and emits
 * the same record shape, so results can be appended to `output/dependencies.json` without the
 * receiving end needing to know which engine produced an entry.
 */
export class LockfileScanner {
  private readonly exact = new Map<string, LockfileDefinition>();

  private readonly globs: LockfileDefinition[] = [];

  constructor(definitions: LockfileDefinition[] = LOCKFILE_DEFINITIONS) {
    for (const def of definitions) {
      if (def.match.includes('*')) this.globs.push(def);
      else this.exact.set(def.match.toLowerCase(), def);
    }
  }

  /**
   * The definition that handles this path, or `null` when the path is not a dependency file this
   * scanner owns. Files the scanoss SDK parses itself always return `null`.
   */
  public getDefinition(filePath: string): LockfileDefinition | null {
    const basename = path.basename(filePath).toLowerCase();
    if (SCANOSS_NATIVE_FILES.has(basename)) return null;
    const exact = this.exact.get(basename);
    if (exact) return exact;
    for (const def of this.globs) if (globMatch(basename, def.match)) return def;
    return null;
  }

  /** The subset of `files` this scanner can parse. */
  public filterFiles(files: string[]): string[] {
    return files.filter((f) => this.getDefinition(f) !== null);
  }

  /** Binary lockfiles present in `files`, which are reported as a coverage gap. */
  public findUnparseable(files: string[]): string[] {
    return files.filter((f) => UNPARSEABLE_FILES.has(path.basename(f).toLowerCase()));
  }

  /**
   * Parses every recognised file in `files`.
   *
   * A malformed or unreadable file is recorded in `stats.failures` and skipped: one bad lockfile
   * must not abort a scan that is otherwise complete.
   */
  public async search(files: string[]): Promise<{ files: LockfileResult[]; stats: LockfileScanStats }> {
    const results: LockfileResult[] = [];
    const stats: LockfileScanStats = {
      perFile: {},
      perEcosystem: {},
      failures: [],
      unparseable: this.findUnparseable(files),
      totalPurls: 0,
    };

    for (const filePath of files) {
      const def = this.getDefinition(filePath);
      if (!def) continue;
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const result = await def.parse(content, filePath);
        if (result.purls.length === 0) continue;
        results.push(result);
        stats.perFile[filePath] = result.purls.length;
        stats.perEcosystem[def.ecosystem] = (stats.perEcosystem[def.ecosystem] ?? 0) + result.purls.length;
        stats.totalPurls += result.purls.length;
      } catch (e: any) {
        stats.failures.push({ file: filePath, error: e?.message ?? String(e) });
      }
    }
    return { files: results, stats };
  }
}
