// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

const AdmZip = require('adm-zip');

export interface IPackager {
  inputPath: string;
  outputPath: string;
}

export class PackagerTask {
  public async run(params: IPackager): Promise<void> {
    const zip = new AdmZip();
    zip.addLocalFolder(params.inputPath);
    zip.writeZip(params.outputPath);
  }
}
