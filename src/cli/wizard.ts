// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import path from 'path';
import fs from 'fs';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { brand, packageExtension } from '../runtime/brand';
import { ScanRequest } from '../core/ScanRunner';
import { splitWords, slug } from './scanRequest';

/**
 * The guided flow: project information, then obfuscation, then a summary to confirm.
 *
 * Runs when the program is invoked with no arguments on a terminal.
 */
export async function runWizard(defaults: { scanRoot?: string } = {}): Promise<ScanRequest | null> {
  p.intro(`${pc.bgCyan(pc.black(` ${brand.productName} `))} ${pc.dim(brand.tagline)}`);

  const scanRoot = await p.text({
    message: 'Which folder should be scanned?',
    placeholder: process.cwd(),
    initialValue: defaults.scanRoot ?? process.cwd(),
    validate: (value) => {
      const target = path.resolve(value || process.cwd());
      if (!fs.existsSync(target)) return `${target} does not exist`;
      if (!fs.statSync(target).isDirectory()) return `${target} is not a directory`;
      return undefined;
    },
  });
  if (p.isCancel(scanRoot)) return cancel();

  const name = await p.text({
    message: 'Project name',
    initialValue: path.basename(path.resolve(String(scanRoot))),
    validate: (v) => (v.trim() ? undefined : 'A project name is required'),
  });
  if (p.isCancel(name)) return cancel();

  const contactName = await p.text({ message: 'Your name', placeholder: 'optional' });
  if (p.isCancel(contactName)) return cancel();

  const email = await p.text({
    message: 'Contact email',
    validate: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? undefined : 'A valid email is required'),
  });
  if (p.isCancel(email)) return cancel();

  const phone = await p.text({ message: 'Phone number', placeholder: 'optional' });
  if (p.isCancel(phone)) return cancel();

  const license = await p.text({
    message: 'Default license of your code',
    placeholder: 'e.g. MIT, Apache-2.0, proprietary',
    initialValue: '',
  });
  if (p.isCancel(license)) return cancel();

  const wantsObfuscation = await p.confirm({
    message: 'Obfuscate identifying words in file paths?',
    initialValue: false,
  });
  if (p.isCancel(wantsObfuscation)) return cancel();

  let obfuscate: string[] = [];
  if (wantsObfuscation) {
    const words = await p.text({
      message: 'Words to remove from paths (comma separated)',
      placeholder: 'your-company, product-name, internal-codename',
    });
    if (p.isCancel(words)) return cancel();
    obfuscate = splitWords(String(words));
  }

  const scanOpts = await p.multiselect({
    message: 'Options',
    required: false,
    initialValues: ['lockfiles', 'redact'],
    options: [
      { value: 'lockfiles', label: 'Read lockfiles', hint: 'pnpm, poetry, Cargo, composer, ...' },
      { value: 'redact', label: 'Strip registry URLs', hint: 'recommended for private registries' },
      { value: 'vendored', label: 'Include vendored manifests', hint: 'node_modules, vendor, ...' },
    ],
  });
  if (p.isCancel(scanOpts)) return cancel();
  const selected = scanOpts as string[];

  const output = await p.text({
    message: `Where should the ${packageExtension} package be written?`,
    initialValue: path.join(process.cwd(), `${slug(String(name))}${packageExtension}`),
  });
  if (p.isCancel(output)) return cancel();

  const request: ScanRequest = {
    scanRoot: path.resolve(String(scanRoot)),
    name: String(name).trim(),
    output: String(output),
    obfuscate,
    projectInfo: {
      contact: {
        name: String(contactName ?? '').trim(),
        email: String(email).trim(),
        phone: String(phone ?? '').trim(),
      },
      opt_in_sms: false,
      default_license: String(license ?? '').trim(),
    },
    options: {
      lockfiles: selected.includes('lockfiles'),
      redactRegistries: selected.includes('redact'),
      includeVendored: selected.includes('vendored'),
    },
  };

  p.note(
    [
      `folder      ${request.scanRoot}`,
      `project     ${request.name}`,
      `contact     ${request.projectInfo.contact?.email}`,
      `license     ${request.projectInfo.default_license || pc.dim('(none)')}`,
      `obfuscate   ${obfuscate.length ? obfuscate.join(', ') : pc.dim('(nothing)')}`,
      `lockfiles   ${request.options?.lockfiles ? 'yes' : 'no'}`,
      `output      ${request.output}`,
    ].join('\n'),
    'Summary',
  );

  const go = await p.confirm({ message: 'Start scan?', initialValue: true });
  if (p.isCancel(go) || !go) return cancel();

  return request;
}

function cancel(): null {
  p.cancel('Cancelled.');
  return null;
}

export const wizardOutro = (message: string) => p.outro(message);
