# Cua Driver Windows 集成（开发分支）

该功能目前仅在 Windows p111 工作区开发，不会修改 Mac，也不会自动影响已安装的 Desktop Bridge 客户端。

## 功能与边界
- 当前主后端仍是 Desktop Commander，25 个原始工具名称不变。
- 只有本地 `agent-config.json` 明确设置 `cuaDriver.enabled=true` 才会尝试启动 Cua Driver。
- Cua 未安装、启动失败、工具目录冲突或目录超限时，Agent 会记录 `mcp_backend_failed`，保持 Desktop Commander 可用。
- Cua 原生命令统一使用 `cua_` 前缀公开，例如 `cua_list_windows` 与 `cua_get_window_state`。
- 两套工具共享现有 WebSocket 中继、账号隔离、任务日志和调用结果恢复；没有增加远程代码下载功能。

## 启用（仅 Windows 本机测试时）
1. 从上游官方发布途径安装已审核版本的 Cua Driver，确认执行 `cua-driver doctor`、`cua-driver list-tools` 正常。
2. 通过 Windows 本机交互授予必要系统权限。勿在无人知情的情况下自动提权。
3. 编辑本机 Desktop Bridge 的 agent 配置（保留其已有字段与凭据），增加：

```json
"cuaDriver": {
  "enabled": true,
  "command": "C:\\Absolute\\Path\\To\\cua-driver.exe"
}
```

4. 本机重启 Desktop Bridge Agent，重新建立 WSS 连接并检查新工具清单。
5. 如需停用，把 `enabled` 设为 `false` 并在本机重启 Agent。

此配置项尚未加入图形安装器或管理网页；当前属于开发分支功能，不能作为面向所有用户的一键安装功能宣称已完成。

## 后续工作
- 官方发行包版本固定、签名/哈希校验、Windows GUI 权限引导。
- 更细粒度的观察/写操作授权与权限提示。
- 大截图尺寸限制、真实 GUI 冒烟测试、升级/回滚能力。
- 在同一设备上由 Windows GUI 会话验证 Cua Driver 的真实可用性。

## 已有验证
- 独立 MCP Manager 单测与 Windows 双真实 stdio 子进程测试；
- 现有完整回归中的失败/超时必须单独诊断，不能直接声称整体通过。

## Windows p111 本机验证完成项（2026-10-25）

使用 Cua Driver 0.38.0，已经通过开发分支的 `McpToolManager` 完成后台计算器 UI 测试：

```powershell
cd C:\Users\justl\desktop-bridge-cua-windows\bridge
node test\cua-calculator-e2e.mjs
node test\cua-agent-broker-e2e.mjs
```

第一条脚本会启动 Windows 计算器，通过真实 UI Automation 元素逐个执行 `6 × 7 =`，验证 UI 文本“显示为 42”，并在 MCP 响应中校验缩放后的计算器窗口截图。

第二条脚本使用临时数据目录、随机临时设备令牌和 Windows 本机临时 Broker，启动开发分支 Agent，同时接入模拟 Desktop Commander MCP 与真实 Cua MCP，依次验证工具注册、`cua_list_windows`、`cua_launch_app` 和 `cua_get_window_state` 的截图跨 WebSocket 返回。整个过程不会修改已部署 Agent 的配置或连接生产服务。

已观察到：Cua 真机共 63 个工具；1 个 fixture 工具加上 Cua 为 64 个；计算器截图在 MCP 中约 35 KB，经临时 Broker 转发约 34 KB。此处不是带完整 25 个 Desktop Commander 工具的生产目录计数。

尚待完成：Windows 正式安装器中的“启用 Cua”选择和配置、精细化屏幕/窗口权限、隐私审计、超大图像处理、部分完整旧回归的失败排查，以及真实在线部署验收。测试文件没有扩展名 `.test.mjs`，不会在缺少 Windows/Cua 的环境被普通 `npm test` 自动执行。
