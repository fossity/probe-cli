// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Scan logging.
 *
 * The terminal belongs to the progress reporter, so the log is quiet by default and appends to
 * `project.log` inside the working directory, which keeps a failed scan diagnosable. `--verbose`
 * mirrors it to stderr; errors always go there.
 */
import fs from 'fs';
import path from 'path';

type Level = 'info' | 'warn' | 'error' | 'debug';

let logFilePath: string | null = null;
let stream: fs.WriteStream | null = null;
let verbose = process.env.PROBE_VERBOSE === '1';

/** Directs the log at a file, creating its directory. Closes any previously open file. */
export function setLogFile(filePath: string): void {
  if (filePath === logFilePath) return;
  try {
    stream?.end();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    stream = fs.createWriteStream(filePath, { flags: 'a' });
    logFilePath = filePath;
  } catch {
    // A log that cannot be opened must not stop a scan.
    stream = null;
    logFilePath = null;
  }
}

/**
 * Closes the log file.
 *
 * Windows refuses to delete a file that is still open, so the handle has to be released before the
 * working directory can be removed. On other systems this is merely tidy.
 */
export function closeLogFile(): Promise<void> {
  const closing = stream;
  stream = null;
  logFilePath = null;

  if (!closing) return Promise.resolve();
  // end() only queues the close; the handle lives until the stream says otherwise.
  return new Promise((resolve) => {
    closing.once('close', () => resolve());
    closing.end();
  });
}

/** Path currently being written to, or null when logging to memory only. */
export function getLogFile(): string | null {
  return logFilePath;
}

/** Mirrors every entry to stderr as well as the file. */
export function setVerbose(value: boolean): void {
  verbose = value;
}

function write(level: Level, args: unknown[]): void {
  const line = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack ?? arg.message;
      return JSON.stringify(arg);
    })
    .join(' ');

  const entry = `[${new Date().toISOString()}] [${level}] ${line}\n`;
  stream?.write(entry);
  if (verbose || level === 'error') process.stderr.write(entry);
}

export const log = {
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
  debug: (...args: unknown[]) => write('debug', args),
};

export default log;
