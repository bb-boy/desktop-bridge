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

## 一份 ZIP

在支持 portable Agent Plugins 格式的宿主中安装生成的 `desktop-bridge-plugin.zip`。首次连接某台电脑时，在目标电脑解压同一个 ZIP，运行对应入口：

| 系统 | 入口 |
| --- | --- |
| Windows x64 / ARM64 | `Install.cmd` |
| macOS x64 / ARM64 | `Install.command` |
| Linux x64 / ARM64 | `Install.sh` |

其余步骤自动完成，首次只需登录并确认绑定。插件、服务地址和账号体系共用，用户不需要手工编写 MCP 配置或复制设备密钥。客户端运行于安装它的系统账号权限下。

Google 身份服务需先配置自己的 Google OAuth 网页客户端，见 [配置 Google 登录](docs/google-oauth.md)。插件 ZIP 不包含 Google 客户端密钥、用户密码、设备令牌、数据库或安装后的依赖。

## 开发与打包

使用 Node.js 24，在仓库根目录执行：

```sh
npm ci --prefix bridge --ignore-scripts
npm test --prefix bridge
python3 bridge/scripts/package-plugin.py --output release-output/desktop-bridge-plugin.zip
```

模块分支使用独立 worktree 并发开发：[模块与协作](docs/modules.md)。测试覆盖 API、真实 MCP/WSS、实际代理进程和客户端生命周期，不使用浏览器测试。实际验证范围见 [验证记录](bridge/VALIDATION.md)，服务运行、迁移与保留期限见 [扩展说明](bridge/README.md)。

`.github/workflows/bridge.yml` 定义 Windows、macOS、Linux 非浏览器测试和通用 ZIP 构建。远端 CI 是否通过以 GitHub 实际运行结果为准；Git 推送和 ZIP 生成不会自动部署自托管服务。

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
