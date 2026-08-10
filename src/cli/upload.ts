// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import path from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { uploadPackage, UploadError } from '../core/upload';
import { brand } from '../runtime/brand';

const isTTY = process.stdout.isTTY && !process.env.CI;

/** `1.2 MB`, matching how the website reports the same numbers. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function bar(fraction: number, width = 24): string {
  const filled = Math.round(fraction * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

/**
 * Asks whether to send the package, spelling out what that means and what the alternative is.
 *
 * Answering no is a first-class outcome: the file is already written, and it can be submitted later
 * from any machine. Nothing leaves this one unless the answer is yes.
 */
export async function confirmUpload(packagePath: string): Promise<boolean> {
  p.note(
    [
      `${pc.bold('Send it now')}   uploads ${path.basename(packagePath)} over HTTPS to ${new URL(brand.uploadApiUrl).host}.`,
      `              Needs an internet connection from this machine.`,
      ``,
      `${pc.bold('Send it later')}  copy the file anywhere and drop it at`,
      `              ${brand.uploadUrl}`,
      `              from any machine with a browser. Nothing is uploaded from here.`,
    ].join('\n'),
    'Submitting the package',
  );

  const answer = await p.confirm({
    message: `Upload ${path.basename(packagePath)} to ${new URL(brand.uploadApiUrl).host} now?`,
    initialValue: false,
  });

  return !p.isCancel(answer) && answer === true;
}

/**
 * Uploads the package, drawing progress.
 *
 * Returns true when the server accepted it. A failure is reported with the file left in place, so
 * the person can retry or submit it through the website.
 */
export async function runUpload(packagePath: string): Promise<boolean> {
  const host = new URL(brand.uploadApiUrl).host;
  let lastLine = 0;

  const draw = (sent: number, total: number) => {
    if (!isTTY) return;
    const fraction = total > 0 ? sent / total : 0;
    const line = `  ${pc.cyan(bar(fraction))} ${(fraction * 100).toFixed(0).padStart(3)}%  ${formatSize(sent)} / ${formatSize(total)}`;
    process.stdout.write(`\r${' '.repeat(lastLine)}\r${line}`);
    lastLine = line.replace(/\x1b\[[0-9;]*m/g, '').length; // eslint-disable-line no-control-regex
  };

  process.stdout.write(`\n  Uploading ${path.basename(packagePath)} to ${host}\n`);

  try {
    await uploadPackage(packagePath, brand.uploadApiUrl, ({ sent, total }) => draw(sent, total));
    if (isTTY) process.stdout.write(`\r${' '.repeat(lastLine)}\r`);
    process.stdout.write(`  ${pc.green('✔')} uploaded — the auditor has it\n\n`);
    return true;
  } catch (error) {
    if (isTTY) process.stdout.write(`\r${' '.repeat(lastLine)}\r`);
    const reason = error instanceof UploadError ? error.message : ((error as Error)?.message ?? String(error));
    process.stderr.write(`  ${pc.red('✖')} upload failed: ${reason}\n`);
    process.stderr.write(`  The package is still at ${packagePath}\n`);
    process.stderr.write(`  You can submit it from any machine at ${brand.uploadUrl}\n\n`);
    return false;
  }
}
