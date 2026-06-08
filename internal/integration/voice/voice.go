// Package voice implements a thin Go proxy for OpenAI-compatible speech-to-text
// (STT) and text-to-speech (TTS) endpoints. Audio capture and playback live in
// the webview (JS); this proxy exists so the provider API key never reaches the
// frontend or remote/browser clients, and so the same loop works over the
// remote/Cloudflare-tunnel transport.
//
// Endpoints (OpenAI-compatible):
//   - POST {baseURL}/v1/audio/transcriptions  (multipart: model, file, response_format, language?)
//   - POST {baseURL}/v1/audio/speech          (json: model, input, voice, response_format, speed)
//
// This feature is LOCAL-ONLY by design: requests target the user's self-hosted
// engines (Whisper STT + Kokoro TTS) and NEVER fall back to a cloud provider, so
// captured mic audio and TTS text never leave the machine.
package voice

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"quant/internal/application/adapter"
	"quant/internal/domain/entity"
)

const (
	defaultSTTModel = "whisper-1"
	defaultTTSModel = "tts-1"
	defaultVoice    = "am_onyx"
	defaultSpeed    = 1.2
	defaultTimeout  = 60 * time.Second
	// discoverTimeout bounds the model/voice discovery probes. It is short so a
	// down or slow local server fails fast and the UI falls back to its curated
	// option list instead of hanging the Settings tab.
	discoverTimeout = 4 * time.Second
)

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
}

