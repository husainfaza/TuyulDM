# TuyulDM — Build Plan

Step-by-step instructions to take this project from its current M0/M1 skeleton to a shippable v1.0. Phases are ordered so each one unblocks the next; do not skip ahead.

Status legend: ☐ todo · ◐ partial · ☑ done.

Current state (snapshot 2026-05-19):

- ☑ M0 skeleton (IPC handshake works)
- ◐ M1 segment engine (works, but no `go.mod`, no auth passthrough)
- ◐ M2 interception (download hijack wired, headers not forwarded)
- ◐ M3 UI (dashboard exists, not bundled into extension popup)
- ◐ M4 video (shells out to ffmpeg; no native HLS engine, no pause/resume)
- ☐ M5 scheduler · ☐ M6 Firefox · ☐ M7 installers · ☐ M8 release

---

## Phase 0 — Unblock the build (done)

The project does not currently build end-to-end. Fix this first; everything below depends on it.

### 0.1 Initialize the Go module

The Go code imports `go.etcd.io/bbolt` but `native-host/` has no `go.mod`.

```bash
cd native-host
go mod init github.com/<your-org>/tuyuldm/native-host
go get go.etcd.io/bbolt@latest
go mod tidy
```

Commit `go.mod` and `go.sum`.

### 0.2 Fix the build command

README says `go build -o tuyuldm-daemon main.go protocol.go` — that omits `engine.go` and `storage.go` and will fail. Replace with:

```bash
go build -o tuyuldm-daemon ./...
```

Update `README.md` step 1 accordingly.

### 0.3 Pin a sensible working directory for the daemon

`storage.NewStorage("tuyuldm.db")` (`native-host/main.go:27`) opens the DB in whatever CWD the browser spawns the host in — unstable and platform-dependent.

Compute a canonical data dir on startup:

