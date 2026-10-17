# Validation · 0.2.0 development

Validation uses API, MCP/WSS protocol and real local processes. No browser tests are performed.

## Accepted module evidence

- Accounts module: 19 tests passed in its worktree (9 new account regressions). Covered OAuth approval concurrency, password-change races, CSRF, one-time/expired/denied pairing, cross-account routes, account deletion and rotation send errors.
- Reliability module: 18 tests passed in its worktree. Covered per-account MCP catalog/device/task isolation, late result idempotency, send/shutdown outcomes with task IDs, live ownership/pause/unlink checks, pending key handshake, old-schema migration and actual agent offline-completion recovery after a relay restart.
- Integrated accounts + reliability: 27/27 tests passed on the local macOS host with Node.js 24.19.0.

- Client module: 7/7 headless lifecycle tests passed. Actual macOS ARM64 installer smoke passed official runtime download/checksum, dependency install, no-browser account pairing, real Desktop Commander MCP `get_config`, native ripgrep, targeted dependency override compatibility, repair and uninstall. Windows/Linux platform paths and six-architecture checksums were checked; native execution and automatic startup registration were not exercised.
- Google module: 22 Google-specific tests passed; its 41-test worktree suite also passed. Covered correctly signed local JWTs, production Google JWKS transport, state/cookie/nonce/PKCE, issuer/audience/expiry, automatic separate accounts, same-email non-merging, explicit owner binding, safe unlink and session-based explicit MCP consent. A separate read-only review found no confirmed P1/P2 issue.
- Final integrated suite: **56/56 passed** on macOS with Node.js 24.19.0, no browser tests.
- Server and client runtime dependency audits: **0 known vulnerabilities** in the locked production dependency trees.
- Universal ZIP: one enclosing plugin directory; identity and schema preserved; JSON and skill YAML parsed; all referenced components present; six runtime SHA256 values match official Node.js SHASUMS256; no credentials, state, installed dependencies or symlinks; deterministic archive and SHA256 sidecar generated.

Worktree pass counts overlap because each includes the shared baseline; they must not be added to infer the final count.

## Remote CI

GitHub rejected active workflow writes because the current OAuth credential lacks `workflow` scope. The tested source is pushed without expanding account permissions; CI is retained at `.github/workflow-templates/bridge.yml` and is not enabled. No remote CI pass is claimed.

## Delivery limits

A Git push or plugin ZIP does not deploy the self-hosted endpoint. An installer prepares the target computer and pairs through the configured service; the service must run the matching release. Actual Google end-to-end login requires a configured Google OAuth web client, secret and exact redirect URI. Locally signed test tokens validate protocol and isolation behavior but are not a real Google account login.

Retention is bounded: cloud task/results expire after 30 days; local journal output has an overall capacity limit and may retain an unknown-outcome marker. Recovery never automatically repeats an original modifying command.

## Production activation · 2026-10-17 (Asia/Shanghai)

- Deployed service 0.2.0 to the existing `https://mcp.ilovestudy.de` endpoint after private configuration and SQLite backups. Existing owner, device and refresh authorizations were retained.
- Installed the supplied Google web-client credential only in the protected server configuration (mode 0400); no credential was added to Git, plugin ZIP or public files. Its redirect URI matches `/auth/google/callback`.
- Public HTTPS checks passed: version 0.2.0 health, Google enabled, browser-login page available, Google authorization start pointing to the configured client and exact callback with state/nonce/PKCE S256, and anonymous MCP access denied. Google token/JWKS endpoints are reachable from the server.
- The existing Windows p111 device was upgraded to protocol v2 and reconnected; local MCP health passed. This is an actual Windows agent compatibility check, not a full Windows universal-installer or boot/startup acceptance test.
- The public plugin download matches the accepted universal ZIP SHA256 `609cf2d35fe882967bc0114b952e493866a81749c221bb9adfe9e455c5f82e31`.
- No browser automation was used. A real Google account sign-in still requires the user to complete Google's interactive authentication; successful account login, account binding and real two-user isolation are not claimed yet.

## 0.2.1 集成分支补充验证（2026-10-17）

- 集成分支 `feature/admin-service-integration`，Node.js 24.19.0 / macOS ARM64：**88 项测试，87 项通过，1 项跳过，0 失败**。
- 覆盖客户端手动/后台模式切换、信号退出与子进程清理、运行环境安装/损坏修复、管理员受保护目录与授权调用规划、服务器端账户/Google/OAuth/MCP/任务恢复回归。
- 管理页面使用自托管 CSS 和原生 JavaScript，新增响应式布局与可访问性改进；增加 4 项静态 DOM/样式/可访问性检查（最终回归测试总数另计）。
- macOS Chrome Headless 使用**模拟账号和设备数据**完成登录后管理页浏览器烟测：1366px/390px，设备卡片渲染、无水平溢出、标签切换以及方向键导航通过。仍需人工检查 Safari、Edge、真实账号登录流程及系统权限提示，**不声称跨浏览器视觉回归完整覆盖**。
- Windows 专项 bootstrap 测试在 macOS 下跳过。**未**进行 Windows UAC SYSTEM 任务、macOS root LaunchDaemon 或 Linux systemd 的实际高权限安装/开机恢复与卸载验收。
- 当前生产环境 `https://mcp.ilovestudy.de` 的 0.2.0 部署记录保持不变；**0.2.1 分支代码与 ZIP 并未自动部署到生产**。

## 0.2.2 独立安装入口与 GPT 设置引导

