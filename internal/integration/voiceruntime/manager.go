package voiceruntime

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"time"

	"quant/internal/domain/entity"
	"quant/internal/integration/voice/engine/sherpaengine"
)

// ConfigStore is the minimal config persistence the Manager needs to record the
// user's managed-runtime intent. Satisfied by injector.ConfigPersistence().
type ConfigStore interface {
	LoadConfig() (*entity.Config, error)
	SaveConfig(cfg *entity.Config) error
}

// EmitFunc delivers an event to the desktop webview and remote browser clients.
// Satisfied by remote.Emit.
type EmitFunc func(ctx context.Context, event string, data interface{})

// Unloader releases the in-process speech models. Satisfied by
// *sherpaengine.Engine; Uninstall must call it BEFORE deleting the model files
// so no loaded model keeps stale file handles / memory around.
type Unloader interface {
	Unload()
}

// runtimeEventName is the single event channel the Settings UI subscribes to
// for install progress.
const runtimeEventName = "voice:runtime"

// ModelStatus is the per-model snapshot returned to the UI.
type ModelStatus struct {
	Name      string `json:"name"`
	Installed bool   `json:"installed"`
	// SizeBytes is the on-disk size when installed, else the download size from
	// the manifest.
	SizeBytes int64 `json:"sizeBytes"`
}

// Status is the aggregate snapshot the Settings UI renders.
type Status struct {
	Installed  bool          `json:"installed"`
	Installing bool          `json:"installing"`
	Managed    bool          `json:"managed"`
	Version    string        `json:"version"`
	Platform   string        `json:"platform"`
	Models     []ModelStatus `json:"models"`
	Error      string        `json:"error,omitempty"`
}

