// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * End-to-end tests. Each case spawns the CLI as a child process, so they cover the parts unit tests
 * cannot: argument parsing, exit codes, stdout and stderr, and the brand configuration, which is
 * resolved once per process at import time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import brandConfig from '../brand.config.json';

const ROOT = path.join(__dirname, '..');
/** The bundle these tests exercise; built by test/globalSetup.ts. */
const BUNDLE = path.join(ROOT, `dist/${brandConfig.binaryName}.cjs`);
const FIXTURE = path.join(__dirname, 'fixtures', 'sample-project');

let tmp: string;

/** Runs the bundled CLI, exactly as an installed user would. */
function cli(args: string[], env: Record<string, string> = {}): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [BUNDLE, ...args], {
    encoding: 'utf-8',
    cwd: tmp,
    env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' },
    timeout: 120_000,
  });
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-e2e-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('help and version', () => {
  it('prints the version', () => {
    const result = cli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('lists its commands in the help text', () => {
    const result = cli(['--help']);
    expect(result.status).toBe(0);
    for (const command of ['scan', 'deps', 'formats', 'workspace']) {
      expect(result.stdout).toContain(command);
    }
  });

  it('prints help and fails when invoked with no arguments and no terminal', () => {
    // A CI job with no TTY must not hang waiting for the wizard's prompts.
    const result = cli([]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Usage:');
  });

  it('exits quietly when its output is piped to a command that stops reading', () => {
    // Regression: EPIPE printed a stack trace over whatever the reader was showing.
    const result = spawnSync('sh', ['-c', `"${process.execPath}" "${BUNDLE}" formats | head -2`], {
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 60_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/EPIPE|Error:/);
  });

  it('rejects an unknown command with a hint', () => {
    const result = cli(['frobnicate']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown command/i);
  });
});

describe('formats', () => {
  it('separates inherited formats from the ones this build adds', () => {
    const result = cli(['formats', '--json']);
    expect(result.status).toBe(0);

    const formats = JSON.parse(result.stdout);
    expect(formats.inherited).toContain('package-lock.json');
    expect(formats.added.map((entry: any) => entry.match)).toEqual(
      expect.arrayContaining(['pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock'.toLowerCase()]),
    );
    expect(formats.unparseable).toContain('bun.lockb');

    // No format may be claimed by both engines.
    const overlap = formats.added.filter((entry: any) => formats.inherited.includes(entry.match));
    expect(overlap).toEqual([]);
  });
});

describe('deps', () => {
  it('reports lockfiles the scanoss SDK does not parse', () => {
    const result = cli(['deps', FIXTURE]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pnpm-lock.yaml');
    expect(result.stdout).toMatch(/purls total/);
  });

  it('finds nothing extra with --no-lockfiles', () => {
    const withLockfiles = JSON.parse(cli(['deps', FIXTURE, '--json']).stdout);
    const without = JSON.parse(cli(['deps', FIXTURE, '--json', '--no-lockfiles']).stdout);

    expect(withLockfiles.stats.totalPurls).toBeGreaterThan(0);
    expect(without.stats.totalPurls).toBe(0);
    expect(without.files.length).toBeLessThan(withLockfiles.files.length);
  });
});

describe('scan', () => {
  it('requires a contact email and exits with the usage code', () => {
    const result = cli(['scan', FIXTURE]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/contact email is required/);
  });

  it('writes a package and reports it as JSON', () => {
    const output = path.join(tmp, 'json-run');
    const result = cli(['scan', FIXTURE, '--email', 'dev@example.com', '-o', output, '--json']);
    expect(result.status).toBe(0);

    const outcome = JSON.parse(result.stdout);
    expect(outcome.packagePath).toBe(`${output}${brandConfig.packageExtension}`);
    expect(fs.existsSync(outcome.packagePath)).toBe(true);
    expect(outcome.filesFingerprinted).toBeGreaterThan(0);
    expect(outcome.lockfileStats.totalPurls).toBeGreaterThan(0);
  });

  it('prints only the path with --quiet', () => {
    const output = path.join(tmp, 'quiet-run');
    const result = cli(['scan', FIXTURE, '--email', 'dev@example.com', '-o', output, '--quiet']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`${output}${brandConfig.packageExtension}`);
  });

  it('appends the package extension when the output path lacks it', () => {
    const result = cli([
      'scan',
      FIXTURE,
      '--email',
      'dev@example.com',
      '-o',
      path.join(tmp, 'no-extension'),
      '--quiet',
    ]);
    expect(result.stdout.trim().endsWith(brandConfig.packageExtension)).toBe(true);
  });

  it('leaves no working directory behind', () => {
    const workspaceRoot = path.join(tmp, 'workspace');
    cli(['scan', FIXTURE, '--email', 'dev@example.com', '-o', path.join(tmp, 'cleanup'), '--quiet'], {
      PROBE_WORKSPACE: workspaceRoot,
    });
    const remaining = fs.existsSync(workspaceRoot) ? fs.readdirSync(workspaceRoot) : [];
    expect(remaining).toEqual([]);
  });

  it('keeps the working directory, and the obfuscation dictionary, on request', () => {
    const workspaceRoot = path.join(tmp, 'kept-workspace');
    const zipPath = path.join(tmp, 'kept.zip');
    const result = cli(
      [
        'scan',
        FIXTURE,
        '--email',
        'dev@example.com',
        '-o',
        zipPath,
        '--obfuscate',
        'sample',
        '--keep-workspace',
        '--raw',
        '--quiet',
      ],
      { PROBE_WORKSPACE: workspaceRoot },
    );
    expect(result.status).toBe(0);

    const projectDir = path.join(workspaceRoot, 'sample-project');
    expect(fs.existsSync(path.join(projectDir, 'obfuscationMapper.json'))).toBe(true);

    // The dictionary is the key to the obfuscated paths, so it must never be packaged.
    const entries = new AdmZip(zipPath).getEntries().map((entry) => entry.entryName);
    expect(entries).not.toContain('obfuscationMapper.json');
  });

  it('reports each pipeline stage exactly once', () => {
    // Regression: the reporter was flushed twice, repeating the final stage line.
    const result = cli(['scan', FIXTURE, '--email', 'dev@example.com', '-o', path.join(tmp, 'stages')]);
    expect(result.status).toBe(0);

    const stageLines = result.stdout.split('\n').filter((line) => line.includes('✔'));
    expect(stageLines).toHaveLength(6); // index, fingerprint, dependencies, hints, obfuscate, attach
    expect(new Set(stageLines).size).toBe(stageLines.length);
  });

  it('fails cleanly when the folder does not exist', () => {
    const result = cli(['scan', path.join(tmp, 'absent'), '--email', 'dev@example.com']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not exist/);
  });
});

describe('rebranding', () => {
  it('takes the product name, extension and footer tag from PROBE_BRAND_CONFIG', () => {
    const brandFile = path.join(tmp, 'acme-brand.json');
    fs.writeFileSync(
      brandFile,
      JSON.stringify({
        ...brandConfig,
        productName: 'Acme Audit Probe',
        binaryName: 'acme-probe',
        shortName: 'Acme Probe',
        vendor: 'Acme',
        packageExtension: '.acme',
        versionFooterTag: 'ACME_VERSION',
        obfuscationKeyPrefix: 'ACME',
        uploadUrl: 'https://acme.example/upload',
      }),
    );
    const env = { PROBE_BRAND_CONFIG: brandFile };

    const help = cli(['--help'], env);
    expect(help.stdout).toContain('acme-probe');
    expect(help.stdout).toContain('Acme Audit Probe');

    const output = path.join(tmp, 'rebranded');
    const scan = cli(['scan', FIXTURE, '--email', 'dev@example.com', '-o', output, '--quiet'], env);
    expect(scan.status).toBe(0);

    const packagePath = scan.stdout.trim();
    expect(packagePath).toBe(`${output}.acme`);

    const bytes = fs.readFileSync(packagePath);
    const footer = bytes
      .subarray(bytes.length - 100)
      .toString('utf-8')
      .replace(/\0+$/, '');
    expect(footer).toMatch(/^ACME_VERSION:\d+\.\d+\.\d+/);
  });

  it('uses the branded prefix for obfuscation dictionary keys', () => {
    const brandFile = path.join(tmp, 'prefix-brand.json');
    fs.writeFileSync(
      brandFile,
      JSON.stringify({ ...brandConfig, obfuscationKeyPrefix: 'ACME', vendor: 'Acme' }),
    );
    const workspaceRoot = path.join(tmp, 'prefix-workspace');

    const result = cli(
      [
        'scan',
        FIXTURE,
        '--email',
        'dev@example.com',
        '-o',
        path.join(tmp, 'prefixed'),
        '--obfuscate',
        'sample',
        '--keep-workspace',
        '--quiet',
      ],
      { PROBE_BRAND_CONFIG: brandFile, PROBE_WORKSPACE: workspaceRoot },
    );
    expect(result.status).toBe(0);

    const dictionary = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, 'sample-project', 'obfuscationMapper.json'), 'utf-8'),
    );
    expect(Object.values(dictionary.dictionary).every((key) => String(key).startsWith('ACME_'))).toBe(true);
  });

  it('reports an unreadable brand configuration instead of falling back silently', () => {
    const result = cli(['--version'], { PROBE_BRAND_CONFIG: path.join(tmp, 'no-such-brand.json') });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/PROBE_BRAND_CONFIG/);
  });
});

describe('workspace', () => {
  it('prints the configured working directory', () => {
    const result = cli(['workspace'], { PROBE_WORKSPACE: '/tmp/example-workspace' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('/tmp/example-workspace');
  });

  it('defaults to a directory named after the brand', () => {
    const result = cli(['workspace'], { PROBE_WORKSPACE: '' });
    expect(result.stdout.trim().endsWith(brandConfig.workspaceDirName)).toBe(true);
  });
});
