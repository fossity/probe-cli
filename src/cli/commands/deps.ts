// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import pc from 'picocolors';
import { LocalDependencies } from 'scanoss';
import { LockfileScanner } from '../../core/lockfile/LockfileScanner';

/**
 * `probe deps <folder>` — dependency discovery on its own, with no fingerprinting and no package.
 * Useful for checking dependency coverage before committing to a full scan.
 */
export function depsCommand(): Command {
  return new Command('deps')
    .description('list the dependencies found in manifests and lockfiles (no package written)')
    .argument('[folder]', 'folder to inspect', '.')
    .option('--json', 'print JSON instead of a table', false)
    .action(async (folder, opts) => {
      const root = path.resolve(folder ?? '.');
      if (!fs.existsSync(root)) {
        process.stderr.write(`${pc.red('✖')} ${root} does not exist\n`);
        process.exit(1);
      }

      const files = walk(root, root);
      const scanoss = new LocalDependencies();
      const lockfiles = new LockfileScanner();

      const scanossResults = await scanoss.search(scanoss.filterFiles(files));
      const lockfileResults = await lockfiles.search(lockfiles.filterFiles(files));

      const all = [
        ...scanossResults.files.map((f: any) => ({ ...f, source: 'scanoss' })),
        ...lockfileResults.files.map((f: any) => ({ ...f, source: 'lockfile' })),
      ].map((f) => ({ ...f, file: f.file.replace(root, '') || path.basename(f.file) }));

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ files: all, stats: lockfileResults.stats }, null, 2)}\n`);
        return;
      }

      if (all.length === 0) {
        process.stdout.write(`No manifests or lockfiles found under ${root}\n`);
        return;
      }

      const width = Math.max(...all.map((f) => f.file.length));
      process.stdout.write('\n');
      for (const entry of all.sort((a, b) => a.file.localeCompare(b.file))) {
        const tag = entry.source === 'lockfile' ? pc.cyan('lockfile') : pc.dim('  sdk   ');
        process.stdout.write(
          `  ${tag}  ${entry.file.padEnd(width)}  ${String(entry.purls.length).padStart(4)} purls\n`,
        );
      }

      const total = all.reduce((acc, f) => acc + f.purls.length, 0);
      const added = lockfileResults.stats.totalPurls;
      process.stdout.write(`\n  ${total} purls total`);
      if (added) process.stdout.write(pc.cyan(`, ${added} of them from lockfiles`));
      process.stdout.write('\n');

      if (lockfileResults.stats.unparseable.length) {
        process.stdout.write(
          `  ${pc.yellow('!')} binary lockfiles found but not parseable: ${lockfileResults.stats.unparseable
            .map((f) => f.replace(root, ''))
            .join(', ')}\n`,
        );
      }
      for (const failure of lockfileResults.stats.failures) {
        process.stdout.write(`  ${pc.yellow('!')} ${failure.file.replace(root, '')}: ${failure.error}\n`);
      }
      process.stdout.write('\n');
    });
}

function walk(dir: string, root: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, root));
    else out.push(full);
  }
  return out;
}
