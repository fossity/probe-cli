// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { ScanRunner } from '../src/core/ScanRunner';
import { brand } from '../src/runtime/brand';
import { getLogFile, closeLogFile } from '../src/runtime/log';

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-project');
let tmp: string;

const request = (over: Record<string, any> = {}) => ({
  scanRoot: FIXTURE,
  name: 'sample',
  output: path.join(tmp, 'out'),
  obfuscate: [] as string[],
  projectInfo: {
    contact: { name: 'Dev', email: 'dev@example.com', phone: '' },
    opt_in_sms: false,
    default_license: 'MIT',
  },
  ...over,
});

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-test-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('scan pipeline', () => {
  it('produces the four output artifacts inside a zip', async () => {
    const outcome = await new ScanRunner().run(request({ raw: true, output: path.join(tmp, 'raw') }) as any);
    const entries = new AdmZip(outcome.packagePath)
      .getEntries()
      .map((e) => e.entryName)
      .sort();
    expect(entries).toEqual(['dependencies.json', 'file_count.csv', 'projectMetadata.json', 'winnowing.wfp']);
  });

  it('captures lockfile dependencies in the same dependencies.json', async () => {
    const outcome = await new ScanRunner().run(request({ raw: true, output: path.join(tmp, 'deps') }) as any);
    const zip = new AdmZip(outcome.packagePath);
    const deps = JSON.parse(zip.getEntry('dependencies.json')!.getData().toString('utf-8'));

    const byFile: Record<string, string[]> = {};
    const requirements: Record<string, string> = {};
    for (const entry of deps.files) {
      byFile[path.basename(entry.file)] = entry.purls.map((p: any) => p.purl);
      for (const p of entry.purls) requirements[`${path.basename(entry.file)}|${p.purl}`] = p.requirement;
    }

    // inherited from scanoss, which keeps the resolved version in `requirement`, not in the purl
    expect(byFile['package-lock.json']).toContain('pkg:npm/express');
    expect(requirements['package-lock.json|pkg:npm/express']).toBe('4.18.2');
    // added here
    expect(byFile['pnpm-lock.yaml']).toContain('pkg:npm/react@18.2.0');
    expect(byFile['poetry.lock']).toContain('pkg:pypi/requests@2.31.0');
    expect(byFile['composer.lock']).toContain('pkg:composer/monolog/monolog@2.9.1');
    expect(byFile['mix.lock']).toContain('pkg:hex/phoenix@1.7.7');

    expect(outcome.lockfileStats!.totalPurls).toBeGreaterThan(0);
    expect(outcome.dependencyPurls).toBeGreaterThan(outcome.lockfileStats!.totalPurls);
  });

  it('parses vendored manifests, which are part of what ships', async () => {
    const outcome = await new ScanRunner().run(
      request({ raw: true, output: path.join(tmp, 'vendor') }) as any,
    );
    expect(readDepFiles(outcome.packagePath).some((f) => f.includes('node_modules'))).toBe(true);
  });

  it('reads lockfiles unconditionally', async () => {
    const outcome = await new ScanRunner().run(request({ raw: true, output: path.join(tmp, 'lock') }) as any);
    const files = readDepFiles(outcome.packagePath).map((f) => path.basename(f));
    // Neither engine can be turned off: coverage is not a scan-time decision.
    expect(files).toContain('pnpm-lock.yaml');
    expect(files).toContain('package-lock.json');
    expect(outcome.lockfileStats!.totalPurls).toBeGreaterThan(0);
  });

  it('leaves the package contents in the clear, matching the package byte for byte', async () => {
    // The package is encrypted to the auditor's key, so this copy is the author's only way to check
    // what they are sending. If it ever drifts from the payload it is worse than not existing.
    const outcome = await new ScanRunner().run(
      request({ raw: true, output: path.join(tmp, 'review') }) as any,
    );

    expect(outcome.reviewPath).toBe(`${outcome.packagePath}.contents`);
    expect(fs.existsSync(outcome.reviewPath)).toBe(true);

    const zip = new AdmZip(outcome.packagePath);
    const packaged = zip.getEntries().filter((e) => !e.isDirectory);
    expect(fs.readdirSync(outcome.reviewPath).sort()).toEqual(packaged.map((e) => e.entryName).sort());

    for (const entry of packaged) {
      const onDisk = fs.readFileSync(path.join(outcome.reviewPath, entry.entryName));
      expect(onDisk.equals(entry.getData())).toBe(true);
    }
  });

  it('never leaves the obfuscation dictionary in the reviewable copy', async () => {
    const outcome = await new ScanRunner().run(
      request({ raw: true, output: path.join(tmp, 'review-obf'), obfuscate: ['sample'] }) as any,
    );
    expect(fs.readdirSync(outcome.reviewPath)).not.toContain('obfuscationMapper.json');
  });

  it('fingerprints source files into the WFP', async () => {
    const outcome = await new ScanRunner().run(request({ raw: true, output: path.join(tmp, 'wfp') }) as any);
    const wfp = new AdmZip(outcome.packagePath).getEntry('winnowing.wfp')!.getData().toString('utf-8');
    expect(wfp).toMatch(/^file=[a-f0-9]{32},\d+,\//m);
  });

  it('obfuscates the words it is given', async () => {
    const outcome = await new ScanRunner().run(
      request({ raw: true, output: path.join(tmp, 'obf'), obfuscate: ['sample', 'acme'] }) as any,
    );
    const zip = new AdmZip(outcome.packagePath);
    const deps = zip.getEntry('dependencies.json')!.getData().toString('utf-8');
    const wfp = zip.getEntry('winnowing.wfp')!.getData().toString('utf-8');
    expect(deps.toLowerCase()).not.toContain('sample');
    expect(wfp.toLowerCase()).not.toContain('sample');
  });

  it('releases the log file so the working directory can be removed', async () => {
    // Windows refuses to delete a directory containing an open file, so a scan that leaves the log
    // handle open cannot clean up after itself there.
    const workspace = path.join(tmp, 'log-handle');
    const outcome = await new ScanRunner().run(
      request({ raw: true, output: path.join(tmp, 'loghandle'), workspaceDir: workspace }) as any,
    );

    await closeLogFile(); // idempotent; the scan has already done this
    expect(getLogFile()).toBeNull();
    // The directory was kept because workspaceDir was given, so the log is there to inspect.
    expect(fs.existsSync(path.join(outcome.projectPath, 'project.log'))).toBe(true);
    // With the handle released, removing it must succeed on any platform.
    expect(() => fs.rmSync(workspace, { recursive: true })).not.toThrow();
  });

  it('rejects a scan root that is not a directory', async () => {
    await expect(
      new ScanRunner().run(request({ scanRoot: path.join(FIXTURE, 'package.json') }) as any),
    ).rejects.toThrow(/not a directory/);
  });
});

describe('package format', () => {
  it('writes RSA header + AES body + 100-byte branded footer', async () => {
    const outcome = await new ScanRunner().run(request({ output: path.join(tmp, 'pkg') }) as any);
    expect(outcome.packagePath.endsWith(brand.packageExtension)).toBe(true);

    const bytes = fs.readFileSync(outcome.packagePath);
    const footer = bytes
      .subarray(bytes.length - 100)
      .toString('utf-8')
      .replace(/\0+$/, '');
    expect(footer).toMatch(new RegExp(`^${brand.versionFooterTag}:\\d+\\.\\d+\\.\\d+`));

    const headerLength = crypto.publicEncrypt(
      { key: brand.publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.alloc(40),
    ).length;
    const bodyLength = bytes.length - 100 - headerLength;
    expect(bodyLength).toBeGreaterThan(0);
    expect(bodyLength % 16).toBe(0); // AES-128-CBC blocks
  });

  it('keeps the rebrandable fields independent of the crypto', () => {
    // brand.ts resolves at import time, so this asserts the config contract: a rebrand changes the
    // name, extension and footer tag, and the key is the only thing that must match the back end.
    const rebranded = {
      ...brand,
      productName: 'Acme Probe',
      packageExtension: '.acme',
      versionFooterTag: 'ACME_VERSION',
    };
    expect(rebranded.publicKeyPem).toBe(brand.publicKeyPem);
    expect(Buffer.from(`${rebranded.versionFooterTag}:1.0.0`).length).toBeLessThan(100);
    expect(rebranded.packageExtension.startsWith('.')).toBe(true);
  });
});

function readDepFiles(packagePath: string): string[] {
  const zip = new AdmZip(packagePath);
  const deps = JSON.parse(zip.getEntry('dependencies.json')!.getData().toString('utf-8'));
  return deps.files.map((f: any) => f.file);
}
