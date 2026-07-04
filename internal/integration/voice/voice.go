// Package voice exposes quant's voice mode (STT/TTS) to the frontend. Audio
// capture and playback live in the webview (JS); this controller routes each
// request to a speech backend:
//
//   - the embedded sherpa-onnx engine (Kokoro TTS + Whisper STT) once its
//     models are installed under the voice runtime models dir — the default,
//     fully in-process path, or
//   - the HTTP proxy for a power user's own OpenAI-compatible local endpoints
//     (kept Go-side so any API key never reaches the frontend or
//     remote/browser clients).
//
// This feature is LOCAL-ONLY by design: both backends run on the user's
// machine and NEVER fall back to a cloud provider, so captured mic audio and
// TTS text never leave the machine.
package voice

import (
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"quant/internal/application/adapter"
	"quant/internal/domain/entity"
	"quant/internal/infra/paths"
	"quant/internal/integration/voice/engine"
	"quant/internal/integration/voice/engine/httpengine"
	"quant/internal/integration/voice/engine/sherpaengine"
)

const (
	// defaultSpeed is the live-path fallback used when the frontend passes a zero
	// speed AND the saved config has none. It MUST stay in sync with
	// entity.VoiceConfig.WithDefaults() (the single source of truth for voice
	// defaults, in internal/domain/entity/config.go); it is duplicated here only
	// to avoid an awkward cross-package import on the hot synth path. The default
	// voice is language-dependent, so it comes from sherpaengine.DefaultVoice
	// rather than a const here.
	defaultSpeed   = 1.2
	defaultTimeout = 60 * time.Second
)

// sherpaSTTModel is the fixed model id reported by ListModels while the
// embedded engine is active (it has exactly one STT model).
const sherpaSTTModel = "whisper-small.en"

// kickoffSubmitDelay is the pause between writing the persona message to a
// session's PTY and writing the Enter keystroke that submits it. The Claude CLI
// TUI treats a carriage return arriving in the same write as the message text as
// a multi-line newline rather than a submit; delivering Enter as a separate
// keystroke after a short delay lets the TUI process the pasted text first so the
// return is read as a submit. Mirrors the MCP send_message auto-submit primitive.
const kickoffSubmitDelay = 120 * time.Millisecond

// VoicePersona is the kickoff message injected (as a normal, auto-submitted user
// message) into a session when its voice pane is opened. It does NOT change the
// session's system prompt — it simply instructs the running agent to switch into
// a spoken, hands-free conversation driven by the MCP voice tools. The wording
// references voice_speak / voice_listen / voice_converse exactly as registered in
// internal/integration/mcp/server.go.
const VoicePersona = "You are now in VOICE MODE — you and the user are having a live, spoken conversation. " +
	"Talk by calling the MCP voice tools: voice_converse(text) to say something and immediately listen for the reply " +
	"(use this for normal back-and-forth), voice_speak(text) to say something without waiting, and voice_listen() to just listen. " +
	"Speak the way people actually talk out loud: short, natural sentences, one idea at a time. " +
	"No markdown, no code blocks, no bullet lists, no emoji, and don't read out long URLs or file paths character by character — " +
	"if something is long or visual, summarize it in a sentence and offer to put the details in the terminal. " +
	"You can still use all your normal tools to get real work done; when you do, narrate it in a few words instead of going silent. " +
	"If you didn't catch what the user said, just ask them to repeat. " +
	"If the user says they're about to give a long answer or asks to start recording, reply briefly — for example \"Recording — go ahead, say 'stop recording' when done.\" — " +
	"via voice_converse with record=true (or voice_speak then voice_listen with record=true); " +
	"the recording keeps the mic open across pauses and ends when the user says \"stop recording\" or taps stop. " +
	"Start now: greet the user briefly with voice_converse, then keep the conversation going — " +
	"after each user turn, think, then reply with voice_converse (or voice_speak if you don't expect a reply). " +
	"Continue until the user says goodbye or the voice pane is closed."

// SessionMessenger is the minimal slice of the session manager that the voice
// kickoff needs: writing raw input to a running session's PTY. Keeping it narrow
// avoids the voice package depending on the full session manager surface and
// makes StartVoiceSession trivially mockable in tests.
type SessionMessenger interface {
	SendMessage(id string, message string) error
}

