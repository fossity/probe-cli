// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Result types for lockfile parsing.
 *
 * These mirror the scanoss SDK's `ILocalDependency` and `IDependencyResponse` shapes, so records
 * from both parsing engines can be concatenated into one `output/dependencies.json` that a consumer
 * reads without knowing which engine produced any given entry.
 */

export interface LockfilePurl {
  purl: string;
  /** Version constraint (manifest) or resolved version (lockfile), as written in the file. */
  requirement?: string;
  /** 'dependencies' | 'devDependencies' | ... — free text, matching scanoss's usage. */
  scope?: string;
}

export interface LockfileResult {
  file: string;
  purls: LockfilePurl[];
}

export type LockfileParser = (fileContent: string, filePath: string) => Promise<LockfileResult>;

export interface LockfileDefinition {
  /** Exact filename or a `*` glob, matched against the basename (case-insensitive). */
  match: string;
  /** Short ecosystem label, used in `probe deps` output and stats. */
  ecosystem: string;
  /** true when the file pins resolved versions (a lockfile) rather than constraints (a manifest). */
  resolved: boolean;
  parse: LockfileParser;
}

export const emptyResult = (filePath: string): LockfileResult => ({ file: filePath, purls: [] });
