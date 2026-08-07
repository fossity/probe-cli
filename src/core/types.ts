// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Types shared by the scanning pipeline.
 *
 * Kept deliberately small: only what the pipeline reads or writes.
 */

/** Lifecycle of the project directory that holds a scan's intermediate artifacts. */
export enum ProjectState {
  OPENED = 'OPENED',
  CLOSED = 'CLOSED',
}

/** How far a scan has progressed. Persisted in `metadata.json`. */
export enum ScanState {
  CREATED = 'CREATED',
  INDEXED = 'INDEXED',
  SCANNING = 'SCANNING',
  FINISHED = 'FINISHED',
  FAILED = 'FAILED',
}

/** Pipeline stages, reported through {@link ScanEvent.StageStarted}. */
export enum ScannerStage {
  INDEX = 'INDEX',
  SCAN = 'SCAN',
  DEPENDENCY = 'DEPENDENCY',
  HINT = 'HINT',
  OBFUSCATE = 'OBFUSCATE',
  ATTACH_FILES = 'ATTACH_FILES',
}

/** Contents of `metadata.json`: the client-side record of a scan. Never sent to the auditor. */
export interface IMetadata {
  name: string;
  scan_root: string;
  appVersion: string;
  date: string;
  work_root: string;
  uuid: string;
  files: number;
  scannerState: ScanState;
  obfuscatedList: Array<string>;
}

/**
 * Contents of `output/projectMetadata.json`: the declaration that travels inside the package.
 *
 * `software_composition_*` fields start as paths on the scanning machine and are rewritten to the
 * in-package filenames by `AttachFileTask`.
 */
export interface IProjectInfoMetadata {
  /** Who the auditor should contact. An email address is mandatory. */
  contact?: Record<string, string> | null;
  opt_in_sms: boolean;
  /** Path to an SBOM of components already known to be present. */
  software_composition_known_uri?: string;
  /** Path to a list of components the auditor should ignore. */
  software_composition_ignore_uri?: string;
  /** Paths to further files to attach, copied in as `SCA0000_<name>`. */
  software_composition_uri?: Array<string>;
  /** Free-text notes for the auditor. */
  software_composition?: string;
  /** The declared license of the scanned code. */
  default_license: string;
  extra_license?: string;
}
