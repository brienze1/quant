package e2e

import (
	"testing"
)

// TestCrewCliCommandPersistsPerWorkspace verifies the per-workspace crew CLI
// command round-trips through the workspace manager, so the setting survives a
// restart and is what crew reads when it creates a worker.
func TestCrewCliCommandPersistsPerWorkspace(t *testing.T) {
	h := newHarness(t)
	workspaces := h.injector.WorkspaceManager()

	ws, err := workspaces.GetWorkspace(h.wsID)
	if err != nil || ws == nil {
		t.Fatalf("GetWorkspace: %v", err)
	}
	if ws.CrewCliCommand != "" {
		t.Fatalf("a fresh workspace should have no crew command, got %q", ws.CrewCliCommand)
	}

	ws.CrewCliCommand = "claude-da"
	if _, err := workspaces.UpdateWorkspace(*ws); err != nil {
		t.Fatalf("UpdateWorkspace: %v", err)
	}

	reloaded, err := workspaces.GetWorkspace(h.wsID)
	if err != nil || reloaded == nil {
		t.Fatalf("GetWorkspace after update: %v", err)
	}
	if reloaded.CrewCliCommand != "claude-da" {
		t.Errorf("crew cli command: got %q want %q", reloaded.CrewCliCommand, "claude-da")
	}

	// Updating another field must not wipe it.
	reloaded.Name = "renamed"
	if _, err := workspaces.UpdateWorkspace(*reloaded); err != nil {
		t.Fatalf("UpdateWorkspace(rename): %v", err)
	}
	after, err := workspaces.GetWorkspace(h.wsID)
	if err != nil || after == nil {
		t.Fatalf("GetWorkspace after rename: %v", err)
	}
	if after.CrewCliCommand != "claude-da" {
		t.Errorf("crew cli command lost on rename: got %q", after.CrewCliCommand)
	}
}
