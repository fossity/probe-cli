// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import pc from 'picocolors';
import { ScanEvent, scanEvents } from '../core/events';
import { ScanOutcome } from '../core/ScanRunner';
import { brand } from '../runtime/brand';

const isTTY = process.stdout.isTTY && !process.env.CI;

/**
 * Renders scan progress in the terminal.
 *
 * On a terminal each stage gets one spinning line that is overwritten in place and ticked when the
 * stage completes. Without a terminal (CI, a pipe) nothing is drawn until a stage finishes, so the
 * log stays one line per stage.
 */
export class Reporter {
  private stage = '';

  private percent = 0;

  private timer: NodeJS.Timeout | null = null;

  private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  private frame = 0;

  private lastLineLength = 0;

  constructor(private readonly quiet = false) {}

  public attach() {
    scanEvents.on(ScanEvent.StageStarted, ({ label, stage, step }) => {
      this.finishLine();
      this.stage = `${label || stage} ${pc.dim(`(${step})`)}`;
      this.percent = 0;
      this.draw();
    });

    scanEvents.on(ScanEvent.Progress, ({ processed }) => {
      if (typeof processed === 'number') this.percent = Math.min(100, processed);
      this.draw();
    });

    scanEvents.on(ScanEvent.StageFailed, ({ name, cause }) => {
      this.finishLine();
      process.stderr.write(`${pc.red('✖')} ${name}: ${cause?.message ?? ''}\n`);
    });

    if (isTTY && !this.quiet) {
      this.timer = setInterval(() => {
        this.frame = (this.frame + 1) % this.frames.length;
        this.draw();
      }, 90);
      if (typeof this.timer.unref === 'function') this.timer.unref();
    }
  }

  private draw() {
    if (this.quiet || !this.stage) return;
    const pct = this.percent > 0 ? ` ${pc.dim(`${this.percent.toFixed(0)}%`)}` : '';
    if (!isTTY) return; // non-TTY: one line per stage, written by finishLine()
    const line = `  ${pc.cyan(this.frames[this.frame])} ${this.stage}${pct}`;
    process.stdout.write(`\r${' '.repeat(this.lastLineLength)}\r${line}`);
    this.lastLineLength = stripAnsi(line).length;
  }

  /** Marks the current stage complete. Clearing `stage` keeps a repeated call from printing twice. */
  private finishLine() {
    if (this.quiet || !this.stage) return;
    const label = `  ${pc.green('✔')} ${this.stage}`;
    if (isTTY) process.stdout.write(`\r${' '.repeat(this.lastLineLength)}\r${label}\n`);
    else process.stdout.write(`${stripAnsi(label)}\n`);
    this.stage = '';
    this.lastLineLength = 0;
  }

  /** Stops rendering and unsubscribes. Safe to call more than once. */
  public done() {
    this.finishLine();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    scanEvents.removeAllListeners();
  }
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function printOutcome(outcome: ScanOutcome, opts: { raw?: boolean } = {}) {
  const kb = (outcome.bytes / 1024).toFixed(1);
  const stats = outcome.lockfileStats;

  process.stdout.write(`\n${pc.bold('Scan complete')}\n`);
  process.stdout.write(`  files seen           ${outcome.filesTotal}\n`);
  process.stdout.write(`  fingerprinted        ${outcome.filesFingerprinted}\n`);
  process.stdout.write(`  filtered out         ${outcome.filesFiltered}\n`);
  process.stdout.write(
    `  dependency files     ${outcome.dependencyFiles} ${pc.dim(`(${outcome.dependencyPurls} purls)`)}\n`,
  );

  if (stats && stats.totalPurls > 0) {
    const eco = Object.entries(stats.perEcosystem)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}:${count}`)
      .join('  ');
    process.stdout.write(`  ${pc.cyan('from lockfiles')}       ${stats.totalPurls} purls ${pc.dim(eco)}\n`);
  }
  if (stats?.unparseable.length) {
    process.stdout.write(
      `  ${pc.yellow('binary lockfiles')}     ${stats.unparseable.length} skipped (cannot be parsed)\n`,
    );
  }
  if (stats?.failures.length) {
    process.stdout.write(`  ${pc.yellow('parse failures')}       ${stats.failures.length} (see --verbose)\n`);
  }
  if (outcome.obfuscatedPaths) {
    process.stdout.write(`  obfuscated paths     ${outcome.obfuscatedPaths}\n`);
  }

  process.stdout.write(`\n  ${pc.green('→')} ${pc.bold(outcome.packagePath)} ${pc.dim(`(${kb} KB)`)}\n`);
  if (!opts.raw) process.stdout.write(`  ${pc.dim(`upload it at ${brand.uploadUrl}`)}\n`);
  process.stdout.write('\n');
}
