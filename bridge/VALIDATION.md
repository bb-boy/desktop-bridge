# Validation · 0.2.0 development

Validation uses API, MCP/WSS protocol and real local processes. No browser tests are performed.

## Accepted module evidence

- Accounts module: 19 tests passed in its worktree (9 new account regressions). Covered OAuth approval concurrency, password-change races, CSRF, one-time/expired/denied pairing, cross-account routes, account deletion and rotation send errors.
- Reliability module: 18 tests passed in its worktree. Covered per-account MCP catalog/device/task isolation, late result idempotency, send/shutdown outcomes with task IDs, live ownership/pause/unlink checks, pending key handshake, old-schema migration and actual agent offline-completion recovery after a relay restart.
- Integrated accounts + reliability: 27/27 tests passed on the local macOS host with Node.js 24.19.0.

Client, Google identity and final universal package validation are recorded after integration. Worktree pass counts overlap because each includes the shared baseline; they must not be added to infer final test count.

## Delivery limits

A Git push or plugin ZIP does not deploy the self-hosted endpoint. An installer prepares the target computer and pairs through the configured service; the service must run the matching release. Actual Google end-to-end login requires a configured Google OAuth web client, secret and exact redirect URI. Locally signed test tokens validate protocol and isolation behavior but are not a real Google account login.

Retention is bounded: cloud task/results expire after 30 days; local journal output has an overall capacity limit and may retain an unknown-outcome marker. Recovery never automatically repeats an original modifying command.
