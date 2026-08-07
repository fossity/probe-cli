# Probe CLI

A command-line and terminal-UI code auditing probe. It fingerprints a codebase, reads its declared
dependencies from manifests **and lockfiles**, counts files, optionally obfuscates paths, and writes
a single encrypted package for an auditor.

It succeeds the Fossity Probe desktop application, which is discontinued.

Your source code never leaves the machine: the package contains winnowing fingerprints, package
URLs and counts, not file contents.

```
$ probe-cli scan .
  ✔ Indexing files (1/1)
  ✔ Fingerprinting source (1/5)
  ✔ Analyzing dependencies (2/5)
  ✔ Counting files (3/5)
  ✔ Obfuscating paths (4/5)
  ✔ Attaching files (5/5)

Scan complete
  files seen           1284
  fingerprinted        902
  filtered out         382
  dependency files     11 (1043 purls)
  from lockfiles       806 purls  npm:612  pypi:98  cargo:96

  → /home/you/acme-app.fossity (612.4 KB)
```

## Install

Pick whichever is easiest — none of them needs a checkout.

**Standalone binary (no Node required)** — Linux and macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/fossity/probe-cli/main/install.sh | sh
```

**Already have Node 18+?**

```sh
npx @fossity/probe-cli scan .        # runs without installing anything
npm install -g @fossity/probe-cli    # or install it permanently
```

**Or download a binary directly** from the [releases page](https://github.com/fossity/probe-cli/releases)
— one file per platform, `gunzip` and run. Verify it against the published `SHA256SUMS`.

### Unsigned binaries

The binaries carry no Developer ID or Authenticode certificate. What that means in practice:

- **The install script above is unaffected.** macOS attaches its quarantine flag in the _browser_,
  not in `curl`, so `curl | sh` triggers no warning.
- **Downloading from the releases page in a browser does trigger one.** Right-click the file and
  choose Open, or run `xattr -d com.apple.quarantine <file>`.
- **`npx` is unaffected** — no operating-system gatekeeping applies to it at all.

Check the published `SHA256SUMS` if you want to verify what you downloaded; it is a stronger check
than a code signature, since it is produced by the same public build that produced the binary.

### Windows is not supported yet

There is no Windows binary, and `npx` on Windows is not recommended. The winnowing engine writes
scanned paths into the fingerprint file without normalising separators, so a scan run on Windows
produces backslash paths, and path obfuscation cannot match them — it would appear to succeed while
leaving the words it was asked to remove in place. Rather than risk that, `--obfuscate` refuses to
run on Windows.

`install.ps1` and the tracking issue remain in the repository; the platform will be restored once
the path handling is fixed and CI can prove it.

## Use

Run it with no arguments for the guided flow: project information, obfuscation, then a summary to
confirm before anything is written.

```sh
probe-cli
```

Or drive it non-interactively, which is what you want in CI:

```sh
probe-cli scan . --email you@example.com --license MIT -o audit.fossity
```

### Commands

| Command                   | What it does                                               |
| ------------------------- | ---------------------------------------------------------- |
| `probe-cli`               | guided terminal wizard                                     |
| `probe-cli scan [folder]` | fingerprint a folder and write the package                 |
| `probe-cli deps [folder]` | list the dependencies found, write nothing                 |
| `probe-cli formats`       | list every manifest/lockfile format this build understands |
| `probe-cli workspace`     | print the working directory used for intermediate files    |

### Useful flags

| Flag                   | Effect                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `-e, --email <email>`  | contact email — the auditor requires it                                              |
| `-o, --output <file>`  | where the package goes                                                               |
| `-l, --license <spdx>` | default license of your own code                                                     |
| `--obfuscate <words>`  | comma-separated words to strip from every path in the package                        |
| `--no-lockfiles`       | skip lockfiles; read only the manifests the scanoss SDK parses                       |
| `--include-vendored`   | also parse manifests inside `node_modules`, `vendor`, …                              |
| `--keep-registry-urls` | keep registry/repository URLs (stripped by default)                                  |
| `--sbom <file>`        | attach a known-components SBOM                                                       |
| `--raw`                | write a plain `.zip` instead of an encrypted package, to review what you are sending |
| `--json`               | machine-readable result, for CI                                                      |
| `--verbose`            | mirror the scan log to stderr                                                        |

Reviewing what you are about to send is one command:

```sh
probe-cli scan . --email you@example.com --raw -o review.zip && unzip -l review.zip
```

## What the package contains

| File                   | Contents                                      |
| ---------------------- | --------------------------------------------- |
| `winnowing.wfp`        | winnowing fingerprints (hashes, never source) |
| `dependencies.json`    | package URLs from manifests and lockfiles     |
| `file_count.csv`       | file counts by extension                      |
| `projectMetadata.json` | the contact details and license you supplied  |

## Dependency coverage

Dependency discovery runs two parsing engines. The scanoss SDK covers `package.json`,
`package-lock.json`, `yarn.lock`, `pom.xml`, `build.gradle`, `requirements.txt`, `pyproject.toml`,
`Gemfile`, `Gemfile.lock`, `go.mod`, `go.sum`, `*.csproj` and `packages.config`. This program adds
the lockfile formats it does not:

| Ecosystem          | Added formats                                                                    |
| ------------------ | -------------------------------------------------------------------------------- |
| npm                | `pnpm-lock.yaml`, `npm-shrinkwrap.json`, `bun.lock`                              |
| Python             | `poetry.lock`, `Pipfile`, `Pipfile.lock`, `requirements*.txt`, `environment.yml` |
| Rust / C++         | `Cargo.lock`, `Cargo.toml`, `conan.lock`, `vcpkg.json`                           |
| PHP                | `composer.json`, `composer.lock`                                                 |
| JVM                | `gradle.lockfile`                                                                |
| .NET               | `packages.lock.json`, `paket.lock`, `*.fsproj`, `*.vbproj`                       |
| Apple              | `Podfile.lock`, `Package.resolved`, `Cartfile.resolved`                          |
| Dart / Elixir / Go | `pubspec.yaml`, `pubspec.lock`, `mix.lock`, `Gopkg.lock`                         |

`probe-cli formats` prints the live list. Two deliberate behaviours:

- **Local packages are not reported.** `workspace:*`, `file:`, `link:`, path and git specifiers name
  things that exist in no registry, so no purl is emitted for them.
- **Ranges stay ranges.** A manifest constraint like `^4.18.2` goes in `requirement`; the purl only
  carries a version when the file actually pins one. Lockfiles pin, so their purls carry versions.

`bun.lockb` is binary: it is detected and reported as a gap rather than silently ignored.

## Privacy

Lockfiles routinely name internal packages and private registry hosts. By default any URL-shaped
field is dropped from the dependency records before they are written, and package names still go
through the obfuscation dictionary. Use `--keep-registry-urls` only when the auditor needs them.

The obfuscation dictionary (`obfuscationMapper.json`) is written to the working directory and is
**not** included in the package — it is the key that maps obfuscated paths back to real ones, and it
stays with you. Keep it if you need to interpret the auditor's findings; pass `--keep-workspace` to
retain it.

## Rebranding

Everything brand-specific lives in **`brand.config.json`**. `npm run brand:check` fails the build if a
vendor name is hardcoded anywhere in `src/` or `scripts/` — attribution notices excepted, since the
GPL requires those — so the list below is the whole job.

1. **Fork and edit `brand.config.json`:**

   ```json
   {
     "productName": "Acme Audit Probe",
     "binaryName": "acme-probe",
     "shortName": "Acme Probe",
     "vendor": "Acme",
     "tagline": "Captures fingerprints from your code, without shipping your code.",

     "packageExtension": ".acme",
     "versionFooterTag": "ACME_VERSION",
     "obfuscationKeyPrefix": "ACME",
     "workspaceDirName": "acme-workspace",
     "configDirName": "acme-probe",

     "websiteUrl": "https://acme.example",
     "uploadUrl": "https://acme.example/upload",
     "supportEmail": "audit@acme.example",
     "issuesUrl": "https://github.com/acme/probe-cli/issues",

     "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n…your key…\n-----END PUBLIC KEY-----\n",
     "accentColor": "magenta"
   }
   ```

   `publicKeyPem` is the RSA public key your back end holds the private half of. Everything else is
   cosmetic except the three format fields called out below.

2. **Apply and verify:**

   ```sh
   npm run brand:apply    # updates package.json name/bin/homepage and the install scripts
   npm run brand:check    # fails if any brand string is hardcoded in the source
   npm test
   npm run build:binary
   ```

3. **Point the installers at your repository.** Set `"repository": "acme/probe-cli"` in
   `brand.config.json` and re-run `npm run brand:apply`, which rewrites the defaults in `install.sh`
   and `install.ps1`. Update `.github/workflows/release.yml` and the artwork by hand.

### Three fields are wire format, not decoration

`packageExtension`, `versionFooterTag` and `publicKeyPem` are read by whatever ingests the package.
Change them only together with the receiving end:

- `publicKeyPem` — the package body is AES-128-CBC, its key and IV sealed with this RSA key. The
  wrong key makes the package undecryptable.
- `versionFooterTag` — the last 100 bytes of the file are `<TAG>:<version>` padded with NULs. An
  ingest that greps for the old tag will reject the file.
- `packageExtension` — upload forms usually filter on it.

Keep the originals if you are talking to an existing back end, and rebrand only the surface.

### Try a rebrand without rebuilding

`PROBE_BRAND_CONFIG` points the binary at a different brand file at runtime — useful for testing
before you commit to a fork:

```sh
PROBE_BRAND_CONFIG=/tmp/acme-brand.json probe-cli scan . --email you@example.com
```

## Development

```sh
npm install

