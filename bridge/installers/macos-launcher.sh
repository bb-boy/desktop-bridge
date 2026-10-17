#!/bin/sh
set -eu
CONTENTS=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec /usr/bin/open -a Terminal "$CONTENTS/Resources/Install.command"
