---
name: setup
description: Set up Desktop Bridge after the user uploads or installs the plugin, signs in, or asks to install and connect a computer from GPT.
---

# Install and connect Desktop Bridge

Use this workflow for initial setup. The plugin already declares its remote MCP endpoint and OAuth. Never ask the user to paste an MCP URL, a device token, a password or a Google client secret.

1. If the connection is not authenticated, direct the user to the host's Connect action for Desktop Bridge. They sign in with Google and confirm the client's access. Keep all host and operating-system confirmation mechanisms.
2. When tools are connected, call `list_devices`. If the intended computer is already paired and `toolsAvailable` is true, report it ready and continue the user's task without reinstalling it. If several computers are present, use the one requested or ask which they intend.
3. For a new computer, determine the **target computer's** OS from the user's request or ask one short question. Give the corresponding clickable download below, labelled “下载 Mac 安装器”, “下载 Windows 安装器” or “下载 Linux 安装器”. If the OS is unknown, provide all three choices instead of making the user type commands.

- macOS: https://mcp.ilovestudy.de/downloads/DesktopBridge-macOS.pkg
- Windows: https://mcp.ilovestudy.de/downloads/DesktopBridge-Windows.cmd
- Linux: https://mcp.ilovestudy.de/downloads/DesktopBridge-Linux.sh

4. For Mac, say: “下载后双击安装包，按系统提示安装。安装器会打开一个进度窗口，并引导你登录、确认绑定。无需解压或输入命令。” The PKG installs Desktop Bridge Setup in Applications and starts it in the logged-in user's session. Its progress window is Terminal; all commands are supplied by the installer. If no window opens, ask the user to open Desktop Bridge Setup from Applications.
5. For Windows, say: “下载后双击安装文件，按系统提示确认。安装器会自动准备环境并打开配对页面，无需解压或输入命令。” The standalone CMD extracts its embedded payload in a private temporary directory, then runs the existing installer as the current user.
6. For Linux, desktop file-manager executable handling varies. Say the download is a self-contained shell installer, not a universal graphical installer. Offer desktop “Run in Terminal” if the user's environment supports it. Provide a command only if requested or if their desktop cannot run shell files; never promise that every Linux desktop can double-click it.
7. Explain only what the user needs next: the installer downloads and checks Node.js and Desktop Commander automatically; the browser asks them to sign in to the **same Desktop Bridge account as the GPT connection**, confirm the displayed computer, then return to GPT. No manual token copying or manual environment installation is needed. This entry selects normal-user background mode with login startup; it does not request a root/SYSTEM agent. Full administrator mode remains a separate explicit option.
8. Once the user reports completion, call `list_devices` again. Confirm success only when the intended computer appears and `toolsAvailable` is true. If it is absent or unavailable, report the actual state and request the relevant installer error, without repeating side effects. A paired offline device needs its existing client started, not an automatic reinstall.

Do not claim upload by itself starts a local installer. The user must download and open the native installer on the target computer. Do not execute this installer in a GPT cloud sandbox as a substitute. Do not poll indefinitely while the user installs.

These downloads are currently unsigned; the Mac PKG is not notarized. State this when the system blocks or questions the download, and preserve security prompts. Do not disable Gatekeeper, SmartScreen, quarantine or privacy controls. A signed/notarized production build is still pending.
