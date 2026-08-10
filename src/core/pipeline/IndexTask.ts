// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import fs from 'fs';
import { LocalDependencies } from 'scanoss';
import path from 'path';
import { Project } from '../project/Project';
import { PipelineTask, StageProperties } from './types';
import { ScannerStage } from '../types';
import Folder from '../tree/Folder';
import { Tree } from '../tree/Tree';
import { FilterOR } from '../tree/filters/FilterOR';
import { FilterWFP } from '../tree/filters/FilterWFP';
import { FilterDependency } from '../tree/filters/FilterDependency';
import { ScanState } from '../types';
import { LockfileScanner } from '../lockfile/LockfileScanner';

export class IndexTask implements PipelineTask {
  constructor(private readonly project: Project) {}

  public getStageProperties(): StageProperties {
    return {
      name: ScannerStage.INDEX,
      label: 'Indexing files',
      isCritical: true,
    };
  }

  public async run(params: void): Promise<boolean> {
    const files = this.getProjectFiles(this.project.getScanRoot(), this.project.getScanRoot());
    await this.buildTree(files);
    this.setTreeSummary(this.project.getTree());
    await this.setDependenciesOnFileTree();
    this.createFileMap();
    this.project.metadata.setScannerState(ScanState.INDEXED);
    this.project.save();
    return true;
  }

  /**
   * Flags every file either parsing engine recognises.
   *
   * The banned list marks `.lock` and `.json` files FILTERED because they carry no useful
   * fingerprint; flagging them here lifts them back out so the dependency stage can read them.
   *
   * Vendored copies are included deliberately. A checked-in `node_modules` or `vendor` directory is
   * part of what ships, so its manifests describe real components of the product; excluding them
   * would understate the audit. They stay out of the fingerprint file either way, because the
   * banned list filters those directories from the scan.
   */
  private async setDependenciesOnFileTree() {
    const files = this.project
      .getTree()
      .getRootFolder()
      .getFiles()
      .map((file: { path: string }) => file.path);

    const fromSdk = new LocalDependencies().filterFiles(files);
    const fromLockfiles = new LockfileScanner().filterFiles(files);

    this.project.tree.addDependencies([...new Set([...fromSdk, ...fromLockfiles])]);
  }

  private createFileMap() {
    const files = this.project
      .getTree()
      .getRootFolder()
      .getFilesByFilter(new FilterOR(new FilterWFP(), new FilterDependency()));
    const fileMapper = new Map<string, string | null>();
    files.forEach((f) => fileMapper.set(f, null));
    this.project.getTree().setFilesToObfuscate(fileMapper);
  }

  private getProjectFiles(dir: string, rootPath: string): Array<string> {
    let results: Array<string> = [];
    const dirEntries = fs
      .readdirSync(dir, { withFileTypes: true }) // Returns a list of files and folders
      .sort(this.dirFirstFileAfter)
      .filter((dirent: any) => !dirent.isSymbolicLink());

    for (const dirEntry of dirEntries) {
      const relativePath = `${dir}${path.sep}${dirEntry.name}`.replace(rootPath, '');
      if (dirEntry.isDirectory()) {
        const f: Folder = new Folder(relativePath, dirEntry.name);
        const subTree = this.getProjectFiles(`${dir}${path.sep}${dirEntry.name}`, rootPath);

        results = results.concat(subTree);
      } else results.push(relativePath);
    }
    return results;
  }

  // This is a sorter that will sort folders before files in alphabetical order.
  private dirFirstFileAfter(a: any, b: any): number {
    if (!a.isDirectory() && b.isDirectory()) return 1;
    if (a.isDirectory() && !b.isDirectory()) return -1;
    return 0;
  }

  public async buildTree(files: Array<string>): Promise<Tree> {
    this.project.getTree().setRootName(this.project.metadata.getName());
    this.project.getTree().setProjectPath(this.project.getMyPath());
    this.project.getTree().setScanRoot(this.project.metadata.getScanRoot());
    this.project.getTree().build(files);
    this.project.getTree().setFilter();
    return this.project.getTree();
  }

  public setTreeSummary(tree: Tree): void {
    tree.summarize();
    const summary = tree.getSummarize();
    this.project.filesSummary = summary;
    this.project.filesNotScanned = {};
    this.project.processedFiles = 0;
    this.project.metadata.setTotalFiles(summary.include);
  }
}
