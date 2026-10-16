#!/bin/sh
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ACTION=$1
shift
if [ -f "$SOURCE/.desktop-bridge-client" ]; then DATA_ROOT=$SOURCE
elif [ "$(uname -s)" = Darwin ]; then DATA_ROOT="$HOME/Library/Application Support/DesktopBridge"
else DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/desktop-bridge"; fi
NEXT_ROOT=0
for ARG in "$@"; do
 if [ "$NEXT_ROOT" = 1 ]; then DATA_ROOT=$ARG; NEXT_ROOT=0; elif [ "$ARG" = --root ]; then NEXT_ROOT=1; fi
done
case "$(uname -s)" in Darwin) PLATFORM=darwin;; Linux) PLATFORM=linux;; *) echo 'Use Start.cmd on Windows.' >&2; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; *) echo 'Unsupported processor.' >&2; exit 1;; esac
NODE="$DATA_ROOT/runtime/node-v24.19.0-$PLATFORM-$ARCH/bin/node"
[ -x "$NODE" ] && [ -f "$DATA_ROOT/control.mjs" ] || { echo 'Install Desktop Bridge first.' >&2; exit 1; }
exec "$NODE" "$DATA_ROOT/control.mjs" "$ACTION" "$@"
