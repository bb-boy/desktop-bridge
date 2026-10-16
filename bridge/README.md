# Desktop Bridge — p111 测试版

基于 Desktop Commander 本地 MCP 工具的自托管远程连接实现。当前为单用户版本，只配置 p111；多用户注册、租户隔离和公开发行尚未实现。

本项目新增云端 HTTP MCP 服务和独立的设备连接程序。本地工具直接复用 p111 已固定的 Desktop Commander 0.3.0 npm 包，未改动它的原文件。此连接不依赖 Desktop Commander 官方云端或 OpenAI MCP Tunnel。

## 调用路径

ChatGPT → HTTPS / MCP → tx 上的中继 → WSS → p111 Agent → stdio / MCP → Desktop Commander 本地工具。

当前公布 26 个工具：25 个本地工具和新增的 `list_devices`。调用本地工具时可附加 `device_id: "p111"`，单设备时可省略。

## 在 ChatGPT 中使用

网页端必须通过以下“添加自定义 MCP 服务”入口注册远程连接。压缩包创建的私有插件 https://chatgpt.com/plugins/plugins_6ad2574131d88191bf27a6be9ab1a6c1 被当前平台识别为桌面端插件，不作为网页接入入口。

1. 打开插件页面，添加自定义 MCP 服务。
2. 名称填写 `Desktop Bridge 网页版`。
3. 服务器 URL 填写 `https://mcp.ilovestudy.de/mcp`。
4. 认证方式选择 OAuth，客户端 ID 和客户端密钥留空，使用动态注册。服务支持 OAuth 2.1 授权码、PKCE S256 和刷新令牌。
5. 在服务授权页面输入服务访问密码。密码保存在此项目旁边的私有连接信息文件中，不在源码中。
6. 安装插件，在对话中选择它，发送“先列出我的设备，然后读取 p111 上 PersonalDesktopBridge 目录中的 smoke-test.txt”。

初次连接需要所有者授权。访问令牌有效期 1 小时；刷新令牌轮换，闲置有效期 180 天。授权状态保存在服务器 SQLite 中，重启后可继续使用。ChatGPT 自身的工具确认设置由平台决定。

## 已部署的位置

| 位置 | 用途 |
|---|---|
| tx `/opt/desktop-bridge/current` | 当前服务程序，指向版本目录 |
| tx `/etc/desktop-bridge/config.json` | 密码哈希和设备密钥哈希 |
| tx `/var/lib/desktop-bridge/bridge.db` | OAuth 注册、授权状态、工具目录、调用状态 |
| tx `desktop-bridge.service` | 中继进程，独立低权限账号运行 |
| tx `desktop-bridge-watchdog.timer` | 每分钟检查服务，停止或无响应时重启 |
| tx `/etc/caddy/Caddyfile` | 新增 MCP 域名，原配置备份在 `/var/backups/desktop-bridge/` |
| p111 `%LOCALAPPDATA%\PersonalDesktopBridge` | Agent、独立设备凭据、日志、心跳和执行记录 |
| p111 `PersonalDesktopBridge` | 开机、登录和每分钟触发的后台任务；S4U / Highest / Session 0 |
| p111 `PersonalDesktopBridgeWatchdog` | 恢复停止或无响应的 Agent |

原来的 `DesktopCommanderRemote` 任务仍保留，属于另一条官方服务连接。两条连接使用独立进程和凭据。当前测试版本没有接管或删除原来的服务。

## 本地运行与测试

需要 Node.js 24。

```sh
npm ci --ignore-scripts
npm test
npm audit --omit=dev
```

通过 `scripts/configure.mjs` 为新环境生成独立凭据，输出位置必须在仓库外：

```sh
node scripts/configure.mjs https://your-domain /private/config-output 'C:\Users\your-user\AppData\Local\DesktopCommanderRemote'
```

将生成的配置路径通过 `BRIDGE_CONFIG` 交给服务端；Agent 使用 `node agent/agent.mjs path/to/agent-config.json` 启动。Agent 的 `runtimeDir` 指向包含 Desktop Commander、MCP SDK 和 ws 的固定运行环境。p111 当前复用既有运行环境，尚未制作面向所有电脑的一键安装包。

