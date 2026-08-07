// SPDX-FileCopyrightText: 2021-2026 Fossity LLC (fossity.com)
// SPDX-License-Identifier: GPL-2.0-only

import { describe, it, expect } from 'vitest';
import path from 'path';
import { LockfileScanner, SCANOSS_NATIVE_FILES } from '../src/core/lockfile/LockfileScanner';
import * as js from '../src/core/lockfile/parsers/javascript';
import * as py from '../src/core/lockfile/parsers/python';
import * as native from '../src/core/lockfile/parsers/native';
import * as managed from '../src/core/lockfile/parsers/managed';

const purls = (r: { purls: Array<{ purl: string }> }) => r.purls.map((p) => p.purl).sort();

describe('registry', () => {
  const scanner = new LockfileScanner();

  it('never claims a file scanoss already parses', () => {
    for (const name of SCANOSS_NATIVE_FILES) {
      expect(scanner.getDefinition(`/repo/${name}`), name).toBeNull();
    }
    expect(scanner.getDefinition('/repo/app.csproj')).toBeNull();
  });

  it('matches by basename, case-insensitively', () => {
    expect(scanner.getDefinition('/repo/PNPM-LOCK.YAML')?.ecosystem).toBe('npm');
    expect(scanner.getDefinition('/repo/sub/dir/Cargo.lock')?.ecosystem).toBe('cargo');
  });

  it('supports globs without matching unrelated files', () => {
    expect(scanner.getDefinition('/r/requirements-dev.txt')?.ecosystem).toBe('pypi');
    expect(scanner.getDefinition('/r/requirements.txt')).toBeNull(); // scanoss owns the exact name
    expect(scanner.getDefinition('/r/app.fsproj')?.ecosystem).toBe('nuget');
    expect(scanner.getDefinition('/r/notes.txt')).toBeNull();
  });

  it('flags binary lockfiles as a known gap', () => {
    expect(scanner.findUnparseable(['/r/bun.lockb', '/r/bun.lock'])).toEqual(['/r/bun.lockb']);
  });
});

