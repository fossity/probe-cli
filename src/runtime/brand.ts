// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Brand resolution. Every user-visible name, URL, file extension and key comes from here.
 *
 * Precedence:
 *   1. $PROBE_BRAND_CONFIG  (absolute path to a JSON file)  -- runtime override, no rebuild
 *   2. brand.config.json bundled at build time               -- the normal case
 *
 * See README -> Rebranding.
 */
import fs from 'fs';
import bundledBrand from '../../brand.config.json';

export interface Brand {
  productName: string;
  binaryName: string;
  shortName: string;
  vendor: string;
  tagline: string;
  packageExtension: string;
  versionFooterTag: string;
  /** Prefix for obfuscation dictionary keys; appears inside obfuscated paths. */
  obfuscationKeyPrefix: string;
  workspaceDirName: string;
  configDirName: string;
  websiteUrl: string;
  uploadUrl: string;
  supportEmail: string;
  issuesUrl: string;
  /** GitHub owner/name the install scripts download releases from. */
  repository?: string;
  /** npm package name; defaults to `<binaryName>-cli` in brand:apply. */
  npmPackageName?: string;
  publicKeyPem: string;
  accentColor: string;
}

function load(): Brand {
  const override = process.env.PROBE_BRAND_CONFIG;
  if (override) {
    try {
      const raw = JSON.parse(fs.readFileSync(override, 'utf-8'));
      return { ...(bundledBrand as unknown as Brand), ...raw };
    } catch (e: any) {
      throw new Error(`PROBE_BRAND_CONFIG=${override} could not be read: ${e.message}`);
    }
  }
  return bundledBrand as unknown as Brand;
}

export const brand: Brand = load();

/** Normalised package extension, used in CLI help text and output-path checks. */
export const packageExtension = brand.packageExtension.startsWith('.')
  ? brand.packageExtension
  : `.${brand.packageExtension}`;