`deploy/install-server.sh` 是当前 tx 环境的部署脚本，包含已选定的域名和路径；它读取 `/tmp/desktop-bridge-source.tar.gz` 与 `/tmp/desktop-bridge-config.json`。迁移前需要按目标环境修改。配置生成器拒绝覆盖已有配置，不要在更新程序时重新生成或替换设备密钥。

## 恢复、暂停与维护

中继进程由 systemd 自动重启，健康巡检还会恢复被停止的服务。需要维护时，先创建维护标记，避免巡检重启：

```sh
sudo touch /var/lib/desktop-bridge/maintenance.flag
sudo systemctl stop desktop-bridge
# 恢复
sudo rm /var/lib/desktop-bridge/maintenance.flag
sudo systemctl start desktop-bridge
```

Windows Agent 的维护标记也会让重复启动触发器退出：

```powershell
$root = Join-Path $env:LOCALAPPDATA 'PersonalDesktopBridge'
New-Item -ItemType File -Force (Join-Path $root 'maintenance.flag')
Stop-ScheduledTask -TaskName PersonalDesktopBridge
# 恢复
Remove-Item (Join-Path $root 'maintenance.flag')
Start-ScheduledTask -TaskName PersonalDesktopBridge
```

如需完全结束仍在执行的子进程，先通过任务命令行确认 PID，再针对该 Agent 使用 `taskkill /PID <PID> /T /F`，会中断它正在运行的工具。

## 执行语义与日志

- 已发送任务在断线、超时或服务重启后不会自动重发。中断结果明确提示“可能已经执行”，需要检查状态后再决定是否重试。
- Agent 在执行前写入任务编号，已完成结果保存在有界本地记录中。相同编号不会重复执行；异常退出时尚未完成的编号标为结果未知。
- 每台设备最多 4 个并行工具调用。中继截止时间 120 秒，本地请求 110 秒；长任务使用 Desktop Commander 的后台进程及输出读取工具。
- WSS 心跳检测、指数退避重连，后台任务和巡检负责进程恢复。
- 默认 PowerShell 调用设置 UTF-8 输出，已验证中文。
- 云端仅记录调用编号、工具名称、时间与状态，不记录工具参数或文件内容；程序日志写入 systemd journal。
- p111 的 `agent.log` 超过 1MB 后轮换一份；执行结果记录最多保留 256 个编号，超出约 12MB 时保留“结果未知”标记。Desktop Commander 自己的本地日志仍按其原有机制管理。

## 验证范围

5 个自动化集成测试通过：OAuth/CSRF/PKCE、真实 MCP 协议调用、设备认证、令牌重启持久化、真实 Agent 的跨重启去重。当前锁定的云端 npm 依赖审计为 0 个已知漏洞。

公网实测通过：HTTPS、OAuth 动态注册和授权、令牌刷新、p111 文件读写、后台 Session 0 管理员命令、中文输出，以及中继和 Agent 故障恢复。详细结果见 `VALIDATION.md`。

未执行真实电脑重启、注销、锁屏操作或多日运行测试；已验证后台 Session 0 和启动触发器配置。尚需在用户 ChatGPT 网页账号中完成首次连接并验证实际工具调用。

## 后续多用户版本

当前所有有效 OAuth 授权都属于同一所有者。正式开放前需要增加账号体系、OAuth 授权与设备的所有权绑定、设备配对、查询和任务路由隔离、撤销管理，以及面向用户的安装和升级流程。当前实例不应作为已实现多用户隔离的服务对外开放。

## 源码结构

- `server/`：MCP 入口、OAuth、SQLite 状态与设备任务转发。
- `agent/`：设备连接、stdio MCP 客户端与执行记录。
- `public/`：连接说明与授权页面样式。
- `deploy/`：Linux systemd 和 Windows 计划任务配置。
- `test/`：真实 MCP / WSS / OAuth 集成测试。
- `scripts/`：新环境配置生成器。

原项目和依赖许可见 `THIRD_PARTY_NOTICES.md`。
