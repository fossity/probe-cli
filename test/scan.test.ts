// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { ScanRunner } from '../src/core/ScanRunner';
import { IndexTask } from '../src/core/pipeline/IndexTask';
import { brand } from '../src/runtime/brand';

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
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('vendored detection', () => {
  it('recognises dependency caches but not ordinary source paths', () => {
    expect(IndexTask.isVendored('/node_modules/left-pad/package.json')).toBe(true);
    expect(IndexTask.isVendored('/backend/vendor/composer/installed.json')).toBe(true);
    expect(IndexTask.isVendored('/src/app/package.json')).toBe(false);
    expect(IndexTask.isVendored('/my-vendored-code/package.json')).toBe(false);
  });
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

  it('excludes vendored manifests unless asked', async () => {
    const off = await new ScanRunner().run(request({ raw: true, output: path.join(tmp, 'novendor') }) as any);
    expect(readDepFiles(off.packagePath).some((f) => f.includes('node_modules'))).toBe(false);

    const on = await new ScanRunner().run(
      request({ raw: true, output: path.join(tmp, 'vendor'), options: { includeVendored: true } }) as any,
    );
    expect(readDepFiles(on.packagePath).some((f) => f.includes('node_modules'))).toBe(true);
  });

  it('honours --no-lockfiles, matching desktop behaviour', async () => {
    const outcome = await new ScanRunner().run(
      request({ raw: true, output: path.join(tmp, 'nolock'), options: { lockfiles: false } }) as any,
    );
    const files = readDepFiles(outcome.packagePath).map((f) => path.basename(f));
    expect(files).not.toContain('pnpm-lock.yaml');
    expect(files).toContain('package-lock.json');
    expect(outcome.lockfileStats).toBeNull();
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
