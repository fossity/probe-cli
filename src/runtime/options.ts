// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Scan-wide switches read by the pipeline tasks.
 *
 * Pipeline stages are constructed from a `Project` alone, so there is no constructor parameter to
 * thread options through. They live in one module-level object that `ScanRunner` sets before a scan
 * begins; only one scan runs per process.
 */
export interface ScanOptions {
  /**
   * Parse manifests found inside dependency directories (`node_modules`, `vendor` and similar).
   *
   * Off by default: a vendored package's own manifest describes third-party code the parent
   * project's lockfile already accounts for, so including it inflates the dependency count.
   */
  includeVendored: boolean;

  /**
   * Parse the lockfile formats the scanoss SDK does not recognise.
   *
   * On by default. Turning it off restricts dependency discovery to the SDK's manifests, which is
   * occasionally useful when comparing results with other tooling built on it.
   */
  lockfiles: boolean;

  /**
   * Remove registry and repository URLs from dependency records before they are written.
   *
   * On by default: lockfiles routinely name internal registry hosts and private tarball URLs, which
   * the audit contract does not require and which should not leave the scanning machine.
   */
  redactRegistries: boolean;
}

/** Defaults applied when a caller supplies no options. */
export const DEFAULT_SCAN_OPTIONS: Readonly<ScanOptions> = Object.freeze({
  includeVendored: false,
  lockfiles: true,
  redactRegistries: true,
});

/** The options in force for the current scan. */
export const scanOptions: ScanOptions = { ...DEFAULT_SCAN_OPTIONS };

/** Applies the caller's options over the defaults, discarding any previous scan's settings. */
export function setScanOptions(partial: Partial<ScanOptions> = {}): ScanOptions {
  Object.assign(scanOptions, DEFAULT_SCAN_OPTIONS, partial);
  return scanOptions;
}
