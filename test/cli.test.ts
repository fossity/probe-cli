// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildScanRequest, validateScanRequest, splitWords, slug, UsageError } from '../src/cli/scanRequest';
import { buildProgram } from '../src/cli/index';
import { setScanOptions, scanOptions, DEFAULT_SCAN_OPTIONS } from '../src/runtime/options';
import { packageExtension } from '../src/runtime/brand';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-project');
let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-cli-test-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  setScanOptions();
});

describe('splitWords', () => {
  it('splits on commas and newlines, trimming and dropping blanks', () => {
    expect(splitWords('one, two ,,\n three ')).toEqual(['one', 'two', 'three']);
  });

  it('returns nothing for an empty or separator-only string', () => {
    expect(splitWords('')).toEqual([]);
    expect(splitWords(' , , ')).toEqual([]);
  });
});

describe('slug', () => {
  it('lowercases and replaces characters that are unsafe in a filename', () => {
    expect(slug('Acme Corp / Project X')).toBe('acme-corp-project-x');
  });

  it('keeps dots, underscores and hyphens', () => {
    expect(slug('my_app-v1.2')).toBe('my_app-v1.2');
  });

  it('falls back to a placeholder when nothing usable remains', () => {
    expect(slug('///')).toBe('project');
    expect(slug('   ')).toBe('project');
  });
});

describe('buildScanRequest', () => {
  it('defaults the project name to the folder name and the output beside it', () => {
    const request = buildScanRequest(FIXTURE, {});
    expect(request.name).toBe('sample-project');
    expect(request.output).toBe(path.join(process.cwd(), `sample-project${packageExtension}`));
  });

  it('resolves every supplied path to an absolute one', () => {
    const request = buildScanRequest('.', {
      output: 'out/audit',
      workspace: 'work',
      sbom: 'sbom.json',
      ignoreSbom: 'ignore.json',
      attach: ['a.txt', 'b.txt'],
    });
    expect(path.isAbsolute(request.output)).toBe(true);
    expect(path.isAbsolute(request.workspaceDir!)).toBe(true);
    expect(path.isAbsolute(request.projectInfo.software_composition_known_uri!)).toBe(true);
    expect(path.isAbsolute(request.projectInfo.software_composition_ignore_uri!)).toBe(true);
    expect(request.projectInfo.software_composition_uri!.every(path.isAbsolute)).toBe(true);
  });

  it('maps contact and licence details into the project information', () => {
    const request = buildScanRequest(FIXTURE, {
      email: 'dev@example.com',
      contactName: 'Dev',
      phone: '+34 000',
      license: 'Apache-2.0',
      notes: 'internal build tooling only',
    });
    expect(request.projectInfo.contact).toEqual({
      name: 'Dev',
      email: 'dev@example.com',
      phone: '+34 000',
    });
    expect(request.projectInfo.default_license).toBe('Apache-2.0');
    expect(request.projectInfo.software_composition).toBe('internal build tooling only');
  });

  it('enables lockfiles and redaction by default', () => {
    const request = buildScanRequest(FIXTURE, {});
    expect(request.options).toEqual({
      lockfiles: true,
      includeVendored: false,
      redactRegistries: true,
    });
  });

  it('translates the negated and inverted flags commander produces', () => {
    // commander sets lockfiles:false for --no-lockfiles, and keepRegistryUrls:true for the opt-out.
    const request = buildScanRequest(FIXTURE, {
      lockfiles: false,
      keepRegistryUrls: true,
      includeVendored: true,
    });
    expect(request.options).toEqual({
      lockfiles: false,
      includeVendored: true,
      redactRegistries: false,
    });
  });

  it('splits the obfuscation word list', () => {
    expect(buildScanRequest(FIXTURE, { obfuscate: 'acme, projectx' }).obfuscate).toEqual([
      'acme',
      'projectx',
    ]);
    expect(buildScanRequest(FIXTURE, {}).obfuscate).toEqual([]);
  });
});

describe('validateScanRequest', () => {
  const valid = () => buildScanRequest(FIXTURE, { email: 'dev@example.com' });

  it('accepts a complete request', () => {
    expect(() => validateScanRequest(valid())).not.toThrow();
  });

  it('rejects a missing scan root', () => {
    const request = buildScanRequest(path.join(tmp, 'nope'), { email: 'dev@example.com' });
    expect(() => validateScanRequest(request)).toThrow(UsageError);
    expect(() => validateScanRequest(request)).toThrow(/does not exist/);
  });

  it('rejects a scan root that is a file', () => {
    const request = buildScanRequest(path.join(FIXTURE, 'package.json'), { email: 'dev@example.com' });
    expect(() => validateScanRequest(request)).toThrow(/not a directory/);
  });

  it('requires a contact email', () => {
    const request = buildScanRequest(FIXTURE, {});
    expect(() => validateScanRequest(request)).toThrow(/contact email is required/);
  });

  it('rejects a malformed contact email', () => {
    const request = buildScanRequest(FIXTURE, { email: 'not-an-email' });
    expect(() => validateScanRequest(request)).toThrow(/not a valid email/);
  });

  it('rejects attachments that do not exist, naming the flag', () => {
    const missing = path.join(tmp, 'missing.json');
    expect(() => validateScanRequest(buildScanRequest(FIXTURE, { email: 'd@e.com', sbom: missing }))).toThrow(
      /--sbom/,
    );
    expect(() =>
      validateScanRequest(buildScanRequest(FIXTURE, { email: 'd@e.com', ignoreSbom: missing })),
    ).toThrow(/--ignore-sbom/);
    expect(() =>
      validateScanRequest(buildScanRequest(FIXTURE, { email: 'd@e.com', attach: [missing] })),
    ).toThrow(/--attach/);
  });

  it('accepts attachments that exist', () => {
    const sbom = path.join(tmp, 'sbom.json');
    fs.writeFileSync(sbom, '{"components":[]}');
    expect(() => validateScanRequest(buildScanRequest(FIXTURE, { email: 'd@e.com', sbom }))).not.toThrow();
  });
});

describe('scan options', () => {
  it('resets to the defaults between scans', () => {
    setScanOptions({ lockfiles: false, includeVendored: true });
    expect(scanOptions.lockfiles).toBe(false);

    setScanOptions({ redactRegistries: false });
    expect(scanOptions.lockfiles).toBe(DEFAULT_SCAN_OPTIONS.lockfiles);
    expect(scanOptions.includeVendored).toBe(DEFAULT_SCAN_OPTIONS.includeVendored);
    expect(scanOptions.redactRegistries).toBe(false);

    setScanOptions();
    expect(scanOptions).toEqual(DEFAULT_SCAN_OPTIONS);
  });
});

describe('command tree', () => {
  const program = buildProgram();
  const names = program.commands.map((command) => command.name());

  it('exposes the documented commands', () => {
    expect(names).toEqual(expect.arrayContaining(['scan', 'deps', 'formats', 'workspace']));
  });

  it('describes the package extension from the brand configuration', () => {
    const scan = program.commands.find((command) => command.name() === 'scan')!;
    expect(scan.description()).toContain(packageExtension);
  });

  it('defaults the scan folder to the working directory', () => {
    const scan = program.commands.find((command) => command.name() === 'scan')!;
    expect(scan.usage()).toContain('[folder]');
  });
});
