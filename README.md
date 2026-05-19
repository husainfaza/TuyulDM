# TuyulDM - Milestone 0 Boilerplate

This project contains the skeleton for **TuyulDM**, an IDM-like download manager.

## Structure

- `/src`: The React dashboard UI (visible in the AI Studio preview).
- `/native-host`: The Go (1.23+) source code for the native messaging host.
- `/extension`: The Manifest V3 source for the browser extension.

## How to Get Started (Milestone 0)

### 1. Build the Native Host
You must have Go 1.22+ installed.
```bash
cd native-host
go build -o tuyuldm-daemon ./...
```

### 2. Load the Extension
1. Open Chrome/Brave and go to `chrome://extensions`.
2. Enable "Developer mode".
3. Click "Load unpacked" and select the `/extension` folder in this project.
4. Note the Extension ID (e.g., `abcdefg...`).

### 3. Register the Native Host

**Linux / macOS** — one command:

```bash
scripts/install-host.sh <EXTENSION_ID>
```

This builds the daemon (if needed), renders `extension/com.tuyuldm.daemon.json.template` with the daemon's absolute path and your extension ID, and writes the result to every supported browser's `NativeMessagingHosts` directory.

**Windows** — manual for now (a `scripts/install-host.ps1` is on the roadmap):

1. Build `native-host\tuyuldm-daemon.exe`.
2. Copy `extension\com.tuyuldm.daemon.json.template` to e.g. `%LOCALAPPDATA%\TuyulDM\com.tuyuldm.daemon.json`, replacing `__DAEMON_PATH__` and `__EXTENSION_ID__`.
3. Add a registry key at `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.tuyuldm.daemon` whose default value is the absolute path to that JSON file.

### 4. Data directory

The daemon stores its database and downloads under a per-user canonical path:

- Linux: `$XDG_DATA_HOME/tuyuldm` (fallback `~/.local/share/tuyuldm`)
- macOS: `~/Library/Application Support/TuyulDM`
- Windows: `%LOCALAPPDATA%\TuyulDM`

## Features
- **Multi-segment Architecture**: Go host handles raw TCP/HTTP range requests.
- **IPC Protocol**: 4-byte length prefix NDJSON over stdin/stdout.
- **MV3 Interception**: Uses `chrome.downloads.onCreated` to hijack browser downloads.

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE).
