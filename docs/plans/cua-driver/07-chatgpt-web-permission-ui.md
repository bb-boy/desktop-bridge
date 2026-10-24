# Feature 07 — ChatGPT 网页内设备权限设置

## 定位
- 用户在 chatgpt.com 内通过 MCP Apps iframe 管理权限。
- Windows 本地仅运行 Agent + Cua Driver；不安装/启动审批 UI 本地 App。
- 使用 ui://desktop-bridge/permissions/v1.html 的 MCP Resource，MIME text/html;profile=mcp-app。
- 提供“管理设备权限”渲染工具，返回当前账号设备工具快照；应用内请求受限写入工具。
- 同一面板：设备切换，全部允许（默认）、仅查看、自定义三个模式；自定义按 Desktop Commander 和 Cua 分组工具开关；保存/重置有反馈。
- 默认的全允许仅对 Bridge 层生效。ChatGPT 自带 App 审批设置与 Cua standard/Windows 权限独立。

## 安全准则
- 不允许 UI 自己直连 Agent；所有修改经已授权 MCP tool + server 校验 owner/device。
- 更新操作标记 app-only；注意它不是人的不可伪造点击证明，未来高风险审批需要专用一次性凭据。
- 无法加载 UI 的 MCP Host 仍可以读取权限文本；不要自动降低权限。
- 前端处理 MCP Apps ui/initialize/tool-result 和 tools/call，使用沙箱 iframe，不依赖本地客户端。
- UI 只作为可操作设置，不在第一版接管 Cua 原生的系统级审批。
- 验收：协议资源读取，工具模式、HTML 检验，本地 SDK host 模拟以及 chatgpt.com 真实渲染待部署后验证。

## 实现状态（2026-10-25）
- [x] `bridge/public/gui-permissions.html` 独立 HTML + JS + CSS，无本地窗口，不依赖用户电脑。
- [x] MCP resources/list 和 resources/read 为 `ui://desktop-bridge/permissions-v1.html` 返回 `text/html;profile=mcp-app`。
- [x] `get_device_permissions` 通过 `_meta.ui.resourceUri` 关联卡片。
- [x] `set_device_permissions` 使用 `_meta.ui.visibility:['app']`，由 iframe tools/call 进行保存。
- [x] 含设备选择、默认全部允许、只读、自定义两个后端分组和工具勾选。
- [x] 使用 MCP 官方 ui/initialize、ui/notifications/initialized、tools/call；经真实本地授权 MCP SDK 验证资源与调用。
- [ ] ChatGPT 网页端真实 iframe 展示、尺寸和点击保存需要部署 HTTPS 开发实例后验收。
