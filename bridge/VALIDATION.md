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

## Delivery limits

A Git push or plugin ZIP does not deploy the self-hosted endpoint. An installer prepares the target computer and pairs through the configured service; the service must run the matching release. Actual Google end-to-end login requires a configured Google OAuth web client, secret and exact redirect URI. Locally signed test tokens validate protocol and isolation behavior but are not a real Google account login.

Retention is bounded: cloud task/results expire after 30 days; local journal output has an overall capacity limit and may retain an unknown-outcome marker. Recovery never automatically repeats an original modifying command.
