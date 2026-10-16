# Desktop Bridge development

- The product is one universal plugin ZIP for Windows, macOS and Linux, with a shared self-hosted MCP endpoint.
- Develop major features on separate module branches and Git worktrees. Integrate accepted modules without rewriting existing history.
- Module ownership: accounts owns bridge/server/{management,oauth,security}.mjs; reliability owns bridge/server/{broker,store,index}.mjs; client owns bridge/agent/ and bridge/client/. The integrator owns plugin packaging, docs and CI.
- Do not test through a browser. Use protocol, API, process and installer tests.
- Never commit account passwords, OAuth/device credentials, databases, journals, logs, installed dependencies or generated archives.
- Preserve the existing plugin identity and endpoint. Pair devices through account approval; never package device tokens.
- Only the integrator pushes or deploys after tests pass. Keep upstream source and its history intact.
- Google identity is a separate module (`module/google-auth`), with explicit permission to add `bridge/server/google.mjs`, identity/session integration hooks and its tests/dependency. Each verified Google issuer/sub automatically gets an isolated user; never merge by email.