// voiceController is the concrete Wails-bound controller. It is kept unexported
// to match the other controllers' binding convention (the binding key derives
// from the struct type name → "voiceController").
type voiceController struct {
	ctx           context.Context
	configManager adapter.ConfigManager
	client        *http.Client
	bridge        *Bridge
	sessions      SessionMessenger
	sherpa        *sherpaengine.Engine
}

// NewVoiceController constructs the voice STT/TTS controller with the default
// embedded engine rooted at the voice runtime models dir. It reads the voice
// configuration from the config manager at call time, so settings changes take
// effect without a restart.
//
// The bridge connects the MCP voice tools (Go) to the frontend audio pipeline;
// VoiceResult forwards frontend replies into it. Pass nil only in tests that do
// not exercise VoiceResult.
//
// sessions is used by StartVoiceSession to inject the voice-mode kickoff message
// into a running session; pass nil only in tests that do not exercise it.
func NewVoiceController(configManager adapter.ConfigManager, bridge *Bridge, sessions SessionMessenger) *voiceController {
	return NewVoiceControllerWithEngine(configManager, bridge, sessions,
		sherpaengine.New(sherpaengine.Config{ModelsDir: paths.VoiceModelsDir()}))
}

// NewVoiceControllerWithEngine is NewVoiceController with an injected embedded
// engine, so the app wiring can share the single sherpa instance with the
// voice runtime installer/uninstaller (which must Unload it before deleting
// model files) and tests can point it at a temp dir.
func NewVoiceControllerWithEngine(configManager adapter.ConfigManager, bridge *Bridge, sessions SessionMessenger, sherpa *sherpaengine.Engine) *voiceController {
	return &voiceController{
		configManager: configManager,
		client:        &http.Client{Timeout: defaultTimeout},
		bridge:        bridge,
		sessions:      sessions,
		sherpa:        sherpa,
	}
}

// VoiceResult is called by the frontend voice bridge once it has completed a
// voice request (a transcript for "listen", or playback completion for "speak").
// It resolves the matching in-flight bridge.Request so the waiting MCP voice
// tool handler can return. requestId correlates the reply with the original
// "voice:request" event; an empty errMsg means success. Unknown/duplicate
// requestIds are ignored safely.
//
// It returns a single error (nil) to satisfy the remote-transport contract,
// which keeps only the last non-error return value.
func (c *voiceController) VoiceResult(requestId string, transcript string, errMsg string) error {
	if c.bridge == nil {
		return fmt.Errorf("voice bridge not initialized")
	}
	c.bridge.Resolve(requestId, VoiceReply{
		Transcript: transcript,
		Done:       errMsg == "",
		Err:        errMsg,
	})
	return nil
}

// VoiceResultClosed is called by the frontend when the voice pane closes or moves
// mid-request, so an in-flight voice tool turn ends promptly instead of waiting
// the full timeout. It resolves the matching bridge request with Closed:true,
// which Request() surfaces as ErrVoiceEnded so the agent leaves voice mode
// gracefully (the MCP handler returns a "voice ended" message, not an error).
// The frontend calls this as window.go.voice.voiceController.VoiceResultClosed(requestId).
// Unknown/duplicate requestIds are ignored safely.
//
// It returns a single error (nil) to satisfy the remote-transport contract,
// which keeps only the last non-error return value.
func (c *voiceController) VoiceResultClosed(requestID string) error {
	if c.bridge == nil {
		return fmt.Errorf("voice bridge not initialized")
	}
	c.bridge.Resolve(requestID, VoiceReply{Closed: true})
	return nil
}

// VoiceListenExtend is the frontend keepalive for a long-running listen: while
// the user holds the pane in recording mode the frontend pings this (every ~30s)
// with the in-flight requestId, and the bridge resets that request's timeout so
// a long-form recording isn't cut off by ListenTimeout. Unknown/settled
// requestIds are ignored safely; non-recording listens never call this, so their
// behavior is unchanged.
//
// It returns a single error (nil) to satisfy the remote-transport contract.
func (c *voiceController) VoiceListenExtend(requestId string) error {
	if c.bridge == nil {
		return fmt.Errorf("voice bridge not initialized")
	}
	c.bridge.Extend(requestId)
	return nil
}

