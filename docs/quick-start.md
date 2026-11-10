# 在 GPT 中安装并连接电脑

对外统一入口：https://mcp.ilovestudy.de/start.html 。建议按照「连接 ChatGPT → 安装电脑端 → 绑定电脑 → 开始使用」四步完成。Desktop Commander 提供文件、终端等工具；Cua Driver 是显式启用的可选图形桌面控制组件。每个使用者使用自己的账号授权并绑定电脑。

## 1. 手动添加 MCP 服务器并授权

在 ChatGPT 网页端「插件」页点击「添加 → 添加自定义 MCP 服务器」，填写：

- 名称：`Desktop Bridge`
- 服务器地址：`https://mcp.ilovestudy.de/mcp`
- 认证：**OAuth**

创建连接后，使用 Google 登录并确认授权。若没有添加入口，请检查账号或工作空间是否允许创建自定义 MCP 连接。

授权完成后继续安装电脑端客户端。已有可用设备可以直接使用，无需重新安装。

## 2. 两种安装方式任选其一：图形安装器或 npm

两种教程同时列在 [新手指引](https://mcp.ilovestudy.de/start.html#installation-options)，只需选择其中一种安装客户端。图形安装器默认提供 Desktop Bridge + Desktop Commander；需要 Cua Driver 的新用户可选择 npm 的 `--with-cua` 安装。

### 图形安装器：下载并打开对应系统的安装器

开始使用页和登录后的设备管理页提供对应系统的下载链接：

| 电脑 | 下载 | 打开方式 |
| --- | --- | --- |
| Mac x64 / ARM64 | [Mac 安装器](https://mcp.ilovestudy.de/downloads/DesktopBridge-macOS.pkg) | 双击 PKG，按系统提示安装；随后自动打开进度窗口 |
| Windows x64 / ARM64 | [Windows 安装器](https://mcp.ilovestudy.de/downloads/DesktopBridge-Windows.cmd) | 双击 CMD，在终端选择手动运行或登录后后台自启 |
| Linux x64 / ARM64 | [Linux 安装器](https://mcp.ilovestudy.de/downloads/DesktopBridge-Linux.sh) | 自解包脚本；桌面支持时选择「在终端中运行」，否则通过 shell 运行 |

Mac 和 Windows 的独立入口不需要用户解压 ZIP、安装 Node.js 或输入安装命令。Linux 文件管理器对脚本的运行方式不同，不能保证所有桌面都能双击执行。

**Windows** 安装器会明确询问运行模式：`1` 手动启动（安装后不运行、不设置登录自启，需使用 `Start.cmd` 启动和 `Stop.cmd` 停止）；`2` 普通用户后台模式（现在运行，登录 Windows 后自启）。无论首次安装还是重新安装，都必须明确输入 `1` 或 `2`，直接回车不会替用户选择。此选择不会删除设备配对，也不影响使用同一 Google 账号绑定。用于自动化部署时可设置环境变量 `DESKTOP_BRIDGE_INSTALL_MODE=manual` 或 `background` 以跳过交互。已安装设备可以通过 `control.mjs mode manual|background` 切换模式，无需重新配对。

安装成功后，Windows 安装器会在终端列出 `Start.cmd`（启动）、`Stop.cmd`（停止）、`control.ps1 -Action status`（查看状态）和 `START-HERE.txt`（完整说明）的实际路径；交互式安装会停留在结果页，等待用户按键关闭，避免一闪而过。用户以后也可以在 `%LOCALAPPDATA%\\DesktopBridgeClient\\START-HERE.txt` 找到模式切换命令和操作说明。

**macOS、Linux** 安装器和 Windows 一样会在交互式终端提供 `1` 手动模式与 `2` 后台自启模式，首次安装和重新安装都要求用户明确选择，不默认手动或后台模式。Mac PKG 会打开终端显示选择，Linux 安装器需要通过终端执行才能交互；非交互式安装必须显式设置 `DESKTOP_BRIDGE_INSTALL_MODE=manual` 或 `background`；未指定就中止，不会擅自启用或改变后台服务。安装完成会列出启动、停止、状态、重新配对和使用说明路径。两者都仅以普通用户权限安装，不会请求管理员授权或创建管理员服务。Mac PKG 的系统安装步骤只安装应用程序中的启动器，真正的环境下载、工具安装、配对与 Agent 在已登录用户的会话中运行。

**运行权限与启动方式是两个独立概念：** 普通安装器只提供启动方式的选择，不提供管理员模式选项。系统本身的安装确认（例如 macOS PKG 授权）不代表客户端会以管理员权限长期运行。受保护系统服务的专用管理员部署入口保持独立，不通过普通安装器自动启用。

安装器会自动识别处理器、下载并校验官方 Node.js，安装固定版本的 Desktop Commander 和依赖，再打开配对网页。已有私有运行环境会复用；依赖损坏时按原安装器流程修复。**当前图形安装器不会自动启用 Cua Driver**；已经通过图形安装的用户，若后续需要 CUA，可安装 npm CLI 后运行 `desktop-bridge update --with-cua`，不必重新绑定。

### npm 命令行：已有 Node.js 24 的用户

```sh
npm install -g @justlovepl/desktop-bridge
desktop-bridge setup --with-cua
desktop-bridge status
```

**macOS / zsh：安装成功后提示 `command not found`**。先运行 `export PATH="$(npm prefix -g)/bin:$PATH"`、`rehash`、`desktop-bridge --version` 临时验证；成功后通过 `echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.zshrc` 和 `source ~/.zshrc` 持久化。如果仍失败，请检查 `npm prefix -g`、`npm root -g`、`ls -l "$(npm prefix -g)/bin/desktop-bridge"` 是否有安装链接。

本教程按 Desktop Bridge npm CLI **v0.2.9** 编写。`setup --with-cua` 会在完成 Desktop Bridge 和 Desktop Commander 安装时额外安装、校验并启用 Cua Driver 0.38.0；普通 `setup` 则不主动开启 CUA。`setup` 默认选择自动后台模式。首次连接仍需本人在网页确认配对；同一系统用户之前用原生安装器装好的客户端可继续使用原安装目录与设备配对。Windows 后台运行由当前用户的计划任务管理，退出终端或断开 SSH 后继续运行，登录 Windows 后自动启动。普通后台模式需要该用户已登录，不代表未登录时运行的管理员系统服务。

日常使用 `desktop-bridge start`、`stop`、`restart`、`status`；升级使用 `desktop-bridge update`。已经绑定、现在要启用 Cua Driver 时，在本地终端运行 `desktop-bridge update --with-cua`（若原先仅使用图形安装器，先执行 `npm install -g @justlovepl/desktop-bridge`）。仅运行 `npm update -g` 会更新命令行工具，升级正在使用的 Agent 应运行 `desktop-bridge update`。更新保留原配对、任务记录与已选模式。不要通过 Desktop Bridge 自身的远程终端执行自我升级。

需要手动运行时使用 `desktop-bridge mode manual`，再执行 `desktop-bridge start` 并保持窗口；恢复自动后台使用 `desktop-bridge mode background`。npm 只安装命令行入口，首次启用客户端需要显式执行 `setup`。

## 3. 登录并确认绑定

在配对网页登录与 MCP 授权时使用**同一个 Desktop Bridge 账号**，在 10 分钟内核对电脑名称并确认绑定。保持安装窗口打开，直到显示安装和配对完成。只有 `toolsAvailable` 为真才表示设备可执行任务。启用 Cua Driver 后，macOS 可能需要在系统设置中单独允许屏幕录制、辅助功能；Windows UAC 仍须在本机确认。系统授权与 ChatGPT 的确认不会被安装器跳过。

## 4. 回到 ChatGPT 开始使用

在 ChatGPT 网页端新对话中输入 `@`，选择 Desktop Bridge 连接，先说「列出我的电脑，并检查在线与工具状态」，再说「在桌面创建一个测试文件」。测试文件成功出现在电脑桌面说明远程文件操作正常。启用了 CUA 且本机权限允许时，可继续测试「显示我当前电脑的桌面截图」。

原账号已有设备时，应先登录原账号，再显式绑定 Google。新 Google 用户会获得独立空间，不能自动看到原 `owner` 的设备。

首次需本人下载并打开一次电脑端安装器。Google 登录、客户端授权、系统安全与隐私确认均保留。

## 设备解绑后的提醒与重新配对

在网页设备管理中点击「解绑」后，服务器立即撤销旧设备 Token（包括待轮换 Token）并断开连接。前端不再展示已撤销设备；本地客户端仍提示需要重新配对。

- **Windows 普通用户模式、Agent 在线：** Agent 收到撤销通知后清除 `agent-config.json` 中的 `deviceId` 与 `deviceToken`，写入 `auth-status.json`（非敏感状态），尝试显示一次 Windows 提醒，可选择立即重新配对或稍后处理。关闭提醒后状态不会丢失。
- **设备离线或程序未运行：** 旧 Token 在服务器上立即失效，但本地无法即时获知；下一次启动并连接服务器确认撤销后清除旧凭据。普通网络故障、设备暂停不会删除凭据。
- **手动模式：** 不额外安装后台通知服务。打开 `Start.cmd` 会显示「需要重新配对」并停留提示；运行 `control.ps1 -Action status` 会返回 `authStatus: re_pair_required` 以及 `RePair.cmd` 路径。
- **重新配对：** 在已安装的 Windows 客户端目录双击 `RePair.cmd`（一般位于 `%LOCALAPPDATA%\DesktopBridgeClient\RePair.cmd`）；程序会打开网页登录确认新的配对申请。获得新 Token 后清除提醒状态。原为后台模式则自动恢复后台连接；原为手动模式则保持手动，需要再运行 `Start.cmd`。
- **管理员 SYSTEM 服务：** 服务会清除自己的受保护配置，但不能依赖 Windows 桌面消息框显示通知；管理员服务的重新配对必须通过重新授权的管理员安装流程，普通用户 `RePair.cmd` 不修改受保护凭据。

注意：离线电脑无法被云端直接清除磁盘文件；服务端授权撤销立即生效。本地清除的是活动配置，不承诺安全擦除历史备份。Windows 提醒仅在具备交互式桌面会话的情况下才能显示；如果系统阻止弹窗，用户仍能通过状态命令和网页查看撤销提示。

## 0.2.6 仪表盘统计说明

设备概览现在分开显示「已绑定设备」「可用设备」「可调用工具」「等待结果」：以前网页将 `devices.filter(x => x.toolsAvailable).length`（健康设备数量）错误标成了「工具可用」。现由已登录账号的服务端返回 `readyDevices` 与 `toolCount` 两个数字。`toolCount` 根据正常在线设备与账号可见的 MCP 工具目录计算：一台标准 Desktop Bridge 设备健康时可调用 **31 个标准工具**，额外注册的设备工具也会增加数量；如果没有可执行远程调用的健康设备则为 **0**。这不是 MCP 已声明工具个数随时通知 ChatGPT 的机制；刷新 ChatGPT 插件工具目录仍遵循现有规则。

## 当前验证范围

- 原有客户端环境、配对和运行流程继续由协议、进程和安装器测试覆盖。
- 独立安装器新增自解包、校验失败拒绝执行、失败退出码与临时文件清理测试；Mac 应用目录、执行位与真实 PKG 内容可检查，不需要安装到开发电脑。
- PKG 与 Windows CMD 当前**未签名**，PKG **未公证**。系统可能阻止打开，不能承诺默认安全策略下只需一次确认。正式对外发行仍需 Developer ID 签名、公证及 Windows 发布签名；不通过禁用系统防护解决。
- Windows 安装锁权限修复已在 p111 上验证，完成实际安装、用户确认配对和联网检查；这不代表所有操作系统的图形安装都已验收。
- 提供者于 2026-10-17 确认 Google 登录应用面向外部用户并已设为生产环境；此为提供者确认，未通过 Google Cloud 控制台独立核验。

## 构建全部下载

在 Mac 上运行：

```sh
python3 bridge/scripts/package-downloads.py --output release-output/downloads
python3 bridge/test/installers_test.py
npm test --prefix bridge
```

构建会生成同一份 GPT 通用 ZIP、Mac PKG、Windows CMD、Linux 自解包脚本、`downloads.json` 和 `SHA256SUMS`。其他系统可以添加 `--skip-macos` 构建其余文件，不能假装生成 PKG。只发布构建清单内的文件，不发布配置、设备凭据和数据库。
