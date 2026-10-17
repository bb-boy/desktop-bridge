# Desktop Bridge

一份通用插件 ZIP，连接 Windows、macOS 和 Linux。基于 [Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP) 的本地工具引擎，增加自托管中继、Google 身份隔离、账号配对、设备管理和断线任务恢复。

这是独立的私有开发仓库，保留上游完整源码和历史。上游发布命名空间不用于本项目发行；根包保持 `private: true`。

## 功能

- 使用 Google OAuth / OpenID Connect 识别用户，每个经验证的 Google 账号对应独立空间；原有本地账号可显式绑定 Google，不按同邮箱自动合并。
- 安装器自动识别系统和 x64/ARM64，下载并校验官方运行时，准备本地依赖，然后网页确认或输入配对码。设备密钥自动保存。
- 设备重命名、暂停/恢复、解绑、密钥轮换、客户端版本与最后在线时间；客户端授权可查看及撤销。
- 区分网络连通和本地工具可执行。暂停、解绑或健康探测失败时，不向设备分发新命令。
- 持久化任务编号、状态和结果；支持超时后的晚到结果、断线补交、中继重启后补领，绝不因重连自动重放原操作。
- 工具目录、设备、授权和任务均按账号隔离。MCP 客户端通过独立 OAuth/PKCE 关联到用户账号。

## 分发给其他人

把公开入口 https://mcp.ilovestudy.de/start.html 发给使用者即可。该页无需登录，提供 GPT 插件 ZIP、各系统安装器及首次连接步骤。每个人在自己的 ChatGPT 网页端上传同一份包，使用自己的 Google 账号，在自己的电脑上安装并确认绑定。不要把你个人账号中的私人插件详情链接当成公共安装入口。当前为测试分发版，原生安装器签名及使用者实机首装验收尚未完成。

## 一份 ZIP

在 ChatGPT「插件」页选择「添加 → 上传插件压缩包」，直接上传 `desktop-bridge-plugin.zip`，然后连接插件、使用 Google 登录并确认客户端授权。插件已包含服务地址和 OAuth 配置，无需手动添加 MCP 地址。在对话中选择 Desktop Bridge 并说「列出我的电脑」，即可使用账号下已绑定且工具可用的设备。

0.2.2 的首次设置引导会提供「安装并连接」下载入口。新电脑优先使用无需解压的独立安装器：[Mac PKG](https://mcp.ilovestudy.de/downloads/DesktopBridge-macOS.pkg)、[Windows CMD](https://mcp.ilovestudy.de/downloads/DesktopBridge-Windows.cmd)、[Linux 自解包脚本](https://mcp.ilovestudy.de/downloads/DesktopBridge-Linux.sh)。下载后打开，安装器自动准备环境、选择普通用户后台模式，并打开网页登录确认绑定。Mac / Windows 无需输入命令；Linux 的打开方式取决于桌面环境。详见 [GPT 首次连接指南](docs/quick-start.md)。

当前独立安装器尚未签名，Mac PKG 尚未公证，系统可能阻止打开；图形安装和 ChatGPT 上传仍需实际验收。

原有通用 ZIP 仍包含以下安装入口，作为高级使用方式；上传插件不会自动在远端电脑安装或启动程序：

| 系统 | 入口 |
| --- | --- |
| Windows x64 / ARM64 | `Install.cmd` |
| macOS x64 / ARM64 | `Install.command` |
| Linux x64 / ARM64 | `Install.sh` |

其余步骤自动完成，首次只需登录并确认绑定。插件、服务地址和账号体系共用，用户不需要手工编写 MCP 配置或复制设备密钥。普通模式下客户端运行于安装它的系统账号权限下；0.2.1 起还可主动选择手动提权或管理员后台系统服务，详见下文。

Google 身份服务需先配置自己的 Google OAuth 网页客户端，见 [配置 Google 登录](docs/google-oauth.md)。插件 ZIP 不包含 Google 客户端密钥、用户密码、设备令牌、数据库或安装后的依赖。

## 0.2.1 · 启动模式与管理员授权

安装器提供 **手动** 和 **后台** 两种模式；默认不获取系统管理员权限。需要管理受保护的系统位置时，可显式选择管理员模式（一次性启动授权 / 安装时授权的受保护系统服务）。

| 安装方式 | 命令（macOS / Linux） | 权限 |
| --- | --- | --- |
| 普通手动 | `./Install.sh --mode manual` | 当前用户 |
| 管理员手动 | `./Install.sh --mode manual --administrator` | 每次启动由系统确认 |
| 管理员后台 | `./Install.sh --mode background --administrator` | 安装/更新时授权系统服务 |

Windows 使用同名 `Install.cmd` 参数。macOS 通过 launchd、Linux 通过 systemd、Windows 通过计划任务管理管理员后台进程，程序文件位于受保护目录，用户不能直接替换高权限程序。**管理员权限不取代 Google、ChatGPT 确认或 macOS 隐私授权。** 高权限运行意味着所有获得授权的本地工具都可能拥有系统级访问能力，应优先考虑普通模式。详细操作、停用、卸载与权限边界请阅读 [管理员运行指南](docs/admin-runtime.md)。

## 管理页面

管理页采用简洁浅色设计，包括登录、设备连接状态、任务结果、账号授权与配对流程。0.2.1 更新了统一卡片、排版、响应式布局与键盘标签切换，保留现有 API 和业务流程。相关代码在 `bridge/public/`；前端样式更新只有部署匹配版本的服务后才会对外可见。

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
