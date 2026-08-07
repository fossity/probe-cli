// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import fs from 'fs';
import { log, setLogFile } from '../../runtime/log';
import { Fingerprint } from 'scanoss';
import path from 'path';
import { ProjectState } from '../types';
import { Metadata } from './Metadata';
import { Tree } from '../tree/Tree';
import { AppDefaultValues } from '../projectFiles';

/**
 * A single scan: its metadata, its file tree, and the directory holding both.
 *
 * The pipeline tasks receive a `Project` and read from and write to it as they run, so this class is
 * the shared state of a scan rather than a value object.
 *
 * A fresh project directory is created per scan and discarded afterwards unless `--keep-workspace`
 * is given.
 */
export class Project {
  /** The directory holding `metadata.json`, `tree.json` and `output/`. */
  work_root: string;

  /** The directory being scanned. */
  scan_root: string;

  /** The file tree, built during the index stage. */
  tree: Tree;

  /** The winnowing scanner, assigned by the fingerprint stage so a scan can be aborted mid-flight. */
  scanner!: Fingerprint;

  /** Output of `Tree.summarize()`: total, included and filtered file counts, plus the scan list. */
  filesSummary: any;

  /** Files fingerprinted so far, used to turn winnowing events into a percentage. */
  processedFiles = 0;

  /** Files the scanner skipped, keyed by path. */
  filesNotScanned: any;

  metadata: Metadata;

  state: ProjectState;

  constructor() {
    this.state = ProjectState.CLOSED;
    this.tree = new Tree(null, null, null);
  }

  /** Reads a project directory back into memory. */
  public static async readFromPath(pathToProject: string): Promise<Project> {
    const metadata: Metadata = await Metadata.readFromPath(pathToProject);
    const project: Project = new Project();
    project.setState(ProjectState.CLOSED);
    project.setMetadata(metadata);
    return project;
  }

  /** Loads `tree.json` from a previous run, restoring the tree and its summary. */
  public async open(): Promise<boolean> {
    this.state = ProjectState.OPENED;
    setLogFile(path.join(this.metadata.getMyPath(), AppDefaultValues.PROJECT.PROJECT_LOG));

    const serialized = await fs.promises.readFile(
      path.join(this.metadata.getMyPath(), AppDefaultValues.PROJECT.TREE),
      'utf8',
    );
    const saved = JSON.parse(serialized);

    this.filesNotScanned = saved.filesNotScanned;
    this.processedFiles = saved.processedFiles;
    this.filesSummary = saved.filesSummary;
    this.metadata = await Metadata.readFromPath(this.metadata.getMyPath());
    this.tree = new Tree(saved.tree.rootFolder.label, this.metadata.getMyPath(), saved.tree.rootFolder.label);
    this.tree.loadTree(saved.tree.rootFolder);
    this.tree.setSummary(saved.filesSummary);
    this.tree.setFilesToObfuscate(new Map(Object.entries(saved.tree.filesToObfuscate)));
    return true;
  }

  /** Aborts any running scan and releases the tree. */
  public async close() {
    if (this.scanner) this.scanner.abort();
    log.info(`[ PROJECT ]: Closing project ${this.metadata.getName()}`);
    this.state = ProjectState.CLOSED;
    this.tree = null;
  }

  /** Writes `metadata.json` and `tree.json`, so an interrupted scan can be inspected. */
  public save(): void {
    this.metadata.save();
    const snapshot: any = {
      filesNotScanned: this.filesNotScanned,
      processedFiles: this.processedFiles,
      filesSummary: this.filesSummary,
      tree: { ...this.tree },
    };
    // A Map does not survive JSON.stringify.
    snapshot.tree.filesToObfuscate = Object.fromEntries(this.tree.getFilesToObfuscate());

    fs.writeFileSync(
      path.join(this.metadata.getMyPath(), AppDefaultValues.PROJECT.TREE),
      JSON.stringify(snapshot),
    );
    log.info(`[ PROJECT ]: Project ${this.metadata.getName()} saved`);
  }

  public setState(state: ProjectState) {
    this.state = state;
  }

  public getState(): ProjectState {
    return this.state;
  }

  public setMetadata(metadata: Metadata) {
    this.metadata = metadata;
  }

  public getMyPath(): string {
    return this.metadata.getMyPath();
  }

  public getScanRoot(): string {
    return this.metadata.getScanRoot();
  }

  public getTree(): Tree {
    return this.tree;
  }

  public getNode(nodePath: string) {
    return this.tree.getNode(nodePath);
  }

  /** Words the obfuscation stage replaces in every path it writes. */
  public setObfuscatedList(bannedList: Array<string>) {
    this.metadata.setObfuscatedList(bannedList);
  }

  public getBannedList(): Array<string> {
    return this.metadata.getObfuscatedList();
  }
}
