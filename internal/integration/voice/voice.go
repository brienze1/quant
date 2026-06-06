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
// Provider selection follows a simple ordered-list / first-success-wins model
// (mirrors voicemode's local-first-then-cloud failover).
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
	defaultCloudBaseURL = "https://api.openai.com"
	defaultSTTModel     = "whisper-1"
	defaultTTSModel     = "tts-1"
	defaultVoice        = "am_onyx"
	defaultSpeed        = 1.2
	defaultTimeout      = 60 * time.Second
)

// voiceController is the concrete Wails-bound controller. It is kept unexported
// to match the other controllers' binding convention (the binding key derives
// from the struct type name → "voiceController").
type voiceController struct {
	ctx           context.Context
	configManager adapter.ConfigManager
	client        *http.Client
}

// NewVoiceController constructs the voice STT/TTS proxy controller. It reads the
// voice configuration (provider, base URL, models, API key, voice/speed) from the
// config manager at call time, so settings changes take effect without a restart.
func NewVoiceController(configManager adapter.ConfigManager) *voiceController {
	return &voiceController{
		configManager: configManager,
		client:        &http.Client{Timeout: defaultTimeout},
	}
}

// OnStartup is called when the Wails app starts; the context is saved for later use.
func (c *voiceController) OnStartup(ctx context.Context) {
	c.ctx = ctx
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

// baseURLs builds the ordered list of provider base URLs to try, based on the
// configured provider mode:
//   - "local": the configured BaseURL only.
//   - "cloud": the configured BaseURL if set, else the default cloud endpoint.
//   - "auto" (default): the configured BaseURL first if it is local, then cloud.
func baseURLs(vc entity.VoiceConfig) []string {
	trim := func(s string) string { return strings.TrimRight(strings.TrimSpace(s), "/") }
	base := trim(vc.BaseURL)

	switch vc.Provider {
	case "local":
		if base != "" {
			return []string{base}
		}
		return nil
	case "cloud":
		if base != "" {
			return []string{base}
		}
		return []string{defaultCloudBaseURL}
	default: // "auto"
		var urls []string
		if base != "" && isLocal(base) {
			urls = append(urls, base)
		}
		urls = append(urls, defaultCloudBaseURL)
		// If a non-local base URL was configured under auto, prefer it over cloud
		// default but still keep cloud as a fallback.
		if base != "" && !isLocal(base) {
			urls = append([]string{base}, urls...)
		}
		return dedupe(urls)
	}
}

func dedupe(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := in[:0]
	for _, s := range in {
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
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

	urls := baseURLs(vc)
	if len(urls) == 0 {
		return "", fmt.Errorf("no transcription provider configured")
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

	urls := baseURLs(vc)
	if len(urls) == 0 {
		return SpeechResult{}, fmt.Errorf("no speech provider configured")
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