- 插件保留同一身份与远程 OAuth MCP 地址，新增 `onboardingSkill` 指向包内首次设置技能。上传后由宿主设置入口或用户请求触发；不宣称网页上传会执行本机程序。
- 新增 Mac PKG（安装启动器后在已登录用户会话打开进度窗口）、Windows 自解包 CMD、Linux 自解包脚本；复用现有固定校验的运行环境与安装/配对实现，选择普通用户后台模式。
- 新增原生包构建、自解包/篡改拒绝/失败退出码/临时目录清理测试与 HTTP attachment 下载测试。Mac PKG 可构建并展开检查；未在开发电脑实际安装持久化客户端。
- 本机没有 Developer ID 签名身份，生成的 Mac PKG 未签名、公证；Windows CMD 未签名。签名与原生图形首装验收、ChatGPT 账号的实际上传和首次设置触发、真实 Google 登录仍待完成。

- 本轮 macOS Node 24 回归：89 项，88 通过、1 跳过、0 失败；独立包 Python 测试：6 项，5 通过、1 Windows 原生执行项在本机跳过。
- 在 Windows PowerShell 5.1 上实际运行带无副作用模拟载荷的独立 CMD，私有 ACL、校验、解包、后台参数和清理均通过；在 Linux 主机实际运行相同入口结构的模拟载荷，解包、校验、参数和清理通过。两次均未安装或启动真实客户端。
- Mac PKG 使用系统 pkgbuild 构建，经 pkgutil 完整展开验证应用、Agent/客户端文件、执行权限与脚本语法，确认包未签名；没有执行系统安装。

## 0.2.3 ChatGPT 上传元数据修复

- 用户在 ChatGPT 上传 0.2.2 ZIP 时收到「无法添加插件」。排查发现该包缺少导入要求的 `author.name` 和 `interface.developerName`；通用 portable schema 允许缺省，不等于 ChatGPT 导入要求已通过。
- 从同一身份 `desktop-bridge-p111` 的现有私人插件读取原作者名称，补齐这两个字段；不加入作者邮箱、密钥或设备凭据。版本更新为 0.2.3，并在打包前检查这两个必填项。新增三项元数据回归检查。
- 通过 Plugin Creator 的实际账户更新接口成功导入 0.2.3，更新原有私人插件，保留同一插件身份及 OAuth MCP 地址。导入成功不等于 Google 登录或本地设备安装成功。

## NES.css 像素界面改造（2026-10-17）

- 用户界面改用仓库内打包的 NES.css 2.3.0 (MIT)，不从 CDN 加载脚本或字体。登录、统计、设备、配对、任务结果与授权界面复用原功能与 API。
- 删去多余英文装饰及简介小字，保留中文功能标签。
- Google OAuth 后端保持不变；生产接口 `/api/auth/google` 已启用，独立本地测试环境未配置，因此登录页以禁用状态展示 Google 登录按钮，不应误导为可在本地完成 Google 认证。
- Chrome Headless 使用模拟设备测试桌面 1366px 与手机 390px 布局、横向溢出及标签键盘导航；另单独验证本地真实服务器提供的登录页上 Google 禁用提示。真实 Google 交互、Safari/Edge 视觉回归仍需人工验收。

- 基于包含 0.2.3 新安装器与插件元数据的最新 `main` 分支重放并回归：Node 测试 **91 项，90 通过、1 跳过、0 失败**。Chrome 模拟桌面/手机的设备页面和本地登录页也通过无横向溢出检查；仅跳过的仍是 Windows 原生专项测试。

## 桌面端 Google 登录入口可见性（2026-10-17）

- Google 登录由普通按钮改为 NES.css 风格的独立高对比度登录卡片；账号密码表单通过功能性分隔标题区分，没有增加英文装饰文案。
- 本地预览未配置 OAuth 时显示明确的禁用原因，按钮不再因禁用态整体半透明而难以辨认；正式环境启用时可正常点击。没有改动 Google OIDC 后端或手机端布局规则。
- Chrome Headless 已分别验证本地禁用态与模拟启用态；模拟启用态点击后正确 POST 到原有 `/auth/google/start`，包含 `returnTo`。这不代表真实 Google 外部授权回调已完成。
- 完整 Node 回归：**92 项，91 通过、1 跳过、0 失败**。

## 0.2.4 面向独立使用者的首次连接

- 新增无需登录的 `/start.html` 公开入口，提供同一份 GPT ZIP、三个系统的独立安装器、个人账号登录与设备配对步骤。入口不依赖提供者的私人插件链接。管理页增加「首次使用」导航，并移除预填的 `owner` 用户名。
- 新增完整双用户协议集成测试：使用本地签名的模拟 Google 身份，在真实 HTTP、SQLite、OAuth/PKCE、WebSocket 与 MCP SDK 上执行首次登录、设备配对、同一客户端独立授权、设备健康与工具调用。两个身份即使具有同一个显示邮箱，也获得不同账号；互相看不到设备、工具目录和任务结果，越权调用不会发送到设备，原 owner 设备保持独立。
- Google / 前端定向测试 27/27 通过；完整 Node.js 回归 90 项，89 通过、1 平台专项跳过、0 失败；Python 元数据测试 3/3 通过，安装器测试 6 项、5 通过、1 Windows 原生项在 macOS 跳过。此处协议测试使用模拟身份和无副作用设备工具，不代表两个真实 Google 账号的交互式登录验收。
- 提供者确认 Google Cloud 应用已设为「外部用户 / 生产环境」；没有通过控制台独立核验。保留既有服务端 Google 配置，不在 ZIP 内加入登录凭据。
- 0.2.4 仍为测试分发版：Windows CMD 未签名、Mac PKG 未签名和公证，使用者的网页首次上传与真实系统图形安装仍待验收。
