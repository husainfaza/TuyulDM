# Context — TuyulDM

> _Your swarm of loyal tuyul, fetching files in parallel._

A free, open-source clone of Internet Download Manager (IDM), delivered as a browser extension backed by a local native helper. Targets Chromium browsers (Chrome, Brave) and Firefox.

**Name origin.** In Indonesian folklore, a _tuyul_ is a small spirit commanded by a master (_pawang_) to fetch valuables on their behalf. The metaphor fits the architecture exactly: the user is the pawang, and the daemon dispatches a swarm of parallel "tuyul" workers (HTTP Range segments) to retrieve a file faster than any single connection could. The `DM` suffix is a direct nod to IDM so the product category is obvious at first glance.

---

## 1. Problem

Built-in browser download managers are single-connection, lose progress on network drops, and have no scheduling, throttling, or video-stream capture. IDM has dominated this niche for ~20 years but is closed-source, Windows-only, and paid. There is no first-class, cross-platform, open-source alternative that lives where users actually start their downloads: the browser.

## 2. Target user

- Power users on slow / unstable connections (developing markets, rural broadband, mobile tethering) who feel the speed difference from multi-segment downloads.
- Users on metered connections who need bandwidth scheduling and pause/resume reliability.
- People who routinely save video lectures, conference talks, or other HLS/DASH content for offline viewing.
- Linux/macOS users locked out of IDM entirely.

## 3. Value proposition / differentiation

- **Cross-platform**: Chrome, Brave, Firefox on Windows, macOS, Linux. IDM is Windows-only.
- **Free and open source** (MIT or Apache-2.0, TBD).
- **Native speed via a real local daemon** — not a sandboxed extension faking it.
- **Modern stack** — Go for the daemon, MV3 extension, no legacy COM/Win32 baggage.

## 4. Scope — v1 features

All four are in scope for v1:

1. **Multi-segment download engine + pause/resume**
   - Split files into N parallel HTTP Range requests (default 8, configurable).
   - Persist segment state to disk so downloads survive crashes, reboots, and network drops.
   - Integrity check via Content-Length + optional checksum if server provides one.
2. **Browser link interception**
   - Capture clicks on download links and large-file navigations.
   - Hand them off to the native host instead of the browser's built-in downloader.
   - Pass through cookies, Referer, and User-Agent so authenticated downloads work.
3. **Video grabber (HLS / DASH)**
   - Content script sniffs `.m3u8` and `.mpd` manifests in network traffic.
   - Native host downloads all segments and muxes to MP4 (via embedded ffmpeg or a Go-native muxer).
   - Surfaces a "Download this video" button in the page overlay.
   - _Note:_ ship with a clear "respect site ToS / copyright" notice; do not bundle DRM circumvention.
4. **Scheduler + bandwidth limits**
   - Queue with concurrency cap, per-download and global throttling (KB/s).
   - Time-window scheduling (e.g., "run between 02:00 and 06:00").
   - Resume queue automatically on host startup.

### Explicitly out of scope for v1

- Cloud sync of download history across devices.
- Mobile (no extension story on iOS/Android Chrome).
- Torrent / magnet links (different protocol, large extra surface).
- Browser integration beyond Chrome / Brave / Firefox (Edge, Safari can come later).

## 5. Architecture

The internal vocabulary leans into the tuyul metaphor:

- **Pawang** — the daemon's orchestrator that owns the queue and dispatches workers.
- **Tuyul** — an individual segment worker (one HTTP Range fetch).
- **Kantong** — the on-disk container holding partial segments before they are assembled.

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  Browser Extension (MV3)    │         │   Native Host (Go daemon)    │
│                             │         │                              │
│  ┌──────────────────────┐   │ Native  │  ┌────────────────────────┐  │
│  │ background SW        │◄──┼─Messag.─┼─►│ JSON-RPC server        │  │
│  │  - intercept clicks  │   │  (NDJSON│  │                        │  │
│  │  - link sniffer      │   │  over   │  │  ┌──────────────────┐  │  │
│  │  - manifest sniffer  │   │  stdin/ │  │  │ Pawang (engine)  │  │  │
│  └──────────────────────┘   │  stdout)│  │  │  - segmenter     │  │  │
│  ┌──────────────────────┐   │         │  │  │  - tuyul pool    │  │  │
│  │ popup / options UI   │   │         │  │  │  - resumer       │  │  │
│  │  (React + Tailwind)  │   │         │  │  └──────────────────┘  │  │
│  └──────────────────────┘   │         │  ┌──────────────────────┐  │  │
│  ┌──────────────────────┐   │         │  │ Scheduler / queue    │  │  │
│  │ page overlay         │   │         │  └──────────────────────┘  │  │
│  │ (video grab button)  │   │         │  ┌──────────────────────┐  │  │
│  └──────────────────────┘   │         │  │ HLS/DASH muxer       │  │  │
└─────────────────────────────┘         │  │  (ffmpeg or native)  │  │  │
                                        │  └──────────────────────┘  │  │
                                        │  ┌──────────────────────┐  │  │
                                        │  │ Kantong (BoltDB +    │  │  │
                                        │  │ sparse segment files)│  │  │
                                        │  └──────────────────────┘  │  │
                                        └──────────────────────────────┘