// RuntimeEvent is the payload streamed on the voice:runtime channel. Engine
// carries the model name (kept as "engine" for frontend compatibility).
type RuntimeEvent struct {
	Phase   string `json:"phase"` // download|verify|extract|ready|idle|error
	Engine  string `json:"engine,omitempty"`
	Done    int64  `json:"done,omitempty"`
	Total   int64  `json:"total,omitempty"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

// pruneAfterExtract lists files deleted from a model dir right after extract.
// The whisper archive ships both fp32 and int8 models; the embedded engine
// only loads int8, so dropping the fp32 pair saves ~450 MB of disk.
var pruneAfterExtract = map[string][]string{
	sherpaengine.WhisperDirName: {
		"small.en-encoder.onnx",
		"small.en-decoder.onnx",
	},
}

// Manager owns the voice-model install lifecycle and is the single control
// surface the VoiceRuntimeController binds to. Mirrors remote.Manager.
type Manager struct {
	store  ConfigStore
	emit   EmitFunc
	engine Unloader

	mu         sync.Mutex
	ctx        context.Context
	installing bool
	lastErr    string
}

// NewManager wires the manager with config persistence, the event emitter, and
// the shared embedded engine (unloaded before uninstall deletes model files).
func NewManager(store ConfigStore, emit EmitFunc, engine Unloader) *Manager {
	return &Manager{store: store, emit: emit, engine: engine}
}

// SetContext records the Wails app context so events reach the desktop webview.
func (m *Manager) SetContext(ctx context.Context) {
	m.mu.Lock()
	m.ctx = ctx
	m.mu.Unlock()
}

// Install downloads, verifies, and extracts every model that is not already on
// disk. It runs asynchronously (the download is ~730 MB): it returns an
// immediate Status with Installing=true and streams progress on voice:runtime,
// ending with a "ready" event (which the UI uses to auto-enable voice).
func (m *Manager) Install() (Status, error) {
	m.mu.Lock()
	if m.installing {
		st := m.statusLocked()
		m.mu.Unlock()
		return st, nil
	}
	m.installing = true
	m.lastErr = ""
	m.mu.Unlock()

	go m.doInstall()

	return m.Status(), nil
}

func (m *Manager) doInstall() {
	defer func() {
		m.mu.Lock()
		m.installing = false
		m.mu.Unlock()
	}()

	manifest, err := loadManifest()
	if err != nil {
		m.fail(err)
		return
	}

	for _, model := range manifest.Models {
		if modelInstalled(model.Dir) {
			continue
		}
		name := model.Name
		m.emitEvent(RuntimeEvent{Phase: "download", Engine: name, Total: model.Size, Message: "downloading " + name})
		err := downloadAndExtract(model, func(phase string, done, total int64) {
			m.emitEvent(RuntimeEvent{Phase: phase, Engine: name, Done: done, Total: total})
		})
		if err != nil {
			m.fail(err)
			return
		}
		for _, f := range pruneAfterExtract[model.Dir] {
			_ = os.Remove(filepath.Join(modelsDir(), model.Dir, f))
		}
	}

	// Persist install facts (state.json) and the user's managed-runtime intent.
	st := State{
		InstalledVersion: manifest.Version,
		Platform:         platformKey(),
		InstalledAt:      time.Now().UTC().Format(time.RFC3339),
		Managed:          true,
	}
	if err := saveState(st); err != nil {
		m.fail(err)
		return
	}
	m.markManagedIntent(true)

	m.emitEvent(RuntimeEvent{Phase: "ready", Message: "voice is ready"})
}

// Uninstall unloads the in-process models and removes the whole voice runtime
// dir (models, state.json, and any legacy bin/run.json/logs remnants), then
// clears the managed-runtime intent so the UI reverts to the "download" state.
func (m *Manager) Uninstall() (Status, error) {
	if m.engine != nil {
		m.engine.Unload()
	}
	if err := os.RemoveAll(runtimeDir()); err != nil {
		m.fail(err)
		return m.Status(), err
	}
	m.mu.Lock()
	m.lastErr = ""
	m.mu.Unlock()
	m.markManagedIntent(false)
	m.emitEvent(RuntimeEvent{Phase: "idle", Message: "voice models removed"})
	return m.Status(), nil
}

// Status returns the aggregate snapshot.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}

func (m *Manager) statusLocked() Status {
	st := Status{
		Installed:  isInstalled(),
		Installing: m.installing,
		Platform:   platformKey(),
		Models:     modelStatuses(),
		Error:      m.lastErr,
	}
	if s, err := loadState(); err == nil {
		st.Version = s.InstalledVersion
		st.Managed = s.Managed
	}
	return st
}

// modelStatuses builds the per-model snapshot from the manifest (falling back
// to the engine's required model dirs when the manifest cannot be read, so the
// UI still shows install state). Always returns a non-nil slice.
func modelStatuses() []ModelStatus {
	out := []ModelStatus{}
	manifest, err := loadManifest()
	if err == nil {
		for _, model := range manifest.Models {
			out = append(out, modelStatus(model.Name, model.Dir, model.Size))
		}
		return out
	}
	for _, dir := range []string{sherpaengine.KokoroDirName, sherpaengine.WhisperDirName} {
		out = append(out, modelStatus(dir, dir, 0))
	}
	return out
}

func modelStatus(name, dir string, downloadSize int64) ModelStatus {
	installed := modelInstalled(dir)
	size := downloadSize
	if installed {
		size = dirSize(filepath.Join(modelsDir(), dir))
	}
	return ModelStatus{Name: name, Installed: installed, SizeBytes: size}
}

// fail records an install error and emits it to the UI.
func (m *Manager) fail(err error) {
	m.mu.Lock()
	m.lastErr = err.Error()
	m.mu.Unlock()
	m.emitEvent(RuntimeEvent{Phase: "error", Error: err.Error()})
}

// markManagedIntent flips Config.Voice.ManagedRuntime so the Settings form
// reflects whether the user opted into the quant-managed models.
func (m *Manager) markManagedIntent(on bool) {
	cfg, err := m.store.LoadConfig()
	if err != nil || cfg == nil {
		c := entity.NewDefaultConfig()
		cfg = &c
	}
	cfg.Voice.ManagedRuntime = on
	cfg.Voice = cfg.Voice.WithDefaults()
	_ = m.store.SaveConfig(cfg)
}

// emitEvent publishes a RuntimeEvent on the voice:runtime channel.
func (m *Manager) emitEvent(ev RuntimeEvent) {
	m.mu.Lock()
	ctx := m.ctx
	m.mu.Unlock()
	if m.emit != nil {
		m.emit(ctx, runtimeEventName, ev)
	}
}
