package process

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMCPConfigArgs(t *testing.T) {
	t.Run("isolated with file returns flag pair", func(t *testing.T) {
		dir := t.TempDir()
		t.Setenv("QUANT_HOME", dir)
		cfg := filepath.Join(dir, ".mcp.json")
		if err := os.WriteFile(cfg, []byte("{}"), 0644); err != nil {
			t.Fatalf("write config: %v", err)
		}

		got := mcpConfigArgs()
		want := []string{"--mcp-config", cfg}
		if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
			t.Fatalf("mcpConfigArgs() = %v, want %v", got, want)
		}
	})

	t.Run("not isolated returns nil", func(t *testing.T) {
		t.Setenv("QUANT_HOME", "")
		if got := mcpConfigArgs(); got != nil {
			t.Fatalf("mcpConfigArgs() = %v, want nil", got)
		}
	})

	t.Run("isolated without file returns nil", func(t *testing.T) {
		dir := t.TempDir()
		t.Setenv("QUANT_HOME", dir)
		// no .mcp.json written
		if got := mcpConfigArgs(); got != nil {
			t.Fatalf("mcpConfigArgs() = %v, want nil", got)
		}
	})
}
