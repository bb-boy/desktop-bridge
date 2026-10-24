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
