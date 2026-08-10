// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * The uploader is exercised against a local server. These tests never contact fossity.com: a test
 * suite must not put files into a live intake queue.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { uploadPackage, UploadError } from '../src/core/upload';

let server: http.Server;
let endpoint: string;
let received: { body: Buffer; contentType: string | undefined };
let respond: (res: http.ServerResponse) => void;
let tmp: string;
let packagePath: string;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-upload-'));
  packagePath = path.join(tmp, 'audit.fossity');
  fs.writeFileSync(packagePath, Buffer.alloc(300_000, 7));

  received = { body: Buffer.alloc(0), contentType: undefined };
  respond = (res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  };

  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received = { body: Buffer.concat(chunks), contentType: req.headers['content-type'] };
      respond(res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/upload`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('uploadPackage', () => {
  it('posts the file as multipart/form-data in a field named file', async () => {
    const result = await uploadPackage(packagePath, endpoint);
    expect(result.status).toBe(200);

    expect(received.contentType).toMatch(/^multipart\/form-data; boundary=/);
    const head = received.body.subarray(0, 400).toString('utf-8');
    expect(head).toContain('Content-Disposition: form-data; name="file"; filename="audit.fossity"');
  });

  it('sends the file unaltered', async () => {
    await uploadPackage(packagePath, endpoint);

    const original = fs.readFileSync(packagePath);
    // The payload sits between the header and the closing boundary; the file must survive intact.
    expect(received.body.includes(original)).toBe(true);
  });

  it('reports progress that ends at the file size', async () => {
    const seen: Array<{ sent: number; total: number }> = [];
    await uploadPackage(packagePath, endpoint, (progress) => seen.push({ ...progress }));

    const size = fs.statSync(packagePath).size;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toEqual({ sent: size, total: size });
    // Monotonic, never past the total: a bar that goes backwards or overshoots is worse than none.
    for (let i = 1; i < seen.length; i += 1) expect(seen[i].sent).toBeGreaterThanOrEqual(seen[i - 1].sent);
    expect(seen.every((p) => p.sent <= p.total)).toBe(true);
  });

  it('surfaces the server error message', async () => {
    respond = (res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Only .fossity files are accepted.' }));
    };
    await expect(uploadPackage(packagePath, endpoint)).rejects.toThrow(/Only .fossity files are accepted/);
  });

  it('treats a 200 without ok as a failure', async () => {
    // An intercepting proxy answering 200 with its own page must not read as success.
    respond = (res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>captive portal</html>');
    };
    await expect(uploadPackage(packagePath, endpoint)).rejects.toThrow(UploadError);
  });

  it('explains an unreachable host rather than hanging', async () => {
    await expect(
      uploadPackage(packagePath, 'http://127.0.0.1:9/api/upload'),
    ).rejects.toThrow(/refused|could not be resolved/);
  });

  it('refuses a file it cannot read', async () => {
    await expect(uploadPackage(path.join(tmp, 'missing.fossity'), endpoint)).rejects.toThrow(
      /could not be read/,
    );
  });

  it('declines rather than silently bypassing a configured proxy', async () => {
    const previous = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://corporate-proxy:3128';
    try {
      await expect(uploadPackage(packagePath, endpoint)).rejects.toThrow(/proxy/);
    } finally {
      if (previous === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = previous;
    }
  });
});
