// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import fs from 'fs';
import path from 'path';
import { PathObfuscator } from './PathObfuscator';
import { ObfuscationSummary } from './types';
import { brand } from '../../runtime/brand';

export class ObfuscationModule implements PathObfuscator {
  private obfuscatedWords: Array<string>;

  private dictionaryPath: string;

  private obfuscatedMapper: Record<string, string>;

  private obfuscationSummary: Record<string, number>;

  private totalFiles: number;

  private keyNumber: number = 0;

  private totalFilesObfuscated: number;

  constructor(obfuscatedWords: Array<string>, pathToDictionary: string) {
    const obfuscatedWordsSorted = obfuscatedWords.sort((a, b) => b.length - a.length);
    this.obfuscatedWords = obfuscatedWordsSorted;
    this.dictionaryPath = pathToDictionary;
    this.obfuscatedMapper = {};
    this.obfuscationSummary = {};
    this.totalFiles = 0;
    this.totalFilesObfuscated = 0;
    this.initDictionary();
  }

  private initDictionary() {
    try {
      const obfuscationMapper = fs.readFileSync(this.dictionaryPath, 'utf-8');
      const mapper = JSON.parse(obfuscationMapper);
      this.obfuscatedMapper = mapper.dictionary;
      this.keyNumber = mapper.lastKey + 1;
    } catch (e: any) {
      this.obfuscatedMapper = {};
      this.keyNumber = 0;
    }
  }

  public adapt(input: string): string {
    this.totalFiles += 1;
    let obfuscatedInput = input;
    let wasReplaced = false;
    this.obfuscatedWords.forEach((o) => {
      this.updateSummary(o, this.count(o, input));
      if (obfuscatedInput.search(new RegExp(o, 'gmi')) >= 0) {
        wasReplaced = true;
        const matches = input.match(RegExp(o, 'gi'));
        matches.forEach((m) => {
          if (!this.obfuscatedMapper[m]) {
            this.obfuscatedMapper[m] = this.keyGen();
          }
        });

        for (const [word, key] of Object.entries(this.obfuscatedMapper)) {
          obfuscatedInput = obfuscatedInput.replace(new RegExp(word, 'gm'), key);
        }
      }
    });
    if (wasReplaced) this.totalFilesObfuscated += 1;
    return obfuscatedInput;
  }

  private count = (wordToObfuscate: string, input: string) => {
    return (input.match(new RegExp(wordToObfuscate, 'gi')) || []).length;
  };

  private updateSummary(word: string, replaces: number) {
    if (this.obfuscationSummary[word] === undefined) {
      this.obfuscationSummary[word] = replaces > 0 ? replaces : 0;
    } else this.obfuscationSummary[word] += replaces < 0 ? 0 : replaces;
  }

  private keyGen(): string {
    // The prefix appears inside obfuscated paths, so it follows the brand configuration.
    const key = `${brand.obfuscationKeyPrefix}_${this.keyNumber.toString(16).padStart(4, '0').toUpperCase()}`;
    this.keyNumber += 1;
    return key;
  }

  public async done(projectPath: string): Promise<Record<string, string>> {
    await fs.promises.writeFile(
      path.join(projectPath, 'obfuscationMapper.json'),
      JSON.stringify({ dictionary: this.obfuscatedMapper, lastKey: this.keyNumber - 1 }),
    );
    return this.obfuscatedMapper;
  }

  public getSummary(): ObfuscationSummary {
    return {
      totalFiles: this.totalFiles,
      totalFilesObfuscated: this.totalFilesObfuscated,
      obfuscationSummary: this.obfuscationSummary,
    };
  }

  public hasWords(): boolean {
    return this.obfuscatedWords.length > 0;
  }
}
