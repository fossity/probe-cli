# Architecture

## Shape of the program

```
src/cli/                argument parsing, the terminal wizard, progress rendering
src/core/               the scan pipeline, usable as a library
  ScanRunner.ts           orchestrates a scan end to end
  events.ts               typed progress events
  types.ts                shared types
  projectFiles.ts         filenames inside a project directory
  pipeline/               the stages, one class each
  tree/                   the file tree, the banned list and its filters
  project/                the project directory and its metadata
  lockfile/               lockfile parsers and their registry
  obfuscation/            path obfuscation and the dictionary
  cipher/                 package encryption
src/runtime/            brand configuration, logging, scan options
```

`src/cli` depends on `src/core`; nothing in `src/core` depends on `src/cli`. The core never writes to
the terminal — it publishes events — so it can be driven as a library, which is how the tests use it.

## A scan, end to end

```
  probe-cli scan .
      │
      ├─ buildScanRequest()          src/cli/scanRequest.ts
      │    resolve paths, map flags to options, validate before any work starts
      │
      ├─ ScanRunner.run()            src/core/ScanRunner.ts
      │    │
      │    ├─ create the project directory and write output/projectMetadata.json
      │    │
      │    ├─ IndexPipeline
      │    │    IndexTask            walk the folder, build the tree, apply the banned list,
      │    │                         flag manifests and lockfiles as dependency files
      │    │
      │    ├─ FingerprintPipeline
      │    │    FingerprintTask      winnowing hashes      -> output/winnowing.wfp
      │    │    DependencyTask       package URLs          -> output/dependencies.json
      │    │    HintTask             counts by extension   -> output/file_count.csv
      │    │    ObfuscationTask      rewrite paths in the two files above
      │    │    AttachFileTask       copy in the SBOM and any attachments
      │    │
      │    ├─ PackagerTask           zip output/
      │    └─ CipherTask             encrypt the zip       -> <project>.fossity
      │
      └─ Reporter / printOutcome     src/cli/reporter.ts
```

Stages publish `ScanEvent.StageStarted`, `Progress`, `StageFailed` and `Finished` through
`src/core/events.ts`. The reporter is the only subscriber; without it a scan is silent, which is what
makes the core embeddable.

A stage marked `isCritical` aborts the pipeline when it throws. The dependency and hint stages are
not critical: a package with fingerprints but no dependency data is still worth producing.

## The file tree and the banned list

The index stage builds a tree of every file under the scan root, then marks each node `FILTERED` or
scannable using `tree/defaultFilter.ts` — several hundred rules that exclude documentation, images,
build output, vendor directories and lockfiles.

Filtering serves fingerprinting: a `.lock` or `.json` file has no useful winnowing fingerprint.
Dependency parsing wants exactly those files, so the index stage flags every file the two parsing
engines recognise, which lifts them back out of `FILTERED`. Files inside a dependency directory stay
filtered unless `--include-vendored` is given.

A file can therefore be:

|                               | fingerprinted | parsed for dependencies        |
| ----------------------------- | ------------- | ------------------------------ |
| `src/main.c`                  | yes           | no                             |
| `package.json`                | no            | yes                            |
| `pnpm-lock.yaml`              | no            | yes                            |
| `README.md`                   | no            | no                             |
| `node_modules/x/package.json` | no            | only with `--include-vendored` |

## Two parsing engines, one output file

`DependencyTask` runs both:

- the scanoss SDK's `LocalDependencies`, for the manifests it recognises;
- `LockfileScanner` (`src/core/lockfile/`), for the lockfile formats it does not.

Both emit `{ file, purls: [{ purl, requirement, scope }] }` records, concatenated into
`output/dependencies.json`. A consumer cannot tell which engine produced an entry, and does not need
to. `LockfileScanner.getDefinition()` declines any filename the SDK claims, so nothing is parsed
twice.

Adding a format means one entry in `LOCKFILE_DEFINITIONS` and one parser function. Parsers are pure:
content and path in, records out. They do no filesystem access and never throw on malformed input —
`LockfileScanner` records a failure and moves on, because one bad lockfile must not lose a scan.

## Obfuscation

When the user supplies words, `ObfuscationTask` rewrites the paths inside `winnowing.wfp` and
`dependencies.json`, replacing each occurrence with a generated key (`<prefix>_0001`, the prefix
coming from `brand.config.json`) and recording the mapping in `obfuscationMapper.json`.

That mapping stays in the working directory and is never packaged: it is what turns obfuscated paths
back into real ones, so only the person who ran the scan can read the auditor's findings against
their own tree.

## Package format

```
[ RSA-PKCS#1 block: 8-byte length + 16-byte AES key + 16-byte IV ]  256 bytes for the shipped key
[ AES-128-CBC of the zipped output/ directory                    ]  multiple of 16
[ "<versionFooterTag>:<version>" padded with NULs                ]  exactly 100 bytes
```

A fresh AES key and IV are generated per package and sealed with the public key from
`brand.config.json`, so only the holder of the private key can open it. `--raw` skips the encryption
so the author can inspect exactly what would be sent.

## Build and distribution

`scripts/build.mjs` bundles the program into a single CommonJS file with esbuild; `scripts/dev.mjs`
does the same to a temporary file and runs it, which is what `npm run dev` uses.
`scripts/build-binary.mjs` wraps the bundle in a Node Single Executable Application, producing one
self-contained file per platform.

The winnowing worker the scanner starts is created from an evaluated string rather than a separate
file, which is why a single-file executable works at all.
