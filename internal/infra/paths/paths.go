// Package paths centralizes resolution of filesystem paths used by quant.
// All callers that previously joined os.UserHomeDir() with a static suffix
// should funnel through this package so that E2E and tests can redirect data
// off ~/.quant/ via the QUANT_HOME env var without touching user runtime data.
package paths

import (
	"os"
	"path/filepath"
)

// QuantHome returns the root data directory for quant.
// Order of precedence:
//  1. $QUANT_HOME if non-empty
//  2. $HOME/.quant
//
// The directory is NOT created here; callers must MkdirAll as needed.
func QuantHome() string {
	if v := os.Getenv("QUANT_HOME"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		// last-resort fallback so we never panic on lookup
		return ".quant"
	}
	return filepath.Join(home, ".quant")
}

// MCPConfigPath returns the registered .mcp.json path. When QUANT_HOME is set,
// the file lives inside that dir (so E2E does not mutate ~/.mcp.json).
// Otherwise it lives at $HOME/.mcp.json.
func MCPConfigPath() string {
	if v := os.Getenv("QUANT_HOME"); v != "" {
		return filepath.Join(v, ".mcp.json")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".mcp.json")
}

// SkipClaudeConfigDiscovery reports whether the boot should skip touching
// ~/.claude*/settings.local.json. Set QUANT_SKIP_CLAUDE_CONFIG=1 for E2E.
func SkipClaudeConfigDiscovery() bool {
	return os.Getenv("QUANT_SKIP_CLAUDE_CONFIG") == "1"
}

// UserHome returns the user's home directory ("" on error). This is a thin
// indirection over os.UserHomeDir so non-quant paths (shell rc files,
// ~/Library/LaunchAgents, real Claude configs) can be resolved through a
// single chokepoint that tests can stub if needed. It does NOT honor
// QUANT_HOME — for quant-data paths use QuantHome() instead.
func UserHome() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}