// StartVoiceSession kicks a running session into the voice conversation loop by
// injecting the VoicePersona message and auto-submitting it (Enter delivered as a
// separate keystroke, mirroring the MCP send_message primitive so the Claude CLI
// TUI reads it as a submit, not a multi-line newline). The agent then drives the
// loop itself via the voice_* MCP tools, bridged to the frontend audio pipeline.
//
// This is intentionally done Go-side rather than from JS: the auto-submit timing
// and PTY write live next to the other session-input code and work identically
// over the native and remote transports.
//
// It returns a clear error if no agent/process is running for the session (the
// underlying SendMessage reports "no process running for session: <id>") so the
// caller can surface it without crashing.
func (c *voiceController) StartVoiceSession(sessionId string) error {
	if c.sessions == nil {
		return fmt.Errorf("voice session manager not initialized")
	}
	if strings.TrimSpace(sessionId) == "" {
		return fmt.Errorf("sessionId is required")
	}

	// Build the kickoff message: the built-in persona, optionally followed by the
	// user's own voice instructions (from Settings) as authoritative guidance.
	kickoff := VoicePersona
	if cfg, err := c.voiceConfig(); err == nil {
		if ci := strings.TrimSpace(cfg.Instructions); ci != "" {
			kickoff = VoicePersona + "\n\nThe user has given you these additional instructions for how to behave in this voice conversation — follow them throughout:\n" + ci
		}
	}

	if err := c.sessions.SendMessage(sessionId, kickoff); err != nil {
		return fmt.Errorf("failed to start voice session %s: %w", sessionId, err)
	}

	// Submit the message: the CLI TUI treats a carriage return in the same write
	// as the text as a newline, so deliver Enter as a discrete keystroke after a
	// short delay (same approach as the MCP send_message auto-submit).
	time.Sleep(kickoffSubmitDelay)
	if err := c.sessions.SendMessage(sessionId, "\r"); err != nil {
		return fmt.Errorf("voice persona typed but submit (Enter) failed for session %s: %w", sessionId, err)
	}

	return nil
}

// OnStartup is called when the Wails app starts; the context is saved for later use.
func (c *voiceController) OnStartup(ctx context.Context) {
	c.ctx = ctx
	// The bridge must emit voice:request with this lifecycle context; Wails
	// rejects the per-request MCP context passed into Bridge.Request.
	if c.bridge != nil {
		c.bridge.SetContext(ctx)
	}
}

// OnShutdown is called when the Wails app is shutting down.
func (c *voiceController) OnShutdown(_ context.Context) {
	if c.sherpa != nil {
		c.sherpa.Unload()
	}
}

// voiceConfig loads the voice config with defaults applied.
func (c *voiceController) voiceConfig() (entity.VoiceConfig, error) {
	cfg, err := c.configManager.GetConfig()
	if err != nil {
		return entity.VoiceConfig{}, fmt.Errorf("failed to load config: %w", err)
	}
	if cfg == nil {
		return entity.VoiceConfig{}.WithDefaults(), nil
	}
	return cfg.Voice.WithDefaults(), nil
}

// applyLanguage tells the embedded engine which language to serve, so the
// subsequent Ready()/engine selection and any lazy model (re)build reflect the
// user's configured voice language. It reads the (already-defaulted) config and
// is a no-op when the embedded engine is absent (custom-endpoint-only setups).
// Callers invoke it at the top of each engine-facing method, before engine
// selection / sherpaReady().
func (c *voiceController) applyLanguage(vc entity.VoiceConfig) {
	if c.sherpa != nil {
		c.sherpa.SetLanguage(vc.Language)
	}
}

// reqCtx returns the app lifecycle context for outgoing engine calls, falling
// back to Background before OnStartup (e.g. in tests).
func (c *voiceController) reqCtx() context.Context {
	if c.ctx != nil {
		return c.ctx
	}
	return context.Background()
}

