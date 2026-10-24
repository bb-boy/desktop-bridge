# Feature 06 — Desktop Commander 与 Cua 统一设备权限

## 用户确认的需求
- 所有可用 Desktop Commander 和 Cua Driver MCP 工具，在同一个设备权限页配置。
- 新老设备的默认模式是“全部允许”：Bridge 层不限制工具调用；Cua 原生 standard/Windows/UAC 限制仍生效。
- 用户主动选择“仅查看”或“自定义”后才启用 Bridge 限制。
- 权限绑定 (owner,deviceId)，只影响当前账号授权的设备，持久保存。
- 自定义页按工具来源 Desktop Commander / Cua Driver 分组，工具逐个开关；新出现的工具默认不自动放行。
- 服务端 Broker 的唯一 dispatch 入口按权限拦截；不可仅从工具目录隐藏而留后门。shutdown 同样受控。
- 文档说明 start_process 等通用工具可绕开仅对 Cua 施加的限制；限制到“只读”时应拒绝可能写入或执行的能力。
- 任何权限限制都不以“绕过系统权限”为功能，网页不代替 Windows UAC。

## 阶段划分
1. SQLite device tool policy，默认 full，无须迁移既有设备记录。
2. Broker centrally enforce full/read_only/custom allowlist.
3. MCP 管理工具读取/更新同一政策，不暴露跨账号写入口。
4. 联机测试：默认全开、用户限权、动态 catalog、隔离及持久化。
5. 只有测试通过后再推送 PR；当前不修改线上生产设备。

## 实现状态（2026-10-25）
- [x] SQLite `device_tool_policies` 按账号和设备持久化权限；旧设备和新设备不存在记录时默认 full。
- [x] Broker.call() 在发送 WebSocket 命令前强制检查 read_only/custom。
- [x] 自定义模式允许明确工具集合，动态新增工具不自动放行。
- [x] 管理 API `get_device_permissions` / `set_device_permissions`；ChatGPT UI 发送后端 OAuth 认证请求。
- [x] 账号越权、无效工具和重复工具输入被拒绝。
- [x] 真实 Windows 临时 Broker 测试 read_only 阻断 `cua_click`、`start_process`，允许 `cua_list_windows`。
- [ ] 尚未部署/在 chatgpt.com 中以真实账户验收。
