# p111 第一版验证记录

验证日期：2026-10-17（Asia/Shanghai）。以下结果来自实际测试；恢复时间是本次测量值，并非时效保证。

| 验证项目 | 结果 |
|---|---|
| 公共 DNS | `mcp.ilovestudy.de` 已解析到 `43.134.174.254` |
| 公网 HTTPS | 有效证书；`/healthz` 返回 200 |
| 未认证访问 MCP | 401，带 OAuth 资源发现地址 |
| OAuth 动态客户端注册 | 成功 |
| OAuth 所有者授权与 PKCE | 公网完整流程成功 |
| CSRF 来源检查、错误 PKCE、授权码重放 | 自动化测试拒绝 |
| 刷新令牌轮换与撤销 | 自动化测试通过；公网刷新成功 |
| 服务重启后保留授权 | 自动化及公网测试通过 |
| 工具发现 | 26 个工具：25 个 Desktop Commander 本地工具加 `list_devices` |
| p111 文件写入与读取 | 通过公网 MCP 写入并读回 `PersonalDesktopBridge\smoke-test.txt` |
| p111 后台权限 | 工具输出 `Computer=P111, SessionId=0, Administrator=true` |
| 需要管理员权限的命令 | `fltmc filters` 成功，无 Windows UAC 交互 |
| 中文终端输出 | `Write-Output "中文输出正常"` 返回正常中文 |
| 中继强制终止恢复 | systemd 约 4.0 秒恢复，新 PID；客户端自动重连 |
| 中继停止恢复 | 巡检 timer 约 16.0 秒恢复 |
| p111 Agent 进程树强制终止恢复 | 计划任务约 46.1 秒启动新进程，Session 0 |
| 故障恢复后的工具调用 | 文件读写和管理员命令再次成功 |
| 重复任务编号 | 真实 Agent 集成测试证明同一编号在重启前后只执行一次 |
| 断线时正在执行的调用 | 返回执行结果可能未知；中继不自动重发 |
| 开机自启配置 | Linux 服务和巡检 timer 已启用；Windows boot/logon/repeat 与 Highest/S4U 已配置 |
| npm 审计 | 云端锁定依赖 0 个已知漏洞；不代表已审计 p111 既有全部依赖 |
| 私有插件包 | 已创建个人 PRIVATE 插件并读取服务端保存的配置确认 URL/OAuth 正确 |

自动化测试：`npm test`，5 项通过，0 失败。

本版仍待验证：在用户 ChatGPT 网页账号中的首次授权和实际工具调用；真实锁屏、注销、电脑重启及多日运行。未通过重启服务器干扰同机的其他网站。

原官方 Desktop Commander Remote 服务保留，测试连接使用独立的设备凭据和本地 MCP 进程。多用户隔离和公开用户注册不在本版范围内。

## OAuth 网页修正

2026-10-17 修复授权页错误显示 Express `next` 回调的问题；为授权页面采用同源 Referrer Policy，并在保留浏览器 Cookie / 表单 CSRF 令牌校验的前提下支持浏览器抑制 Origin 的表单提交。不同授权尝试使用独立 CSRF Cookie，避免标签页间相互覆盖。新增授权渲染和多次授权隔离回归检查，针对 OAuth 的两项集成测试通过；部署后从公网确认授权页返回 200 且无错误文本。

用户随后要求官方 Remote 下线，已停用 p111 的 `DesktopCommanderRemote` 与其 Watchdog，保留自建 Bridge 运行。网页连接通过自定义 MCP 服务入口注册；之前的压缩包插件被平台标记为桌面入口。