describe('javascript', () => {
  it('parses pnpm-lock.yaml v6 and skips workspace links', async () => {
    const content = `lockfileVersion: '6.0'
dependencies:
  react:
    specifier: ^18.2.0
    version: 18.2.0
  '@acme/shared':
    specifier: workspace:*
    version: link:../shared
devDependencies:
  vitest:
    specifier: ^1.0.0
    version: 1.0.4
packages:
  /react@18.2.0:
    resolution: {integrity: sha512-abc}
  /loose-envify@1.4.0:
    resolution: {integrity: sha512-def}
`;
    const r = await js.pnpmLockParser(content, '/r/pnpm-lock.yaml');
    expect(purls(r)).toContain('pkg:npm/react@18.2.0');
    expect(purls(r)).toContain('pkg:npm/loose-envify@1.4.0');
    expect(r.purls.some((p) => p.purl.includes('acme'))).toBe(false);
  });

  it('parses pnpm-lock.yaml v9 with peer-suffixed versions', async () => {
    const content = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      react-dom:
        specifier: ^18.2.0
        version: 18.2.0(react@18.2.0)
packages:
  react-dom@18.2.0:
    resolution: {integrity: sha512-x}
  '@babel/core@7.22.5':
    resolution: {integrity: sha512-y}
`;
    const r = await js.pnpmLockParser(content, '/r/pnpm-lock.yaml');
    expect(purls(r)).toContain('pkg:npm/react-dom@18.2.0');
    expect(purls(r)).toContain('pkg:npm/%40babel/core@7.22.5');
    expect(r.purls.every((p) => !p.purl.includes('('))).toBe(true);
  });

  it('parses npm-shrinkwrap.json v3 and v1', async () => {
    const v3 = await js.npmShrinkwrapParser(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'root' },
          'node_modules/ms': { version: '2.1.3' },
          'node_modules/@types/node': { version: '20.1.0' },
          'node_modules/local-pkg': { link: true, resolved: 'packages/local' },
        },
      }),
      '/r/npm-shrinkwrap.json',
    );
    expect(purls(v3)).toEqual(['pkg:npm/%40types/node@20.1.0', 'pkg:npm/ms@2.1.3']);

    const v1 = await js.npmShrinkwrapParser(
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: { debug: { version: '4.3.4', dependencies: { ms: { version: '2.1.2' } } } },
      }),
      '/r/npm-shrinkwrap.json',
    );
    expect(purls(v1)).toEqual(['pkg:npm/debug@4.3.4', 'pkg:npm/ms@2.1.2']);
  });

  it('parses bun.lock, tolerating trailing commas', async () => {
    const content = `{
  "lockfileVersion": 1,
  // a comment
  "packages": {
    "lodash": ["lodash@4.17.21", {}, "sha512-x"],
    "sibling": ["sibling@workspace:packages/sibling", {}],
  },
}`;
    const r = await js.bunLockParser(content, '/r/bun.lock');
    expect(purls(r)).toEqual(['pkg:npm/lodash@4.17.21']);
  });
});

describe('python', () => {
  it('parses poetry.lock and skips path sources', async () => {
    const content = `[[package]]
name = "requests"
version = "2.31.0"

[[package]]
name = "internal-lib"
version = "0.1.0"

[package.source]
type = "directory"
url = "../internal-lib"
`;
    const r = await py.poetryLockParser(content, '/r/poetry.lock');
    expect(purls(r)).toEqual(['pkg:pypi/requests@2.31.0']);
  });

  it('parses Pipfile.lock default and develop sections', async () => {
    const r = await py.pipfileLockParser(
      JSON.stringify({
        default: { flask: { version: '==2.3.2' }, local: { path: '.' } },
        develop: { pytest: { version: '==7.4.0' } },
      }),
      '/r/Pipfile.lock',
    );
    expect(purls(r)).toEqual(['pkg:pypi/flask@2.3.2', 'pkg:pypi/pytest@7.4.0']);
    expect(r.purls.find((p) => p.purl.includes('pytest'))?.scope).toBe('devDependencies');
  });

  it('parses requirements-*.txt, ignoring flags, comments and markers', async () => {
    const content = `# comment
-r base.txt
--index-url https://internal/simple
requests[security]==2.31.0
flask>=2.0 ; python_version < "3.12"
./local-wheel.whl
`;
    const r = await py.requirementsParser(content, '/r/requirements-dev.txt');
    expect(purls(r)).toEqual(['pkg:pypi/flask', 'pkg:pypi/requests@2.31.0']);
    // a range stays a range: it must not be asserted as a resolved version
    expect(r.purls.find((p) => p.purl === 'pkg:pypi/flask')?.requirement).toBe('>=2.0');
  });

  it('parses conda environment.yml including its pip block', async () => {
    const content = `name: env
dependencies:
  - python=3.11
  - numpy=1.26.0
  - pip:
    - requests==2.31.0
`;
    const r = await py.condaEnvParser(content, '/r/environment.yml');
    expect(purls(r)).toEqual(['pkg:conda/numpy@1.26.0', 'pkg:pypi/requests@2.31.0']);
  });
});

describe('native', () => {
  it('parses Cargo.lock, skipping workspace members with no source', async () => {
    const content = `[[package]]
name = "my-app"
version = "0.1.0"

[[package]]
name = "serde"
version = "1.0.188"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;
    const r = await native.cargoLockParser(content, '/r/Cargo.lock');
    expect(purls(r)).toEqual(['pkg:cargo/serde@1.0.188']);
  });

  it('parses Cargo.toml, skipping path/git/workspace deps', async () => {
    const content = `[dependencies]
serde = "1.0"
tokio = { version = "1.35", features = ["full"] }
internal = { path = "../internal" }
patched = { git = "https://example.com/x.git" }

[dev-dependencies]
criterion = "0.5"
`;
    const r = await native.cargoTomlParser(content, '/r/Cargo.toml');
    expect(purls(r)).toEqual(['pkg:cargo/criterion', 'pkg:cargo/serde', 'pkg:cargo/tokio']);
  });

  it('parses Podfile.lock including subspecs', async () => {
    const content = `PODS:
  - Alamofire (5.6.4)
  - Firebase/Auth (10.4.0):
    - FirebaseAuth (~> 10.4.0)

DEPENDENCIES:
  - Alamofire (~> 5.6)
`;
    const r = await native.podfileLockParser(content, '/r/Podfile.lock');
    expect(purls(r)).toContain('pkg:cocoapods/Alamofire@5.6.4');
    expect(purls(r)).toContain('pkg:cocoapods/Firebase@10.4.0');
  });

  it('parses Package.resolved v2 with repository namespaces', async () => {
    const content = JSON.stringify({
      pins: [
        {
          identity: 'swift-log',
          location: 'https://github.com/apple/swift-log.git',
          state: { version: '1.5.2' },
        },
      ],
      version: 2,
    });
    const r = await native.swiftPackageResolvedParser(content, '/r/Package.resolved');
    expect(purls(r)).toEqual(['pkg:swift/github.com/apple/swift-log@1.5.2']);
  });

  it('parses conan.lock v2', async () => {
    const r = await native.conanLockParser(
      JSON.stringify({ version: '0.5', requires: ['zlib/1.2.13#abc%1700000000', 'fmt/10.1.1'] }),
      '/r/conan.lock',
    );
    expect(purls(r)).toEqual(['pkg:conan/fmt@10.1.1', 'pkg:conan/zlib@1.2.13']);
  });
});