// NewVoiceController constructs the voice STT/TTS proxy controller. It reads the
// voice configuration (provider, base URL, models, API key, voice/speed) from the
// config manager at call time, so settings changes take effect without a restart.
//
// The bridge connects the MCP voice tools (Go) to the frontend audio pipeline;
// VoiceResult forwards frontend replies into it. Pass nil only in tests that do
// not exercise VoiceResult.
//
// sessions is used by StartVoiceSession to inject the voice-mode kickoff message
// into a running session; pass nil only in tests that do not exercise it.
func NewVoiceController(configManager adapter.ConfigManager, bridge *Bridge, sessions SessionMessenger) *voiceController {
	return &voiceController{
		configManager: configManager,
		client:        &http.Client{Timeout: defaultTimeout},
		bridge:        bridge,
		sessions:      sessions,
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
func (c *voiceController) OnShutdown(_ context.Context) {}

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

// op identifies which speech operation a base-URL list is being built for, so
// errors can name the exact Settings field the user must fill in.
type op int

const (
	opSTT op = iota
	opTTS
)

func (o op) field() string {
	if o == opTTS {
		return "TTS (Kokoro) URL"
	}
	return "STT (Whisper) URL"
}

// resolveBase picks the operation-specific base URL, falling back to the legacy
// shared BaseURL: sttBaseUrl/ttsBaseUrl → baseUrl. Returns "" if none is set.
func resolveBase(vc entity.VoiceConfig, o op) string {
	trim := func(s string) string { return strings.TrimRight(strings.TrimSpace(s), "/") }
	specific := vc.STTBaseURL
	if o == opTTS {
		specific = vc.TTSBaseURL
	}
	if s := trim(specific); s != "" {
		return s
	}
	return trim(vc.BaseURL)
}

// baseURLs builds the list of provider base URLs to try for one operation (STT
// or TTS). This feature is LOCAL-ONLY: there is NO cloud fallback on any code
// path. It returns the operation-specific local URL (sttBaseUrl/ttsBaseUrl),
// falling back to the legacy shared BaseURL. If none is set it returns nil and
// the caller surfaces a clear error naming the field to fill in. The OpenAI /
// cloud endpoint is never returned — a transient local failure must never ship
// the user's mic audio or TTS text off-machine. (Provider is normalized to
// "local" by VoiceConfig.WithDefaults; legacy "auto"/"cloud" are treated the
// same local-only way here as defense in depth.)
func baseURLs(vc entity.VoiceConfig, o op) []string {
	if base := resolveBase(vc, o); base != "" {
		return []string{base}
	}
	return nil
}

// filenameForMIME maps an audio MIME type to a plausible filename so the
// multipart upload carries a sensible extension for the provider.
func filenameForMIME(mime string) string {
	switch {
	case strings.Contains(mime, "webm"):
		return "audio.webm"
	case strings.Contains(mime, "wav"), strings.Contains(mime, "x-wav"):
		return "audio.wav"
	case strings.Contains(mime, "mp3"), strings.Contains(mime, "mpeg"):
		return "audio.mp3"
	case strings.Contains(mime, "ogg"):
		return "audio.ogg"
	case strings.Contains(mime, "m4a"), strings.Contains(mime, "mp4"):
		return "audio.m4a"
	case strings.Contains(mime, "flac"):
		return "audio.flac"
	default:
		return "audio.webm"
	}
}

// shouldFallthrough reports whether an error or response status should cause us
// to try the next provider in the ordered list. Connection errors and 5xx
// responses fall through; other (e.g. 4xx) responses are returned to the caller.
func shouldFallthrough(status int, err error) bool {
	if err != nil {
		return true
	}
	return status >= 500
}

// Transcribe decodes base64 audio and proxies a speech-to-text request to the
// first reachable provider. Audio arrives base64-encoded because the Wails
// bridge marshals []byte awkwardly across the remote transport.
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

	model := vc.STTModel
	if model == "" {
		model = defaultSTTModel
	}
	filename := filenameForMIME(mime)

	urls := baseURLs(vc, opSTT)
	if len(urls) == 0 {
		return "", fmt.Errorf("voice provider is set to \"local\" but no %s is configured — set it in Settings → Voice", opSTT.field())
	}

	var lastErr error
	for _, base := range urls {
		text, status, err := c.doTranscribe(base, model, filename, mime, audio, vc.APIKey)
		if shouldFallthrough(status, err) {
			if err != nil {
				lastErr = err
			} else {
				lastErr = fmt.Errorf("provider %s returned status %d", base, status)
			}
			continue
		}
		if err != nil {
			return "", err
		}
		if status >= 400 {
			return "", fmt.Errorf("transcription failed: status %d: %s", status, text)
		}
		return strings.TrimSpace(text), nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no provider succeeded")
	}
	return "", fmt.Errorf("transcription failed: %w", lastErr)
}

// doTranscribe performs a single multipart transcription request against one base URL.
// It returns the raw response body, the HTTP status (0 on transport error), and any error.
func (c *voiceController) doTranscribe(base, model, filename, mime string, audio []byte, apiKey string) (string, int, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)

	if err := mw.WriteField("model", model); err != nil {
		return "", 0, err
	}
	if err := mw.WriteField("response_format", "text"); err != nil {
		return "", 0, err
	}

	fw, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return "", 0, err
	}
	if _, err := fw.Write(audio); err != nil {
		return "", 0, err
	}
	if err := mw.Close(); err != nil {
		return "", 0, err
	}

	endpoint := base + "/v1/audio/transcriptions"
	req, err := http.NewRequest(http.MethodPost, endpoint, &body)
	if err != nil {
		return "", 0, err
	}
	if c.ctx != nil {
		req = req.WithContext(c.ctx)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", resp.StatusCode, err
	}
	return string(data), resp.StatusCode, nil
}

// SpeechResult is the return payload for Synthesize. It is returned as a single
// struct (not two values) on purpose: the remote/tunnel transport's RPC marshaller
// keeps only the last non-error return value, so multi-value returns would lose the
// audio over the browser path. A struct round-trips correctly on both transports.
type SpeechResult struct {
	AudioB64    string `json:"audioB64"`
	ContentType string `json:"contentType"`
}

// speechRequest is the JSON body for the /v1/audio/speech endpoint.
type speechRequest struct {
	Model          string  `json:"model"`
	Input          string  `json:"input"`
	Voice          string  `json:"voice"`
	ResponseFormat string  `json:"response_format"`
	Speed          float64 `json:"speed"`
}

