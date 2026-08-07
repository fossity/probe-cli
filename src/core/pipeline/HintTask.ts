// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { FileCount } from 'scanoss';
import fs from 'fs';
import { log } from '../../runtime/log';
import { PipelineTask, StageProperties } from './types';
import { ScannerStage } from '../types';
import { Project } from '../project/Project';
import path from 'path';
import { Format } from 'scanoss/build/main/sdk/FileCount/Interfaces';
import { AppDefaultValues } from '../projectFiles';

export class HintTask implements PipelineTask {
  private project: Project;

  constructor(project: Project) {
    this.project = project;
  }

  public getStageProperties(): StageProperties {
    return {
      name: ScannerStage.HINT,
      label: 'Counting files',
      isCritical: false,
    };
  }

  public async run(): Promise<boolean> {
    log.info('[ HintTask init ]');
    await this.createFileCount();
    return true;
  }

  private async createFileCount() {
    const csv = await FileCount.walk(this.project.getScanRoot(), { output: Format.CSV });
    await fs.promises.writeFile(
      path.join(
        this.project.getMyPath(),
        AppDefaultValues.PROJECT.OUTPUT,
        AppDefaultValues.PROJECT.FILE_COUNT,
      ),
      csv.toString(),
    );
  }
}
