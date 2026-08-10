// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import path from 'path';
import fs from 'fs';
import { ScanRequest } from '../core/ScanRunner';
import { packageExtension } from '../runtime/brand';

/** Parsed `scan` command options, as commander produces them. */
export interface ScanCommandOptions {
  output?: string;
  name?: string;
  email?: string;
  contactName?: string;
  phone?: string;
  license?: string;
  notes?: string;
  sbom?: string;
  ignoreSbom?: string;
  attach?: string[];
  obfuscate?: string;
  raw?: boolean;
  keepWorkspace?: boolean;
  workspace?: string;
}

/** A problem with the supplied options, reported to the user without a stack trace. */
export class UsageError extends Error {}

/** Splits a comma- or newline-separated list, dropping empty entries. */
export function splitWords(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((word) => word.trim())
    .filter(Boolean);
}

/** Turns a project name into a safe filename stem. */
export function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  );
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Builds a `ScanRequest` from command-line options, resolving every path against the working
 * directory so the pipeline only ever sees absolute paths.
 *
 * Kept separate from the command definition so the mapping can be tested without running a scan.
 */
export function buildScanRequest(folder: string, options: ScanCommandOptions): ScanRequest {
  const scanRoot = path.resolve(folder || '.');
  const name = options.name?.trim() || path.basename(scanRoot);

  const request: ScanRequest = {
    scanRoot,
    name,
    output: options.output
      ? path.resolve(options.output)
      : path.join(process.cwd(), `${slug(name)}${packageExtension}`),
    obfuscate: options.obfuscate ? splitWords(options.obfuscate) : [],
    raw: options.raw ?? false,
    keepWorkspace: options.keepWorkspace ?? false,
    workspaceDir: options.workspace ? path.resolve(options.workspace) : undefined,
    projectInfo: {
      contact: {
        name: options.contactName ?? '',
        email: options.email ?? '',
        phone: options.phone ?? '',
      },
      opt_in_sms: false,
      default_license: options.license ?? '',
      software_composition: options.notes,
      software_composition_known_uri: options.sbom ? path.resolve(options.sbom) : undefined,
      software_composition_ignore_uri: options.ignoreSbom ? path.resolve(options.ignoreSbom) : undefined,
      software_composition_uri: options.attach?.map((file) => path.resolve(file)),
    },
  };

  return request;
}

/**
 * Checks everything that would otherwise fail deep inside the pipeline: the scan root, the contact
 * email the auditor requires, and any attachment paths.
 *
 * @throws UsageError with a message meant for the terminal.
 */
export function validateScanRequest(request: ScanRequest): void {
  if (!fs.existsSync(request.scanRoot)) {
    throw new UsageError(`${request.scanRoot} does not exist`);
  }
  if (!fs.statSync(request.scanRoot).isDirectory()) {
    throw new UsageError(`${request.scanRoot} is not a directory`);
  }

  const email = request.projectInfo.contact?.email ?? '';
  if (!email) {
    throw new UsageError('a contact email is required: pass --email you@example.com');
  }
  if (!EMAIL.test(email)) {
    throw new UsageError(`--email: "${email}" is not a valid email address`);
  }

  const attachments: Array<[string, string | undefined]> = [
    ['--sbom', request.projectInfo.software_composition_known_uri],
    ['--ignore-sbom', request.projectInfo.software_composition_ignore_uri],
  ];
  for (const [flag, file] of attachments) {
    if (file && !fs.existsSync(file)) throw new UsageError(`${flag}: ${file} does not exist`);
  }
  for (const file of request.projectInfo.software_composition_uri ?? []) {
    if (!fs.existsSync(file)) throw new UsageError(`--attach: ${file} does not exist`);
  }
}
