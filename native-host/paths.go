package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// DataDir returns the per-user data directory for TuyulDM, creating it if needed.
//
//   Linux:   $XDG_DATA_HOME/tuyuldm  (fallback ~/.local/share/tuyuldm)
//   macOS:   ~/Library/Application Support/TuyulDM
//   Windows: %LOCALAPPDATA%\TuyulDM  (fallback %APPDATA%\TuyulDM)
func DataDir() (string, error) {
	dir, err := resolveDataDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create data dir %q: %w", dir, err)
	}
	return dir, nil
}

func resolveDataDir() (string, error) {
	switch runtime.GOOS {
	case "linux":
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, "tuyuldm"), nil
		}
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".local", "share", "tuyuldm"), nil

	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support", "TuyulDM"), nil

	case "windows":
		if base := os.Getenv("LOCALAPPDATA"); base != "" {
			return filepath.Join(base, "TuyulDM"), nil
		}
		if base := os.Getenv("APPDATA"); base != "" {
			return filepath.Join(base, "TuyulDM"), nil
		}
		return "", fmt.Errorf("neither LOCALAPPDATA nor APPDATA is set")

	default:
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, ".tuyuldm"), nil
	}
}

// DownloadsDir returns the default per-user downloads target inside DataDir.
// Phase 3 will let the user override this from the options page.
func DownloadsDir() (string, error) {
	root, err := DataDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(root, "downloads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create downloads dir %q: %w", dir, err)
	}
	return dir, nil
}
