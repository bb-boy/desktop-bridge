# 在 GPT 中安装并连接电脑

对外统一入口：https://mcp.ilovestudy.de/start.html 。每个使用者在自己的 ChatGPT 中手动添加 MCP 服务器，使用自己的 Google 账号授权并绑定电脑。

## 1. 手动添加 MCP 服务器并授权

在 ChatGPT「插件」页点击「添加 → 添加自定义 MCP 服务器」，填写：

- 名称：`Desktop Bridge`
- 服务器地址：`https://mcp.ilovestudy.de/mcp`
- 认证：**OAuth**

创建连接后，使用 Google 登录并确认授权。若没有添加入口，请检查账号或工作空间是否允许创建自定义 MCP 连接。

授权完成后继续安装电脑端客户端。已有可用设备可以直接使用，无需重新安装。

## 2. 下载并打开一个安装器

开始使用页和登录后的设备管理页提供对应系统的下载链接：

| 电脑 | 下载 | 打开方式 |
| --- | --- | --- |
| Mac x64 / ARM64 | [Mac 安装器](https://mcp.ilovestudy.de/downloads/DesktopBridge-macOS.pkg) | 双击 PKG，按系统提示安装；随后自动打开进度窗口 |
| Windows x64 / ARM64 | [Windows 安装器](https://mcp.ilovestudy.de/downloads/DesktopBridge-Windows.cmd) | 双击 CMD，在终端选择手动运行或登录后后台自启 |
| Linux x64 / ARM64 | [Linux 安装器](https://mcp.ilovestudy.de/downloads/DesktopBridge-Linux.sh) | 自解包脚本；桌面支持时选择「在终端中运行」，否则通过 shell 运行 |

Mac 和 Windows 的独立入口不需要用户解压 ZIP、安装 Node.js 或输入安装命令。Linux 文件管理器对脚本的运行方式不同，不能保证所有桌面都能双击执行。

**Windows** 安装器会明确询问运行模式：`1` 手动启动（安装后不运行、不设置登录自启，需使用 `Start.cmd` 启动和 `Stop.cmd` 停止）；`2` 普通用户后台模式（现在运行，登录 Windows 后自启）。新安装默认选择手动模式；重新安装会以原有模式作为回车默认选项。此选择不会删除设备配对，也不影响使用同一 Google 账号绑定。用于自动化部署时可设置环境变量 `DESKTOP_BRIDGE_INSTALL_MODE=manual` 或 `background` 以跳过交互。已安装设备可以通过 `control.mjs mode manual|background` 切换模式，无需重新配对。

安装成功后，Windows 安装器会在终端列出 `Start.cmd`（启动）、`Stop.cmd`（停止）、`control.ps1 -Action status`（查看状态）和 `START-HERE.txt`（完整说明）的实际路径；交互式安装会停留在结果页，等待用户按键关闭，避免一闪而过。用户以后也可以在 `%LOCALAPPDATA%\\DesktopBridgeClient\\START-HERE.txt` 找到模式切换命令和操作说明。

**macOS、Linux** 独立入口目前仍自动选择普通用户后台模式：现在后台运行，用户登录操作系统后自启；不是管理员系统服务。Mac PKG 的系统安装步骤只安装应用程序中的启动器，真正的环境下载、工具安装、配对与 Agent 在已登录用户的会话中运行。

安装器会自动识别处理器、下载并校验官方 Node.js，安装固定版本的 Desktop Commander 和依赖，再打开配对网页。已有私有运行环境会复用；依赖损坏时按原安装器流程修复。

## 3. 登录并确认绑定

在配对网页登录与 MCP 授权时**同一个 Desktop Bridge 账号**，在 10 分钟内核对电脑名称并确认绑定。保持安装窗口打开，直到显示安装和配对完成。然后回到 ChatGPT，在新对话中选择刚创建的连接，说「列出我的电脑，检查它是否可用」。只有 `toolsAvailable` 为真才表示设备可执行任务。

原账号已有设备时，应先登录原账号，再显式绑定 Google。新 Google 用户会获得独立空间，不能自动看到原 `owner` 的设备。

首次需本人下载并打开一次电脑端安装器。Google 登录、客户端授权、系统安全与隐私确认均保留。

## 设备解绑后的提醒与重新配对

在网页设备管理中点击「解绑」后，服务器立即撤销旧设备 Token（包括待轮换 Token），断开连接，原设备出现在「已撤销授权的设备」中，登录该账号后仍可查看撤销记录与重新配对说明。

- **Windows 普通用户模式、Agent 在线：** Agent 收到撤销通知后清除 `agent-config.json` 中的 `deviceId` 与 `deviceToken`，写入 `auth-status.json`（非敏感状态），尝试显示一次 Windows 提醒，可选择立即重新配对或稍后处理。关闭提醒后状态不会丢失。
- **设备离线或程序未运行：** 旧 Token 在服务器上立即失效，但本地无法即时获知；下一次启动并连接服务器确认撤销后清除旧凭据。普通网络故障、设备暂停不会删除凭据。
- **手动模式：** 不额外安装后台通知服务。打开 `Start.cmd` 会显示「需要重新配对」并停留提示；运行 `control.ps1 -Action status` 会返回 `authStatus: re_pair_required` 以及 `RePair.cmd` 路径。
- **重新配对：** 在已安装的 Windows 客户端目录双击 `RePair.cmd`（一般位于 `%LOCALAPPDATA%\DesktopBridgeClient\RePair.cmd`）；程序会打开网页登录确认新的配对申请。获得新 Token 后清除提醒状态。原为后台模式则自动恢复后台连接；原为手动模式则保持手动，需要再运行 `Start.cmd`。
- **管理员 SYSTEM 服务：** 服务会清除自己的受保护配置，但不能依赖 Windows 桌面消息框显示通知；管理员服务的重新配对必须通过重新授权的管理员安装流程，普通用户 `RePair.cmd` 不修改受保护凭据。

注意：离线电脑无法被云端直接清除磁盘文件；服务端授权撤销立即生效。本地清除的是活动配置，不承诺安全擦除历史备份。Windows 提醒仅在具备交互式桌面会话的情况下才能显示；如果系统阻止弹窗，用户仍能通过状态命令和网页查看撤销提示。

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
