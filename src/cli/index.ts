#!/usr/bin/env node
// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import path from 'path';
import { Command } from 'commander';
import pc from 'picocolors';
import { brand, packageExtension } from '../runtime/brand';
import { getAppVersion } from '../runtime/version';
import { setVerbose } from '../runtime/log';
import { ScanRunner, ScanRequest, defaultWorkspaceRoot } from '../core/ScanRunner';
import { Reporter, printOutcome } from './reporter';
import { runWizard, wizardOutro } from './wizard';
import { depsCommand } from './commands/deps';
import { formatsCommand } from './commands/formats';
import { buildScanRequest, validateScanRequest, ScanCommandOptions, UsageError } from './scanRequest';

/** Exit codes. `USAGE` marks a bad invocation; `CANCELLED` follows the SIGINT convention. */
export const ExitCode = {
  OK: 0,
  USAGE: 1,
  FAILED: 2,
  CANCELLED: 130,
} as const;

interface OutputOptions {
  quiet?: boolean;
  json?: boolean;
  /** Print the closing message in the wizard's style. */
  wizard?: boolean;
}

/**
 * Builds the command tree.
 *
 * Exported so tests can drive the parser without spawning a process; `run()` is the entry point.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name(brand.binaryName)
    .description(`${brand.productName} — ${brand.tagline}`)
    .version(getAppVersion(), '-V, --version')
    .option('--verbose', 'mirror the scan log to stderr', false)
    .showHelpAfterError(`(run "${brand.binaryName} --help" for usage)`);

  program
    .command('scan')
    .description(`fingerprint a folder and write a ${packageExtension} package`)
    .argument('[folder]', 'folder to scan', '.')
    .option('-o, --output <file>', `output package path (default: <project>${packageExtension})`)
    .option('-n, --name <name>', 'project name (default: folder name)')
    .option('-e, --email <email>', 'contact email (required by the auditor)')
    .option('--contact-name <name>', 'contact name')
    .option('--phone <phone>', 'contact phone')
    .option('-l, --license <spdx>', 'default license of your code')
    .option('--notes <text>', 'additional information for the auditor')
    .option('--sbom <file>', 'attach an SBOM of components already known to be present')
    .option('--ignore-sbom <file>', 'attach a list of components to ignore')
    .option('--attach <files...>', 'attach further software-composition files')
    .option('--obfuscate <words>', 'comma-separated words to strip from every path')
    .option('--no-lockfiles', 'skip lockfiles; read only the manifests the scanoss SDK parses')
    .option('--include-vendored', 'also parse manifests inside node_modules, vendor and similar', false)
    .option('--keep-registry-urls', 'keep registry and repository URLs in the dependency data', false)
    .option('--raw', 'write a plain .zip instead of an encrypted package', false)
    .option('--keep-workspace', 'keep the intermediate working directory', false)
    .option('--workspace <dir>', 'working directory for intermediate artifacts')
    .option('--json', 'print the result as JSON', false)
    .option('-q, --quiet', 'print only the resulting path', false)
    .action(async (folder: string, options: ScanCommandOptions & OutputOptions, command: Command) => {
      applyGlobalOptions(command);
      const request = buildScanRequest(folder, options);
      await execute(request, { quiet: options.quiet, json: options.json });
    });

  program.addCommand(depsCommand());
  program.addCommand(formatsCommand());

  program
    .command('workspace')
    .description('print the working directory used for intermediate artifacts')
    .action(() => {
      process.stdout.write(`${defaultWorkspaceRoot()}\n`);
    });

  return program;
}

/** Copies the root `--verbose` flag into the logger before a subcommand runs. */
function applyGlobalOptions(command: Command): void {
  const root = command.parent ?? command;
  if (root.opts().verbose) setVerbose(true);
}

/** Runs a scan, rendering progress and the summary. */
async function execute(request: ScanRequest, output: OutputOptions): Promise<void> {
  validateScanRequest(request);

  const reporter = new Reporter(Boolean(output.quiet || output.json));
  reporter.attach();

  try {
    const outcome = await new ScanRunner().run(request);
    reporter.done();

    if (output.json) {
      process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
    } else if (output.quiet) {
      process.stdout.write(`${outcome.packagePath}\n`);
    } else {
      printOutcome(outcome, { raw: request.raw });
      if (output.wizard) {
        wizardOutro(`Send ${path.basename(outcome.packagePath)} to your auditor.`);
      }
    }
  } finally {
    reporter.done();
  }
}

/**
 * Entry point.
 *
 * With no arguments on a terminal the guided wizard runs; otherwise the arguments are parsed. Errors
 * are reported as a single line, with the stack trace kept for `--verbose`.
 */
export async function run(argv: string[] = process.argv): Promise<number> {
  const args = argv.slice(2);
  const program = buildProgram();

  try {
    if (args.length === 0) {
      if (!process.stdout.isTTY) {
        program.outputHelp();
        return ExitCode.USAGE;
      }
      const request = await runWizard();
      if (!request) return ExitCode.CANCELLED;
      await execute(request, { wizard: true });
      return ExitCode.OK;
    }

    await program.parseAsync(argv);
    return ExitCode.OK;
  } catch (error: any) {
    if (error?.code === 'commander.helpDisplayed' || error?.code === 'commander.version') {
      return ExitCode.OK;
    }
    const usage = error instanceof UsageError;
    process.stderr.write(`${pc.red('✖')} ${error?.message ?? String(error)}\n`);
    if (!usage && process.env.PROBE_VERBOSE === '1' && error?.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    return usage ? ExitCode.USAGE : ExitCode.FAILED;
  }
}

/* istanbul ignore next -- exercised by the end-to-end tests, which spawn the CLI. */
if (require.main === module) {
  run().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${pc.red('✖')} ${error?.stack ?? error}\n`);
      process.exit(ExitCode.FAILED);
    },
  );
}
