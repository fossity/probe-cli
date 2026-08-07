// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { Project } from '../project/Project';
import { BasePipeline } from './Pipeline';
import { FingerprintTask } from './FingerprintTask';
import { DependencyTask } from './DependencyTask';
import { HintTask } from './HintTask';
import { ObfuscationTask } from './ObfuscationTask';
import { ProjectState } from '../types';
import { ScanEvent, scanEvents } from '../events';
import { AttachFileTask } from './AttachFileTask';
import { LockfileScanStats } from '../lockfile/LockfileScanner';

export class FingerprintPipelineTask extends BasePipeline {
  private dependencyTask: DependencyTask | null = null;

  public async run(project: Project): Promise<boolean> {
    this.dependencyTask = new DependencyTask(project);
    this.queue.push(new FingerprintTask(project));
    this.queue.push(this.dependencyTask);
    this.queue.push(new HintTask(project));
    this.queue.push(new ObfuscationTask(project));
    this.queue.push(new AttachFileTask(project));

    for await (const [index, task] of this.queue.entries()) {
      await this.executeTask(task, index);
    }

    await this.done(project);

    return true;
  }

  /** Lockfile statistics from the dependency stage, for the CLI summary. */
  public getDependencyStats(): LockfileScanStats | null {
    return this.dependencyTask?.getStats() ?? null;
  }

  // @Override
  protected async done(project: Project) {
    project.setState(ProjectState.CLOSED);
    project.save();
    scanEvents.emit(ScanEvent.Finished, {
      success: true,
      resultsPath: project.metadata.getMyPath(),
    });
  }
}
