package voiceruntime

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"quant/internal/domain/entity"
	"quant/internal/integration/voice/engine/sherpaengine"
)

// makeModelArchive builds a .tar.gz model archive containing the given files
// and (empty) directories under topDir, returning its bytes and hex sha256.
// The extractor sniffs compression by magic, so gzip fixtures exercise the
// same code path as the real bzip2 archives (bz2 is covered separately by an
// embedded fixture, since stdlib has no bzip2 writer).
func makeModelArchive(t *testing.T, topDir string, files []string, dirs []string) ([]byte, string) {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)

	writeDir := func(name string) {
		if err := tw.WriteHeader(&tar.Header{Name: name + "/", Mode: 0o755, Typeflag: tar.TypeDir}); err != nil {
			t.Fatal(err)
		}
	}
	writeDir(topDir)
	for _, d := range dirs {
		writeDir(topDir + "/" + d)
	}
	for _, f := range files {
		body := []byte("fake contents of " + f)
		if err := tw.WriteHeader(&tar.Header{Name: topDir + "/" + f, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write(body); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}

	sum := sha256.Sum256(buf.Bytes())
	return buf.Bytes(), hex.EncodeToString(sum[:])
}

// writeLocalManifest writes a schema-2 manifest whose model URLs are local
// file paths, points QUANT_VOICE_MANIFEST_URL at it, and returns the manifest.
// This is the same mechanism E2E uses to avoid the ~730 MB download.
func writeLocalManifest(t *testing.T, models []ModelArtifact) DownloadManifest {
	t.Helper()
	m := DownloadManifest{Schema: 2, Version: "test-models", Models: models}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(t.TempDir(), "manifest.json")
	if err := os.WriteFile(p, b, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("QUANT_VOICE_MANIFEST_URL", p)
	return m
}

// fakeStore is an in-memory ConfigStore.
type fakeStore struct {
	mu  sync.Mutex
	cfg *entity.Config
}

func (s *fakeStore) LoadConfig() (*entity.Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg, nil
}

func (s *fakeStore) SaveConfig(cfg *entity.Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
	return nil
}

func (s *fakeStore) managedRuntime() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg != nil && s.cfg.Voice.ManagedRuntime
}

// eventCollector is a race-safe EmitFunc recorder.
type eventCollector struct {
	mu     sync.Mutex
	events []RuntimeEvent
}

func (c *eventCollector) emit(_ context.Context, event string, data interface{}) {
	if event != runtimeEventName {
		return
	}
	ev, ok := data.(RuntimeEvent)
	if !ok {
		return
	}
	c.mu.Lock()
	c.events = append(c.events, ev)
	c.mu.Unlock()
}

func (c *eventCollector) phases() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, 0, len(c.events))
	for _, ev := range c.events {
		out = append(out, ev.Phase)
	}
	return out
}

func (c *eventCollector) has(phase string) bool {
	for _, p := range c.phases() {
		if p == phase {
			return true
		}
	}
	return false
}

// unloadRecorder records whether Unload ran while the models dir still existed
// (Uninstall must unload BEFORE deleting model files).
type unloadRecorder struct {
	mu                 sync.Mutex
	called             bool
	modelsDirStillHere bool
}

func (u *unloadRecorder) Unload() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.called = true
	_, err := os.Stat(modelsDir())
	u.modelsDirStillHere = err == nil
}

