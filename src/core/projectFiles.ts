// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

/**
 * Filenames used inside a project directory.
 *
 * `output/` is the only subdirectory that ends up in the package; everything beside it stays on the
 * scanning machine.
 */
export const AppDefaultValues = {
  PROJECT: {
    /** Subdirectory that is zipped and encrypted into the package. */
    OUTPUT: 'output',
    /** Client-side record of the scan. Never packaged. */
    METADATA: 'metadata.json',
    /** The declaration that travels inside the package. */
    OUTPUT_METADATA: 'projectMetadata.json',
    WINNOWING_WFP: 'winnowing.wfp',
    DEPENDENCIES: 'dependencies.json',
    PROJECT_LOG: 'project.log',
    TREE: 'tree.json',
    FILE_COUNT: 'file_count.csv',
    /** Maps obfuscated path segments back to the originals. Never packaged. */
    OBFUSCATION_MAPPER: 'obfuscationMapper.json',
    COMPOSITION_KNOWN_FILE_NAME: 'sbom.json',
    COMPOSITION_IGNORE_FILE_NAME: 'ignore.json',
  },
} as const;
