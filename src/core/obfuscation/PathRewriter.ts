// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import fs from 'fs';
import path from 'path';
import { log } from '../../runtime/log';
import * as readline from 'readline';
import { PathObfuscator } from './PathObfuscator';
import { ObfuscationDTO } from './types';
import { PathExtractor } from './pathExtractors';
import { splitPathParts, joinPathParts } from '../paths';

/**
 * Rewrites the paths inside a generated artifact, line by line.
 *
 * The WFP and dependency files both consist of lines that embed a source path. An `PathExtractor`
 * implementation locates the path in a line, the `PathObfuscator` maps it to its obfuscated form, and the
 * line is written back with the path replaced. The file is rewritten in place through a temporary
 * file, so a failure part-way leaves the original intact.
 *
 * File extensions are preserved: only the directory and stem are obfuscated, because the extension
 * tells the auditor what kind of file was fingerprinted without identifying it.
 *
 * A failure part-way leaves the original file untouched and the temporary file removed.
 */
export class PathRewriter<Adapter extends PathObfuscator> {
  protected obfuscation: Adapter;

  protected pathExtractor: PathExtractor;

  protected inputFile: string;

  protected outputFile: string;

  protected projectPath: string;

  constructor(projectPath: string, inputFile: string, adapter: Adapter, pathExtractor: PathExtractor) {
    this.obfuscation = adapter;
    this.inputFile = inputFile;
    this.projectPath = projectPath;
    this.outputFile = path.join(projectPath, 'obfuscation.tmp');
    this.pathExtractor = pathExtractor;
  }

  public run(): Promise<ObfuscationDTO> {
    // Nothing to obfuscate: leave the artifact untouched.
    if (!this.obfuscation.hasWords()) {
      return Promise.resolve({ path: this.inputFile, dictionary: {} });
    }

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(this.outputFile);
      const input = fs.createReadStream(this.inputFile);
      const lines = readline.createInterface({ input });

      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        log.error('[ OBFUSCATION ]: failed', error);
        lines.close();
        output.destroy();
        // Remove the partial file so the untouched original is what remains.
        fs.promises.rm(this.outputFile, { force: true }).finally(() => reject(error));
      };

      // All three need a listener. readline re-emits the input stream's error on the interface, and
      // an unhandled 'error' there is thrown rather than delivered, which would take down the
      // process instead of failing this stage.
      input.on('error', fail);
      output.on('error', fail);
      lines.on('error', fail);

      lines.on('line', (line) => {
        output.write(`${this.obfuscateLine(line)}\n`);
      });

      lines.on('close', () => {
        output.end();
      });

      output.on('close', async () => {
        if (settled) return;
        try {
          const dictionary = await this.obfuscation.done(this.projectPath);
          await fs.promises.rename(this.outputFile, this.inputFile);
          log.info('[ OBFUSCATION ]: Obfuscation done');
          settled = true;
          resolve({ path: this.inputFile, dictionary });
        } catch (error: any) {
          fail(error);
        }
      });
    });
  }

  /**
   * Replaces the path embedded in one line, keeping the rest of the line byte-for-byte.
   *
   * The replacement targets the exact substring the extractor found, so it cannot miss through a
   * separator or normalisation difference: whatever the line holds is what gets replaced. The
   * extension is preserved, because it tells the auditor what kind of file was fingerprinted
   * without identifying it.
   */
  private obfuscateLine(line: string): string {
    const pathToProcess = this.pathExtractor.extractPath(line);
    if (!pathToProcess) return line;

    const { dir, name, ext } = splitPathParts(pathToProcess);
    const obfuscatedPath = `${this.obfuscation.adapt(joinPathParts(dir, name))}${ext}`;

    return line.replace(pathToProcess, obfuscatedPath);
  }
}
