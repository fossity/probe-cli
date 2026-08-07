// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import fs from 'fs';
import path from 'path';
import { Cipher } from '../cipher/Cipher';
import { getAppVersion } from '../../runtime/version';
import { brand } from '../../runtime/brand';

export interface ICipherTask {
  inputPath: string;
  outputPath: string;
  rsaPubKey: string;
  wantDecryptScript: boolean;
}

export class CipherTask {
  async run(params: ICipherTask): Promise<void> {
    const data = await fs.promises.readFile(params.inputPath);

    const cipher = new Cipher(params.rsaPubKey);
    const cipherText = await cipher.cipherPackage(data);

    const appVersion = getAppVersion();
    // Create a buffer with the version footer
    const probeVersion = Buffer.alloc(100);
    probeVersion.write(`${brand.versionFooterTag}:${appVersion}`, 'utf-8');

    // Combine the encrypted data with the version footer
    const finalData = Buffer.concat([cipherText, probeVersion]);
    // Write the combined data
    await fs.promises.writeFile(params.outputPath, finalData);

    if (params.wantDecryptScript) {
      const projPath = path.parse(params.outputPath);

      const scriptName = `${projPath.name}_decrypt.sh`;
      const scriptFullPath = path.join(projPath.dir, scriptName);

      const script = cipher.generateDecrypBash(scriptName, projPath.name);
      await fs.promises.writeFile(scriptFullPath, script, { mode: 0o755 });
    }
  }
}
