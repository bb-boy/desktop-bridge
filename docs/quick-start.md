# 在 GPT 中安装并连接电脑

## 1. 上传插件并登录

在 ChatGPT「插件」页点击「添加 → 上传插件压缩包」，直接上传 `desktop-bridge-plugin.zip`，不用解压。连接 Desktop Bridge，使用 Google 登录并确认客户端授权。

插件 0.2.2 提供首次设置引导。宿主支持时，运行插件的设置流程；也可以直接在对话里说「帮我安装并连接这台 Mac / Windows / Linux 电脑」。引导先检查已绑定设备；可用设备直接使用，不要求重新安装。

## 2. 下载并打开一个安装器

GPT 会给出对应系统的下载链接，管理页登录前后也有「安装并连接」入口：

| 电脑 | 下载 | 打开方式 |
| --- | --- | --- |
| Mac x64 / ARM64 | [Mac 安装器](https://mcp.ilovestudy.de/downloads/DesktopBridge-macOS.pkg) | 双击 PKG，按系统提示安装；随后自动打开进度窗口 |
| Windows x64 / ARM64 | [Windows 安装器](https://mcp.ilovestudy.de/downloads/DesktopBridge-Windows.cmd) | 双击 CMD，按系统提示确认后自动运行 |
| Linux x64 / ARM64 | [Linux 安装器](https://mcp.ilovestudy.de/downloads/DesktopBridge-Linux.sh) | 自解包脚本；桌面支持时选择「在终端中运行」，否则通过 shell 运行 |

Mac 和 Windows 的独立入口不需要用户解压 ZIP、安装 Node.js 或输入安装命令。Linux 文件管理器对脚本的运行方式不同，不能保证所有桌面都能双击执行。

这些入口自动选择**普通用户后台模式**：现在后台运行，用户登录操作系统后自启；不是管理员系统服务。Mac PKG 的系统安装步骤只安装应用程序中的启动器，真正的环境下载、工具安装、配对与 Agent 在已登录用户的会话中运行。

安装器会自动识别处理器、下载并校验官方 Node.js，安装固定版本的 Desktop Commander 和依赖，再打开配对网页。已有私有运行环境会复用；依赖损坏时按原安装器流程修复。

## 3. 登录并确认绑定

在配对网页登录与 GPT 插件连接时**同一个 Desktop Bridge 账号**，核对电脑名称后确认绑定。然后回到 GPT，说「已安装，检查我的电脑」。GPT 查询设备，只有 `toolsAvailable` 为真才报告可用。

原账号已有设备时，应先登录原账号，再显式绑定 Google。新 Google 用户会获得独立空间，不能自动看到原 `owner` 的设备。

上传 ZIP 不会在浏览器背后启动电脑程序；第一次仍需本人下载并打开一次安装器。Google 登录、客户端授权、系统安全与隐私确认均保留。

## 当前验证范围

- 原有客户端环境、配对和运行流程继续由协议、进程和安装器测试覆盖。
- 独立安装器新增自解包、校验失败拒绝执行、失败退出码与临时文件清理测试；Mac 应用目录、执行位与真实 PKG 内容可检查，不需要安装到开发电脑。
- PKG 与 Windows CMD 当前**未签名**，PKG **未公证**。系统可能阻止打开，不能承诺默认安全策略下只需一次确认。正式对外发行仍需 Developer ID 签名、公证及 Windows 发布签名；不通过禁用系统防护解决。
- ChatGPT 账号中的上传验收、首次设置的实际触发，以及完整的原生图形安装与真实 Google 账号登录，仍需由使用者完成验收。生成包和接口测试不代表这些步骤已完成。

## 构建全部下载

在 Mac 上运行：

```sh
python3 bridge/scripts/package-downloads.py --output release-output/downloads
python3 bridge/test/installers_test.py
npm test --prefix bridge
```

构建会生成同一份 GPT 通用 ZIP、Mac PKG、Windows CMD、Linux 自解包脚本、`downloads.json` 和 `SHA256SUMS`。其他系统可以添加 `--skip-macos` 构建其余文件，不能假装生成 PKG。只发布构建清单内的文件，不发布配置、设备凭据和数据库。
