// Package voiceruntime downloads and installs the local speech models
// (Whisper STT + Kokoro TTS, both int8 ONNX) that the embedded sherpa-onnx
// engine loads, so the user can enable voice mode with a single "Download
// voice mode" click — no terminal, Docker, or Python required.
//
// Design mirrors internal/integration/remote: a Manager owns the lifecycle and
// is the single control surface a thin Wails controller binds to. There are no
// child processes to supervise anymore — inference runs in-process via
// internal/integration/voice/engine/sherpaengine; this package only manages
// the model files on disk.
package voiceruntime

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

// defaultManifestJSON is the manifest pinned to this quant build (schema 2):
// the upstream sherpa-onnx model archives with verified sha256 + sizes. A
// local or hosted manifest can be substituted at runtime via
// QUANT_VOICE_MANIFEST_URL (an http(s):// URL or a filesystem path) — used by
// E2E to point at local copies of the tarballs instead of a ~730 MB download.
//
//go:embed manifest.json
var defaultManifestJSON []byte

// ModelArtifact is one downloadable model archive (.tar.bz2 or .tar.gz).
type ModelArtifact struct {
	// Name is the short human label streamed in progress events and shown as a
	// chip in Settings (e.g. "kokoro tts").
	Name string `json:"name"`
	// URL is an http(s):// URL, or a local filesystem path (tests/E2E).
	URL string `json:"url"`
	// SHA256 is the archive digest, lowercase hex; verified after download.
	SHA256 string `json:"sha256"`
	// Size is the archive byte size; drives the download progress %.
	Size int64 `json:"size"`
	// Dir is the top-level directory the archive extracts to under the models
	// dir. Must match the sherpaengine model dir consts.
	Dir string `json:"dir"`
	// Lang tags an artifact with the language it enables. Empty (or "base")
	// means it is part of the always-installed base set (Kokoro TTS + English
	// Whisper); a value like "pt-br" means it is installed on demand only when
	// the user selects that voice language.
	Lang string `json:"lang,omitempty"`
}

// isBase reports whether the artifact belongs to the always-installed base set
// (English STT + Kokoro TTS) rather than an on-demand language pack.
func (a ModelArtifact) isBase() bool {
	return a.Lang == "" || a.Lang == "base"
}

// DownloadManifest is the small, version-pinned index of model archives.
type DownloadManifest struct {
	Schema  int             `json:"schema"`
	Version string          `json:"version"`
	Models  []ModelArtifact `json:"models"`
}

// platformKey names the running host (informational, reported in Status).
func platformKey() string { return runtime.GOOS + "/" + runtime.GOARCH }

// loadManifest resolves the download manifest, honoring the
// QUANT_VOICE_MANIFEST_URL override (http(s):// or a local path) and falling
// back to the embedded default.
func loadManifest() (*DownloadManifest, error) {
	raw := defaultManifestJSON
	if override := strings.TrimSpace(os.Getenv("QUANT_VOICE_MANIFEST_URL")); override != "" {
		b, err := readSource(override)
		if err != nil {
			return nil, fmt.Errorf("load voice manifest from %q: %w", override, err)
		}
		raw = b
	}
	var m DownloadManifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("parse voice manifest: %w", err)
	}
	return &m, nil
}

// readSource fetches bytes from an http(s):// URL or a local filesystem path.
// Local paths let tests/E2E point at a hand-rolled manifest without a server.
func readSource(src string) ([]byte, error) {
	if isHTTP(src) {
		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Get(src)
		if err != nil {
			return nil, err
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("unexpected HTTP %d", resp.StatusCode)
		}
		return io.ReadAll(resp.Body)
	}
	return os.ReadFile(src)
}

func isHTTP(src string) bool {
	return strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://")
}
