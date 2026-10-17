#!/bin/sh
set -eu
# Installer runs this helper as root. Only launch the app as the console user;
# all network downloads, pairing and the actual agent run in that user's session.
USER_NAME=$(/usr/bin/stat -f '%Su' /dev/console)
case "$USER_NAME" in ''|root|loginwindow|_mbsetupuser)
 echo '请登录桌面后，从应用程序打开 Desktop Bridge Setup 完成连接。'
 exit 0;;
esac
USER_ID=$(/usr/bin/id -u "$USER_NAME")
if ! /bin/launchctl asuser "$USER_ID" /usr/bin/sudo -H -u "$USER_NAME" /usr/bin/open '/Applications/Desktop Bridge Setup.app'; then
 echo '请从应用程序打开 Desktop Bridge Setup 完成连接。'
fi
exit 0
