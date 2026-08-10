// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import fs from 'fs';
import os from 'os';
import path from 'path';
import { log, setLogFile } from '../runtime/log';
import { Project } from './project/Project';
import { Metadata } from './project/Metadata';
import { IndexPipelineTask } from './pipeline/IndexPipeline';
import { FingerprintPipelineTask } from './pipeline/FingerprintPipeline';
import { PackagerTask } from './pipeline/PackagerTask';
import { CipherTask } from './pipeline/CipherTask';
import { AppDefaultValues } from './projectFiles';
import { IProjectInfoMetadata } from './types';
import { brand, packageExtension } from '../runtime/brand';
import { LockfileScanStats } from './lockfile/LockfileScanner';

export interface ScanRequest {
  /** Directory to scan. */
  scanRoot: string;
  /** Project name; also the workspace directory name. */
  name: string;
  /** Where the package is written. */
  output: string;
  /** Words to obfuscate out of paths (company name, product name, internal codenames). */
  obfuscate: string[];
  projectInfo: IProjectInfoMetadata;
  /** Working directory for intermediate artifacts. Defaults to <workspace>/<name>. */
  workspaceDir?: string;
  /** Emit the plain zip instead of the encrypted package (debugging / self-review). */
  raw?: boolean;
  /** Keep the working directory after a successful run. */
  keepWorkspace?: boolean;
}

export interface ScanOutcome {
  packagePath: string;
  /** Directory holding the package contents in the clear, for the author to read before sending. */
  reviewPath: string;
  projectPath: string;
  filesTotal: number;
  filesFingerprinted: number;
  filesFiltered: number;
  dependencyFiles: number;
  dependencyPurls: number;
  lockfileStats: LockfileScanStats | null;
  obfuscatedPaths: number;
  bytes: number;
}

/**
 * Directory holding the intermediate artifacts of a scan.
 *
 * `PROBE_WORKSPACE` overrides it. An empty value counts as unset, so exporting the variable without
 * a value in a shell profile does not resolve the workspace to the filesystem root.
 */
export function defaultWorkspaceRoot(): string {
  return process.env.PROBE_WORKSPACE || path.join(os.homedir(), brand.workspaceDirName);
}

/**
 * Runs a scan end to end:
 * index -> fingerprint, dependencies, hints, obfuscate, attach -> zip -> encrypt.
 */
export class ScanRunner {
  private project!: Project;

  private dependencyStats: LockfileScanStats | null = null;

  public async run(request: ScanRequest): Promise<ScanOutcome> {
    const scanRoot = path.resolve(request.scanRoot);
    if (!fs.existsSync(scanRoot) || !fs.statSync(scanRoot).isDirectory()) {
      throw new Error(`${scanRoot} is not a directory`);
    }

    const projectPath = request.workspaceDir ?? path.join(defaultWorkspaceRoot(), request.name);
    await this.createProject(request, scanRoot, projectPath);

    setLogFile(path.join(projectPath, AppDefaultValues.PROJECT.PROJECT_LOG));

    // Stage 1: index. Builds the tree, applies the banned list, flags dependency files.
    await new IndexPipelineTask().run(this.project);

    // Stage 2: fingerprint + dependencies + hints + obfuscation + attachments.
    const fingerprintPipeline = new FingerprintPipelineTask();
    await fingerprintPipeline.run(this.project);
    this.dependencyStats = fingerprintPipeline.getDependencyStats();

    // Stage 3: package.
    const packagePath = await this.package(request, projectPath);
    const reviewPath = await this.writeReviewCopy(
      path.join(projectPath, AppDefaultValues.PROJECT.OUTPUT),
      packagePath,
    );

    const outcome = await this.summarise(request, projectPath, packagePath, reviewPath);

    if (!request.keepWorkspace && !request.workspaceDir) {
      await fs.promises.rm(projectPath, { recursive: true, force: true });
    }
    return outcome;
  }

