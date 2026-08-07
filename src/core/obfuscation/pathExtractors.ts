// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Locating the source path inside a line of a generated artifact.
 *
 * The WFP and the dependency file embed paths in different syntaxes, so each gets an extractor and
 * `PathRewriter` stays independent of the format it is rewriting.
 */

export interface PathExtractor {
  /** The path embedded in `line`, or null when the line carries none. */
  extractPath(line: string): string | null;
}

/**
 * WFP lines are `file=<md5>,<size>,<path>`, followed by lines of hashes that carry no path.
 */
export class WfpPathExtractor implements PathExtractor {
  public extractPath(line: string): string | null {
    if (!line.startsWith('file=')) return null;
    const fields = line.split(',');
    if (fields.length < 3) return null;
    // Commas are legal in filenames, so the path is everything after the size field.
    return fields.slice(2).join(',');
  }
}

/**
 * Dependency records are pretty-printed JSON, one property per line; the path is the `file` value.
 */
export class DependencyPathExtractor implements PathExtractor {
  private static readonly FILE_PROPERTY = /"file":\s*"(.*?)",?\s*$/;

  public extractPath(line: string): string | null {
    return line.match(DependencyPathExtractor.FILE_PROPERTY)?.[1] ?? null;
  }
}
