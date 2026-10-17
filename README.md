# Desktop Bridge

通过远程 MCP 连接 Windows、macOS 和 Linux。基于 [Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP) 的本地工具引擎，增加自托管中继、Google 身份隔离、账号配对、设备管理和断线任务恢复。

这是独立的私有开发仓库，保留上游完整源码和历史。上游发布命名空间不用于本项目发行；根包保持 `private: true`。

## 功能

- 使用 Google OAuth / OpenID Connect 识别用户，每个经验证的 Google 账号对应独立空间；原有本地账号可显式绑定 Google，不按同邮箱自动合并。
- 安装器自动识别系统和 x64/ARM64，下载并校验官方运行时，准备本地依赖，然后网页确认或输入配对码。设备密钥自动保存。
- 设备重命名、暂停/恢复、解绑、密钥轮换、客户端版本与最后在线时间；客户端授权可查看及撤销。
- 区分网络连通和本地工具可执行。暂停、解绑或健康探测失败时，不向设备分发新命令。
- 持久化任务编号、状态和结果；支持超时后的晚到结果、断线补交、中继重启后补领，绝不因重连自动重放原操作。
- 工具目录、设备、授权和任务均按账号隔离。MCP 客户端通过独立 OAuth/PKCE 关联到用户账号。

## 分发给其他人

把公开入口 https://mcp.ilovestudy.de/start.html 发给使用者即可。该页无需登录，提供手动 MCP 配置说明、各系统安装器及设备绑定步骤。每个人在自己的 ChatGPT 中添加服务器，使用自己的 Google 账号完成 OAuth 授权，再在自己的电脑上安装并确认绑定。当前为测试分发版，原生安装器尚未签名。

## 在 ChatGPT 配置连接

在 ChatGPT「插件」页选择「添加 → 添加自定义 MCP 服务器」，名称填写 `Desktop Bridge`，服务器地址填写 `https://mcp.ilovestudy.de/mcp`，认证选择 **OAuth**。创建后使用 Google 登录并确认授权。在对话中选择这个连接并说「列出我的电脑」，即可检查账号下的设备。

