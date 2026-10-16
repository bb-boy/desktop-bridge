# Optional CI workflow

`bridge.yml` is a ready-to-enable GitHub Actions workflow for Windows, macOS and Linux protocol tests and universal plugin packaging. It is intentionally stored outside `.github/workflows/`, so it does not execute.

The authenticated GitHub OAuth credential used for the source push lacks the `workflow` scope. Source and module branches can be pushed without adding account permissions; enabling this template requires a repository workflow write through an appropriately authorized GitHub session. Copy it to `.github/workflows/bridge.yml` when that is available.

Local accepted validation is recorded in `bridge/VALIDATION.md`. No remote CI success is claimed.