- Linux: `$XDG_DATA_HOME/tuyuldm/` (fallback `~/.local/share/tuyuldm/`)
- macOS: `~/Library/Application Support/TuyulDM/`
- Windows: `%LOCALAPPDATA%\TuyulDM\`

Create the dir if missing, then open `tuyuldm.db` and the downloads folder inside it. Add a helper `paths.go` in `native-host/`.

### 0.4 Replace placeholders in the native-messaging manifest

`extension/com.tuyuldm.daemon.json` ships with literal `/absolute/path/...` and `PASTE_YOUR_EXTENSION_ID_HERE`. Either:

- Add a `scripts/install-host.{sh,ps1}` that templates these in at install time, OR
- Document the dev workflow clearly and gitignore a `com.tuyuldm.daemon.local.json` for personal use.

Acceptance: a fresh clone can run `make build && make install-dev` and end up with a working extension ↔ host link.

### 0.5 Decide the license

CONTEXT.md §9 leaves MIT vs Apache-2.0 open. Pick now (recommend **Apache-2.0** — explicit patent grant matters for a tool that re-implements IDM behavior). Add `LICENSE` and an SPDX header policy to `CONTRIBUTING.md`.

---

## Phase 1 — Harden the segment engine (finish M1)

### 1.1 Validate `HEAD` results before segmenting

`Engine.Add` (`engine.go:36`) trusts `Content-Length` and `Accept-Ranges` blindly. Add:

- Fall back to `GET` with `Range: bytes=0-0` when `HEAD` is rejected (many CDNs do this).
- Refuse to segment if status is not 200 or `Content-Length` ≤ 0; mark download as single-segment streaming.
- Follow redirects manually and remember the final URL — segments must hit the resolved URL, not the original.

### 1.2 Forward request headers end-to-end

Today, `extension/background.js` passes `referer` over IPC but `downloadSegment` never reads it. Wire the full chain:

1. **Extension** (`background.js`): on `chrome.downloads.onCreated`, capture:
   - `referer` (already present)
   - cookies via `chrome.cookies.getAll({ url: item.url })`
   - User-Agent (use `navigator.userAgent` from a content script or hardcode the browser's UA in the host based on a startup handshake)
   - Any `Authorization` headers seen on the originating request via `chrome.webRequest.onSendHeaders` (store last-seen per URL, short TTL)
2. **IPC**: extend `download.add` params with `headers: {[name]: string}` and `cookies: [{name, value, domain, path}]`.
3. **Host** (`engine.go`): store these on `DownloadState`, apply them in `downloadSegment` via `req.Header.Set` and a cookie jar.

Don't blanket-forward every header — pick an allowlist: `Referer`, `Cookie`, `User-Agent`, `Authorization`, `Origin`.

### 1.3 Persist progress across restarts

Segment `Current` offsets are saved only every 500 ms in the progress reporter. On crash the last ~500 ms is lost — acceptable, but you should also:

- Save state once when a segment transitions to `Completed` (immediately, not on the next tick).
- On daemon startup, scan storage for `status == "downloading"` and mark them `paused` so the UI shows a resume button instead of a phantom in-progress download.

Add this scan at the top of `main.go` after `NewEngine`.

### 1.4 Fix file-handle contention

`downloadSegment` opens `a.State.Filename` per segment (`engine.go:274`). With N=8 you have 8 fds writing to the same file at overlapping offsets — works on Linux/macOS, brittle on Windows. Two options:

- **Pre-open once** in `runDownload`, share `*os.File` via `pwrite`/`WriteAt` calls instead of `Seek`+`Write`. `WriteAt` is safe for concurrent calls per Go docs.
- Keep per-segment files (`<filename>.part0`, `.part1`, …) and concatenate at the end. Simpler crash semantics but doubles disk I/O.

Prefer the `WriteAt` approach.

### 1.5 Respect `Retry-After` and back off

CONTEXT.md §10 calls this out. On 429 or 503, parse `Retry-After`, sleep, and reconnect. Cap retries per segment (e.g., 5) before failing the whole download.

### 1.6 Integrity check

After all segments complete, verify `ContentLength == sum(seg.End - seg.Start + 1)`. If the server emitted `Content-MD5` or `Digest`, verify against it. Surface mismatch as `state.Status = "error"`.

Acceptance for Phase 1: download a 1 GB file from a server that requires auth cookies, with 8 segments, killing the daemon mid-download, and the resume produces a byte-identical file (verified with `sha256sum`).

---

## Phase 2 — Finish browser interception (M2)

### 2.1 Narrow host permissions

`extension/manifest.json` requests `<all_urls>` — CONTEXT.md §10 flags this as a Web Store rejection risk. Switch to:

```json
"host_permissions": [],
"optional_host_permissions": ["<all_urls>"],
"permissions": ["nativeMessaging", "downloads", "webRequest", "cookies", "storage", "scripting", "activeTab"]
```

Request the URL pattern dynamically when a download is intercepted using `chrome.permissions.request`. This is what 1Password and similar extensions do.

### 2.2 Handoff via declarativeNetRequest, not `chrome.downloads.onCreated`

`onCreated` fires _after_ the browser has already started the download. The cancel-and-retry pattern works but loses TLS connection reuse and the first chunk. Use a `declarativeNetRequest` rule that redirects matching URLs to a sentinel, or a `webRequest.onBeforeRequest` blocking listener (still allowed in MV3 for `webRequest` with the right permission) to short-circuit before bytes flow.

### 2.3 Settings UI for interception rules

Add a settings page (or a section in `App.tsx`) to:

- Toggle interception by file extension (e.g., `.zip`, `.iso`, `.mp4`, `.pdf`).
- Threshold by `Content-Length` (e.g., only hijack >50 MB).
- Per-domain allow/block list.

Persist via `chrome.storage.local`.

Acceptance: a normal browser PDF preview still opens inline; a 2 GB `.iso` link gets routed to the host without the browser starting a parallel download.

---

## Phase 3 — Wire the React UI into the extension (M3)

### 3.1 Build the popup into the extension bundle

Today `extension/manifest.json` points `default_popup` to `index.html` from the Vite project root — that file is the dev entry and won't work as a static popup.

Two-step fix:

1. Adopt **`@crxjs/vite-plugin`** (already listed as the build choice in CONTEXT.md §6 but not installed):

   ```bash
   npm i -D @crxjs/vite-plugin
   ```

2. Restructure to a single Vite project that emits the extension:

   ```
   extension/
   ├─ manifest.json          ← source of truth for MV3
   ├─ src/
   │  ├─ popup/
   │  │  ├─ index.html
   │  │  └─ main.tsx         ← imports App.tsx
   │  ├─ background/index.ts ← rewrite background.js as TS
   │  └─ content/index.ts
   └─ vite.config.ts
   ```

   Update `vite.config.ts` to use `crx({ manifest })`. `npm run build` then emits `dist/` containing the full unpacked extension.

3. Keep the standalone dashboard (`server.ts` + `src/App.tsx`) for browser-less preview, but import `App.tsx` into the popup too — one component, two mount points.

### 3.2 Replace mocks with real state

In `App.tsx`:

- The footer's "Native Host: Connected (IPC v1)" string is hardcoded. Surface real connection status by tracking `port.onDisconnect` in the background and broadcasting `{ type: "HOST_STATUS", connected: bool }` to the popup.
- "Global Speed" and "Free Space" in the header are placeholders. Add `host.getStats` IPC method that returns aggregate bytes/s and `os.DiskFree(downloadDir)`.
- "Resume All" / "Pause All" toolbar buttons are decorative — wire them to bulk IPC calls.

### 3.3 Fix the typo

`src/App.tsx:171`: `"Acive Queue"` → `"Active Queue"`.

### 3.4 Options page

Add `options_ui.page` to the manifest pointing at a route in the same React app. Move settings (segment count, interception rules, download dir, throttle defaults) out of the modal into a real options page; keep the modal as a quick-edit.

Acceptance: clicking the toolbar icon shows the React popup; the dashboard works at `chrome-extension://<id>/popup.html` and at `http://localhost:3000` for dev.