npm run dev -- scan ./some-folder --email you@example.com   # run from source
npm test                # 110 tests: parsers, pipeline, package format, CLI, end to end
npm run typecheck
npm run verify          # brand check, types, formatting and tests, as CI runs them
npm run build           # dist/probe.cjs, a single file of about 4.8 MB
npm run build:binary    # bin/probe-<version>-<os>-<arch>, 99 MB (33 MB compressed)
```

Layout, data flow and the reasoning behind the design are in [ARCHITECTURE.md](ARCHITECTURE.md).

`src/core` holds the scanning pipeline and is free of any terminal or CLI concern, so it can be
driven as a library; `src/cli` is the only place that reads arguments or writes to the terminal.

Adding a lockfile format takes one entry in `LOCKFILE_DEFINITIONS` and one parser function; see the
same-named section of ARCHITECTURE.md.

## Licensing

Copyright (C) 2021-2026 Fossity LLC (https://fossity.com).

This program is free software licensed under the **GNU General Public License, version 2 only**
(`SPDX-License-Identifier: GPL-2.0-only`). The full text is in [LICENSE](LICENSE).

Parts of `src/core` derive, in modified form, from the discontinued Fossity Probe desktop
application, which was itself based on the
[SCANOSS Audit Workbench](https://github.com/scanoss/audit-workbench). Both are GPL-2.0.
[NOTICE](NOTICE) records which parts are derived and which were written for this program; every
source file carries an SPDX header, and `.reuse/dep5` covers the files that cannot.

This program is distributed in the hope that it will be useful, but **WITHOUT ANY WARRANTY**;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

### What this means if you fork it

- A rebranded fork is still a derivative work: it must remain GPL-2.0, keep the copyright notices
  and the LICENSE file, and offer source to anyone it distributes binaries to.
- Rebranding changes the name, not the licence. Replacing the vendor name everywhere is expected and
  supported (see [Rebranding](#rebranding)); removing the attribution is not permitted.
- Contributions are accepted under the same licence.

### Third-party components

Dependencies keep their own licences; `package.json` lists them and `npm ls` resolves the tree. The
notable one is [scanoss](https://www.npmjs.com/package/scanoss) (MIT), which provides the winnowing
fingerprint engine and the package manifest parsers this program builds on. A standalone binary
embeds the Node runtime, which is MIT licensed.
