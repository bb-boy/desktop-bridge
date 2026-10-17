#!/bin/sh
# Shared macOS/Linux installer choice. Only the selected mode goes to stdout.
set -eu
PLATFORM=${1:-}
case "$PLATFORM" in
  darwin) SETTINGS="${HOME:?HOME is required}/Library/Application Support/DesktopBridge/client-settings.json" ;;
  linux) SETTINGS="${XDG_DATA_HOME:-${HOME:?HOME is required}/.local/share}/desktop-bridge/client-settings.json" ;;
  *) printf 'Unsupported installer platform: %s\n' "$PLATFORM" >&2; exit 2 ;;
esac

DEFAULT_MODE=manual
if [ -f "$SETTINGS" ]; then
  # This reads only the two known literal values; never evaluate settings as shell.
  PREVIOUS=$(sed -n 's/.*"mode"[[:space:]]*:[[:space:]]*"\(manual\|background\)".*/\1/p' "$SETTINGS") || PREVIOUS=''
  case "$PREVIOUS" in manual|background) DEFAULT_MODE="$PREVIOUS";; esac
fi

if [ "${DESKTOP_BRIDGE_INSTALL_MODE+x}" = x ]; then
  MODE="$DESKTOP_BRIDGE_INSTALL_MODE"
  case "$MODE" in manual|background) ;; *) printf 'DESKTOP_BRIDGE_INSTALL_MODE must be manual or background.\n' >&2; exit 2 ;; esac
elif [ -t 0 ] && [ -t 2 ]; then
  printf '\n请选择 Desktop Bridge 启动方式（不改变运行权限）：\n' >&2
  printf '  1) 手动启动：需要时启动，关闭窗口或按 Ctrl+C 停止；不设置开机自启。\n' >&2
  printf '  2) 后台运行：安装后启动，用户登录系统后自动连接。\n' >&2
  if [ "$DEFAULT_MODE" = background ]; then DEFAULT_NUMBER=2; else DEFAULT_NUMBER=1; fi
  while :; do
    printf '输入 1 或 2（回车保留默认 %s）：' "$DEFAULT_NUMBER" >&2
    if ! IFS= read -r ANSWER; then printf '\n未完成选择，安装已取消。\n' >&2; exit 2; fi
    case "$ANSWER" in
      '' ) MODE="$DEFAULT_MODE"; break ;;
      1|manual) MODE=manual; break ;;
      2|background) MODE=background; break ;;
      *) printf '请输入 1 或 2。\n' >&2 ;;
    esac
  done
else
  # CI and unattended installations must never unexpectedly start a service.
  MODE="$DEFAULT_MODE"
fi

printf '已选择启动方式：%s\n' "$MODE" >&2
printf '%s\n' "$MODE"
