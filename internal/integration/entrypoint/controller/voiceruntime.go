package controller

import (
	"context"

	"quant/internal/integration/voiceruntime"
)

// voiceRuntimeController is bound to the Wails runtime and exposes one-click
// install/uninstall of the local speech models (whisper STT + kokoro TTS,
// loaded in-process by the embedded sherpa-onnx engine) to the frontend.
// Mirrors remoteController. Desktop-only: it is intentionally NOT reachable
// over the remote tunnel (installing/removing models from a remote browser is
// undesirable).
type voiceRuntimeController struct {
	ctx     context.Context
	manager *voiceruntime.Manager
}

// NewVoiceRuntimeController creates the voice-runtime controller.
func NewVoiceRuntimeController(manager *voiceruntime.Manager) *voiceRuntimeController {
	return &voiceRuntimeController{manager: manager}
}

// OnStartup records the app context so progress events reach the webview.
func (c *voiceRuntimeController) OnStartup(ctx context.Context) {
	c.ctx = ctx
	c.manager.SetContext(ctx)
}

// OnShutdown is a no-op; the shared embedded engine is unloaded by the voice
// controller's shutdown hook.
func (c *voiceRuntimeController) OnShutdown(_ context.Context) {}

// VoiceRuntimeStatus returns the current install + per-model snapshot.
func (c *voiceRuntimeController) VoiceRuntimeStatus() voiceruntime.Status {
	return c.manager.Status()
}

// InstallVoiceRuntime downloads + verifies + extracts the speech models.
// Returns immediately with Installing=true; progress streams on the
// voice:runtime event, ending with phase "ready".
func (c *voiceRuntimeController) InstallVoiceRuntime() (voiceruntime.Status, error) {
	return c.manager.Install()
}

// UninstallVoiceRuntime unloads the in-process models and removes them from disk.
func (c *voiceRuntimeController) UninstallVoiceRuntime() (voiceruntime.Status, error) {
	return c.manager.Uninstall()
}
