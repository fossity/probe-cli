// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { Command } from 'commander';
import pc from 'picocolors';
import {
  LOCKFILE_DEFINITIONS,
  SCANOSS_NATIVE_FILES,
  UNPARSEABLE_FILES,
} from '../../core/lockfile/LockfileScanner';

/** `probe formats` — what this build can read, so coverage gaps are visible without a scan. */
export function formatsCommand(): Command {
  return new Command('formats')
    .description('list every manifest and lockfile format this build understands')
    .option('--json', 'print JSON', false)
    .action((opts) => {
      const inherited = [...SCANOSS_NATIVE_FILES].sort();
      const added = [...LOCKFILE_DEFINITIONS].sort(
        (a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.match.localeCompare(b.match),
      );

      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              inherited,
              added: added.map(({ match, ecosystem, resolved }) => ({ match, ecosystem, resolved })),
              unparseable: [...UNPARSEABLE_FILES],
            },
            null,
            2,
          )}\n`,
        );
        return;
      }

      process.stdout.write(`\n${pc.bold('Parsed by the scanoss SDK')}\n`);
      process.stdout.write(`  ${inherited.join('  ')}\n`);
      process.stdout.write(`  *.csproj\n`);

      process.stdout.write(`\n${pc.bold('Parsed by this program')}\n`);
      let ecosystem = '';
      for (const def of added) {
        if (def.ecosystem !== ecosystem) {
          ecosystem = def.ecosystem;
          process.stdout.write(`  ${pc.cyan(ecosystem)}\n`);
        }
        const kind = def.resolved ? pc.dim('lockfile ') : pc.dim('manifest ');
        process.stdout.write(`    ${kind} ${def.match}\n`);
      }

      process.stdout.write(`\n${pc.bold('Detected but not parseable')}\n`);
      process.stdout.write(
        `  ${[...UNPARSEABLE_FILES].join(', ')} ${pc.dim('(binary format — reported as a gap)')}\n\n`,
      );
    });
}