// Synthesize proxies a text-to-speech request and returns base64-encoded audio
// bytes plus the response content-type (as a SpeechResult). The voice and speed
// arguments override the config defaults when non-empty / non-zero. Audio is
// returned base64-encoded for the Wails bridge.
func (c *voiceController) Synthesize(text string, voice string, speed float64) (SpeechResult, error) {
	if strings.TrimSpace(text) == "" {
		return SpeechResult{}, fmt.Errorf("empty text")
	}

	vc, err := c.voiceConfig()
	if err != nil {
		return SpeechResult{}, err
	}

	model := vc.TTSModel
	if model == "" {
		model = defaultTTSModel
	}
	if voice == "" {
		voice = vc.Voice
	}
	if voice == "" {
		voice = defaultVoice
	}
	if speed == 0 {
		speed = vc.Speed
	}
	if speed == 0 {
		speed = defaultSpeed
	}

	payload, err := json.Marshal(speechRequest{
		Model:          model,
		Input:          text,
		Voice:          voice,
		ResponseFormat: "mp3",
		Speed:          speed,
	})
	if err != nil {
		return SpeechResult{}, err
	}

	urls := baseURLs(vc, opTTS)
	if len(urls) == 0 {
		return SpeechResult{}, fmt.Errorf("voice provider is set to \"local\" but no %s is configured — set it in Settings → Voice", opTTS.field())
	}

	var lastErr error
	for _, base := range urls {
		audio, contentType, status, err := c.doSynthesize(base, payload, vc.APIKey)
		if shouldFallthrough(status, err) {
			if err != nil {
				lastErr = err
			} else {
				lastErr = fmt.Errorf("provider %s returned status %d", base, status)
			}
			continue
		}
		if err != nil {
			return SpeechResult{}, err
		}
		if status >= 400 {
			return SpeechResult{}, fmt.Errorf("speech failed: status %d: %s", status, strconv.Quote(string(audio)))
		}
		return SpeechResult{
			AudioB64:    base64.StdEncoding.EncodeToString(audio),
			ContentType: contentType,
		}, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no provider succeeded")
	}
	return SpeechResult{}, fmt.Errorf("speech failed: %w", lastErr)
}

// doSynthesize performs a single TTS request against one base URL. It returns
// the audio bytes, content-type, HTTP status (0 on transport error), and any error.
func (c *voiceController) doSynthesize(base string, payload []byte, apiKey string) ([]byte, string, int, error) {
	endpoint := base + "/v1/audio/speech"
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, "", 0, err
	}
	if c.ctx != nil {
		req = req.WithContext(c.ctx)
	}
	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, "", 0, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", resp.StatusCode, err
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "audio/mpeg"
	}
	return data, contentType, resp.StatusCode, nil
}

// opFromString maps the frontend's "stt"/"tts" discovery argument to the
// internal op enum, defaulting to STT for anything else.
func opFromString(s string) op {
	if strings.EqualFold(strings.TrimSpace(s), "tts") {
		return opTTS
	}
	return opSTT
}

// discoverGET issues a short-timeout GET against {base}/{path} for one
// operation's resolved base URL and returns the raw response body. It soft-fails:
// the timeout is intentionally tight so a down/slow local server doesn't hang the
// Settings tab, and the caller turns any error into an empty list. The api key
// header is attached when configured, mirroring Synthesize/Transcribe.
func (c *voiceController) discoverGET(o op, path string) ([]byte, error) {
	vc, err := c.voiceConfig()
	if err != nil {
		return nil, err
	}
	base := resolveBase(vc, o)
	if base == "" {
		// Fall back to the provider list (e.g. cloud default) so discovery still
		// works when only the legacy/cloud config is set.
		if urls := baseURLs(vc, o); len(urls) > 0 {
			base = urls[0]
		}
	}
	if base == "" {
		return nil, fmt.Errorf("no %s configured — set it in Settings → Voice", o.field())
	}

	ctx, cancel := context.WithTimeout(context.Background(), discoverTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
	if err != nil {
		return nil, err
	}
	if vc.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+vc.APIKey)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("discovery failed: status %d", resp.StatusCode)
	}
	return data, nil
}

// idFromAny extracts a string id from a discovery list element that may be a
// bare string or an object carrying an "id" (or "name") field.
func idFromAny(v interface{}) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case map[string]interface{}:
		for _, key := range []string{"id", "name"} {
			if s, ok := t[key].(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}

// idsFromList maps a slice of mixed string/object elements to their ids,
// dropping empties.
func idsFromList(items []interface{}) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		if id := idFromAny(it); id != "" {
			out = append(out, id)
		}
	}
	return out
}

