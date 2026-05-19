#!/usr/bin/env bash
# install-host.sh — register the TuyulDM native messaging host with the local browser.
#
# Usage:
#   scripts/install-host.sh <EXTENSION_ID> [path/to/tuyuldm-daemon]
#
# If the daemon path is omitted, we build it from native-host/ and use the
# resulting binary's absolute path.
#
# Supports Chrome, Brave, and Chromium on Linux and macOS. Firefox is handled
# in Phase 6 — see BUILD_PLAN.md.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <EXTENSION_ID> [path/to/tuyuldm-daemon]" >&2
  exit 64
fi

EXTENSION_ID="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DAEMON_PATH="${2:-}"

if [[ -z "$DAEMON_PATH" ]]; then
  echo "Building daemon..."
  (cd "$REPO_ROOT/native-host" && go build -o tuyuldm-daemon ./...)
  DAEMON_PATH="$REPO_ROOT/native-host/tuyuldm-daemon"
fi

if [[ ! -x "$DAEMON_PATH" ]]; then
  echo "error: $DAEMON_PATH is not an executable file" >&2
  exit 1
fi
DAEMON_PATH="$(cd "$(dirname "$DAEMON_PATH")" && pwd)/$(basename "$DAEMON_PATH")"

TEMPLATE="$REPO_ROOT/extension/com.tuyuldm.daemon.json.template"
if [[ ! -f "$TEMPLATE" ]]; then
  echo "error: template not found at $TEMPLATE" >&2
  exit 1
fi

# Render template
rendered="$(sed -e "s|__DAEMON_PATH__|$DAEMON_PATH|g" -e "s|__EXTENSION_ID__|$EXTENSION_ID|g" "$TEMPLATE")"

# Resolve per-OS target dirs for Chromium-family browsers
case "$(uname -s)" in
  Linux)
    targets=(
      "$HOME/.config/google-chrome/NativeMessagingHosts"
      "$HOME/.config/chromium/NativeMessagingHosts"
      "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
    ;;
  Darwin)
    targets=(
      "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
      "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
      "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    )
    ;;
  *)
    echo "error: unsupported OS $(uname -s); use scripts/install-host.ps1 on Windows" >&2
    exit 1
    ;;
esac

installed=0
for dir in "${targets[@]}"; do
  parent="$(dirname "$dir")"
  if [[ ! -d "$parent" ]]; then
    continue   # browser not installed
  fi
  mkdir -p "$dir"
  out="$dir/com.tuyuldm.daemon.json"
  printf '%s\n' "$rendered" > "$out"
  echo "wrote $out"
  installed=$((installed + 1))
done

if [[ $installed -eq 0 ]]; then
  echo "warning: no supported browsers found; nothing installed" >&2
  exit 2
fi

echo "done. registered daemon at $DAEMON_PATH for extension $EXTENSION_ID"
