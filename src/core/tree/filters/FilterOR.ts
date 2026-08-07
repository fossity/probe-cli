// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { Filter } from './Filter';
import File from '../File';

export class FilterOR extends Filter {
  private filterA;

  private filterB;

  constructor(filterA: Filter, filterB: Filter) {
    super();
    this.filterA = filterA;
    this.filterB = filterB;
  }

  public evaluate(file: File): boolean {
    return this.filterA.evaluate(file) || this.filterB.evaluate(file);
  }
}
