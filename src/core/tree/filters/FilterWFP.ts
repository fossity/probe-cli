// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { Filter } from './Filter';
import File from '../File';

export class FilterWFP extends Filter {
  public evaluate(file: File): boolean {
    return file.getAction() === 'scan';
  }
}
