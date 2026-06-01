package controller

import (
	"context"

	"quant/internal/integration/remote"
)

// remoteController is bound to the Wails runtime and exposes remote-access
// control (enable/disable the browser tunnel, status, passcode) to the frontend.
type remoteController struct {
	ctx     context.Context
	manager *remote.Manager
}

// NewRemoteController creates a new remote-access controller.
func NewRemoteController(manager *remote.Manager) *remoteController {
	return &remoteController{manager: manager}
}

// OnStartup is called when the Wails app starts.
func (c *remoteController) OnStartup(ctx context.Context) { c.ctx = ctx }

// OnShutdown is called when the Wails app is shutting down.
func (c *remoteController) OnShutdown(_ context.Context) {}

// GetRemoteAccessStatus returns the current remote-access snapshot.
func (c *remoteController) GetRemoteAccessStatus() remote.Status {
	return c.manager.Status()
}

// EnableRemoteAccess starts the server + Cloudflare tunnel.
func (c *remoteController) EnableRemoteAccess() (remote.Status, error) {
	return c.manager.Enable()
}

// DisableRemoteAccess stops the server + tunnel.
func (c *remoteController) DisableRemoteAccess() (remote.Status, error) {
	return c.manager.Disable()
}

// RegenerateRemotePasscode rotates the passcode (invalidating live sessions).
func (c *remoteController) RegenerateRemotePasscode() (remote.Status, error) {
	return c.manager.RegeneratePasscode()
}