  private async createProject(request: ScanRequest, scanRoot: string, projectPath: string) {
    await fs.promises.rm(projectPath, { recursive: true, force: true });
    await fs.promises.mkdir(path.join(projectPath, AppDefaultValues.PROJECT.OUTPUT), { recursive: true });

    const metadata = new Metadata(request.name, scanRoot, projectPath);
    this.project = new Project();
    this.project.setMetadata(metadata);
    this.project.setObfuscatedList(request.obfuscate);
    metadata.save();

    // The declaration that travels inside the package, from CLI flags or the wizard.
    // AttachFileTask reads it back to resolve any attachments.
    await fs.promises.writeFile(
      path.join(projectPath, AppDefaultValues.PROJECT.OUTPUT, AppDefaultValues.PROJECT.OUTPUT_METADATA),
      JSON.stringify(request.projectInfo, null, 2),
    );
  }

  /**
   * Writes the package contents beside the package, unencrypted.
   *
   * The package itself is encrypted to the auditor's key, so its author cannot open what they are
   * about to send. Leaving the same files in the clear means the decision to send is an informed
   * one: every byte in this directory is a byte in the package.
   */
  private async writeReviewCopy(outputDir: string, target: string): Promise<string> {
    const reviewPath = `${target}.contents`;
    await fs.promises.rm(reviewPath, { recursive: true, force: true });
    await fs.promises.cp(outputDir, reviewPath, { recursive: true });
    return reviewPath;
  }

  /** Zips the output folder, then encrypts it unless a plain archive was requested. */
  private async package(request: ScanRequest, projectPath: string): Promise<string> {
    const outputDir = path.join(projectPath, AppDefaultValues.PROJECT.OUTPUT);
    let target = path.resolve(request.output);

    if (request.raw) {
      if (!target.toLowerCase().endsWith('.zip')) target = `${target}.zip`;
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await new PackagerTask().run({ inputPath: outputDir, outputPath: target });
      return target;
    }

    if (!target.toLowerCase().endsWith(packageExtension)) target = `${target}${packageExtension}`;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });

    const tmpZip = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'probe-pkg-')), 'payload.zip');
    await new PackagerTask().run({ inputPath: outputDir, outputPath: tmpZip });
    await new CipherTask().run({
      rsaPubKey: brand.publicKeyPem,
      inputPath: tmpZip,
      outputPath: target,
      wantDecryptScript: false,
    });
    await fs.promises.rm(path.dirname(tmpZip), { recursive: true, force: true });
    return target;
  }

  private async summarise(
    request: ScanRequest,
    projectPath: string,
    packagePath: string,
    reviewPath: string,
  ): Promise<ScanOutcome> {
    const summary = this.project.getTree().getSummarize();
    let dependencyFiles = 0;
    let dependencyPurls = 0;
    try {
      const deps = JSON.parse(
        await fs.promises.readFile(
          path.join(projectPath, AppDefaultValues.PROJECT.OUTPUT, AppDefaultValues.PROJECT.DEPENDENCIES),
          'utf-8',
        ),
      );
      dependencyFiles = deps.files?.length ?? 0;
      dependencyPurls = (deps.files ?? []).reduce((acc: number, f: any) => acc + (f.purls?.length ?? 0), 0);
    } catch {
      /* dependencies.json is optional: the dependency stage is not critical to a scan */
    }

    return {
      packagePath,
      reviewPath,
      projectPath,
      filesTotal: summary?.total ?? 0,
      filesFingerprinted: summary?.include ?? 0,
      filesFiltered: summary?.filter ?? 0,
      dependencyFiles,
      dependencyPurls,
      lockfileStats: this.dependencyStats,
      obfuscatedPaths: request.obfuscate.length ? this.project.getTree().getFilesToObfuscate().size : 0,
      bytes: (await fs.promises.stat(packagePath)).size,
    };
  }
}
