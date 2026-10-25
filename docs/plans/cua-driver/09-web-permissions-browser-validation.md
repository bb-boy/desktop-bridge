# Feature 09 — ChatGPT 网页权限组件浏览器级验收

目标：在 Windows p111 上用本机 Chrome 的隔离 Headless 会话模拟 MCP Apps 网页 Host，真实渲染和操作 GUI；不要求用户安装本地 ChatGPT 客户端。

工作范围：
- 建立最小测试 Host，通过 JSON-RPC postMessage 模拟 ui/initialize、tools/call、ui/notifications/tool-result。
- 加载 bridge/public/gui-permissions.html，在真实 Chromium 中验证页面显示、设备切换、全部允许／仅查看／自定义，以及 Desktop Commander / Cua Driver 工具开关。
- 模拟成功保存、拒绝/失败，确保界面有明确反馈并保护现有设置。
- 使用本地临时端口和独立 Chrome profile，不触及生产 ChatGPT 账号、不调用真实设备命令。
- 测试结束关闭 Chrome 和本地服务器，避免残留进程。
- 使用 MCP Apps 标准格式，并保留 Bridge Broker 授权强制执行的既有测试。
- chatgpt.com 真实插件端到端验收仍需部署到 HTTPS 测试端点；隔离 Chrome 模拟不等于真实 ChatGPT 渲染通过。

验收：浏览器级脚本通过；已通过的 npm bridge / installer / Cua Broker E2E 不回归。PR #21 GitHub CI Checkout 失败已重新触发，以 CI 日志为准继续处理。

## 本次实现与实测（2026-10-25）
- [x] 实现 `bridge/test/permissions-host.fixture.html`：隔离的最小 MCP Apps 浏览器 Host，通过标准 postMessage 接收 `ui/initialize` / `tools/call`，模拟 OAuth 后的数据范围和服务端错误。
- [x] 实现 `bridge/test/permissions-browser.test.mjs`：使用 Windows p111 本地 Chrome/Edge 无头模式和独立 profile，使用 CDP 操作真实 HTML 界面；其他无此浏览器的平台跳过。
- [x] 实测默认全部允许、按 Desktop Commander 和 Cua 分组选择、自定义允许列表保存、切换到 Mac 设备、服务端拒绝不能保存、之后恢复保存。
- [x] 浏览器回收无残留 Chrome 测试进程；隔离页面不连接生产账户。
- [x] `node --test bridge/test/device-permissions.test.mjs bridge/test/permissions-mcp.test.mjs bridge/test/permissions-browser.test.mjs`：9/9 通过，0 失败。
- [ ] GitHub CI 自托管 Linux `actions/checkout@v4` 在 PR #21 失败；重新运行仍失败，后续任务未运行，GitHub job 日志 API 返回 BlobNotFound；不可声称 Linux 测试已经失败/通过。
- [ ] 在 HTTPS 测试环境的 chatgpt.com 真实渲染仍未验证；不要因此发布到生产。
