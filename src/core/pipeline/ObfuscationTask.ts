// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import path from 'path';
import { PipelineTask, StageProperties } from './types';
import { Project } from '../project/Project';
import { ScannerStage } from '../types';
import { AppDefaultValues } from '../projectFiles';
import { ObfuscationModule } from '../obfuscation/ObfuscationModule';
import { PathRewriter } from '../obfuscation/PathRewriter';
import { WfpPathExtractor, DependencyPathExtractor } from '../obfuscation/pathExtractors';

/**
 * Removes identifying words from the paths recorded in the package.
 *
 * The fingerprint and dependency files both embed source paths, and a path can name the company,
 * the product or an internal codename. Each requested word is replaced with a generated key, and the
 * mapping is written to the working directory — never to the package, since it is what reverses the
 * obfuscation.
 *
 * Both files share one dictionary, so the same word maps to the same key in each and the auditor can
 * still correlate a fingerprint with the dependency file it came from.
 */
export class ObfuscationTask implements PipelineTask {
  constructor(private readonly project: Project) {}

  public getStageProperties(): StageProperties {
    return {
      name: ScannerStage.OBFUSCATE,
      label: 'Obfuscating paths',
      isCritical: true,
    };
  }

  public async run(): Promise<boolean> {
    const projectPath = this.project.getMyPath();
    const outputPath = path.join(projectPath, AppDefaultValues.PROJECT.OUTPUT);
    const dictionaryPath = path.join(projectPath, AppDefaultValues.PROJECT.OBFUSCATION_MAPPER);
    const words = this.project.getBannedList();

    const artifacts: Array<[string, WfpPathExtractor | DependencyPathExtractor]> = [
      [path.join(outputPath, AppDefaultValues.PROJECT.WINNOWING_WFP), new WfpPathExtractor()],
      [path.join(outputPath, AppDefaultValues.PROJECT.DEPENDENCIES), new DependencyPathExtractor()],
    ];

    for (const [file, extractor] of artifacts) {
      // A fresh module per file, each seeded from the dictionary the previous one wrote.
      const obfuscation = new ObfuscationModule(words, dictionaryPath);
      await new PathRewriter(projectPath, file, obfuscation, extractor).run();
    }

    return true;
  }
}
