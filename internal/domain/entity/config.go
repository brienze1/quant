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
	Enabled  bool   `json:"enabled"`
	Provider string `json:"provider"` // always normalized to "local" (local-only; legacy "auto"/"cloud" migrate to "local")
	// BaseURL is the legacy single endpoint used for BOTH STT and TTS. It is kept
	// as a back-compat fallback: when STTBaseURL / TTSBaseURL are empty the proxy
	// falls back to BaseURL, then to the provider default.
	BaseURL string `json:"baseUrl"`
	// STTBaseURL / TTSBaseURL let local self-hosted engines run as separate servers
	// on different ports (e.g. Whisper http://localhost:2022, Kokoro http://localhost:8880).
	// Empty means "fall back to BaseURL, then provider default". Not secrets — not masked.
	STTBaseURL string  `json:"sttBaseUrl"`
	TTSBaseURL string  `json:"ttsBaseUrl"`
	APIKey     string  `json:"apiKey"`
	STTModel   string  `json:"sttModel"`
	TTSModel   string  `json:"ttsModel"`
	Voice      string  `json:"voice"` // default "am_onyx"
	Speed      float64 `json:"speed"` // default 1.2
	// PauseMs is the milliseconds of silence the VAD waits through before ending
	// the user's turn (frontend redemption window); higher = more time to
	// pause/think mid-sentence.
	PauseMs int `json:"pauseMs"`
	// Instructions is optional user-authored guidance appended to the built-in
	// voice persona at session kickoff. Empty = none (no default).
	Instructions string `json:"instructions"`
}

// Local-first default endpoints for the self-hosted STT/TTS engines: whisper.cpp
// serves OpenAI-compatible STT on :2022, Kokoro-FastAPI serves TTS on :8880.
const (
	defaultLocalSTTBaseURL = "http://localhost:2022"
	defaultLocalTTSBaseURL = "http://localhost:8880"
)

// WithDefaults returns a copy of the voice config with sensible defaults applied
// for any unset fields. This keeps configs saved before the voice feature usable.
func (v VoiceConfig) WithDefaults() VoiceConfig {
	// Local-only enforcement: this feature must NEVER egress to a cloud provider
	// (OpenAI etc.). Normalize ANY provider value other than "local" (including the
	// legacy "auto"/"cloud" and the empty string) to "local", which migrates legacy
	// saved configs so they persist as local on the next save.
	if v.Provider != "local" {
		v.Provider = "local"
	}
	// Provider is always "local" by the time we reach here (normalized above), so
	// blank STT/TTS URLs always get the localhost engine defaults filled in; a
	// local user who clears a field gets the sensible default back.
	if v.STTBaseURL == "" {
		v.STTBaseURL = defaultLocalSTTBaseURL
	}
	if v.TTSBaseURL == "" {
		v.TTSBaseURL = defaultLocalTTSBaseURL
	}
	if v.Voice == "" {
		v.Voice = "am_onyx"
	}
	if v.Speed == 0 {
		v.Speed = 1.2
	}
	if v.PauseMs == 0 {
		v.PauseMs = 3000
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
	UseWorktreeDefault    bool     `json:"useWorktreeDefault"`
	SkipPermissions       bool     `json:"skipPermissions"`
	MaxConcurrentSessions int      `json:"maxConcurrentSessions"`
	AutoResumeOnStart     bool     `json:"autoResumeOnStart"`
	AutoStopIdle          bool     `json:"autoStopIdle"`
	IdleTimeoutMinutes    int      `json:"idleTimeoutMinutes"`
	ActiveSessionID       string   `json:"activeSessionId"`
	OpenSessionIDs        []string `json:"openSessionIds"`
	MindmapPaneOpen       bool     `json:"mindmapPaneOpen"`
	VoicePaneOpen         bool     `json:"voicePaneOpen"`

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
	EnvVariables     map[string]string `json:"envVariables"`
	CommandOverrides map[string]string `json:"commandOverrides"`

	// BasePersona is the system prompt Quant appends (via --append-system-prompt)
	// to every interactive session it spawns, layered on top of the user's project
	// context. Empty means "use the built-in default" (persona.Base) so improvements
	// to the shipped default reach users who never customized it; a non-empty value
	// fully replaces it. Honored only when QUANT_SKIP_PERSONA != "1".
	BasePersona string `json:"basePersona"`

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
		EnvVariables:     make(map[string]string),
		CommandOverrides: make(map[string]string),
		// Empty = use the built-in persona.Base; the user can override it in Settings.
		BasePersona: "",

		// Remote Access — disabled until the user opts in. Port 0 = auto-pick a
		// free port; passcode is generated on first enable.
		RemoteAccessEnabled:  false,
		RemoteAccessPort:     0,
		RemoteAccessPasscode: "",

		// Voice — disabled by default; local-first provider pointing at the
		// self-hosted whisper.cpp (:2022) + Kokoro-FastAPI (:8880) engines.
		// Delegate to WithDefaults() so the voice defaults (provider "local",
		// voice "am_onyx", speed 1.2, pauseMs 3000, the localhost STT/TTS URLs)
		// live in exactly one place. Enabled stays false (zero value untouched).
		Voice: VoiceConfig{}.WithDefaults(),
	}
}
