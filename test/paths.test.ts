// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Windows path handling, proven without a Windows machine.
 *
 * The failure these cover is specific: the winnowing engine writes the scanned path into the WFP in
 * the host's native form, so a scan on Windows records `\src\main.c`. Nothing crashes — the package
 * simply describes the tree differently from a Linux scan, and path obfuscation cannot match the
 * text it is asked to replace, so it reports success while leaving the words in place.
 *
 * These tests feed the code the exact byte sequences a Windows run produces.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { toPosixPath, splitPathParts, joinPathParts, normaliseWfpPaths } from '../src/core/paths';
import { ObfuscationModule } from '../src/core/obfuscation/ObfuscationModule';
import { PathRewriter } from '../src/core/obfuscation/PathRewriter';
import { WfpPathExtractor, DependencyPathExtractor } from '../src/core/obfuscation/pathExtractors';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-paths-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('toPosixPath', () => {
  it('converts Windows separators', () => {
    expect(toPosixPath('\\src\\acme\\main.c')).toBe('/src/acme/main.c');
  });

  it('leaves a POSIX path untouched', () => {
    expect(toPosixPath('/src/acme/main.c')).toBe('/src/acme/main.c');
  });
});

describe('splitPathParts', () => {
  it('splits a Windows path', () => {
    expect(splitPathParts('\\src\\acme\\main.c')).toEqual({ dir: '/src/acme', name: 'main', ext: '.c' });
  });

  it('splits a POSIX path the same way', () => {
    expect(splitPathParts('/src/acme/main.c')).toEqual({ dir: '/src/acme', name: 'main', ext: '.c' });
  });

  it('treats a leading dot as part of the name', () => {
    expect(splitPathParts('/src/.gitignore')).toEqual({ dir: '/src', name: '.gitignore', ext: '' });
  });

  it('handles a bare filename', () => {
    expect(splitPathParts('package.json')).toEqual({ dir: '', name: 'package', ext: '.json' });
  });

  it('round-trips through joinPathParts', () => {
    const { dir, name, ext } = splitPathParts('\\a\\b\\c.txt');
    expect(`${joinPathParts(dir, name)}${ext}`).toBe('/a/b/c.txt');
  });
});

describe('normaliseWfpPaths', () => {
  it('rewrites the path in a file header and leaves hash lines alone', () => {
    const windows = ['file=8a1c,1024,\\src\\acme\\main.c', '4=a1b2c3,d4e5f6', '12=aabb,ccdd', ''].join('\n');

    const normalised = normaliseWfpPaths(windows);

    expect(normalised).toContain('file=8a1c,1024,/src/acme/main.c');
    expect(normalised).toContain('4=a1b2c3,d4e5f6'); // untouched
    expect(normalised).toContain('12=aabb,ccdd');
  });

  it('keeps a path that contains commas intact', () => {
    // The path is the last field, not the third.
    const line = 'file=8a1c,1024,\\src\\a,b\\c.c';
    expect(normaliseWfpPaths(line)).toBe('file=8a1c,1024,/src/a,b/c.c');
  });

  it('is a no-op on output that is already POSIX', () => {
    const posix = ['file=8a1c,1024,/src/main.c', '4=a1b2c3,d4e5f6'].join('\n');
    expect(normaliseWfpPaths(posix)).toBe(posix);
  });
});

describe('obfuscation over Windows-shaped input', () => {
  it('replaces the words even when the path uses backslashes', async () => {
    // The regression: platform normalisation made the search text differ from the line, so nothing
    // was replaced and the run still reported success.
    const target = path.join(tmp, 'winnowing.wfp');
    fs.writeFileSync(target, 'file=8a1c,1024,\\src\\acme\\main.c\n4=a1b2c3,d4e5f6\n');

    const obfuscation = new ObfuscationModule(['acme'], path.join(tmp, 'dictionary.json'));
    await new PathRewriter(tmp, target, obfuscation, new WfpPathExtractor()).run();

    const rewritten = fs.readFileSync(target, 'utf-8');
    expect(rewritten).not.toContain('acme');
    expect(rewritten).toMatch(/^file=8a1c,1024,/m); // the fingerprint metadata survives
    expect(rewritten).toContain('.c'); // the extension survives
    expect(rewritten).toContain('4=a1b2c3,d4e5f6'); // hash lines untouched
  });

  it('replaces the words in dependency records with backslash paths', async () => {
    const target = path.join(tmp, 'dependencies.json');
    fs.writeFileSync(target, '{\n  "files": [\n    {\n      "file": "\\\\acme\\\\package.json",\n');

    const obfuscation = new ObfuscationModule(['acme'], path.join(tmp, 'dictionary.json'));
    await new PathRewriter(tmp, target, obfuscation, new DependencyPathExtractor()).run();

    expect(fs.readFileSync(target, 'utf-8')).not.toContain('acme');
  });

  it('produces the same obfuscated result from either separator', async () => {
    const run = async (line: string, dir: string) => {
      const file = path.join(dir, 'winnowing.wfp');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `${line}\n`);
      const obfuscation = new ObfuscationModule(['acme'], path.join(dir, 'dictionary.json'));
      await new PathRewriter(dir, file, obfuscation, new WfpPathExtractor()).run();
      return fs.readFileSync(file, 'utf-8');
    };

    // Once the WFP is normalised, both hosts feed the same text through, so both produce the same
    // package: that equivalence is the point of the fix.
    const fromWindows = await run(
      normaliseWfpPaths('file=8a1c,1024,\\src\\acme\\main.c'),
      path.join(tmp, 'win'),
    );
    const fromPosix = await run('file=8a1c,1024,/src/acme/main.c', path.join(tmp, 'posix'));

    expect(fromWindows).toBe(fromPosix);
  });
});
