// Package entity contains domain entities representing core business objects.
package entity

// Shortcut represents a named shell command for session left-click menus.
type Shortcut struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

// VoiceConfig holds settings for the native voice mode (STT/TTS pipeline).
// The APIKey is stored Go-side only and is never exposed to the frontend / remote
// clients (see internal/integration/entrypoint/dto/config.go).
type VoiceConfig struct {
	Enabled  bool   `json:"enabled"`
	Provider string `json:"provider"` // always normalized to "local" (local-only; legacy "auto"/"cloud" migrate to "local")
	// Deprecated: BaseURL / STTBaseURL / TTSBaseURL / APIKey / STTModel /
	// TTSModel are hidden power-user overrides for bring-your-own
	// OpenAI-compatible STT/TTS servers. The embedded sherpa-onnx runtime is the
	// default engine; these fields are no longer exposed in the Settings UI (the
	// DTO omits them) but are preserved across saves and, when set, are used
	// whenever the embedded engine's models are not installed. BaseURL is the
	// legacy single endpoint used for BOTH STT and TTS when the specific one is
	// empty.
	BaseURL    string  `json:"baseUrl"`
	STTBaseURL string  `json:"sttBaseUrl"`
	TTSBaseURL string  `json:"ttsBaseUrl"`
	APIKey     string  `json:"apiKey"`
	STTModel   string  `json:"sttModel"`
	TTSModel   string  `json:"ttsModel"`
	Voice      string  `json:"voice"` // default "af_heart"
	Speed      float64 `json:"speed"` // default 1.2
	// PauseMs is the milliseconds of silence the VAD waits through before ending
	// the user's turn (frontend redemption window); higher = more time to
	// pause/think mid-sentence.
	PauseMs int `json:"pauseMs"`
	// Instructions is optional user-authored guidance appended to the built-in
	// voice persona at session kickoff. Empty = none (no default).
	Instructions string `json:"instructions"`
	// ManagedRuntime records that the user opted into quant downloading and
	// supervising the local STT/TTS engines itself (the one-click "Download
	// voice mode" flow) rather than bringing their own servers. It is user
	// intent only; the concrete install facts (version, per-engine state) live
	// in ~/.quant/voice/state.json, owned by the voiceruntime manager.
	ManagedRuntime bool `json:"managedRuntime"`
}

// Legacy localhost endpoints for the previously self-hosted STT/TTS engines
// (whisper.cpp on :2022, Kokoro-FastAPI on :8880). Older versions filled these
// into blank STT/TTS URLs; they are kept only so WithDefaults can migrate such
// configs back to "no custom endpoint" now that the embedded sherpa-onnx
// runtime is the default engine.
const (
	legacyLocalSTTBaseURL = "http://localhost:2022"
	legacyLocalTTSBaseURL = "http://localhost:8880"
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
	// Migration: older versions auto-filled the localhost engine defaults into
	// blank STT/TTS URLs. Those exact values were never user intent, so strip
	// them back to "" — empty now means "use the embedded engine" and only a
	// deliberately customized endpoint survives.
	if v.STTBaseURL == legacyLocalSTTBaseURL {
		v.STTBaseURL = ""
	}
	if v.TTSBaseURL == legacyLocalTTSBaseURL {
		v.TTSBaseURL = ""
	}
	if v.Voice == "" {
		v.Voice = "af_heart"
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
	AssistantModel   string            `json:"assistantModel"`
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
		AssistantModel:   "claude-sonnet-4-6",
		EnvVariables:     make(map[string]string),
		CommandOverrides: make(map[string]string),
		// Empty = use the built-in persona.Base; the user can override it in Settings.
		BasePersona: "",

		// Remote Access — disabled until the user opts in. Port 0 = auto-pick a
		// free port; passcode is generated on first enable.
		RemoteAccessEnabled:  false,
		RemoteAccessPort:     0,
		RemoteAccessPasscode: "",

		// Voice — disabled by default; the embedded sherpa-onnx engine serves
		// STT/TTS once its models are installed (no endpoint URLs needed).
		// Delegate to WithDefaults() so the voice defaults (provider "local",
		// voice "af_heart", speed 1.2, pauseMs 3000) live in exactly one place.
		// Enabled stays false (zero value untouched).
		Voice: VoiceConfig{}.WithDefaults(),
	}
}
