package voiceruntime

import (
	"encoding/json"
	"os"
	"path/filepath"

	"quant/internal/infra/paths"
	"quant/internal/integration/voice/engine/sherpaengine"
)

// State is the machine-owned install record. It lives in
// ~/.quant/voice/state.json and records what was installed and when. Kept out
// of the user-facing config.json (which is DTO-masked and round-trips through
// the Settings form) so runtime bookkeeping can never be clobbered by a
// config save.
type State struct {
	InstalledVersion string `json:"installedVersion"`
	Platform         string `json:"platform"`
	InstalledAt      string `json:"installedAt"`
	Managed          bool   `json:"managed"`
}

// runtimeDir is the install root (~/.quant/voice, honoring QUANT_HOME).
// Uninstall removes it wholesale, which also clears any legacy bin/, logs/,
// and run.json remnants from the old external-server runtime.
func runtimeDir() string { return paths.VoiceRuntimeDir() }

// modelsDir is where the model archives extract to ({runtimeDir}/models).
// Matches sherpaengine's Config.ModelsDir via paths.VoiceModelsDir().
func modelsDir() string { return paths.VoiceModelsDir() }

func stateFilePath() string { return filepath.Join(runtimeDir(), "state.json") }
func downloadsDir() string  { return filepath.Join(runtimeDir(), "downloads") }

// loadState reads state.json. A missing file yields a zeroed State rather than
// an error, so callers can treat "not installed" and "no state file"
// identically.
func loadState() (State, error) {
	var s State
	b, err := os.ReadFile(stateFilePath())
	if err != nil {
		if os.IsNotExist(err) {
			return State{}, nil
		}
		return State{}, err
	}
	if err := json.Unmarshal(b, &s); err != nil {
		return State{}, err
	}
	return s, nil
}

// saveState writes state.json atomically (temp file + rename) under the install
// dir, creating the dir if needed.
func saveState(s State) error {
	if err := os.MkdirAll(runtimeDir(), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := stateFilePath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, stateFilePath())
}

// modelInstalled reports whether one model dir is complete: every file the
// embedded engine requires from that dir exists. Dirs the engine does not know
// about (e.g. a test manifest's fake model) count as installed when present.
func modelInstalled(dir string) bool {
	required, known := sherpaengine.FilesByDir()[dir]
	if !known {
		fi, err := os.Stat(filepath.Join(modelsDir(), dir))
		return err == nil && fi.IsDir()
	}
	for _, f := range required {
		if _, err := os.Stat(filepath.Join(modelsDir(), dir, f)); err != nil {
			return false
		}
	}
	return true
}

// isInstalled reports whether the base voice models (Kokoro TTS + English
// Whisper) are fully present under the models dir. Base install alone means
// "voice installed"; an on-demand language pack (e.g. pt-br) present in the
// manifest but not on disk must NOT flip this to false.
func isInstalled() bool {
	for dir := range sherpaengine.BaseRequiredFiles() {
		if !modelInstalled(dir) {
			return false
		}
	}
	return true
}

// languageInstalled reports whether every model file required to serve lang is
// present on disk (used to tell whether an on-demand language pack has been
// installed yet).
func languageInstalled(lang string) bool {
	for dir := range sherpaengine.RequiredFilesFor(lang) {
		if !modelInstalled(dir) {
			return false
		}
	}
	return true
}

// dirSize sums the file sizes under root (best-effort; unreadable entries are
// skipped). Used to report the real on-disk size of an installed model.
func dirSize(root string) int64 {
	var total int64
	_ = filepath.Walk(root, func(_ string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil //nolint:nilerr // best-effort size
		}
		total += info.Size()
		return nil
	})
	return total
}