describe('managed ecosystems', () => {
  it('parses composer.lock with vendor namespaces', async () => {
    const r = await managed.composerLockParser(
      JSON.stringify({
        packages: [{ name: 'monolog/monolog', version: 'v2.9.1' }],
        'packages-dev': [{ name: 'phpunit/phpunit', version: '10.4.2' }],
      }),
      '/r/composer.lock',
    );
    expect(purls(r)).toEqual(['pkg:composer/monolog/monolog@2.9.1', 'pkg:composer/phpunit/phpunit@10.4.2']);
  });

  it('parses composer.json, skipping platform packages', async () => {
    const r = await managed.composerJsonParser(
      JSON.stringify({ require: { php: '>=8.1', 'ext-json': '*', 'guzzlehttp/guzzle': '^7.5' } }),
      '/r/composer.json',
    );
    expect(purls(r)).toEqual(['pkg:composer/guzzlehttp/guzzle']);
  });

  it('parses gradle.lockfile', async () => {
    const content = `# This is a Gradle generated file
com.google.guava:guava:31.1-jre=compileClasspath,runtimeClasspath
org.slf4j:slf4j-api:2.0.7=compileClasspath
empty=compileClasspath
`;
    const r = await managed.gradleLockfileParser(content, '/r/gradle.lockfile');
    expect(purls(r)).toEqual([
      'pkg:maven/com.google.guava/guava@31.1-jre',
      'pkg:maven/org.slf4j/slf4j-api@2.0.7',
    ]);
  });

  it('parses packages.lock.json, skipping project references', async () => {
    const r = await managed.nugetPackagesLockParser(
      JSON.stringify({
        version: 1,
        dependencies: {
          'net8.0': {
            'Newtonsoft.Json': { type: 'Direct', resolved: '13.0.3' },
            MyLib: { type: 'Project' },
          },
        },
      }),
      '/r/packages.lock.json',
    );
    expect(purls(r)).toEqual(['pkg:nuget/Newtonsoft.Json@13.0.3']);
  });

  it('parses paket.lock across NUGET and GITHUB groups', async () => {
    const content = `NUGET
  remote: https://api.nuget.org/v3/index.json
    FSharp.Core (8.0.100)
    Newtonsoft.Json (13.0.3)
GITHUB
  remote: forki/FsUnit
    FsUnit.fs (1.0)
`;
    const r = await managed.paketLockParser(content, '/r/paket.lock');
    expect(purls(r)).toEqual([
      'pkg:github/forki/FsUnit.fs@1.0',
      'pkg:nuget/FSharp.Core@8.0.100',
      'pkg:nuget/Newtonsoft.Json@13.0.3',
    ]);
  });

  it('parses *.fsproj PackageReference elements', async () => {
    const content = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="FSharp.Core" Version="8.0.100" />
    <PackageReference Include="Serilog" Version="3.1.1" />
  </ItemGroup>
</Project>`;
    const r = await managed.dotnetProjectParser(content, '/r/app.fsproj');
    expect(purls(r)).toEqual(['pkg:nuget/FSharp.Core@8.0.100', 'pkg:nuget/Serilog@3.1.1']);
  });

  it('parses pubspec.lock, skipping sdk and path sources', async () => {
    const content = `packages:
  http:
    dependency: "direct main"
    source: hosted
    version: "1.1.0"
  flutter:
    dependency: "direct main"
    source: sdk
    version: "0.0.0"
`;
    const r = await managed.pubspecLockParser(content, '/r/pubspec.lock');
    expect(purls(r)).toEqual(['pkg:pub/http@1.1.0']);
  });

  it('parses mix.lock, keeping only hex packages', async () => {
    const content = `%{
  "phoenix": {:hex, :phoenix, "1.7.7", "abc", [:mix], [], "hexpm", "def"},
  "my_fork": {:git, "https://github.com/me/fork.git", "abc123", []},
}`;
    const r = await managed.mixLockParser(content, '/r/mix.lock');
    expect(purls(r)).toEqual(['pkg:hex/phoenix@1.7.7']);
  });

  it('parses Gopkg.lock', async () => {
    const content = `[[projects]]
  name = "github.com/pkg/errors"
  version = "v0.9.1"
  revision = "abc"
`;
    const r = await managed.gopkgLockParser(content, '/r/Gopkg.lock');
    expect(purls(r)).toEqual(['pkg:golang/github.com/pkg/errors@v0.9.1']);
  });
});

describe('resilience', () => {
  it('reports a parse failure instead of aborting the scan', async () => {
    const scanner = new LockfileScanner();
    const dir = path.join(__dirname, 'fixtures', 'broken');
    const { files, stats } = await scanner.search([
      path.join(dir, 'poetry.lock'),
      path.join(dir, 'Cargo.lock'),
    ]);
    expect(stats.failures.length).toBe(1);
    expect(stats.failures[0].file).toContain('poetry.lock');
    expect(files.map((f) => path.basename(f.file))).toEqual(['Cargo.lock']);
  });
});
