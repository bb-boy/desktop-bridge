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

## Windows p111 实际安装记录（2026-10-25）
- 已安装稳定版 Cua Driver 0.38.0（x86_64-pc-windows-msvc），位置：`C:\Users\justl\AppData\Local\Programs\Cua\cua-driver\bin\cua-driver.exe`。
- 先下载 `https://cua.ai/driver/install.ps1`，并与 `trycua/cua` GitHub main 分支的官方安装脚本按 SHA-256 比对，内容一致；固定版本 0.38.0，使用 `-NoAutoStart` 执行。
- 官方发行包的 SHA256SUMS 校验通过，两个可执行文件的 Authenticode 签名有效。未安装 cosign，因此没有完成 Sigstore bundle 独立验证。
- `--version`、`doctor`、`list-tools` 通过；doctor 确认 Windows Session 1、UI Automation 和可见窗口。
- 已手动启动 Cua Driver 标准模式 daemon（不注册 Windows 自启）；`status` 显示运行中。
- 实际 MCP stdio 连接通过：Cua Driver 公开 63 个工具，`list_windows` 识别 18 个窗口。
- Desktop Bridge 的 `McpToolManager` 同时连接测试 Desktop Commander fixture 和真实 Cua Driver 成功，`cua_list_windows` 通过路由返回结果。
- 为最小化额外数据收集，执行 `cua-driver telemetry disable`；本地安装 ID 仍保留。
- 安装器最后一次 PowerShell 包装命令因为历史 `$LASTEXITCODE=1` 输出失败信息，但安装工件、签名、版本、doctor、daemon 和实际 MCP 调用均独立验证成功。
- 尚未执行鼠标点击、键盘输入或 GUI 截图验收；尚未修改已部署 Desktop Bridge Agent 的运行配置，也未启用 Cua 开机自启。
