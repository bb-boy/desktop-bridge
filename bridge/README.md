# Desktop Bridge 客户端 0.2.1 · 通用插件

同一份插件 ZIP 连接 Windows、macOS 和 Linux。服务端提供 MCP/OAuth、用户身份、设备配对与隔离、管理网页和持久化任务结果；电脑端自动准备运行环境并通过向外的连接接收任务。

## 使用

安装 `desktop-bridge-plugin.zip` 到支持 portable Agent Plugins 格式的宿主。首次绑定一台电脑时，在那台电脑上解压同一份 ZIP，运行 `Install.cmd`（Windows）、`Install.command`（macOS）或 `Install.sh`（Linux）。安装器自动选择操作系统和处理器、校验 Node.js 下载、安装锁定依赖、启动配对并保存凭据。

登录管理页后确认电脑名称，完成绑定。在无法打开浏览器的电脑上，可把配对码输入到另一台设备的管理页。每个人使用同一份插件和服务地址，无需复制设备密钥、修改配置文件或另外注册一个 MCP 地址。

Google 登录启用后，每个经验证的 Google 用户标识对应独立账号，首次登录自动创建隔离的用户空间。已有所有者应先用原账号登录，再显式绑定 Google，以保留原设备；不会凭相同邮箱自动合并账号。本地密码登录继续可用。Google 连接配置见 [Google 配置](../docs/google-oauth.md)。

## 主要功能

| 模块 | 行为 |
| --- | --- |
| 账号与授权 | 账号隔离的 MCP OAuth/PKCE、刷新令牌轮换、会话验证、客户端授权撤销和密码修改 |
| Google 身份 | Google OIDC 登录和显式绑定，以经过验证的 issuer/sub 归属账号 |
| 设备配对 | 短期配对码、登录确认、一次性凭据领取，服务端仅保存设备密钥哈希 |
| 设备管理 | 重命名、暂停/恢复、解绑、客户端版本和最后在线时间、设备密钥轮换 |
| 健康状态 | 分开提供 `networkConnected` 和 `toolsAvailable`；本地探测过期或失败时不发送新工具调用 |
| 任务恢复 | 每个已分发任务都有编号，持久化结果，允许超时后的晚到结果、重连补领和中继重启后补领；不自动重放原操作 |
| 通用客户端 | 同一安装源适配 Windows、macOS、Linux；普通手动/后台以及显式授权的管理员手动/系统后台服务 |

工具 `list_devices`、`list_calls`、`get_call_result` 在云端提供；其余工具来自你账号内设备登记的本地工具目录。所有查询和工具路由都根据令牌所属账号执行，并在分发时再次检查设备当前状态。

暂停、解绑和撤销授权阻止后续操作；已经在电脑上执行的操作可能继续完成。查询结果不会重新执行原任务。当客户端没有确定结果时保留 `unknown`，需要检查电脑上的实际状态。

云端任务及结果保留 30 天，管理页显示最近 100 项任务。结果是用户数据，数据库必须放在受保护的位置。本地执行记录有容量限制，大输出或超出容量时可能仅保留未知结果标记；单次传输上限为 8 MiB。不要把“结果未知”解释为“任务没有执行”。

## 客户端运行模式与管理页面

0.2.1 安装时可选择 `--mode manual`（默认建议）或 `--mode background`；加 `--administrator` 才会请求系统管理员权限。管理员手动模式每次启动需授权，管理员后台模式在安装和更新服务时授权，之后由操作系统管理：Windows SYSTEM 计划任务、macOS root LaunchDaemon、Linux systemd 系统服务。普通后台模式仍然只是用户登录后自启。

管理员服务使用受保护程序目录，不允许普通用户直接修改以系统权限执行的程序。Google 登录、账号隔离、ChatGPT 工具确认和 macOS TCC 授权仍独立生效。详细命令、卸载和风险参见 [管理员运行指南](../docs/admin-runtime.md)。

前端管理页面包含登录、设备列表、连接状态统计、任务记录、配对和授权管理。新增 NES.css 2.3.0 像素风（MIT 授权、本地托管，无在线 CDN 依赖），以及桌面/平板/手机响应式布局、清晰的状态标签、统一交互反馈和可键盘操作的标签页。更新的是 `public/` 静态资源，Git 推送并不会自动改变现有线上页面。

## 开发与模块

服务端需要 Node.js 24：

```sh
npm ci --prefix bridge --ignore-scripts
npm test --prefix bridge
python3 bridge/scripts/package-plugin.py --output release-output/desktop-bridge-plugin.zip
```

从仓库根目录执行。生成的 ZIP 包含一个 portable 插件，跨系统安装源位于其 `assets/client/` 中；不包含运行凭据、数据库、安装后的依赖或开发仓库。

模块分支和职责见 [模块协作](../docs/modules.md)。测试覆盖 API、真实 MCP、WSS、实际 agent 进程和客户端生命周期；不使用浏览器测试。

## 服务端配置与迁移

新服务可使用 `node bridge/scripts/configure.mjs https://your-domain /private/config-directory` 生成所有者初始配置。`BRIDGE_CONFIG` 指向仓库外的 JSON 配置，再启动 `npm run bridge:start`。现有服务更新时继续使用原配置和数据库，不重新生成密码或设备凭据。

旧的单用户凭据迁移至 `owner` 账号，已有设备保留所有权。新版本通过账号数据库管理设备，不再依靠手写设备数组来新增设备。旧客户端没有 v2 健康探测时会显示网络已连但工具尚未验证，需要更新客户端后才能执行新操作。

更新前备份 SQLite（使用 SQLite backup API）和服务配置；代码回滚不能保证旧版本理解新数据库。服务部署应使用新版本目录，保留旧版本，验证 HTTP 健康、OAuth、设备重新握手和无害工具调用后切换。

`deploy/` 里的旧 Windows 计划任务和安装脚本属于已有 p111 实例的运维记录；通用插件的安装器位于 `client/`。插件打包和 Git 推送不会自动部署服务端或更新用户已有安装。

## 许可与工具引擎

自托管扩展遵循 MIT。客户端固定使用 `@wonderwhy-er/desktop-commander@0.3.0`，保留上游许可和第三方声明。仓库也保留完整上游源代码；修改根目录源码不等于自动更新已安装客户端的 npm 工具引擎。需要新的工具引擎版本时应明确构建、固定依赖并重新测试客户端。