// waitInstalled polls the manager until the async install settles.
func waitInstalled(t *testing.T, m *Manager) Status {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		st := m.Status()
		if !st.Installing {
			return st
		}
		if time.Now().After(deadline) {
			t.Fatalf("install did not settle: %+v", st)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// realModelFixtures builds archives for the two real model dirs: every file
// sherpaengine requires (so isInstalled flips true), plus — for whisper — the
// fp32 files the installer must prune.
func realModelFixtures(t *testing.T) []ModelArtifact {
	t.Helper()
	required := sherpaengine.RequiredFiles()

	// Kokoro: espeak-ng-data and dict are directories on disk.
	kokoroDirs := []string{"espeak-ng-data", "dict"}
	var kokoroFiles []string
	for _, f := range required[sherpaengine.KokoroDirName] {
		if f == "espeak-ng-data" || f == "dict" {
			continue
		}
		kokoroFiles = append(kokoroFiles, f)
	}
	kokoroData, kokoroSum := makeModelArchive(t, sherpaengine.KokoroDirName, kokoroFiles, kokoroDirs)

	whisperFiles := append([]string{}, required[sherpaengine.WhisperDirName]...)
	whisperFiles = append(whisperFiles, "small.en-encoder.onnx", "small.en-decoder.onnx") // fp32, must be pruned
	whisperData, whisperSum := makeModelArchive(t, sherpaengine.WhisperDirName, whisperFiles, nil)

	dir := t.TempDir()
	kokoroPath := filepath.Join(dir, "kokoro.tar.gz")
	whisperPath := filepath.Join(dir, "whisper.tar.gz")
	if err := os.WriteFile(kokoroPath, kokoroData, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(whisperPath, whisperData, 0o644); err != nil {
		t.Fatal(err)
	}

	return []ModelArtifact{
		{Name: "kokoro tts", URL: kokoroPath, SHA256: kokoroSum, Size: int64(len(kokoroData)), Dir: sherpaengine.KokoroDirName},
		{Name: "whisper stt", URL: whisperPath, SHA256: whisperSum, Size: int64(len(whisperData)), Dir: sherpaengine.WhisperDirName},
	}
}

func TestInstallStatusUninstallFlow(t *testing.T) {
	t.Setenv("QUANT_HOME", t.TempDir())
	writeLocalManifest(t, realModelFixtures(t))

	store := &fakeStore{}
	events := &eventCollector{}
	unloader := &unloadRecorder{}
	m := NewManager(store, events.emit, unloader)

	if st := m.Status(); st.Installed || len(st.Models) != 2 || st.Models[0].Installed {
		t.Fatalf("unexpected pre-install status: %+v", st)
	}

	if _, err := m.Install(); err != nil {
		t.Fatalf("Install: %v", err)
	}
	st := waitInstalled(t, m)

	if st.Error != "" {
		t.Fatalf("install error: %s", st.Error)
	}
	if !st.Installed || !st.Managed || st.Version != "test-models" {
		t.Fatalf("unexpected post-install status: %+v", st)
	}
	for _, ms := range st.Models {
		if !ms.Installed || ms.SizeBytes <= 0 {
			t.Fatalf("model %q not reported installed with on-disk size: %+v", ms.Name, ms)
		}
	}
	if !isInstalled() {
		t.Fatal("expected all required model files on disk")
	}
	// fp32 whisper files must be pruned; int8 must remain.
	whisperDir := filepath.Join(modelsDir(), sherpaengine.WhisperDirName)
	for _, gone := range []string{"small.en-encoder.onnx", "small.en-decoder.onnx"} {
		if _, err := os.Stat(filepath.Join(whisperDir, gone)); !os.IsNotExist(err) {
			t.Fatalf("expected fp32 file %s to be pruned", gone)
		}
	}
	if _, err := os.Stat(filepath.Join(whisperDir, "small.en-encoder.int8.onnx")); err != nil {
		t.Fatalf("int8 whisper file missing after prune: %v", err)
	}
	if !events.has("download") || !events.has("extract") || !events.has("ready") {
		t.Fatalf("expected download/extract/ready events, got %v", events.phases())
	}
	if !store.managedRuntime() {
		t.Fatal("expected ManagedRuntime=true after install")
	}

	// Re-install with everything present: models are skipped, still ends ready.
	before := len(events.phases())
	if _, err := m.Install(); err != nil {
		t.Fatalf("re-Install: %v", err)
	}
	waitInstalled(t, m)
	newPhases := events.phases()[before:]
	for _, p := range newPhases {
		if p == "download" {
			t.Fatalf("re-install must skip installed models, got phases %v", newPhases)
		}
	}
	if newPhases[len(newPhases)-1] != "ready" {
		t.Fatalf("re-install must end ready, got %v", newPhases)
	}

	// Uninstall: unload first, then remove everything, then clear intent.
	st, err := m.Uninstall()
	if err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if !unloader.called || !unloader.modelsDirStillHere {
		t.Fatalf("engine.Unload must run before model files are deleted: %+v", unloader)
	}
	if st.Installed || st.Managed {
		t.Fatalf("unexpected post-uninstall status: %+v", st)
	}
	if _, err := os.Stat(runtimeDir()); !os.IsNotExist(err) {
		t.Fatal("expected voice runtime dir to be removed")
	}
	if store.managedRuntime() {
		t.Fatal("expected ManagedRuntime=false after uninstall")
	}
	if !events.has("idle") {
		t.Fatalf("expected idle event after uninstall, got %v", events.phases())
	}
}

func TestInstallFailsOnChecksumMismatch(t *testing.T) {
	t.Setenv("QUANT_HOME", t.TempDir())
	models := realModelFixtures(t)
	models[0].SHA256 = "deadbeef"
	writeLocalManifest(t, models)

	store := &fakeStore{}
	events := &eventCollector{}
	m := NewManager(store, events.emit, nil)

	if _, err := m.Install(); err != nil {
		t.Fatalf("Install: %v", err)
	}
	st := waitInstalled(t, m)
	if st.Installed || st.Error == "" {
		t.Fatalf("expected checksum failure, got %+v", st)
	}
	if !events.has("error") || events.has("ready") {
		t.Fatalf("expected error (and no ready) events, got %v", events.phases())
	}
	if store.managedRuntime() {
		t.Fatal("failed install must not mark ManagedRuntime")
	}
}

// fixtureTarBz2 is a tiny hand-made .tar.bz2 (fake-model/hello.txt) proving
// the extractor handles the real archives' bzip2 compression. stdlib cannot
// write bzip2, so the fixture is embedded pre-built.
const fixtureTarBz2 = "QlpoOTFBWSZTWbvgOccAAO7/vv65E4BQA//iPnb/cP/v/9AAQA4AAgAAAQgAEAhAAjwAAHMJoDQGjRhGgxGmJkxNBhGgZAMmBzCaA0Bo0YRoMRpiZMTQYRoGQDJgcwmgNAaNGEaDEaYmTE0GEaBkAyYBUlASnk00mm0NUep5MkYRoBmp6Am0JoyGnpPU/KnhZXuTpT/Hvljh2Pi7fFLWpK6GlYV8Gh2XUWBwKScqm43mC1B2lJLFEPW4FjUoTuO47q1uiaksQdgpGVTwKTaNKFjFYf6rmVc4G7/DQuJ3DxFjmUmgnElJXgqlbaehfLk38ulWi+17H3PM9/8244uspxpa2d7InGd9MEyz5nQul6t6ZROXdsRLFCZ0+9KJz+bierpvTElJy5pqpwqvlwoKZ30KW3JXExSxyU+pTK67+/mS/tW2ptJY47MP+8jG/Ou0PKvXTInlZnYlfi3bUvmONSWptTBasx25YlsmWrquyLLEqjGksYLrsjC3HkTdankfq001OF+intek6HtcjpMuspqbSxY9b3eH2NxT9ndYvU7FzBgt0szFsNC9zKT4p+753xT5JgmhOA+D+0z0wT0MTnS55XpTxpY8inG6k3E6nySi01pupatTk6r/Hza9PiTYl+TJWlPSmdzt9OyhrSjfOGTedabi9MUwOFM3ClJlS9M6crIlqbZY1p28UtTfTtzvNibSbbKZjPM+xN5LNadpgwMZ2cE1qRgbCxH/i7kinChIXfAc44A="

func TestExtractArchiveBzip2(t *testing.T) {
	data, err := base64.StdEncoding.DecodeString(fixtureTarBz2)
	if err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "fixture.tar.bz2")
	if err := os.WriteFile(archive, data, 0o644); err != nil {
		t.Fatal(err)
	}

	dest := t.TempDir()
	if err := extractArchive(archive, dest); err != nil {
		t.Fatalf("extractArchive(bz2): %v", err)
	}
	b, err := os.ReadFile(filepath.Join(dest, "fake-model", "hello.txt"))
	if err != nil {
		t.Fatalf("expected extracted file: %v", err)
	}
	if string(b) != "hello from bz2\n" {
		t.Fatalf("unexpected contents: %q", b)
	}
}

func TestExtractArchiveRejectsUnknownFormat(t *testing.T) {
	archive := filepath.Join(t.TempDir(), "junk.bin")
	if err := os.WriteFile(archive, []byte("not an archive"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := extractArchive(archive, t.TempDir()); err == nil {
		t.Fatal("expected unsupported-format error")
	}
}

func TestVerifySHA256(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "f")
	if err := os.WriteFile(p, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("hello"))
	good := hex.EncodeToString(sum[:])

	if err := verifySHA256(p, good); err != nil {
		t.Fatalf("expected match, got %v", err)
	}
	if err := verifySHA256(p, "deadbeef"); err == nil {
		t.Fatal("expected checksum mismatch error")
	}
	if err := verifySHA256(p, ""); err != nil {
		t.Fatalf("empty want should skip, got %v", err)
	}
}

func TestSafeJoinRejectsTraversal(t *testing.T) {
	dest := t.TempDir()
	if _, err := safeJoin(dest, "../escape"); err == nil {
		t.Fatal("expected traversal to be rejected")
	}
	if _, err := safeJoin(dest, "ok/inside.txt"); err != nil {
		t.Fatalf("expected safe path to be accepted, got %v", err)
	}
}

func TestStateRoundTrip(t *testing.T) {
	t.Setenv("QUANT_HOME", t.TempDir())

	// Missing file yields a zeroed state.
	s0, err := loadState()
	if err != nil {
		t.Fatalf("loadState (missing): %v", err)
	}
	if s0.Managed || s0.InstalledVersion != "" {
		t.Fatalf("unexpected empty state: %+v", s0)
	}

	want := State{InstalledVersion: "v9", Platform: "darwin/arm64", InstalledAt: "2026-07-03T00:00:00Z", Managed: true}
	if err := saveState(want); err != nil {
		t.Fatalf("saveState: %v", err)
	}
	got, err := loadState()
	if err != nil {
		t.Fatalf("loadState: %v", err)
	}
	if got != want {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}

func TestEmbeddedManifestIsPinned(t *testing.T) {
	var m DownloadManifest
	if err := json.Unmarshal(defaultManifestJSON, &m); err != nil {
		t.Fatalf("embedded manifest invalid: %v", err)
	}
	if m.Schema != 2 || len(m.Models) != 2 {
		t.Fatalf("expected schema-2 manifest with 2 models, got %+v", m)
	}
	dirs := map[string]bool{}
	for _, model := range m.Models {
		if model.URL == "" || len(model.SHA256) != 64 || model.Size <= 0 || model.Dir == "" || model.Name == "" {
			t.Fatalf("model not fully pinned: %+v", model)
		}
		dirs[model.Dir] = true
	}
	// The manifest dirs must be exactly the dirs the embedded engine loads.
	if !dirs[sherpaengine.KokoroDirName] || !dirs[sherpaengine.WhisperDirName] {
		t.Fatalf("manifest dirs must match sherpaengine model dirs, got %+v", dirs)
	}
}

func TestManifestOverride(t *testing.T) {
	m := writeLocalManifest(t, []ModelArtifact{{Name: "x", URL: "/tmp/x.tar.bz2", SHA256: "abc", Size: 10, Dir: "x-dir"}})

	got, err := loadManifest()
	if err != nil {
		t.Fatalf("loadManifest override: %v", err)
	}
	if got.Version != m.Version || len(got.Models) != 1 || got.Models[0].Dir != "x-dir" {
		t.Fatalf("expected overridden manifest, got %+v", got)
	}
}
