#!/bin/sh
set -eu
umask 077
fail() { echo "$*" >&2; exit 1; }
# Validate portable options before downloading or changing the local installation.
NEXT=''; DATA_ROOT=''; MODE=''; NO_START=0; STOP=0; UNINSTALL=0; PURGE=0
for ARG in "$@"; do
 if [ -n "$NEXT" ]; then
  case "$ARG" in ''|--*) fail "$NEXT 缺少参数值。";; esac
  if [ "$NEXT" = --root ]; then DATA_ROOT="$ARG"
  else
   case "$ARG" in manual|background) ;; *) fail '--mode 只能是 manual 或 background。';; esac
   [ -z "$MODE" ] || [ "$MODE" = "$ARG" ] || fail '不能同时指定不同的 --mode。'
   MODE="$ARG"
  fi
  NEXT=''
 else
  case "$ARG" in
   --root|--mode) NEXT="$ARG";;
   --no-start) NO_START=1;; --stop) STOP=1;; --uninstall) UNINSTALL=1;; --purge) PURGE=1;;
   --repair|--no-browser) ;; *) fail "未知参数：$ARG";;
  esac
 fi
done
[ -z "$NEXT" ] || fail "$NEXT 缺少参数值。"
[ "$NO_START:$MODE" != 1:background ] || fail '--no-start 不能与 --mode background 同时使用。'
[ "$STOP:$UNINSTALL" != 1:1 ] || fail '--stop 不能与 --uninstall 同时使用。'
[ "$PURGE:$UNINSTALL" != 1:0 ] || fail '--purge 必须与 --uninstall 一起使用。'
for TOOL in uname dirname; do command -v "$TOOL" >/dev/null 2>&1 || fail "缺少基础工具 $TOOL，无法识别安装环境。"; done
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$(uname -s)" in Darwin) PLATFORM=darwin;; Linux) PLATFORM=linux;; *) fail '支持的系统：macOS 和 Linux。';; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; *) fail '支持的处理器：x64 和 ARM64。';; esac
VERSION=24.19.0
if [ -z "$DATA_ROOT" ]; then
 if [ "$PLATFORM" = darwin ]; then DATA_ROOT="$HOME/Library/Application Support/DesktopBridge"; else DATA_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/desktop-bridge"; fi
fi
LOCAL_RUNTIME="$DATA_ROOT/runtime/node-v$VERSION-$PLATFORM-$ARCH"
LOCAL_NODE="$LOCAL_RUNTIME/bin/node"
LOCAL_NPM="$LOCAL_RUNTIME/lib/node_modules/npm/bin/npm-cli.js"
if [ -x "$LOCAL_NODE" ] && [ -f "$LOCAL_NPM" ]; then
 if NODE_VERSION=$("$LOCAL_NODE" --version 2>/dev/null) && [ "$NODE_VERSION" = "v$VERSION" ] && NPM_VERSION=$("$LOCAL_NODE" "$LOCAL_NPM" --version 2>/dev/null) && [ -n "$NPM_VERSION" ]; then
  exec "$LOCAL_NODE" "$SOURCE/install.mjs" "$@"
 fi
fi
[ ! -e "$LOCAL_RUNTIME" ] || echo '私有 Node 或 npm 无法正常运行，将下载校验后的官方环境进行修复。' >&2
# Discover every required fallback before beginning a network request.
for TOOL in mktemp rm chmod; do command -v "$TOOL" >/dev/null 2>&1 || fail "缺少基础工具 $TOOL，无法创建和清理私有临时目录。"; done
PYTHON=''
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; assert sys.version_info >= (3, 8); import urllib.request, ssl, hashlib, tarfile' >/dev/null 2>&1; then PYTHON=python3; fi
if command -v curl >/dev/null 2>&1; then DOWNLOADER=curl
elif command -v wget >/dev/null 2>&1; then DOWNLOADER=wget
elif [ -n "$PYTHON" ]; then DOWNLOADER=python
else fail '缺少可用下载环境：需要 curl、wget 或 Python 3（含 HTTPS 标准库）。'; fi
if command -v sha256sum >/dev/null 2>&1; then HASHER=sha256sum
elif command -v shasum >/dev/null 2>&1; then HASHER=shasum
elif [ -n "$PYTHON" ]; then HASHER=python
else fail '缺少 SHA-256 校验环境：需要 sha256sum、shasum 或 Python 3。'; fi
if command -v tar >/dev/null 2>&1 && { [ "$PLATFORM" = darwin ] || command -v gzip >/dev/null 2>&1; }; then EXTRACTOR=tar
elif [ -n "$PYTHON" ]; then EXTRACTOR=python
else fail '缺少解压环境：需要 tar（Linux 同时需要 gzip）或 Python 3；尚未开始下载。'; fi
case "$PLATFORM-$ARCH" in
 darwin-x64) HASH=d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316;;
 darwin-arm64) HASH=8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d;;
 linux-x64) HASH=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4;;
 linux-arm64) HASH=d28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f;;
