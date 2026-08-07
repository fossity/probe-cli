// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { log } from '../../runtime/log';
import { ScanEvent, scanEvents } from '../events';
import { PipelineTask, StageProperties } from './types';
import { Project } from '../project/Project';
import { ProjectState } from '../types';

/**
 * Runs a list of stages in order, publishing progress and stopping at the first critical failure.
 */
export abstract class BasePipeline {
  protected queue: Array<PipelineTask> = [];

  public abstract run(project: Project): Promise<boolean>;

  protected async executeTask(task: PipelineTask, stageStep = 1) {
    try {
      scanEvents.emit(ScanEvent.StageStarted, {
        stage: task.getStageProperties().name,
        label: task.getStageProperties().label,
        step: `${stageStep + 1}/${this.queue.length}`,
      });
      await task.run();
    } catch (e: any) {
      if (task.getStageProperties().isCritical) {
        log.error(
          '[SCANNER PIPELINE ERROR]',
          `Stage: ${task.getStageProperties().label} error: ${e.message}`,
        );
        scanEvents.emit(ScanEvent.StageFailed, {
          name: task.getStageProperties().label,
          cause: e,
        });
        throw e;
      }
    }
  }

  protected async done(project: Project) {
    project.setState(ProjectState.OPENED);
    project.save();
    scanEvents.emit(ScanEvent.Finished, {
      success: true,
      resultsPath: project.metadata.getMyPath(),
    });
  }
}
