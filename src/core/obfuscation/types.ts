// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Data-transfer shapes used by the obfuscation stage.
 *
 * Returned by the obfuscation stage; `ScanRunner` reports the summary and keeps the dictionary on
 * the scanning machine.
 */

/** Result of obfuscating one artifact: its path, plus the word to replacement-key mapping applied. */
export interface ObfuscationDTO {
  path: string;
  dictionary: Record<string, string>;
}

/** How many paths were rewritten, and how often each requested word matched. */
export interface ObfuscationSummary {
  totalFiles: number;
  totalFilesObfuscated: number;
  obfuscationSummary: Record<string, number>;
}
