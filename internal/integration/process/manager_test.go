package process

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"quant/internal/domain/persona"
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

func TestPersonaArgs(t *testing.T) {
	t.Run("default returns append-system-prompt pair", func(t *testing.T) {
		t.Setenv("QUANT_SKIP_PERSONA", "")
		got := personaArgs()
		want := []string{"--append-system-prompt", "$QUANT_BASE_PERSONA"}
		if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
			t.Fatalf("personaArgs() = %v, want %v", got, want)
		}
	})

	t.Run("skipped returns nil", func(t *testing.T) {
		t.Setenv("QUANT_SKIP_PERSONA", "1")
		if got := personaArgs(); got != nil {
			t.Fatalf("personaArgs() = %v, want nil", got)
		}
	})
}

func TestWithMCPToolTimeout(t *testing.T) {
	t.Run("default applied when absent", func(t *testing.T) {
		env := []string{"PATH=/usr/bin", "QUANT_SESSION_ID=abc"}
		got := withMCPToolTimeout(env)
		want := "MCP_TOOL_TIMEOUT=" + defaultMCPToolTimeoutMS
		if len(got) != len(env)+1 || got[len(got)-1] != want {
			t.Fatalf("withMCPToolTimeout(%v) = %v, want %q appended", env, got, want)
		}
	})

	t.Run("user-provided value is not overridden", func(t *testing.T) {
		env := []string{"PATH=/usr/bin", "MCP_TOOL_TIMEOUT=90000"}
		got := withMCPToolTimeout(env)
		if len(got) != len(env) {
			t.Fatalf("withMCPToolTimeout(%v) = %v, want unchanged", env, got)
		}
		count := 0
		for _, kv := range got {
			if strings.HasPrefix(kv, "MCP_TOOL_TIMEOUT=") {
				count++
				if kv != "MCP_TOOL_TIMEOUT=90000" {
					t.Fatalf("user value overridden: got %q", kv)
				}
			}
		}
		if count != 1 {
			t.Fatalf("expected exactly one MCP_TOOL_TIMEOUT entry, got %d in %v", count, got)
		}
	})
}

func TestPersonaBaseContent(t *testing.T) {
	if persona.Base == "" {
		t.Fatal("persona.Base is empty")
	}
	for _, want := range []string{"mindmap_set_node", "Quant"} {
		if !strings.Contains(persona.Base, want) {
			t.Fatalf("persona.Base does not contain %q", want)
		}
	}
}
