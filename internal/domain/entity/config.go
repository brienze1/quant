// Package entity contains domain entities representing core business objects.
package entity

// Shortcut represents a named shell command for session left-click menus.
type Shortcut struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

// VoiceConfig holds settings for the native voice mode (STT/TTS pipeline).
// The APIKey is stored Go-side only and is never exposed to the frontend / remote
// clients — the DTO masks it (see internal/integration/entrypoint/dto/config.go).
type VoiceConfig struct {
	Enabled  bool    `json:"enabled"`
	Provider string  `json:"provider"` // "auto" | "local" | "cloud"
	BaseURL  string  `json:"baseUrl"`
	APIKey   string  `json:"apiKey"`
	STTModel string  `json:"sttModel"`
	TTSModel string  `json:"ttsModel"`
	Voice    string  `json:"voice"` // default "am_onyx"
	Speed    float64 `json:"speed"` // default 1.2
}

// WithDefaults returns a copy of the voice config with sensible defaults applied
// for any unset fields. This keeps configs saved before the voice feature usable.
func (v VoiceConfig) WithDefaults() VoiceConfig {
	if v.Provider == "" {
		v.Provider = "auto"
	}
	if v.Voice == "" {
		v.Voice = "am_onyx"
	}
	if v.Speed == 0 {
		v.Speed = 1.2
	}
	return v
}

// Config represents the application configuration settings.
type Config struct {
	// General
	StartOnLogin  bool       `json:"startOnLogin"`
	Notifications bool       `json:"notifications"`
	AutoUpdate    bool       `json:"autoUpdate"`
	Shortcuts     []Shortcut `json:"shortcuts"`

	// Git & Branches
	AutoPull            bool              `json:"autoPull"`
	DefaultPullBranch   string            `json:"defaultPullBranch"`
	BranchNamePattern   string            `json:"branchNamePattern"`
	DeleteBranchOnDone  bool              `json:"deleteBranchOnDone"`
	BranchOverrides     map[string]string `json:"branchOverrides"`
	CommitMessagePrefix string            `json:"commitMessagePrefix"`

	// Sessions
	UseWorktreeDefault    bool   `json:"useWorktreeDefault"`
	SkipPermissions       bool   `json:"skipPermissions"`
	MaxConcurrentSessions int    `json:"maxConcurrentSessions"`
	AutoResumeOnStart     bool   `json:"autoResumeOnStart"`
	AutoStopIdle          bool   `json:"autoStopIdle"`
	IdleTimeoutMinutes    int    `json:"idleTimeoutMinutes"`
	ActiveSessionID       string   `json:"activeSessionId"`
	OpenSessionIDs        []string `json:"openSessionIds"`
	MindmapPaneOpen       bool     `json:"mindmapPaneOpen"`

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
	NewLineKey      string  `json:"newLineKey"`

	// Workspace
	CurrentWorkspaceID string `json:"currentWorkspaceId"`

	// Claude CLI
	CliBinaryPath    string            `json:"cliBinaryPath"`
	ExtraCliArgs     string            `json:"extraCliArgs"`
	DefaultModel     string            `json:"defaultModel"`
	AssistantModel   string            `json:"assistantModel"`
	EnvVariables     map[string]string `json:"envVariables"`
	CommandOverrides map[string]string `json:"commandOverrides"`

	// Remote Access — expose the UI in a browser via a Cloudflare quick tunnel,
	// guarded by a generated passcode. Off by default; see internal/integration/remote.
	RemoteAccessEnabled  bool   `json:"remoteAccessEnabled"`
	RemoteAccessPort     int    `json:"remoteAccessPort"`
	RemoteAccessPasscode string `json:"remoteAccessPasscode"`

	// Voice — native voice mode (STT/TTS proxy). APIKey is masked in the DTO.
	Voice VoiceConfig `json:"voice"`
}

// NewDefaultConfig returns a Config populated with sensible default values.
func NewDefaultConfig() Config {
	return Config{
		// General
		StartOnLogin:  false,
		Notifications: true,
		AutoUpdate:    true,
		Shortcuts:     []Shortcut{},

		// Git & Branches
		AutoPull:            true,
		DefaultPullBranch:   "main",
		BranchNamePattern:   "quant/{session}",
		DeleteBranchOnDone:  false,
		BranchOverrides:     make(map[string]string),
		CommitMessagePrefix: "",

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
		NewLineKey:      "backslash+enter",

		// Workspace
		CurrentWorkspaceID: "default",

		// Claude CLI
		CliBinaryPath:    "claude",
		ExtraCliArgs:     "",
		DefaultModel:     "cli default",
		AssistantModel:   "claude-sonnet-4-6",
		EnvVariables:     make(map[string]string),
		CommandOverrides: make(map[string]string),

		// Remote Access — disabled until the user opts in. Port 0 = auto-pick a
		// free port; passcode is generated on first enable.
		RemoteAccessEnabled:  false,
		RemoteAccessPort:     0,
		RemoteAccessPasscode: "",

		// Voice — disabled by default; cloud/auto provider, sensible voice defaults.
		Voice: VoiceConfig{
			Enabled:  false,
			Provider: "auto",
			BaseURL:  "",
			APIKey:   "",
			STTModel: "",
			TTSModel: "",
			Voice:    "am_onyx",
			Speed:    1.2,
		},
	}
}
