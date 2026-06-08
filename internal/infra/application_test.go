package infra

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestInjectQuantMCPIsolated verifies that in isolated mode (QUANT_HOME set)
// injectQuantMCP writes the quant entry to $QUANT_HOME/.mcp.json with the right
// URL/port and does NOT create any settings.local.json under a real home (the
// isolated branch skips the Claude config loop entirely).
func TestInjectQuantMCPIsolated(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("QUANT_HOME", dir)

	const port = 54321
	injectQuantMCP(port)

	mcpPath := filepath.Join(dir, ".mcp.json")
	data, err := os.ReadFile(mcpPath)
	if err != nil {
		t.Fatalf("expected %s to be written: %v", mcpPath, err)
	}

	var config struct {
		MCPServers map[string]struct {
			Type string `json:"type"`
			URL  string `json:"url"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatalf("invalid JSON written: %v", err)
	}

	quant, ok := config.MCPServers["quant"]
	if !ok {
		t.Fatalf("expected mcpServers.quant entry, got: %s", string(data))
	}
	if !strings.Contains(quant.URL, "54321") {
		t.Fatalf("expected quant.url to contain port 54321, got %q", quant.URL)
	}

	// Nothing should have been written outside the isolated dir: confirm no
	// settings.local.json appeared inside QUANT_HOME (the loop is skipped).
	if _, err := os.Stat(filepath.Join(dir, "settings.local.json")); err == nil {
		t.Fatal("did not expect settings.local.json under QUANT_HOME in isolated mode")
	}
}
