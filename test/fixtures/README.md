# Test fixtures

## `sample-project/`

A small polyglot project used by the pipeline and end-to-end tests. It deliberately contains:

- **manifests and lockfiles the scanoss SDK parses** (`package.json`, `package-lock.json`,
  `yarn.lock`, `pom.xml`, `requirements.txt`, `Gemfile.lock`, `go.sum`) so tests can assert that
  inherited coverage still works;
- **lockfiles only this CLI parses** (`pnpm-lock.yaml`, `poetry.lock`, `composer.lock`, `mix.lock`,
  `Cargo.lock`, `Podfile.lock`, `Package.resolved`, `pubspec.lock`, `packages.lock.json`,
  `Pipfile.lock`, `gradle.lockfile`, `npm-shrinkwrap.json`) so the added coverage is measurable;
- **two source files** (`src/main.c`, `src/index.js`) so the fingerprinting stage has something to
  winnow;
- **a vendored manifest** (`node_modules/leftpad/package.json`) so the vendored-exclusion default and
  the `--include-vendored` opt-in can both be verified.

The contents are minimal but structurally valid: each file carries just enough for its parser to
produce a package URL.

## `broken/`

A malformed `poetry.lock` beside a valid `Cargo.lock`, asserting that one unparseable file is
reported as a failure and skipped rather than aborting the scan.
