#!/bin/sh
# One explicit startup choice per interactive macOS/Linux installation.
# Stdout contains only manual or background, so the caller can capture it.
set -eu
PLATFORM=${1:-}
case "$PLATFORM" in
  darwin|linux) ;;
  *) printf 'Unsupported installer platform: %s\n' "$PLATFORM" >&2; exit 2 ;;
esac

if [ "${DESKTOP_BRIDGE_INSTALL_MODE+x}" = x ]; then
  MODE="$DESKTOP_BRIDGE_INSTALL_MODE"
  case "$MODE" in
    manual|background) ;;
    *) printf 'DESKTOP_BRIDGE_INSTALL_MODE must be manual or background.\n' >&2; exit 2 ;;
  esac
elif [ -t 0 ] && [ -t 2 ]; then
  printf '\n请选择 Desktop Bridge 启动方式：\n' >&2
  printf '  1) 手动启动：需要时启动，Ctrl+C 或关闭窗口停止；不设置登录自启。\n' >&2
  printf '  2) 后台运行：现在启动，用户登录系统后自动连接。\n' >&2
  while :; do
    printf '请输入 1 或 2（必须选择，回车不代表默认选项）：' >&2
    if ! IFS= read -r ANSWER; then
      printf '\n未选择启动方式，安装已取消。\n' >&2
      exit 2
    fi
    case "$ANSWER" in
      1|manual) MODE=manual; break ;;
      2|background) MODE=background; break ;;
      *) printf '请选择 1（手动）或 2（后台）。\n' >&2 ;;
    esac
  done
else
  printf '非交互安装必须设置 DESKTOP_BRIDGE_INSTALL_MODE=manual 或 background。\n' >&2
  exit 2
fi

printf '已选择启动方式：%s\n' "$MODE" >&2
printf '%s\n' "$MODE"