// ListModels probes the OpenAI-compatible models endpoint for the given
// operation ("stt" or "tts") and returns the available model ids. It tolerates
// the standard {"data":[{"id":...}]} shape as well as {"models":[...]} or a bare
// array; elements may be strings or objects with an id/name.
//
// It soft-fails: on any error it returns an empty slice plus the error so the
// frontend can fall back to its curated option list without surfacing a crash.
func (c *voiceController) ListModels(op string) ([]string, error) {
	data, err := c.discoverGET(opFromString(op), "/v1/models")
	if err != nil {
		return []string{}, err
	}

	// Try the standard {"data": [...]} / {"models": [...]} shapes first.
	var obj struct {
		Data   []interface{} `json:"data"`
		Models []interface{} `json:"models"`
	}
	if err := json.Unmarshal(data, &obj); err == nil {
		if len(obj.Data) > 0 {
			return idsFromList(obj.Data), nil
		}
		if len(obj.Models) > 0 {
			return idsFromList(obj.Models), nil
		}
	}

	// Fall back to a bare array of strings/objects.
	var arr []interface{}
	if err := json.Unmarshal(data, &arr); err == nil {
		return idsFromList(arr), nil
	}

	return []string{}, fmt.Errorf("could not parse models response")
}

// ListVoices probes the TTS server's voices endpoint (Kokoro:
// {base}/v1/audio/voices) and returns the available voice ids. The response is
// expected as {"voices":[...]} where each element is a string or an object with
// an id/name; a bare array is also tolerated.
//
// It soft-fails like ListModels: any error yields an empty slice plus the error.
func (c *voiceController) ListVoices() ([]string, error) {
	data, err := c.discoverGET(opTTS, "/v1/audio/voices")
	if err != nil {
		return []string{}, err
	}

	var obj struct {
		Voices []interface{} `json:"voices"`
	}
	if err := json.Unmarshal(data, &obj); err == nil && len(obj.Voices) > 0 {
		return idsFromList(obj.Voices), nil
	}

	var arr []interface{}
	if err := json.Unmarshal(data, &arr); err == nil {
		return idsFromList(arr), nil
	}

	return []string{}, fmt.Errorf("could not parse voices response")
}

// PingResult is the return payload for Ping: whether the engine's server is
// listening plus a short human-readable detail. Returned as a struct so it
// round-trips over both the Wails desktop and remote/tunnel transports.
type PingResult struct {
	Ok     bool   `json:"ok"`
	Detail string `json:"detail"`
}

// Ping probes whether the configured engine for one operation ("stt" or "tts")
// is reachable. It resolves that op's base URL and issues a short-timeout GET to
// {base}/v1/models. Semantics:
//   - the URL for that op is unset → Ok=false, "no STT|TTS URL configured".
//   - ANY HTTP response (even non-2xx) → the server is listening, Ok=true with a
//     helpful detail (a non-2xx status is still "server up").
//   - connection refused / timeout / DNS failure → Ok=false naming the host:port.
//
// It soft-fails (never panics): a load/config error is reported as Ok=false with
// the error text rather than returned as a hard error.
func (c *voiceController) Ping(op string) (PingResult, error) {
	o := opFromString(op)

	vc, err := c.voiceConfig()
	if err != nil {
		return PingResult{Ok: false, Detail: "could not load voice config: " + err.Error()}, nil
	}

	base := resolveBase(vc, o)
	if base == "" {
		// Fall back to the provider list so a cloud/legacy-only config still pings.
		if urls := baseURLs(vc, o); len(urls) > 0 {
			base = urls[0]
		}
	}
	if base == "" {
		kind := "STT"
		if o == opTTS {
			kind = "TTS"
		}
		return PingResult{Ok: false, Detail: "no " + kind + " URL configured"}, nil
	}

	hostPort := base
	if u, perr := url.Parse(base); perr == nil && u.Host != "" {
		hostPort = u.Host
	}

	ctx, cancel := context.WithTimeout(context.Background(), discoverTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/v1/models", nil)
	if err != nil {
		return PingResult{Ok: false, Detail: "invalid URL: " + base}, nil
	}
	if vc.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+vc.APIKey)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		// Connection refused / timeout / DNS failure: the server is not listening.
		return PingResult{
			Ok:     false,
			Detail: fmt.Sprintf("not reachable — is the server running on %s?", hostPort),
		}, nil
	}
	defer resp.Body.Close()
	// Drain so the connection can be reused.
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return PingResult{Ok: true, Detail: "reachable"}, nil
	}
	// Any other response still means the server is up and listening.
	return PingResult{
		Ok:     true,
		Detail: fmt.Sprintf("reachable (HTTP %d on /v1/models — server up)", resp.StatusCode),
	}, nil
}
