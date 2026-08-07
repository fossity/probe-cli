// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import Node, { NodeStatus } from './Node';

/**
 * A rule that excludes nodes from a tree traversal.
 *
 * Passed to `Folder.getFiles()`, which skips any node the rule evaluates to true and, for folders,
 * does not descend into it.
 */
export abstract class FileExclusion {
  /** True when `node` should be skipped. */
  public abstract evaluate(node: Node): boolean;
}

/**
 * Excludes files the banned list filtered out.
 *
 * Note the explicit initializer: writing `private filter: NodeStatus.FILTERED` declares a type
 * without assigning a value, leaving the field `undefined` at runtime and the rule inert.
 */
export class ExcludeFilteredFiles extends FileExclusion {
  private readonly filter: NodeStatus = NodeStatus.FILTERED;

  public evaluate(node: Node): boolean {
    return node.getStatus() === this.filter;
  }
}
