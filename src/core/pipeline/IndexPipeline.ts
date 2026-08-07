// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { BasePipeline } from './Pipeline';
import { Project } from '../project/Project';
import { IndexTask } from './IndexTask';
import { ProjectState } from '../types';

export class IndexPipelineTask extends BasePipeline {
  public async run(project: Project): Promise<boolean> {
    this.queue.push(new IndexTask(project));

    for await (const [index, task] of this.queue.entries()) {
      await this.executeTask(task, index);
    }

    await this.done(project);
    return true;
  }
}
