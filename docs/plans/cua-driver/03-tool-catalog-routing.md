# Feature 03 — 多工具目录与服务端路由

## 目标
让 ChatGPT 仍通过一个 Desktop Bridge MCP 入口发现原有工具与 Cua 工具，并按设备真实安装情况调用。

## 当前限制
`bridge/server/broker.mjs` 从已配对设备的 hello 消息读取目录；单台设备目前最多接收 128 个工具；服务端有固定 Desktop Commander 目录用于首次配对前发现。

## 设计
1. 保留 `list_devices`、`list_calls`、`get_call_result`、`who_am_i`、`ping`、`shutdown` 和所有原有工具名。
2. 将新增工具命名为 `cua_<native_tool>`，只允许合法名称且拒绝冲突；保留 nativeToolName 供 Windows Agent 路由。
3. 控制目录容量与 schema 大小；新增工具数超过 128 时，先报告 `catalog_limit`，不得悄悄截断/隐藏重要工具。
4. 用户隔离：只公开该账号已有设备提供的新增工具；跨设备同名工具能力的缺失应在调用时明确报错。
5. 可选服务未启动时，状态应区分 Cua 不可用与 Desktop Commander 已就绪；不把 GUI 能力误报成整机离线。
6. 原有任务 UUID 与结果查询保持不变，截图结果走现有返回通道并受大小限制。

## 验收
- [ ] 现有工具数量与名称在未启用 Cua 时不变化。
- [ ] Cua 工具前缀映射正确，调用到选定的 Windows 设备。
- [ ] 冲突目录/恶意工具名/工具过多均安全拒绝。
- [ ] 不泄露其他账号设备工具目录。
- [ ] Mock 设备与 broker 测试通过。

## Windows p111 实测记录（2026-10-25）
- [x] 真实 Cua Driver 0.38.0 可通过 Agent 的 `cua_` 命名空间提供工具。
- [x] 临时 Desktop Commander MCP fixture + 真实 Cua 同时连接，发现 64 个工具（1 个 fixture + 63 个 Cua）。
- [x] 临时本地 Broker 能注册 64 个工具，按设备下发 `cua_list_windows`，Windows Agent 正确处理并返回结果。
- [x] `cua_get_window_state` 窗口截图经过 Windows Agent -> WebSocket -> Broker 返回完整 MCP image，约 34 KiB。
- [ ] 服务端真实账户多设备权限和跨设备目录上限仍需专项验证；64 个工具不代表生产环境原始工具总数。