esac
# Bootstrap only in a private directory. install.mjs owns the durable installation.
TEMP=$(mktemp -d "${TMPDIR:-/tmp}/desktop-bridge.XXXXXXXX") || fail '无法创建私有临时目录，请检查临时目录的写入权限。'
trap 'rm -rf "$TEMP"' 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
chmod 700 "$TEMP" || fail '无法保护临时目录权限。'
FILE="node-v$VERSION-$PLATFORM-$ARCH.tar.gz"
URL="https://nodejs.org/dist/v$VERSION/$FILE"
echo '正在准备经过 SHA-256 校验的官方 Node 24.19.0 环境…' >&2
case "$DOWNLOADER" in
 curl) curl --fail --location --retry 2 --proto '=https' --proto-redir '=https' --tlsv1.2 "$URL" -o "$TEMP/runtime.tar.gz" || fail '官方环境下载失败，请检查网络、HTTPS 证书或代理设置。';;
 wget) wget --https-only "$URL" -O "$TEMP/runtime.tar.gz" || fail '官方环境下载失败，请检查网络、HTTPS 证书或代理设置。';;
 python) python3 - "$URL" "$TEMP/runtime.tar.gz" <<'PY' || fail '官方环境下载失败，请检查网络、HTTPS 证书或代理设置。'
import shutil, sys, urllib.parse, urllib.request
class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlparse(newurl).scheme != 'https':
            raise ValueError('Refusing a non-HTTPS redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)
with urllib.request.build_opener(HTTPSOnly()).open(sys.argv[1], timeout=30) as response, open(sys.argv[2], 'wb') as output:
    shutil.copyfileobj(response, output)
PY
 ;;
esac
case "$HASHER" in
 sha256sum) HASH_OUTPUT=$(sha256sum "$TEMP/runtime.tar.gz") || fail 'SHA-256 校验工具执行失败。'; ACTUAL=${HASH_OUTPUT%% *};;
 shasum) HASH_OUTPUT=$(shasum -a 256 "$TEMP/runtime.tar.gz") || fail 'SHA-256 校验工具执行失败。'; ACTUAL=${HASH_OUTPUT%% *};;
 python) ACTUAL=$(python3 - "$TEMP/runtime.tar.gz" <<'PY'
import hashlib, sys
value=hashlib.sha256()
with open(sys.argv[1], 'rb') as source:
    for block in iter(lambda: source.read(1024*1024), b''):
        value.update(block)
print(value.hexdigest())
PY
 ) || fail 'Python SHA-256 校验失败。';;
esac
[ "$ACTUAL" = "$HASH" ] || fail '官方 Node 环境校验失败（checksum mismatch），已拒绝执行。'
if [ "$EXTRACTOR" = tar ]; then tar -xzf "$TEMP/runtime.tar.gz" -C "$TEMP" || fail '官方环境解压失败，请检查磁盘空间。'
else python3 - "$TEMP/runtime.tar.gz" "$TEMP" <<'PY' || fail 'Python 安全解压失败，请检查压缩包和磁盘空间。'
import os, pathlib, sys, tarfile
root=os.path.realpath(sys.argv[2])
def inside(value):
    return os.path.commonpath((root, os.path.realpath(value))) == root
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive:
        parts=pathlib.PurePosixPath(member.name)
        target=os.path.join(root, member.name)
        if parts.is_absolute() or '..' in parts.parts or not inside(target):
            raise ValueError('Unsafe archive path')
        if member.issym() or member.islnk():
            link=os.path.join(os.path.dirname(target) if member.issym() else root, member.linkname)
            if os.path.isabs(member.linkname) or not inside(link):
                raise ValueError('Unsafe archive link')
        elif not (member.isfile() or member.isdir()):
            raise ValueError('Unsupported archive entry')
        archive.extract(member, root)
# Recheck links after extracting the complete graph; never execute an escaping link.
for directory, folders, files in os.walk(root, followlinks=False):
    for name in folders + files:
        if not inside(os.path.join(directory, name)):
            raise ValueError('Unsafe archive link graph')
PY
fi
BOOT_NODE="$TEMP/node-v$VERSION-$PLATFORM-$ARCH/bin/node"
BOOT_NPM="$TEMP/node-v$VERSION-$PLATFORM-$ARCH/lib/node_modules/npm/bin/npm-cli.js"
[ -x "$BOOT_NODE" ] && [ -f "$BOOT_NPM" ] || fail '官方环境不完整：缺少 Node 或 npm。'
NODE_VERSION=$("$BOOT_NODE" --version 2>/dev/null) && [ "$NODE_VERSION" = "v$VERSION" ] || fail '下载的 Node 无法运行或版本不匹配，请检查系统架构和执行权限。'
NPM_VERSION=$("$BOOT_NODE" "$BOOT_NPM" --version 2>/dev/null) && [ -n "$NPM_VERSION" ] || fail '下载环境中的 npm 无法运行，请重新下载。'
"$BOOT_NODE" "$SOURCE/install.mjs" "$@"
