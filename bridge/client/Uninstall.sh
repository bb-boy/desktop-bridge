#!/bin/sh
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$SOURCE/Install.sh" --uninstall "$@"
