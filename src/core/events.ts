// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Scan progress events.
 *
 * The pipeline publishes its progress here rather than writing to the terminal, so the core stays
 * usable as a library and the CLI owns all rendering. `src/cli/reporter.ts` is the only subscriber
 * in this program.
 */
import { EventEmitter } from 'events';

/** Payload of {@link ScanEvent.StageStarted}. */
export interface StageStartedEvent {
  /** Machine-readable stage identifier. */
  stage: string;
  /** Human-readable label for the terminal. */
  label: string;
  /** Position in the pipeline, as `"3/5"`. */
  step: string;
}

/** Payload of {@link ScanEvent.Progress}. Fields are stage-specific and all optional. */
export interface ProgressEvent {
  /** Percentage of the current stage that is complete. */
  processed?: number;
  /** Package URLs read from lockfiles so far. */
  lockfilePurls?: number;
  /** Package URLs per ecosystem. */
  lockfileEcosystems?: Record<string, number>;
}

/** Payload of {@link ScanEvent.StageFailed}. */
export interface StageFailedEvent {
  /** What failed, phrased for the terminal. */
  name: string;
  cause?: Error | { message?: string };
}

/** Payload of {@link ScanEvent.Finished}. */
export interface FinishedEvent {
  success: boolean;
  /** The project directory holding the artifacts. */
  resultsPath: string;
}

export enum ScanEvent {
  /** A pipeline stage began. */
  StageStarted = 'stage:started',
  /** Progress within the current stage. */
  Progress = 'stage:progress',
  /** A stage failed. Critical stages also reject the pipeline promise. */
  StageFailed = 'stage:failed',
  /** The pipeline completed. */
  Finished = 'scan:finished',
}

/** Maps each event to the shape its listeners receive. */
export interface ScanEventPayloads {
  [ScanEvent.StageStarted]: StageStartedEvent;
  [ScanEvent.Progress]: ProgressEvent;
  [ScanEvent.StageFailed]: StageFailedEvent;
  [ScanEvent.Finished]: FinishedEvent;
}

/**
 * Typed wrapper over `EventEmitter`, so publishing and subscribing agree about payloads.
 *
 * A single process-wide emitter is enough: one scan runs at a time.
 */
class ScanEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  public emit<E extends ScanEvent>(event: E, payload: ScanEventPayloads[E]): void {
    this.emitter.emit(event, payload);
  }

  public on<E extends ScanEvent>(event: E, listener: (payload: ScanEventPayloads[E]) => void): void {
    this.emitter.on(event, listener);
  }

  public off<E extends ScanEvent>(event: E, listener: (payload: ScanEventPayloads[E]) => void): void {
    this.emitter.off(event, listener);
  }

  /** Drops every subscriber. The CLI calls this once a scan has finished rendering. */
  public removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

export const scanEvents = new ScanEvents();