---

## Phase 4 — Real video grabber (M4)

The current implementation (`engine.go:312`) just runs `ffmpeg -i <manifest>` and lets ffmpeg fetch every segment serially over a single connection — defeats the whole point of TuyulDM for video.

### 4.1 Native HLS parser

Add `native-host/hls.go`:

- Fetch `.m3u8`, parse playlist (master and media).
- For master playlists: pick the highest-bitrate variant by default, expose all variants to the UI so the user can override.
- Resolve relative URIs against the manifest URL.
- Return a `[]VideoSegment{ URL, Duration, ByteRangeStart, ByteRangeEnd }`.

Use [`github.com/grafov/m3u8`](https://github.com/grafov/m3u8) — battle-tested, vendored or via `go get`.

### 4.2 Native DASH parser

`native-host/dash.go`: parse MPD XML, extract `Representation` entries per `AdaptationSet`, compute segment URLs from `SegmentTemplate` or `SegmentList`. [`github.com/zencoder/go-dash`](https://github.com/zencoder/go-dash) covers the common cases.

### 4.3 Reuse the tuyul pool for video segments

Once you have a `[]VideoSegment`, segments are just URLs — feed them through the existing engine. Treat each video segment as a separate small download, or batch with a per-video worker pool sized like `numSegments`.

Persist progress as `segments[i].Completed` so pause/resume works the same as for files.

### 4.4 Mux at the end

When all segments are downloaded, concatenate into a single `.ts` stream, then run:

```
ffmpeg -y -i input.ts -c copy -bsf:a aac_adtstoasc -movflags +faststart output.mp4
```

Set status to `muxing` during this step (already supported in the UI).

### 4.5 Ship ffmpeg as a sidecar

Don't depend on the user having ffmpeg in `$PATH`. Bundle a static build per OS/arch in `native-host/bin/ffmpeg-<os>-<arch>`. Resolve the binary path relative to the daemon executable.

For licensing: use the LGPL static builds from <https://www.gyan.dev/ffmpeg/builds/> (Windows), <https://evermeet.cx/ffmpeg/> (macOS), and <https://johnvansickle.com/ffmpeg/> (Linux), and ship `COPYING.LGPLv2.1` alongside.

### 4.6 Explicit DRM refusal

Per CONTEXT.md §10: if the manifest references `#EXT-X-KEY:METHOD=SAMPLE-AES` or `<ContentProtection>` with a non-clear scheme, refuse the download and surface a UI message. Do **not** prompt for keys, do not implement Widevine.

Acceptance: a public HLS stream (e.g., Apple's Big Buck Bunny test stream) downloads with N parallel segment fetches and produces a playable MP4.

---

## Phase 5 — Scheduler & bandwidth (M5)

### 5.1 Queue with concurrency cap

Wrap `Engine.Start` in a queue: only N downloads (default 3) run concurrently; the rest sit in `queued`. When one finishes, the next dequeues.

Implementation: a buffered `chan struct{}` slot pool. Acquire on `Start`, release on completion.

### 5.2 Per-download and global throttling

Use `golang.org/x/time/rate.Limiter`. Two limiters per active segment:

- A per-download limiter shared across that download's tuyul pool.
- A global limiter shared across all downloads.

Wrap `resp.Body` in a token-bucket `io.Reader`:

```go
type throttledReader struct {
    r       io.Reader
    perDl   *rate.Limiter
    global  *rate.Limiter
}
```

Configure caps in the options page (KB/s) and via IPC `host.setThrottle`.

### 5.3 Time-window scheduling

Add `state.Schedule = { StartHour, EndHour, Days[] }`. A scheduler goroutine ticks once a minute; outside the window, pause active downloads with that schedule and unpause inside it.

Store the schedule in `DownloadState` so it survives restart.

### 5.4 Autoresume on daemon startup

Per Phase 1.3, downloads marked `paused` because of a crash should be auto-resumed if their schedule permits and the user hasn't explicitly paused them. Add a `WasUserPaused bool` flag so manual pauses stay paused.

Acceptance: queue 10 downloads, set global cap to 1 MB/s, only 3 run, total throughput stays under cap, and downloads outside an `02:00–06:00` window are paused.

---

## Phase 6 — Firefox port (M6)

### 6.1 Polyfill

Install `webextension-polyfill` and switch all `chrome.*` calls in `background.ts` / `content.ts` to `browser.*`. The polyfill makes `chrome.*` work on Firefox and vice versa.

### 6.2 Manifest differences

Firefox MV3 still requires `browser_specific_settings.gecko.id` and supports MV3 background as either a service worker (since FF 121) or an event page. Pick the event page for compatibility:

```json
"background": {
  "scripts": ["background.js"],
  "type": "module"
}
```

Use `@crxjs/vite-plugin`'s Firefox target, or maintain two manifest files merged at build time.

### 6.3 Native messaging on Firefox

Manifest path differs:

- Linux: `~/.mozilla/native-messaging-hosts/com.tuyuldm.daemon.json`
- macOS: `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.tuyuldm.daemon.json`
- Windows: registry under `HKEY_CURRENT_USER\Software\Mozilla\NativeMessagingHosts\com.tuyuldm.daemon`

The JSON format adds `"allowed_extensions": ["id@addons.mozilla.org"]` instead of `allowed_origins`. The installer script (Phase 7) must handle both.

### 6.4 webRequest blocking is fine on Firefox

Firefox keeps blocking `webRequest` in MV3 — your interception path can stay declarative on Chrome and blocking on Firefox if it simplifies things.

Acceptance: install via `about:debugging` → "Load Temporary Add-on", and a download from Firefox routes through the same host.

---

## Phase 7 — Installers and distribution (M7)

### 7.1 Cross-compile matrix

Set up GitHub Actions `build.yml`:

```yaml
strategy:
  matrix:
    include:
      - { os: ubuntu-latest, goos: linux, goarch: amd64 }
      - { os: ubuntu-latest, goos: linux, goarch: arm64 }
      - { os: macos-latest, goos: darwin, goarch: amd64 }
      - { os: macos-latest, goos: darwin, goarch: arm64 }
      - { os: windows-latest, goos: windows, goarch: amd64 }
```

Build `tuyuldm-daemon` for each, upload as artifacts.

### 7.2 Per-OS installer scripts

In `installers/`:

- `linux/install.sh` — places binary in `~/.local/bin/tuyuldm-daemon`, writes manifest to both Chrome and Firefox locations.
- `linux/tuyuldm.deb` and `tuyuldm.rpm` via `nfpm` (single YAML config).
- `linux/PKGBUILD` for AUR.
- `macos/install.sh` and a `.pkg` via `pkgbuild` + `productbuild`.
- `windows/install.ps1` and an `.msi` via WiX or [Tauri's bundler](https://tauri.app/v1/guides/building/windows/) if you want simpler tooling.

Each installer also handles uninstall.

### 7.3 Code signing

- **Windows**: EV or OV code signing cert (~$200–400/yr). Use `signtool` in CI. Without signing, SmartScreen will scare every user.
- **macOS**: Apple Developer Program ($99/yr), notarize with `notarytool`. Without notarization, Gatekeeper blocks the binary.
- **Linux**: not strictly required, but sign `.deb`/`.rpm` with GPG and publish the public key.

Store certs as encrypted GitHub secrets. CONTEXT.md §10 already flags this cost — budget for it.

### 7.4 Auto-update

Two practical paths:

- **GitHub Releases + manual update**: simplest, ship "Update available" UI in the popup that links to the latest release.
- **Sparkle-style auto-update**: ship an updater binary that polls `releases/latest`, downloads, verifies signature, swaps the binary. Use [`github.com/inconshreveable/go-update`](https://github.com/inconshreveable/go-update).

Start with manual; revisit auto-update after v1.0 ships.

### 7.5 Extension-detects-host onboarding

Per CONTEXT.md §8: when the extension starts and `connectNative` fails, show a friendly install card with an OS-detected download link. Implement this in the popup.

Acceptance: a fresh Windows VM with no Go, no ffmpeg, and no TuyulDM can install the `.msi`, install the extension from the Web Store, and complete a download in under 2 minutes.

---

## Phase 8 — Public 1.0 (M8)

### 8.1 Privacy policy and permissions justifications

Write a one-page privacy policy: no telemetry, no remote calls except to the URLs the user explicitly downloads, no analytics. Host on the docs site.

For Chrome Web Store, the listing form asks you to justify each permission. Pre-write these:

- `nativeMessaging` — talk to the local downloader daemon.
- `downloads` — intercept browser downloads.
- `webRequest` — detect video manifests, capture auth headers for downloads.
- `cookies` — pass session cookies to the daemon for authenticated downloads.
- `<all_urls>` (optional) — required because downloads can originate from any site; requested on-demand.

### 8.2 Docs site

`docs/` with [Docusaurus](https://docusaurus.io/) or a simple Astro Starlight. Cover:

- Quick start
- How interception works (set expectations re: which downloads get hijacked)
- HLS/DASH grabber usage and the DRM policy
- Troubleshooting native host issues per OS
- API/IPC reference for contributors

Deploy to GitHub Pages.

### 8.3 Web Store and AMO submission

- Chrome Web Store: $5 one-time fee, expect a permissions review (1–7 days).
- Mozilla AMO: free, expect a code review (2–10 days, depending on backlog). They will read every line — make sure no obfuscation, no remote code execution.

Prepare promo images: 1280×800 marketing tile, 440×280 small tile, screenshots of the popup and overlay.

### 8.4 Sponsors page

Open Collective or GitHub Sponsors. Add a `FUNDING.yml` to the repo. Mention the code-signing certificate cost as a concrete budget item.

### 8.5 Launch checklist

- [ ] All CI green on the cross-platform matrix
- [ ] `LICENSE`, `NOTICE`, `THIRD_PARTY_LICENSES.md` (for ffmpeg, bbolt, polyfill, etc.) present
- [ ] Privacy policy live
- [ ] Web Store listing submitted and approved
- [ ] AMO listing submitted and approved
- [ ] Docs site live
- [ ] Release notes drafted
- [ ] `v1.0.0` tag pushed, signed binaries attached
- [ ] Post on Hacker News / r/programming / r/firefox / r/chrome / Mastodon

---

## Cross-cutting work (do alongside phases)

### CI

- `lint`: `go vet ./...`, `staticcheck`, `npm run lint` (currently `tsc --noEmit`).
- `test`: `go test ./...` for the daemon, Playwright for the extension end-to-end.
- `build`: cross-compile matrix from Phase 7.1.
- Run on every PR; required for merge.

### Tests worth writing

- `engine_test.go`: spin up an `httptest.Server` that serves a known file with `Accept-Ranges`, verify a 4-segment download produces a byte-identical result; verify pause/resume.
- `engine_test.go`: server that returns 503 with `Retry-After: 1` — verify backoff.
- `hls_test.go`: parse a fixture playlist, verify segment URLs are resolved.
- Playwright: load the unpacked extension in Chromium, click a download link, assert the IPC call to the (faked) host fires.

### Observability

Add structured logging via `log/slog`. Write logs to a rotating file in the data dir (Phase 0.3). Add a "Open Logs" button in the popup.

### Security review before 1.0

- All IPC params validated server-side (no path traversal via `filename`).
- Downloads sandboxed to the configured download dir.
- TLS verification on by default; an "ignore cert" toggle is **per-download**, never global.
- No shell interpolation when invoking ffmpeg — use `exec.Command` argv form (already correct).

---

## Suggested order of work

If you want a single linear todo list:

1. Phase 0 (build hygiene) — half a day.
2. Phase 1.1, 1.2, 1.4 (engine correctness) — 2–3 days.
3. Phase 3.1 (extension bundle) — 1 day; unblocks real UI testing.
4. Phase 2.1, 2.3 (permissions and rules UI) — 1–2 days.
5. Phase 1.3, 1.5, 1.6 (durability and integrity) — 1–2 days.
6. Phase 5 (scheduler/throttle) — 2–3 days.
7. Phase 4 (real video grabber) — 3–5 days.
8. Phase 6 (Firefox) — 1–2 days.
9. Phase 7 (installers, signing) — 1 week including cert procurement.
10. Phase 8 (docs, listings) — 1 week including review wait.

Rough budget: 4–6 weeks of focused work to v1.0, plus ~2 weeks of store-review elapsed time.
