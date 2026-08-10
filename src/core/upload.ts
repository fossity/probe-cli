// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Uploading a finished package.
 *
 * This is the only part of the program that opens a network connection, and it runs only when the
 * person doing the scan says so. Everything else works offline.
 *
 * The request matches what the website's own uploader sends: a `multipart/form-data` POST with the
 * package in a field named `file`. No credentials are involved; submission is anonymous.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface UploadProgress {
  /** Bytes handed to the socket so far. */
  sent: number;
  /** Total bytes of the package. */
  total: number;
}

export interface UploadResult {
  /** HTTP status returned by the server. */
  status: number;
  /** Whatever the server said, for the terminal. */
  message: string;
}

/** Raised for anything that stops the upload, with a message meant to be shown as-is. */
export class UploadError extends Error {}

const CRLF = '\r\n';

/**
 * Sends `filePath` to `endpoint`.
 *
 * The file is streamed rather than read into memory: a package from a large codebase can be
 * hundreds of megabytes, and buffering it would be a needless memory spike on the client's machine.
 *
 * @param onProgress Called as bytes go out, for a progress indicator.
 */
export async function uploadPackage(
  filePath: string,
  endpoint: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResult> {
  const stats = await fs.promises.stat(filePath).catch(() => {
    throw new UploadError(`${filePath} could not be read`);
  });

  // A proxy needs a CONNECT tunnel, which this does not implement. Saying so beats a timeout that
  // looks like the server is down.
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (proxy) {
    throw new UploadError(
      `a proxy is configured (${proxy}) and direct upload does not support one. ` +
        'Upload the file through your browser instead.',
    );
  }

  const url = new URL(endpoint);
  const transport = url.protocol === 'http:' ? http : https;
  const boundary = `----probe${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;

  const head = Buffer.from(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"${CRLF}` +
      `Content-Type: application/octet-stream${CRLF}${CRLF}`,
  );
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);

  return new Promise<UploadResult>((resolve, reject) => {
    const file = fs.createReadStream(filePath);

    /** Releases the file handle. Windows keeps the file locked until it is closed. */
    const fail = (error: Error) => {
      file.destroy();
      reject(error);
    };

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': head.length + stats.size + tail.length,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const status = response.statusCode ?? 0;

          let payload: { ok?: boolean; error?: string } = {};
          try {
            payload = JSON.parse(body);
          } catch {
            // A non-JSON body means something other than the API answered: a proxy, an error page.
          }

          file.destroy();
          if (status === 200 && payload.ok) {
            resolve({ status, message: 'accepted' });
            return;
          }
          reject(new UploadError(payload.error ?? `the server answered ${status || 'nothing'}`));
        });
      },
    );

    request.on('error', (error: NodeJS.ErrnoException) => {
      const reason =
        error.code === 'ENOTFOUND'
          ? `${url.hostname} could not be resolved: check the connection`
          : error.code === 'ECONNREFUSED'
            ? `${url.host} refused the connection`
            : (error.message ?? String(error));
      fail(new UploadError(reason));
    });

    request.write(head);

    let sent = 0;
    file.on('data', (chunk) => {
      sent += chunk.length;
      onProgress?.({ sent, total: stats.size });
    });
    file.on('error', (error) => {
      request.destroy();
      fail(new UploadError(`${filePath} could not be read: ${error.message}`));
    });
    file.on('end', () => {
      request.end(tail);
    });
    file.pipe(request, { end: false });
  });
}
