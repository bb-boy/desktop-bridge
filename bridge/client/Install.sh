#!/bin/sh
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$(uname -s)" in Darwin) PLATFORM=darwin;; Linux) PLATFORM=linux;; *) echo 'Supported systems: macOS and Linux.' >&2; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; *) echo 'Supported processors: x64 and ARM64.' >&2; exit 1;; esac
VERSION=24.19.0
if [ "$PLATFORM" = darwin ]; then DATA_ROOT="$HOME/Library/Application Support/DesktopBridge"; else DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/desktop-bridge"; fi
NEXT_ROOT=0
for ARG in "$@"; do
 if [ "$NEXT_ROOT" = 1 ]; then DATA_ROOT="$ARG"; NEXT_ROOT=0; elif [ "$ARG" = --root ]; then NEXT_ROOT=1; fi
done
LOCAL_NODE="$DATA_ROOT/runtime/node-v$VERSION-$PLATFORM-$ARCH/bin/node"
if [ -x "$LOCAL_NODE" ]; then exec "$LOCAL_NODE" "$SOURCE/install.mjs" "$@"; fi
case "$PLATFORM-$ARCH" in
 darwin-x64) HASH=d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316;;
 darwin-arm64) HASH=8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d;;
 linux-x64) HASH=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4;;
 linux-arm64) HASH=d28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f;;
esac
# A private temporary runtime bootstraps installation. install.mjs copies it into
# the user's protected data directory, so deleting this ZIP never breaks startup.
TEMP=$(mktemp -d "${TMPDIR:-/tmp}/desktop-bridge.XXXXXXXX")
trap 'rm -rf "$TEMP"' EXIT HUP INT TERM
FILE="node-v$VERSION-$PLATFORM-$ARCH.tar.gz"
URL="https://nodejs.org/dist/v$VERSION/$FILE"
if command -v curl >/dev/null 2>&1; then curl --fail --location --retry 2 --proto '=https' --tlsv1.2 "$URL" -o "$TEMP/runtime.tar.gz"
elif command -v wget >/dev/null 2>&1; then wget --https-only "$URL" -O "$TEMP/runtime.tar.gz"
else echo 'Install curl or wget, then retry.' >&2; exit 1; fi
if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$TEMP/runtime.tar.gz" | cut -d ' ' -f 1)
else ACTUAL=$(shasum -a 256 "$TEMP/runtime.tar.gz" | cut -d ' ' -f 1); fi
[ "$ACTUAL" = "$HASH" ] || { echo 'Official Node runtime checksum mismatch.' >&2; exit 1; }
tar -xzf "$TEMP/runtime.tar.gz" -C "$TEMP"
"$TEMP/node-v$VERSION-$PLATFORM-$ARCH/bin/node" "$SOURCE/install.mjs" "$@"
