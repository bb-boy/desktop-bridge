#!/bin/sh
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/sh "$SOURCE/launch.sh" stop "$@"