新电脑使用无需解压的独立安装器：[Mac PKG](https://mcp.ilovestudy.de/downloads/DesktopBridge-macOS.pkg)、[Windows CMD](https://mcp.ilovestudy.de/downloads/DesktopBridge-Windows.cmd)、[Linux 自解包脚本](https://mcp.ilovestudy.de/downloads/DesktopBridge-Linux.sh)。下载后打开，安装器自动准备环境、选择普通用户后台模式，并打开网页登录确认绑定。Mac / Windows 无需输入命令；Linux 的打开方式取决于桌面环境。详见 [首次连接指南](docs/quick-start.md)。

当前独立安装器尚未签名，Mac PKG 尚未公证，系统可能阻止打开。

源码打包保留以下跨平台客户端入口，供开发和高级使用；网页用户使用上面的独立安装器：

| 系统 | 入口 |
| --- | --- |
| Windows x64 / ARM64 | `Install.cmd` |
| macOS x64 / ARM64 | `Install.command` |
| Linux x64 / ARM64 | `Install.sh` |

首次还需在配对页面使用与 MCP 授权相同的账号确认绑定；配对码有效期 10 分钟。设备密钥由客户端自动保存。普通模式下客户端运行于安装它的系统账号权限下；还可主动选择手动提权或管理员后台系统服务，详见下文。

Google 身份服务需先配置自己的 Google OAuth 网页客户端，见 [配置 Google 登录](docs/google-oauth.md)。插件 ZIP 不包含 Google 客户端密钥、用户密码、设备令牌、数据库或安装后的依赖。

## npm 安装与后台管理 · 客户端 0.2.7

已有 Node.js 24 时，可通过 npm 安装并管理客户端：

```sh
npm install -g @justlovepl/desktop-bridge
desktop-bridge setup
desktop-bridge status
```

`setup` 默认自动后台；使用 `desktop-bridge mode manual` 切换手动模式，`mode background` 恢复后台。`start`、`stop`、`restart` 管理进程，`update` 同时升级 npm 命令行与本地 Agent，并保留配对、任务记录和已选模式。Windows 后台模式通过当前用户的计划任务运行，关闭终端或断开 SSH 后继续运行，登录后自启。首次配对仍需本人网页登录确认。完整命令及原生安装迁移说明见 [npm 客户端说明](npm-installer/README.md)。

## 0.2.1 · 启动模式与管理员授权

安装器提供 **手动** 和 **后台** 两种模式；默认不获取系统管理员权限。需要管理受保护的系统位置时，可显式选择管理员模式（一次性启动授权 / 安装时授权的受保护系统服务）。

| 安装方式 | 命令（macOS / Linux） | 权限 |
| --- | --- | --- |
| 普通手动 | `./Install.sh --mode manual` | 当前用户 |
| 管理员手动 | `./Install.sh --mode manual --administrator` | 每次启动由系统确认 |
| 管理员后台 | `./Install.sh --mode background --administrator` | 安装/更新时授权系统服务 |

Windows 使用同名 `Install.cmd` 参数。macOS 通过 launchd、Linux 通过 systemd、Windows 通过计划任务管理管理员后台进程，程序文件位于受保护目录，用户不能直接替换高权限程序。**管理员权限不取代 Google、ChatGPT 确认或 macOS 隐私授权。** 高权限运行意味着所有获得授权的本地工具都可能拥有系统级访问能力，应优先考虑普通模式。详细操作、停用、卸载与权限边界请阅读 [管理员运行指南](docs/admin-runtime.md)。

## 管理页面

管理页面采用 [NES.css](https://github.com/nostalgic-css/NES.css) 2.3.0 复古 8-bit 像素风格，使用其输入框、按钮和容器组件。CSS 已本地打包在 `bridge/public/vendor/nes.css/`，不依赖第三方 CDN，遵循 MIT 许可并随仓库保留原许可。保留 Google OAuth、设备管理、配对及任务等现有 API 和业务逻辑，兼容桌面与手机宽度。**未配置 Google OAuth 的测试环境会显示禁用按钮，配置正确的正式环境仍能使用 Google 登录**。Git 推送并不自动部署新版管理页。

## 开发与打包

使用 Node.js 24，在仓库根目录执行：

```sh
npm ci --prefix bridge --ignore-scripts
npm test --prefix bridge
python3 bridge/scripts/package-plugin.py --output release-output/desktop-bridge-plugin.zip
```

模块分支使用独立 worktree 并发开发：[模块与协作](docs/modules.md)。测试覆盖 API、真实 MCP/WSS、实际代理进程和客户端生命周期，不使用浏览器测试。实际验证范围见 [验证记录](bridge/VALIDATION.md)，服务运行、迁移与保留期限见 [扩展说明](bridge/README.md)。

`.github/workflow-templates/bridge.yml` 提供 Windows、macOS、Linux 非浏览器测试及通用 ZIP 构建模板。当前 GitHub 授权没有工作流写权限，模板尚未启用，不声称远端 CI 已运行。Git 推送和 ZIP 生成不会自动部署自托管服务。

## 源码布局

| 路径 | 内容 |
| --- | --- |
| `bridge/server/` | 中继、OAuth/Google 身份、会话、配对、归属和结果持久化 |
| `bridge/agent/` | 电脑端配对、MCP 执行、健康检查、日志及结果恢复 |
| `bridge/client/` | 通用安装源、官方运行时校验清单、启动/修复/卸载 |
| `bridge/public/` | 登录、设备、任务结果和授权管理 |
| `bridge/test/` | 非浏览器协议及进程验收 |
| `plugin/` | 同一通用插件的 portable manifest、MCP 和技能说明 |
| `src/`、`test/`、`vendor/` | 保留的 Desktop Commander 上游源码与测试 |
| `README.upstream.md` | 上游原始 README |

客户端目前固定使用官方 npm 工具引擎 `@wonderwhy-er/desktop-commander@0.3.0`。根目录源码的修改不会自动进入已安装客户端；更换引擎需要明确构建、固定版本并重新验收。

## 来源

上游与历史导入记录见 `docs/import/`。本地可增加 `upstream` remote 用于后续合并上游；不要覆盖扩展模块。原项目和本扩展采用 MIT 许可，版权与第三方声明保留于 `LICENSE`、`bridge/LICENSE` 与 `bridge/THIRD_PARTY_NOTICES.md`。本服务与官方托管服务无隶属关系。
