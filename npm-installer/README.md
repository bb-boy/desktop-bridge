# Desktop Bridge npm CLI

Independent npm distribution for the Desktop Bridge **local device client**. It does not publish the upstream Desktop Commander package or cloud relay.

**Status: development branch, not yet published or production validated.**

Requires Node.js 24 and npm. Native installers for computers without Node remain available at <https://mcp.ilovestudy.de/start.html>.

```sh
npm install -g @justlovepl/desktop-bridge
desktop-bridge setup               # must type 1 or 2; blank Enter prompts again
desktop-bridge status
desktop-bridge start
desktop-bridge stop
desktop-bridge restart
desktop-bridge pair                # explicitly request browser approval
desktop-bridge mode manual
desktop-bridge mode background
desktop-bridge repair              # repairs AND re-pairs in the browser
desktop-bridge uninstall           # preserves credentials/results unless --purge
```

**The CLI installation itself never prompts or starts a service.** Each interactive `desktop-bridge setup` or reinstall must explicitly select `1` (manual) or `2` (background); pressing Enter without a choice repeats the prompt. For non-interactive setup, a startup mode is mandatory. No existing credential, Agent, or login startup configuration may change before the choice is validated.\n\nUse `desktop-bridge setup --mode manual` or `--mode background` in automated shells. `--administrator` requires explicit OS authorization and respects the existing protected service restrictions. `--root <directory>` selects a dedicated custom data directory. **There is no install/start action in npm postinstall**.

`desktop-bridge uninstall --purge` permanently deletes local credentials and result journals. Uninstalling locally does not revoke the server token; use device management at <https://mcp.ilovestudy.de/start.html> to revoke device authorization. Existing administrator service installations require the protected service's own approved uninstall flow.

Update the npm CLI and then apply the local client release:

```sh
npm update -g @justlovepl/desktop-bridge
desktop-bridge setup
```

`npm update` alone does not replace an already running agent. `desktop-bridge update` upgrades the CLI and Agent while explicitly passing the existing saved mode, with credential, mode, and task journal protection; routine update is not an interactive re-install. A new pairing still requires an explicit browser login and approval if the existing device authorization was revoked.

## Packaging / tests

The npm package lives in `npm-installer/`, distinct from the root upstream `package.json` and `bridge/client/package.json`. Packing stages files from an explicit allowlist in `bridge/client/` and `bridge/agent/`; no cloud server, installed user data or secret credentials enter the package.

```sh
cd npm-installer
npm test
npm pack --dry-run
```

Review the resulting npm tarball and run real setup/stop/re-pair/update/uninstall tests on Windows, macOS and Linux before first publication. **Never run npm publish from the repository root or bridge/client directory.**
