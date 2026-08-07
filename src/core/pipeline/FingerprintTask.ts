// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { Fingerprint, SbomMode, ScannerEvents, ScannerInput, WinnowingMode } from 'scanoss';
import fs from 'fs';
import path from 'path';
import { log } from '../../runtime/log';
import { ScannerStage, ScanState } from '../types';
import { Project } from '../project/Project';
import { ScanEvent, scanEvents } from '../events';
import { PipelineTask, StageProperties } from './types';
import { AppDefaultValues } from '../projectFiles';

/** Name of an optional file in the scan root listing components the auditor should ignore. */
const IGNORE_FILE = 'scanoss-ignore.json';

/**
 * Computes winnowing fingerprints and writes `output/winnowing.wfp`.
 *
 * Everything happens locally: the scanner reads each file, reduces it to winnowing hashes and
 * appends those to the WFP file. File contents never leave the process.
 *
 * Files are split into two lists by the scan mode the index stage assigned. Source files get full
 * winnowing with HPSM, which supports snippet matching; binaries, very large and very small files
 * get an MD5 only, which can match a whole file but nothing inside it.
 */
export class FingerprintTask implements PipelineTask {
  private fingerprint: Fingerprint;

  constructor(private readonly project: Project) {}

  public getStageProperties(): StageProperties {
    return {
      name: ScannerStage.SCAN,
      label: 'Fingerprinting source',
      isCritical: true,
    };
  }

  public async run(): Promise<boolean> {
    log.info('[ FingerprintTask ] starting');
    this.project.metadata.setScannerState(ScanState.SCANNING);

    this.start();
    await this.fingerprint.start(this.buildScannerInput());

    this.project.metadata.setScannerState(ScanState.FINISHED);
    this.project.metadata.save();
    this.project.save();
    return true;
  }

  /** Creates the scanner and turns its events into pipeline progress. */
  private start(): void {
    this.fingerprint = new Fingerprint();
    // Held on the project so an interrupted scan can be aborted.
    this.project.scanner = this.fingerprint;
    this.fingerprint.setFingerprintPath(
      path.join(
        this.project.getMyPath(),
        AppDefaultValues.PROJECT.OUTPUT,
        AppDefaultValues.PROJECT.WINNOWING_WFP,
      ),
    );

    let { processedFiles } = this.project;

    this.fingerprint.on(ScannerEvents.WINNOWING_STATUS, (filesFingerprinted: number) => {
      processedFiles += filesFingerprinted;
      scanEvents.emit(ScanEvent.Progress, {
        processed: (100 * processedFiles) / this.project.filesSummary.include,
      });
    });

    this.fingerprint.on(ScannerEvents.WINNOWING_FINISHED, async () => {
      this.project.metadata.setScannerState(ScanState.FINISHED);
      await this.project.save();
      log.info('[ FingerprintTask ] winnowing finished');
    });

    this.fingerprint.on('error', async (error) => {
      this.project.save();
      await this.project.close();
      scanEvents.emit(ScanEvent.StageFailed, { name: 'Fingerprinting source', cause: error });
    });
  }

  /** Splits the indexed files by scan mode and attaches the ignore list, if the project has one. */
  private buildScannerInput(): Array<ScannerInput> {
    const filesToScan: Record<string, string> = this.project.getTree().getSummarize().files;
    const fullScanList: string[] = [];
    const quickScanList: string[] = [];

    for (const [filePath, mode] of Object.entries(filesToScan)) {
      if (mode === 'MD5_SCAN') quickScanList.push(filePath);
      else fullScanList.push(filePath);
    }

    const folderRoot = this.project.getScanRoot();
    const input: Array<ScannerInput> = [];

    // The scanoss 0.17 type declares `winnowing: { mode }`, but WfpCalculator.start() reads
    // `params.winnowingMode` and nothing else. Renaming the field to satisfy the type would
    // silently drop HPSM and the MD5 fast path, so the runtime-correct name is kept.
    if (fullScanList.length > 0) {
      input.push({
        fileList: fullScanList,
        folderRoot,
        winnowingMode: WinnowingMode.FULL_WINNOWING_HPSM,
      } as unknown as ScannerInput);
    }
    if (quickScanList.length > 0) {
      input.push({
        fileList: quickScanList,
        folderRoot,
        winnowingMode: WinnowingMode.WINNOWING_ONLY_MD5,
      } as unknown as ScannerInput);
    }

    if (this.project.getTree().getRootFolder().containsFile(IGNORE_FILE)) {
      const sbom = fs.readFileSync(path.join(folderRoot, IGNORE_FILE), 'utf-8');
      for (const entry of input) {
        entry.sbom = sbom;
        entry.sbomMode = SbomMode.SBOM_IGNORE;
      }
    }

    return input;
  }
}
