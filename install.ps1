# Installs the probe binary on Windows. No Node required.
#
#   irm https://raw.githubusercontent.com/OWNER/REPO/main/install.ps1 | iex
#
# Parameters can be supplied as environment variables: PROBE_VERSION, PROBE_REPO, PROBE_INSTALL_DIR.

$ErrorActionPreference = 'Stop'

$BinaryName = "probe-cli"
$Repo = if ($env:PROBE_REPO) { $env:PROBE_REPO } else { "fossity/probe-cli" }
$Version = if ($env:PROBE_VERSION) { $env:PROBE_VERSION } else { "latest" }
$InstallDir = if ($env:PROBE_INSTALL_DIR) { $env:PROBE_INSTALL_DIR } else { "$env:LOCALAPPDATA\Programs\$BinaryName" }

$arch = if ([Environment]::Is64BitOperatingSystem) {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
} else {
  throw "32-bit Windows is not supported"
}

$asset = "$BinaryName-win32-$arch.exe.gz"
$url = if ($Version -eq 'latest') {
  "https://github.com/$Repo/releases/latest/download/$asset"
} else {
  "https://github.com/$Repo/releases/download/$Version/$asset"
}

Write-Host "Downloading $BinaryName (win32-$arch)..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  $gz = Join-Path $tmp $asset
  Invoke-WebRequest -Uri $url -OutFile $gz -UseBasicParsing

  # Verify the checksum when the release publishes one.
  try {
    $sumsUrl = ($url -replace '/[^/]+$', '/SHA256SUMS')
    $sums = (Invoke-WebRequest -Uri $sumsUrl -UseBasicParsing).Content
    $line = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($asset) } | Select-Object -First 1)
    if ($line) {
      $expected = ($line -split '\s+')[0]
      $actual = (Get-FileHash -Algorithm SHA256 -Path $gz).Hash.ToLower()
      if ($expected.ToLower() -ne $actual) { throw "checksum mismatch (expected $expected, got $actual)" }
      Write-Host "Checksum verified."
    }
  } catch [System.Net.WebException] {
    # No SHA256SUMS published for this release; continue.
  }

  # Decompress.
  $exePath = Join-Path $InstallDir "$BinaryName.exe"
  $input = [System.IO.File]::OpenRead($gz)
  $output = [System.IO.File]::Create($exePath)
  $gzip = New-Object System.IO.Compression.GzipStream($input, [System.IO.Compression.CompressionMode]::Decompress)
  $gzip.CopyTo($output)
  $gzip.Dispose(); $output.Dispose(); $input.Dispose()

  Write-Host "Installed to $exePath"

  # Put it on PATH for future sessions.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$InstallDir", 'User')
    Write-Host "Added $InstallDir to your PATH (open a new terminal to pick it up)."
  }
  Write-Host ""
  Write-Host "Run: $BinaryName"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
