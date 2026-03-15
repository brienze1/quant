// Package entity contains domain entities representing core business objects.
package entity

// Config represents the application configuration settings.
type Config struct {
	// General
	StartOnLogin  bool `json:"startOnLogin"`
	Notifications bool `json:"notifications"`

	// Git & Branches
	AutoPull           bool              `json:"autoPull"`
	DefaultPullBranch  string            `json:"defaultPullBranch"`
	BranchNamePattern  string            `json:"branchNamePattern"`
	DeleteBranchOnDone bool              `json:"deleteBranchOnDone"`
	BranchOverrides    map[string]string `json:"branchOverrides"`

	// Sessions
	UseWorktreeDefault    bool `json:"useWorktreeDefault"`
	SkipPermissions       bool `json:"skipPermissions"`
	MaxConcurrentSessions int  `json:"maxConcurrentSessions"`
	AutoResumeOnStart     bool `json:"autoResumeOnStart"`
	AutoStopIdle          bool `json:"autoStopIdle"`
	IdleTimeoutMinutes    int  `json:"idleTimeoutMinutes"`

	// Storage & Data
	DataDirectory     string `json:"dataDirectory"`
	WorktreeDirectory string `json:"worktreeDirectory"`
	LogDirectory      string `json:"logDirectory"`

	// Terminal
	FontFamily      string  `json:"fontFamily"`
	FontSize        int     `json:"fontSize"`
	LineHeight      float64 `json:"lineHeight"`
	CursorStyle     string  `json:"cursorStyle"`
	CursorBlink     bool    `json:"cursorBlink"`
	ScrollbackLines int     `json:"scrollbackLines"`

	// Claude CLI
	CliBinaryPath string            `json:"cliBinaryPath"`
	ExtraCliArgs  string            `json:"extraCliArgs"`
	DefaultModel  string            `json:"defaultModel"`
	EnvVariables  map[string]string `json:"envVariables"`
}

// NewDefaultConfig returns a Config populated with sensible default values.
func NewDefaultConfig() Config {
	return Config{
		// General
		StartOnLogin:  false,
		Notifications: true,

		// Git & Branches
		AutoPull:           true,
		DefaultPullBranch:  "main",
		BranchNamePattern:  "quant/{session}",
		DeleteBranchOnDone: false,
		BranchOverrides:    make(map[string]string),

		// Sessions
		UseWorktreeDefault:    true,
		SkipPermissions:       false,
		MaxConcurrentSessions: 5,
		AutoResumeOnStart:     true,
		AutoStopIdle:          false,
		IdleTimeoutMinutes:    30,

		// Storage & Data
		DataDirectory:     "~/.quant",
		WorktreeDirectory: "~/.quant/worktrees",
		LogDirectory:      "~/.quant/sessions",

		// Terminal
		FontFamily:      "JetBrains Mono",
		FontSize:        13,
		LineHeight:      1.2,
		CursorStyle:     "block",
		CursorBlink:     true,
		ScrollbackLines: 10000,

		// Claude CLI
		CliBinaryPath: "claude",
		ExtraCliArgs:  "",
		DefaultModel:  "claude-sonnet-4-6",
		EnvVariables:  make(map[string]string),
	}
}
