// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WfpPathExtractor, DependencyPathExtractor } from '../src/core/obfuscation/pathExtractors';
import { ObfuscationModule } from '../src/core/obfuscation/ObfuscationModule';
import { PathRewriter } from '../src/core/obfuscation/PathRewriter';
import { brand } from '../src/runtime/brand';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-obf-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('WfpPathExtractor', () => {
  const extractor = new WfpPathExtractor();

  it('reads the path from a file header line', () => {
    expect(extractor.extractPath('file=8a1c,1024,/src/acme/main.c')).toBe('/src/acme/main.c');
  });

  it('keeps commas that belong to the filename', () => {
    // The path is the last field, not the third: splitting naively truncates it.
    expect(extractor.extractPath('file=8a1c,1024,/src/a,b/c.c')).toBe('/src/a,b/c.c');
  });

  it('ignores hash lines, which carry no path', () => {
    expect(extractor.extractPath('4=a1b2c3,d4e5f6')).toBeNull();
    expect(extractor.extractPath('')).toBeNull();
  });
});

describe('DependencyPathExtractor', () => {
  const extractor = new DependencyPathExtractor();

  it('reads the path from a file property', () => {
    expect(extractor.extractPath('    "file": "/acme/package.json",')).toBe('/acme/package.json');
  });

  it('reads it without a trailing comma', () => {
    expect(extractor.extractPath('    "file": "/acme/package.json"')).toBe('/acme/package.json');
  });

  it('ignores other properties', () => {
    expect(extractor.extractPath('    "purl": "pkg:npm/express"')).toBeNull();
  });
});

describe('ObfuscationModule', () => {
  it('replaces the requested words and keeps a dictionary', async () => {
    const module = new ObfuscationModule(['acme'], path.join(tmp, 'dictionary.json'));

    const first = module.adapt('/acme/src/main');
    const second = module.adapt('/acme/lib/util');

    expect(first).not.toContain('acme');
    // The same word maps to the same key every time, or paths could not be correlated.
    expect(first.split('/')[1]).toBe(second.split('/')[1]);
    expect(first.split('/')[1]).toMatch(new RegExp(`^${brand.obfuscationKeyPrefix}_[0-9A-F]{4}$`));
  });

  it('leaves paths without a match untouched', () => {
    const module = new ObfuscationModule(['acme'], path.join(tmp, 'dictionary.json'));
    expect(module.adapt('/src/main')).toBe('/src/main');
  });

  it('matches case-insensitively', () => {
    const module = new ObfuscationModule(['acme'], path.join(tmp, 'dictionary.json'));
    expect(module.adapt('/ACME/src')).not.toContain('ACME');
  });

  it('writes the dictionary so obfuscated paths can be read back', async () => {
    const dictionaryPath = path.join(tmp, 'dictionary.json');
    const module = new ObfuscationModule(['acme'], dictionaryPath);
    const obfuscated = module.adapt('/acme/src/main');
    await module.done(tmp);

    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'obfuscationMapper.json'), 'utf-8'));
    const key = saved.dictionary.acme;
    expect(obfuscated.replace(key, 'acme')).toBe('/acme/src/main');
  });
});

describe('PathRewriter', () => {
  const wfp = ['file=8a1c,1024,/acme/src/main.c', '4=a1b2c3,d4e5f6', 'file=9b2d,512,/other/x.c', ''].join(
    '\n',
  );

  it('rewrites the paths it is given and leaves the rest of each line alone', async () => {
    const target = path.join(tmp, 'winnowing.wfp');
    fs.writeFileSync(target, wfp);

    const module = new ObfuscationModule(['acme'], path.join(tmp, 'dictionary.json'));
    await new PathRewriter(tmp, target, module, new WfpPathExtractor()).run();

    const rewritten = fs.readFileSync(target, 'utf-8');
    expect(rewritten).not.toContain('acme');
    expect(rewritten).toContain('4=a1b2c3,d4e5f6'); // hash lines untouched
    expect(rewritten).toContain('/other/x.c'); // unmatched paths untouched
    expect(rewritten).toMatch(/^file=8a1c,1024,/m); // the metadata of a rewritten line survives
  });

  it('preserves the file extension, which identifies nothing on its own', async () => {
    const target = path.join(tmp, 'winnowing.wfp');
    fs.writeFileSync(target, 'file=8a1c,1024,/acme/main.c\n');

    const module = new ObfuscationModule(['acme'], path.join(tmp, 'dictionary.json'));
    await new PathRewriter(tmp, target, module, new WfpPathExtractor()).run();

    expect(fs.readFileSync(target, 'utf-8').trim().endsWith('.c')).toBe(true);
  });

  it('does nothing when no words were supplied', async () => {
    const target = path.join(tmp, 'winnowing.wfp');
    fs.writeFileSync(target, wfp);

    const module = new ObfuscationModule([], path.join(tmp, 'dictionary.json'));
    const result = await new PathRewriter(tmp, target, module, new WfpPathExtractor()).run();

    expect(fs.readFileSync(target, 'utf-8')).toBe(wfp);
    expect(result.dictionary).toEqual({});
  });

  it('rejects rather than hanging when the input cannot be read', async () => {
    const module = new ObfuscationModule(['acme'], path.join(tmp, 'dictionary.json'));
    const rewriter = new PathRewriter(tmp, path.join(tmp, 'missing.wfp'), module, new WfpPathExtractor());

    await expect(rewriter.run()).rejects.toThrow();
    // The temporary file must not be left behind.
    expect(fs.existsSync(path.join(tmp, 'obfuscation.tmp'))).toBe(false);
  });
});
