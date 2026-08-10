// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { LocalDependencies } from 'scanoss';
import fs from 'fs';
import { log } from '../../runtime/log';
import path from 'path';
import { ExcludeFilteredFiles } from '../tree/exclusions';
import { Project } from '../project/Project';
import { PipelineTask, StageProperties } from './types';
import { ScannerStage } from '../types';
import { AppDefaultValues } from '../projectFiles';
import { LockfileScanner, LockfileScanStats } from '../lockfile/LockfileScanner';
import { toPosixPath } from '../paths';
import { ScanEvent, scanEvents } from '../events';

/**
 * Reads dependency data and writes `output/dependencies.json`.
 *
 * Two engines run over the same file list: the scanoss SDK for the manifests it recognises, and
 * `LockfileScanner` for the lockfile formats it does not. Their records share a shape and are
 * concatenated, so everything downstream — obfuscation, packaging, the auditor — sees one list.
 */
export class DependencyTask implements PipelineTask {
  private project: Project;

  private stats: LockfileScanStats | null = null;

  constructor(project: Project) {
    this.project = project;
  }

  public getStageProperties(): StageProperties {
    return {
      name: ScannerStage.DEPENDENCY,
      label: 'Analyzing dependencies',
      isCritical: false,
    };
  }

  public async run(): Promise<boolean> {
    log.info('[ DependencyTask init ]');
    await this.scanDependencies();
    await this.project.save();
    return true;
  }

  public getStats(): LockfileScanStats | null {
    return this.stats;
  }

  private async scanDependencies() {
    try {
      const allFiles = [];
      const rootPath = this.project.metadata.getScanRoot();
      this.project.tree
        .getRootFolder()
        .getFiles(new ExcludeFilteredFiles())
        .forEach((f: { path: string }) => {
          allFiles.push(rootPath + f.path);
        });

      const dependencies = await new LocalDependencies().search(allFiles);

      {
        const lockfileScanner = new LockfileScanner();
        const { files: lockfileResults, stats } = await lockfileScanner.search(allFiles);
        this.stats = stats;
        dependencies.files.push(...(lockfileResults as any));

        for (const failure of stats.failures) {
          log.warn(`[ DependencyTask ] could not parse ${failure.file}: ${failure.error}`);
        }
        if (stats.unparseable.length) {
          log.warn(`[ DependencyTask ] binary lockfiles skipped: ${stats.unparseable.join(', ')}`);
        }
        scanEvents.emit(ScanEvent.Progress, {
          lockfilePurls: stats.totalPurls,
          lockfileEcosystems: stats.perEcosystem,
        });
      }

      dependencies.files.forEach((f) => {
        f.file = toPosixPath(f.file.replace(rootPath, ''));
        DependencyTask.redact(f);
      });

      await fs.promises.writeFile(
        path.join(
          this.project.metadata.getMyPath(),
          AppDefaultValues.PROJECT.OUTPUT,
          AppDefaultValues.PROJECT.DEPENDENCIES,
        ),
        JSON.stringify(dependencies, null, 2),
      );
    } catch (e) {
      log.error(e);
    }
  }

  /**
   * Lockfiles routinely carry internal registry hosts and private tarball URLs. The audit contract
   * is "no sensitive information leaves the company", so any URL-shaped field is dropped before the
   * record is written. Package names themselves still pass through the obfuscation dictionary.
   */
  private static redact(entry: any) {
    for (const purlEntry of entry.purls ?? []) {
      for (const key of Object.keys(purlEntry)) {
        if (typeof purlEntry[key] === 'string' && /^(https?|git\+|ssh|file):/i.test(purlEntry[key])) {
          delete purlEntry[key];
        }
      }
    }
  }
}
