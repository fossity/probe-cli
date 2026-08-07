// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { ObfuscationSummary } from './types';

/** Replaces identifying words in a path and records what it replaced. */
export interface PathObfuscator {
  /** The path with every configured word replaced by its key. */
  adapt(path: string): string;

  /** Writes the dictionary to `projectPath` and returns it. */
  done(projectPath?: string): Promise<Record<string, string>>;

  /** False when no words were configured, in which case rewriting is skipped entirely. */
  hasWords(): boolean;

  /** How many paths were rewritten, and how often each word matched. */
  getSummary(): ObfuscationSummary;
}