// isLocal reports whether the given base URL points at the local machine
// (host is localhost or a loopback address such as 127.0.0.1 / ::1).
func isLocal(rawURL string) bool {
	if rawURL == "" {
		return false
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if host == "" {
		// No scheme — url.Parse put everything in Path. Fall back to a prefix check.
		host = strings.TrimSpace(rawURL)
	}
	if host == "localhost" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// resolveBase picks the operation-specific custom base URL, falling back to
// the legacy shared BaseURL: sttBaseUrl/ttsBaseUrl → baseUrl. Returns "" if
// none is set (the common case post-migration: the embedded engine is used and
// no custom endpoint exists). LOCAL-ONLY: this only ever returns URLs the user
// configured — there is NO cloud fallback on any code path.
func resolveBase(vc entity.VoiceConfig, o httpengine.Op) string {
	trim := func(s string) string { return strings.TrimRight(strings.TrimSpace(s), "/") }
	specific := vc.STTBaseURL
	if o == httpengine.OpTTS {
		specific = vc.TTSBaseURL
	}
	if s := trim(specific); s != "" {
		return s
	}
	return trim(vc.BaseURL)
}

// httpEngine builds the HTTP backend for the given (already defaulted) config.
// It is cheap to construct per call — the underlying http.Client is shared —
// which keeps settings changes effective without a restart.
func (c *voiceController) httpEngine(vc entity.VoiceConfig) *httpengine.Engine {
	return httpengine.New(httpengine.Config{
		STTBaseURL: resolveBase(vc, httpengine.OpSTT),
		TTSBaseURL: resolveBase(vc, httpengine.OpTTS),
		STTModel:   vc.STTModel,
		TTSModel:   vc.TTSModel,
		APIKey:     vc.APIKey,
	}, c.client)
}

// sherpaReady reports whether the embedded engine's model files are installed.
func (c *voiceController) sherpaReady() bool {
	if c.sherpa == nil {
		return false
	}
	ok, _ := c.sherpa.Ready()
	return ok
}

// engineFor selects the speech backend for one operation: the embedded sherpa
// runtime when its models are installed, else the user's custom HTTP endpoint,
// else a clear error pointing at the one-click install in Settings.
func (c *voiceController) engineFor(vc entity.VoiceConfig, o httpengine.Op) (engine.Engine, error) {
	if c.sherpaReady() {
		return c.sherpa, nil
	}
	if resolveBase(vc, o) != "" {
		return c.httpEngine(vc), nil
	}
	return nil, fmt.Errorf("voice mode is not installed — download it in Settings → Voice (or configure a custom %s there)", opField(o))
}

// opField names the Settings field for one operation, for error messages.
func opField(o httpengine.Op) string {
	if o == httpengine.OpTTS {
		return "TTS (Kokoro) URL"
	}
	return "STT (Whisper) URL"
}

// Transcribe decodes base64 audio and runs speech-to-text on the selected
// backend. Audio arrives base64-encoded because the Wails bridge marshals
// []byte awkwardly across the remote transport.
//
// It returns the trimmed transcript text.
func (c *voiceController) Transcribe(audioB64 string, mime string) (string, error) {
	audio, err := base64.StdEncoding.DecodeString(audioB64)
	if err != nil {
		return "", fmt.Errorf("invalid base64 audio: %w", err)
	}
	if len(audio) == 0 {
		return "", fmt.Errorf("empty audio")
	}

	vc, err := c.voiceConfig()
	if err != nil {
		return "", err
	}
	c.applyLanguage(vc)

	eng, err := c.engineFor(vc, httpengine.OpSTT)
	if err != nil {
		return "", err
	}
	return eng.Transcribe(c.reqCtx(), audio, mime)
}

// SpeechResult is the return payload for Synthesize. It is returned as a single
// struct (not two values) on purpose: the remote/tunnel transport's RPC marshaller
// keeps only the last non-error return value, so multi-value returns would lose the
// audio over the browser path. A struct round-trips correctly on both transports.
type SpeechResult struct {
	AudioB64    string `json:"audioB64"`
	ContentType string `json:"contentType"`
}

// Synthesize runs text-to-speech on the selected backend and returns
// base64-encoded audio bytes plus the content-type (as a SpeechResult). The
// voice and speed arguments override the config defaults when non-empty /
// non-zero. Audio is returned base64-encoded for the Wails bridge.
func (c *voiceController) Synthesize(text string, voice string, speed float64) (SpeechResult, error) {
	if strings.TrimSpace(text) == "" {
		return SpeechResult{}, fmt.Errorf("empty text")
	}

	vc, err := c.voiceConfig()
	if err != nil {
		return SpeechResult{}, err
	}
	c.applyLanguage(vc)

	if voice == "" {
		voice = vc.Voice
	}
	if voice == "" {
		voice = sherpaengine.DefaultVoice(vc.Language)
	}
	if speed == 0 {
		speed = vc.Speed
	}
	if speed == 0 {
		speed = defaultSpeed
	}

	eng, err := c.engineFor(vc, httpengine.OpTTS)
	if err != nil {
		return SpeechResult{}, err
	}
	audio, err := eng.Synthesize(c.reqCtx(), text, voice, speed)
	if err != nil {
		return SpeechResult{}, err
	}
	return SpeechResult{
		AudioB64:    base64.StdEncoding.EncodeToString(audio.Data),
		ContentType: audio.ContentType,
	}, nil
}

// ListModels returns the available model ids for the given operation ("stt" or
// "tts"). With the embedded engine active it is a fixed stub (there is exactly
// one bundled model); otherwise it probes the custom endpoint's
// OpenAI-compatible models endpoint.
//
// It soft-fails: on any error it returns an empty slice plus the error so the
// frontend can fall back to its curated option list without surfacing a crash.
func (c *voiceController) ListModels(op string) ([]string, error) {
	vc, err := c.voiceConfig()
	if err != nil {
		return []string{}, err
	}
	c.applyLanguage(vc)
	if c.sherpaReady() {
		return []string{sherpaSTTModel}, nil
	}
	return c.httpEngine(vc).ListModels(httpengine.OpFromString(op))
}

// ListVoices returns the available TTS voice names. With the embedded engine
// active this is the bundled Kokoro speaker table (no model load, no network);
// otherwise it probes the custom TTS server's voices endpoint.
//
// It soft-fails like ListModels: any error yields an empty slice plus the error.
func (c *voiceController) ListVoices() ([]string, error) {
	vc, err := c.voiceConfig()
	if err != nil {
		return []string{}, err
	}
	c.applyLanguage(vc)
	if c.sherpaReady() {
		voices, err := c.sherpa.Voices()
		if err != nil {
			return []string{}, err
		}
		names := make([]string, len(voices))
		for i, v := range voices {
			names[i] = v.Name
		}
		return names, nil
	}
	return c.httpEngine(vc).ListVoiceNames()
}

// PingResult is the return payload for Ping: whether the engine for one
// operation is usable plus a short human-readable detail. Returned as a struct
// so it round-trips over both the Wails desktop and remote/tunnel transports.
type PingResult struct {
	Ok     bool   `json:"ok"`
	Detail string `json:"detail"`
}

// Ping probes whether the engine for one operation ("stt" or "tts") is usable.
// With the embedded engine's models installed it reports ready without loading
// anything; with a custom endpoint configured it issues a short-timeout GET to
// {base}/v1/models (any HTTP response — even non-2xx — means the server is
// listening); otherwise it points the user at the one-click install.
//
// It soft-fails (never panics): a load/config error is reported as Ok=false with
// the error text rather than returned as a hard error.
func (c *voiceController) Ping(op string) (PingResult, error) {
	vc, err := c.voiceConfig()
	if err != nil {
		return PingResult{Ok: false, Detail: "could not load voice config: " + err.Error()}, nil
	}
	c.applyLanguage(vc)

	if c.sherpaReady() {
		return PingResult{Ok: true, Detail: "embedded voice engine ready"}, nil
	}

	o := httpengine.OpFromString(op)
	if resolveBase(vc, o) == "" {
		return PingResult{Ok: false, Detail: "voice mode is not installed — download it in Settings → Voice"}, nil
	}

	ok, detail := c.httpEngine(vc).Ping(o)
	return PingResult{Ok: ok, Detail: detail}, nil
}
