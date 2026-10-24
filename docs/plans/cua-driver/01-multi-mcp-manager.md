# Feature 01 — Windows Agent 多 MCP 进程管理器

## 目标
在 Windows p111 开发并验证 Desktop Bridge Agent 同时连接 Desktop Commander 与 Cua Driver，不改变当前 OAuth、设备配对、WSS 中继、任务恢复协议。

## 当前状态
`bridge/agent/agent.mjs` 仅创建一个 MCP Client 与 StdioClientTransport；工具发现及 callTool 均绑定此单例。现有客户端版本 0.2.7，正式默认工具引擎仍是 Desktop Commander。

## 设计
1. 新增 `bridge/agent/mcp-manager.mjs`，独立管理多个后端的启动、连接、状态、工具清单与关闭。
2. 后端配置至少含 `id`、`command`、`args`、`cwd`、`env`、`optional`，默认 Desktop Commander 仍使用原本配置。
3. 工具路由表 `externalToolName -> (backendId, nativeToolName)`；原有 Desktop Commander 工具名保持不变，新 Cua 工具使用 `cua_` 前缀。
4. 工具列表分页获取、动态合并与健康探测；可选 Cua 启动失败不使 Desktop Commander 断线。
5. 操作执行仍经过原有任务 UUID、journal 持久化、幂等防重放、最多 4 个并发请求；命名空间解析后调用对应本地 MCP Client。
6. Agent 关闭时关闭所有客户端，保持 WebSocket 断线重连不额外启动重复进程。

## 验收
- [ ] Windows 本地同时发现两个 mock MCP 后端，互不覆盖。
- [ ] 旧 25 个 Desktop Commander 工具保持原名、原功能。
- [ ] 可选后端故障不影响主后端操作。
- [ ] 并发、失败与重连路径不会重复执行写操作。
- [ ] Windows Node.js 测试通过，未触碰 Mac。

## 边界
本 Feature 不安装 Cua Driver、不修改生产部署、不变更任何用户密钥。
