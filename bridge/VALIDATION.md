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
