// Package controller contains Wails-bound entrypoint controllers.
package controller

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// LocalServerProvider starts (if needed) the loopback attach server and returns
// its port + bypass token. Backed by the remote.Manager.
type LocalServerProvider interface {
	EnsureLocalServer() (int, string, error)
}

// windowController opens a workspace in its own detached desktop window. The
// detached window is a second Quant process running as a thin client: its webview
// reverse-proxies to THIS process's loopback attach server (shared backend + DB +
// live events), pinned to the chosen workspace. See internal/infra/attach.go.
type windowController struct {
	local LocalServerProvider
}

// NewWindowController creates the window controller.
func NewWindowController(local LocalServerProvider) *windowController {
	return &windowController{local: local}
}

func (c *windowController) OnStartup(_ context.Context)  {}
func (c *windowController) OnShutdown(_ context.Context) {}

// OpenWorkspaceWindow launches a new detached window pinned to workspaceID. It
// ensures the loopback attach server is running, then spawns the current
// executable as a thin-client child (QUANT_ATTACH_* env). The child shares this
// process's backend over loopback, so its sessions/jobs/mindmap stay live-synced.
func (c *windowController) OpenWorkspaceWindow(workspaceID string) error {
	if strings.TrimSpace(workspaceID) == "" {
		return fmt.Errorf("workspaceID is required")
	}

	port, token, err := c.local.EnsureLocalServer()
	if err != nil {
		return err
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to resolve executable path: %w", err)
	}

	cmd := exec.Command(exe)
	cmd.Env = append(os.Environ(),
		"QUANT_ATTACH_PORT="+strconv.Itoa(port),
		"QUANT_ATTACH_TOKEN="+token,
		"QUANT_ATTACH_WORKSPACE="+workspaceID,
		// The child must not touch the shared MCP config / inject its own server —
		// it has no backend of its own (see internal/infra/attach.go).
		"QUANT_SKIP_MCP_INJECT=1",
	)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to launch detached window: %w", err)
	}
	// Detach: we never wait on the child. Release so it isn't reaped as a zombie
	// when it outlives nothing in particular (it's an independent window process).
	_ = cmd.Process.Release()
	return nil
}
