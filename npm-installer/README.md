# Desktop Bridge npm CLI

Independent npm distribution for the Desktop Bridge **local device client**. It does not publish the upstream Desktop Commander package or cloud relay.

Version 0.2.7 adds Windows Task Scheduler background management. npm remains the installation, upgrade and control entry point.

Requires Node.js 24 and npm. Native installers for computers without Node remain available at <https://mcp.ilovestudy.de/start.html>.

```sh
npm install -g @justlovepl/desktop-bridge
desktop-bridge setup               # default: background, login startup enabled
desktop-bridge setup --mode manual # explicitly choose foreground/manual operation
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

**Installing the npm CLI does not start a service.** Run `desktop-bridge setup` to install/pair the client and select background operation by default. Use `--mode manual` for foreground operation; `--no-start` also selects manual mode. The native installers still ask the user to select a mode explicitly.

On Windows, background mode registers a Task Scheduler task for the current user with limited privileges, starts it independently of the terminal/SSH session, and starts it again on user login. The task has no runtime time limit, allows battery operation, and restarts on failures. This mode requires that user to be logged into Windows; running before login is the separate administrator service option. `stop` leaves the task registered but stops the client; `start` resumes it; `mode manual` and `uninstall` remove it. An update migrates the old login shortcut to the managed task while preserving pairing and the saved mode.

`--administrator` requires explicit OS authorization and respects the existing protected service restrictions. `--root <directory>` selects a dedicated custom data directory. **There is no install/start action in npm postinstall**.

`desktop-bridge uninstall --purge` permanently deletes local credentials and result journals. Uninstalling locally does not revoke the server token; use device management at <https://mcp.ilovestudy.de/start.html> to revoke device authorization. Existing administrator service installations require the protected service's own approved uninstall flow.

Update the npm CLI and then apply the local client release:

```sh
desktop-bridge update
```

`npm update` alone does not replace an already running agent. `desktop-bridge update` upgrades the CLI and Agent while explicitly passing the existing saved mode, with credential, mode, and task journal protection. It refuses to install a CLI older than the current version. `repair` also preserves the saved mode, but deliberately requires browser re-pairing approval. A revoked device always requires explicit new pairing.

## Packaging / tests

The npm package lives in `npm-installer/`, distinct from the root upstream `package.json` and `bridge/client/package.json`. Packing stages files from an explicit allowlist in `bridge/client/` and `bridge/agent/`; no cloud server, installed user data or secret credentials enter the package.

```sh
cd npm-installer
npm test
npm pack --dry-run
```

Review the resulting npm tarball and run real setup/stop/re-pair/update/uninstall tests on Windows, macOS and Linux before first publication. **Never run npm publish from the repository root or bridge/client directory.**
