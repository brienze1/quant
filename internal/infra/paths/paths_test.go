package paths

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIsIsolated(t *testing.T) {
	t.Run("true when QUANT_HOME set", func(t *testing.T) {
		t.Setenv("QUANT_HOME", t.TempDir())
		if !IsIsolated() {
			t.Fatal("expected IsIsolated() to be true when QUANT_HOME is set")
		}
	})

	t.Run("false when QUANT_HOME unset", func(t *testing.T) {
		t.Setenv("QUANT_HOME", "")
		if IsIsolated() {
			t.Fatal("expected IsIsolated() to be false when QUANT_HOME is empty")
		}
	})
}

func TestMCPConfigPath(t *testing.T) {
	t.Run("uses QUANT_HOME when set", func(t *testing.T) {
		dir := t.TempDir()
		t.Setenv("QUANT_HOME", dir)
		got := MCPConfigPath()
		want := filepath.Join(dir, ".mcp.json")
		if got != want {
			t.Fatalf("MCPConfigPath() = %q, want %q", got, want)
		}
	})

	t.Run("uses home when QUANT_HOME unset", func(t *testing.T) {
		t.Setenv("QUANT_HOME", "")
		home, err := os.UserHomeDir()
		if err != nil {
			t.Skipf("no home dir: %v", err)
		}
		got := MCPConfigPath()
		want := filepath.Join(home, ".mcp.json")
		if got != want {
			t.Fatalf("MCPConfigPath() = %q, want %q", got, want)
		}
	})
}
