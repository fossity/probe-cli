// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import File from '../File';
export abstract class Filter {
  public abstract evaluate(file: File): boolean;
}
