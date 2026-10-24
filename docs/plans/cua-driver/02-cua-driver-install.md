# Feature 02 — Cua Driver Windows 可选安装与启动

## 目标
让 Windows Desktop Bridge 客户端在用户主动选择后连接官方 Cua Driver MCP，不默认安装或启用。

## 集成接口
官方仓库 `trycua/cua` 的 `libs/cua-driver` 提供 `cua-driver mcp`（stdio）。不要复制整个 Cua 仓库，不直接 fork / 修改其 Rust 内核。

## 设计
1. 优先使用已安装的 `cua-driver.exe`，校验可执行路径、版本、签名/哈希与 `doctor` 状态。
2. 如需安装，设计显式用户操作与受信任的固定版本发行包；禁止远程静默执行未经验证的网络安装脚本。
3. Agent 可配置独立 `cua-driver mcp` 后端；默认关闭，缺失时报告 `not_installed` 而不是停止 Desktop Commander。
4. 尊重 Windows 交互式桌面、UAC/UIAccess、UI Automation 等权限边界；不自动提权。
5. 安装/升级/停止不丢失 Desktop Bridge 设备令牌及用户绑定。
6. 本轮先完成集成接口、启动可用性探测及测试桩；真实 GUI 验收需要 Windows 图形会话和本机审批。

## 验收
- [ ] 关闭时不会启动 Cua 进程。
- [ ] 已有 Cua 时可显式选择并启动，`tools/list` 返回有效工具。
- [ ] 未安装或启动失败有清晰诊断，Desktop Commander 保持正常。
- [ ] 安装与权限请求没有未经用户允许的静默高权限操作。
- [ ] Windows 的启动/退出流程可重复测试。
