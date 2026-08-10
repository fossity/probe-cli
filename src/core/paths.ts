// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Paths written into the package.
 *
 * A scan reads paths in the host's native form, but everything it *writes* uses forward slashes.
 * Two reasons:
 *
 *  - A package must describe the same codebase whichever machine produced it. Backslashes from a
 *    Windows scan and forward slashes from a Linux one would be two different records of one tree,
 *    and whatever consumes them would have to reconcile that.
 *  - Path obfuscation matches text. The winnowing engine writes the scanned path into the
 *    fingerprint file verbatim, so a separator mismatch between what was written and what is
 *    searched for means the replacement silently does nothing — the words the author asked to
 *    remove stay in the package while the run reports success.
 *
 * Only paths this program emits are converted. Paths handed back to the filesystem stay native.
 */

/** Rewrites a path for an artifact: separators become forward slashes. */
export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Splits a path on either separator, so callers need not know which produced it. */
export function splitPathParts(value: string): { dir: string; name: string; ext: string } {
  const normalised = toPosixPath(value);
  const lastSlash = normalised.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : normalised.slice(0, lastSlash);
  const base = normalised.slice(lastSlash + 1);

  // A leading dot is part of the name, not an extension: `.gitignore` has none.
  const lastDot = base.lastIndexOf('.');
  const hasExtension = lastDot > 0;

  return {
    dir,
    name: hasExtension ? base.slice(0, lastDot) : base,
    ext: hasExtension ? base.slice(lastDot) : '',
  };
}

/** Rejoins what {@link splitPathParts} produced. */
export function joinPathParts(dir: string, stem: string): string {
  return dir ? `${dir}/${stem}` : stem;
}

/**
 * Rewrites the paths in a WFP so they use forward slashes.
 *
 * Only `file=` header lines carry a path; the hash lines that follow must not be touched. The path
 * is the third field and may itself contain commas, so everything after the size is the path.
 */
export function normaliseWfpPaths(wfp: string): string {
  return wfp.replace(
    /^file=([^,]*),([^,]*),(.*)$/gm,
    (_line, md5, size, filePath) => `file=${md5},${size},${toPosixPath(filePath)}`,
  );
}
