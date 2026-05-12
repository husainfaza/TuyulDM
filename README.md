# TuyulDM - Milestone 0 Boilerplate

This project contains the skeleton for **TuyulDM**, an IDM-like download manager.

## Structure

- `/src`: The React dashboard UI (visible in the AI Studio preview).
- `/native-host`: The Go (1.23+) source code for the native messaging host.
- `/extension`: The Manifest V3 source for the browser extension.

## How to Get Started (Milestone 0)

### 1. Build the Native Host
You must have Go installed.
```bash
cd native-host
go build -o tuyuldm-daemon main.go protocol.go
```

### 2. Load the Extension
1. Open Chrome/Brave and go to `chrome://extensions`.
2. Enable "Developer mode".
3. Click "Load unpacked" and select the `/extension` folder in this project.
4. Note the Extension ID (e.g., `abcdefg...`).

### 3. Register the Native Host
1. Open `/extension/com.tuyuldm.daemon.json`.
2. Update the `path` to the absolute path of your `tuyuldm-daemon` binary.
3. Update `allowed_origins` with your Extension ID: `chrome-extension://abcdefg.../`.
4. Register with your OS:
   - **Linux**: Copy the file to `~/.config/google-chrome/NativeMessagingHosts/com.tuyuldm.daemon.json`.
   - **macOS**: Copy to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.tuyuldm.daemon.json`.
   - **Windows**: Add a registry key at `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.tuyuldm.daemon` pointing to the JSON file.

## Features
- **Multi-segment Architecture**: Go host handles raw TCP/HTTP range requests.
- **IPC Protocol**: 4-byte length prefix NDJSON over stdin/stdout.
- **MV3 Interception**: Uses `chrome.downloads.onCreated` to hijack browser downloads.
