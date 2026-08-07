#!/bin/sh
# Installs the probe binary on Linux or macOS. No Node required.
#
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh | sh
#
# Environment:
#   INSTALL_DIR   where to put the binary (default: ~/.local/bin, or /usr/local/bin if writable)
#   VERSION       release tag to install (default: latest)
#   REPO          owner/name of the GitHub repository to download from

set -eu

BINARY_NAME="probe-cli"
REPO="${REPO:-fossity/probe-cli}"
VERSION="${VERSION:-latest}"

say() { printf '%s\n' "$*"; }
die() { printf '✖ %s\n' "$*" >&2; exit 1; }

# --- platform ---
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux)  target_os="linux" ;;
  Darwin) target_os="darwin" ;;
  *) die "unsupported operating system: $os (Windows users: use install.ps1)" ;;
esac
case "$arch" in
  x86_64|amd64) target_arch="x64" ;;
  arm64|aarch64) target_arch="arm64" ;;
  *) die "unsupported architecture: $arch" ;;
esac

# --- destination ---
if [ -n "${INSTALL_DIR:-}" ]; then
  dest="$INSTALL_DIR"
elif [ -w /usr/local/bin ] 2>/dev/null; then
  dest="/usr/local/bin"
else
  dest="$HOME/.local/bin"
fi
mkdir -p "$dest"

# --- resolve the download url ---
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/$REPO/releases/latest/download/${BINARY_NAME}-${target_os}-${target_arch}.gz"
else
  url="https://github.com/$REPO/releases/download/${VERSION}/${BINARY_NAME}-${target_os}-${target_arch}.gz"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "Downloading ${BINARY_NAME} (${target_os}-${target_arch})..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$tmp/probe.gz" || die "download failed: $url"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp/probe.gz" "$url" || die "download failed: $url"
else
  die "neither curl nor wget is available"
fi

gunzip -c "$tmp/probe.gz" > "$tmp/$BINARY_NAME" || die "could not decompress the download"
chmod +x "$tmp/$BINARY_NAME"

# curl does not set the quarantine flag, but clear it anyway in case the file arrived another way.
if [ "$target_os" = "darwin" ] && command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "$tmp/$BINARY_NAME" 2>/dev/null || true
fi

# Verify the checksum when the release publishes one.
if command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1; then
  sums_url="${url%/*}/SHA256SUMS"
  if curl -fsSL "$sums_url" -o "$tmp/SHA256SUMS" 2>/dev/null; then
    expected="$(grep "${BINARY_NAME}-${target_os}-${target_arch}.gz" "$tmp/SHA256SUMS" | cut -d' ' -f1 || true)"
    if [ -n "$expected" ]; then
      if command -v sha256sum >/dev/null 2>&1; then
        actual="$(sha256sum "$tmp/probe.gz" | cut -d' ' -f1)"
      else
        actual="$(shasum -a 256 "$tmp/probe.gz" | cut -d' ' -f1)"
      fi
      [ "$expected" = "$actual" ] || die "checksum mismatch (expected $expected, got $actual)"
      say "Checksum verified."
    fi
  fi
fi

mv "$tmp/$BINARY_NAME" "$dest/$BINARY_NAME"
say "Installed to $dest/$BINARY_NAME"

case ":$PATH:" in
  *":$dest:"*) say "Run: $BINARY_NAME" ;;
  *)
    say ""
    say "$dest is not on your PATH. Add it with:"
    say "  echo 'export PATH=\"$dest:\$PATH\"' >> ~/.profile && . ~/.profile"
    say "Or run it directly: $dest/$BINARY_NAME"
    ;;
esac