```

### Communication

- **Native Messaging API** (Chrome / Brave / Firefox all support it).
- Browser launches the host on demand; host stays alive while extension port is open.
- Wire format: newline-delimited JSON messages with `id`, `method`, `params` / `result`.
- For large progress streams, host pushes throttled status events (~4 Hz) per active download.

### Why a native host (vs. pure extension)

- MV3 service workers have aggressive lifecycle limits — unsuitable for hour-long downloads.
- `chrome.downloads` doesn't expose segmentation or fine-grained throttling.
- Browsers cap concurrent connections per host; bypassing this is a core IDM feature.
- Disk I/O for sparse-file segment writes needs real filesystem access.

## 6. Tech stack

| Layer        | Choice                                                                                               | Rationale                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Extension    | TypeScript + React + Tailwind, Manifest V3                                                           | Standard MV3 stack; works on Chrome/Brave and Firefox MV3.                                            |
| Build        | Vite + `@crxjs/vite-plugin`                                                                          | Fast HMR for extension dev, single config for both targets.                                           |
| Native host  | **Go** (1.23+)                                                                                       | Single static binary per OS, strong stdlib HTTP, easy goroutines for segments, trivial cross-compile. |
| Storage      | BoltDB (embedded KV) or SQLite via modernc                                                           | No external DB; portable; fits a single-user daemon.                                                  |
| Video muxing | Embedded ffmpeg (sidecar binary) for v1                                                              | Battle-tested HLS/DASH support; revisit Go-native later.                                              |
| Installer    | Per-OS scripts (`.msi`, `.pkg`, `.deb`/`.rpm`, AUR) that register the Native Messaging host manifest | Required for browsers to find the host.                                                               |
| Packaging    | GitHub Releases + auto-update channel                                                                | Open-source distribution; signed binaries for Win/macOS.                                              |
| CI           | GitHub Actions (matrix: linux/macos/windows × amd64/arm64)                                           | Standard for OSS Go + JS projects.                                                                    |

## 7. Browser targets

- **Chrome / Brave** — single Manifest V3 codebase, Web Store distribution.
- **Firefox** — same MV3 codebase with minor API shims (`browser.*` vs `chrome.*`), AMO distribution.
- Edge, Safari, mobile: deferred.

## 8. Distribution & install flow

1. User installs extension from Chrome Web Store / AMO.
2. On first launch, extension detects the native host is missing and shows a one-click installer link for their OS.
3. Installer drops the Go binary in a standard location and writes the Native Messaging manifest into the correct per-browser path.
4. Extension reconnects and is ready.

Manifest paths (for reference, the installer handles these):

- Chrome / Brave: `~/.config/google-chrome/NativeMessagingHosts/` (Linux), `%LOCALAPPDATA%\...` (Windows), `~/Library/Application Support/...` (macOS).
- Firefox: equivalent `NativeMessagingHosts` dirs under the Firefox profile root.

## 9. Monetization

**Free and open source.** No paid tier, no telemetry, no upsell.

- License: MIT or Apache-2.0 (decide before first release).
- Optional GitHub Sponsors / Open Collective for donations.
- Reputation play, not a revenue play — value is in trust, openness, and being the obvious default for users who don't want a closed Windows-only app.

## 10. Risks & open questions

- **Web Store policy**: Chrome and Mozilla both scrutinize extensions that intercept downloads or grab video. Plan for a careful permissions story and a clear privacy policy. Avoid `<all_urls>` host permissions if at all possible.
- **Video grabber + DMCA**: do not target DRM-protected services (Netflix, etc.). Limit to publicly served HLS/DASH and document acceptable use.
- **Native host install friction** is the single biggest UX cost. Mitigation: signed installers, one-click flow, and graceful degradation (extension still works for normal browser downloads when host is absent).
- **Code signing certs** for Windows / macOS cost money even for OSS — factor into the launch plan.
- **Concurrent-connection abuse**: servers may rate-limit or ban aggressive segmenting. Default to conservative segment counts and respect `Retry-After`.

## 11. Milestones (suggested)

| Milestone         | Scope                                                                        |
| ----------------- | ---------------------------------------------------------------------------- |
| M0 — Skeleton     | Extension ↔ Go host handshake over Native Messaging; "hello world" download. |
| M1 — Engine       | Multi-segment HTTP Range downloader with pause/resume + on-disk state.       |
| M2 — Interception | Replace browser default for direct file links; cookie/auth passthrough.      |
| M3 — UI           | Popup queue UI, options page, progress overlay.                              |
| M4 — Video        | HLS/DASH sniffer + ffmpeg muxing.                                            |
| M5 — Scheduler    | Queue, bandwidth caps, time-window scheduling.                               |
| M6 — Firefox      | Port to MV3 Firefox, AMO submission.                                         |
| M7 — Installers   | Signed installers for Windows, macOS, Linux; auto-update channel.            |
| M8 — Public 1.0   | Web Store / AMO submission, docs site, sponsors page.                        |

## 12. Glossary

- **MV3** — Chrome's Manifest V3 extension format.
- **Native Messaging** — browser API that lets an extension exchange stdin/stdout JSON messages with a locally installed binary.
- **Range request** — HTTP `Range: bytes=…` header used to fetch byte ranges of a resource; foundation of multi-segment download.
- **HLS / DASH** — adaptive bitrate streaming protocols (`.m3u8` / `.mpd` manifests).
- **Tuyul** — folkloric Indonesian spirit; in this project, the codename for an individual segment worker.
- **Pawang** — the tuyul's master; in this project, the daemon's orchestrator that dispatches and supervises tuyul workers.
- **Kantong** — Indonesian for "pouch"; the on-disk store of partial segments awaiting assembly.
