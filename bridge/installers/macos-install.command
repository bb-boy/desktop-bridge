#!/bin/sh
set -u
if [ "$(/usr/bin/id -u)" -eq 0 ]; then printf "请在已登录的桌面账号下打开安装器。\n" >&2; exit 1; fi
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '\nDesktop Bridge · 安装并连接\n\n'
printf '正在准备环境。随后会打开网页登录，请确认绑定这台电脑。\n\n'
RESULT=0
/bin/sh "$SOURCE/payload/Install.sh" --mode background || RESULT=$?
if [ "$RESULT" -eq 0 ]; then
 printf '\n连接设置完成。请返回 GPT，告诉它“已安装，检查我的电脑”。\n'
else
 printf '\n安装未完成，请保留上方错误信息后重试。\n' >&2
fi
if [ -t 0 ]; then printf '\n按回车关闭此窗口。'; read -r REPLY || :; fi
exit "$RESULT"
