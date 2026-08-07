// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { ScannerStage } from '../types';

/** How a stage identifies itself to the pipeline and to the terminal. */
export interface StageProperties {
  /** Machine-readable stage identifier. */
  name: ScannerStage;

  /** Label shown while the stage runs. */
  label: string;

  /**
   * Whether a failure aborts the scan.
   *
   * The dependency and hint stages are not critical: a package with fingerprints but no dependency
   * data is still worth producing.
   */
  isCritical: boolean;
}

/** One stage of a pipeline. */
export interface PipelineTask {
  getStageProperties(): StageProperties;

  /** Runs the stage. Resolves true on success; throwing fails the stage. */
  run(): Promise<boolean>;
}
