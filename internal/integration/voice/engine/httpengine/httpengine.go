// Package httpengine implements the speech engine against user-supplied
// OpenAI-compatible HTTP endpoints (self-hosted Whisper STT + Kokoro TTS):
//
//   - POST {sttBaseURL}/v1/audio/transcriptions  (multipart: model, file, response_format)
//   - POST {ttsBaseURL}/v1/audio/speech          (json: model, input, voice, response_format, speed)
//
// This backend is LOCAL-ONLY by design: it only ever talks to the endpoints
// the user configured and NEVER falls back to a cloud provider, so captured
// mic audio and TTS text never leave the machine.
package httpengine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"quant/internal/integration/voice/engine"
)

const (
	defaultSTTModel = "whisper-1"
	defaultTTSModel = "tts-1"
	defaultTimeout  = 60 * time.Second
	// discoverTimeout bounds the model/voice discovery probes. It is short so a
	// down or slow local server fails fast and the UI falls back to its curated
	// option list instead of hanging the Settings tab.
	discoverTimeout = 4 * time.Second
)

// Op identifies which speech operation a request targets, so errors can name
// the exact Settings field the user must fill in.
type Op int

const (
	OpSTT Op = iota
	OpTTS
)

func (o Op) field() string {
	if o == OpTTS {
		return "TTS (Kokoro) URL"
	}
	return "STT (Whisper) URL"
}

// OpFromString maps the frontend's "stt"/"tts" discovery argument to Op,
// defaulting to STT for anything else.
func OpFromString(s string) Op {
	if strings.EqualFold(strings.TrimSpace(s), "tts") {
		return OpTTS
	}
	return OpSTT
}

// Config carries the resolved endpoint settings. Base URLs must already be
// resolved (operation-specific URL falling back to the legacy shared one) and
// trimmed of trailing slashes; empty means "not configured".
type Config struct {
	STTBaseURL string
	TTSBaseURL string
	STTModel   string // "" = whisper-1
	TTSModel   string // "" = tts-1
	APIKey     string // "" = no Authorization header
}

// Engine proxies STT/TTS to the configured HTTP endpoints. Construct with New.
type Engine struct {
	cfg    Config
	client *http.Client
}

// New creates an HTTP speech engine. client may be nil, in which case a
// default client with a 60s timeout is used; pass a shared client so
// keep-alive connections are reused across calls.
func New(cfg Config, client *http.Client) *Engine {
	if client == nil {
		client = &http.Client{Timeout: defaultTimeout}
	}
	return &Engine{cfg: cfg, client: client}
}

// base returns the configured base URL for one operation ("" = unset).
func (e *Engine) base(o Op) string {
	if o == OpTTS {
		return e.cfg.TTSBaseURL
	}
	return e.cfg.STTBaseURL
}

// baseURLs builds the ordered list of base URLs to try for one operation.
// LOCAL-ONLY: there is NO cloud fallback on any code path; if nothing is
// configured it returns nil and the caller surfaces a clear error naming the
// field to fill in.
func (e *Engine) baseURLs(o Op) []string {
	if base := e.base(o); base != "" {
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

// doRequest centralizes the HTTP boilerplate shared by every voice proxy call:
// it builds the request with the given context, sets the Content-Type (when
// non-empty), attaches the optional Bearer auth header, performs the request,
// and fully reads + closes the body. It returns the response (for
// status/headers) and the read body bytes. The caller owns all status-code
// handling, so this preserves each caller's distinct semantics
// (doTranscribe/doSynthesize's 5xx-vs-4xx fallthrough, discoverGET's >=400
// error, Ping's "any response = up").
//
// A nil ctx is allowed (e.g. before the app lifecycle context is set) and
// falls back to the request's default background context.
//
// The Authorization header is omitted entirely when the API key is empty so
// local servers that reject an empty bearer still work.
func (e *Engine) doRequest(ctx context.Context, method, url string, body io.Reader, contentType string) (*http.Response, []byte, error) {
	var (
		req *http.Request
		err error
	)
	if ctx != nil {
		req, err = http.NewRequestWithContext(ctx, method, url, body)
	} else {
		req, err = http.NewRequest(method, url, body)
	}
	if err != nil {
		return nil, nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if e.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+e.cfg.APIKey)
	}

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp, nil, err
	}
	return resp, data, nil
}

// shouldFallthrough reports whether an error or response status should cause
// us to try the next provider in the ordered list. Connection errors and 5xx
// responses fall through; other (e.g. 4xx) responses are returned to the caller.
func shouldFallthrough(status int, err error) bool {
	if err != nil {
		return true
	}
	return status >= 500
}

// Transcribe proxies a speech-to-text request to the first reachable provider
// and returns the trimmed transcript text.
func (e *Engine) Transcribe(ctx context.Context, audio []byte, mime string) (string, error) {
	if len(audio) == 0 {
		return "", fmt.Errorf("empty audio")
	}

	model := e.cfg.STTModel
	if model == "" {
		model = defaultSTTModel
	}
	filename := filenameForMIME(mime)

	urls := e.baseURLs(OpSTT)
	if len(urls) == 0 {
		return "", fmt.Errorf("voice provider is set to \"local\" but no %s is configured — set it in Settings → Voice", OpSTT.field())
	}

	var lastErr error
	for _, base := range urls {
		text, status, err := e.doTranscribe(ctx, base, model, filename, audio)
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
func (e *Engine) doTranscribe(ctx context.Context, base, model, filename string, audio []byte) (string, int, error) {
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
	resp, data, err := e.doRequest(ctx, http.MethodPost, endpoint, &body, mw.FormDataContentType())
	if err != nil {
		// On a transport/build error resp is nil; on a body-read error resp is set.
		if resp != nil {
			return "", resp.StatusCode, err
		}
		return "", 0, err
	}
	return string(data), resp.StatusCode, nil
}

// speechRequest is the JSON body for the /v1/audio/speech endpoint.
type speechRequest struct {
	Model          string  `json:"model"`
	Input          string  `json:"input"`
	Voice          string  `json:"voice"`
	ResponseFormat string  `json:"response_format"`
	Speed          float64 `json:"speed"`
}

// Synthesize proxies a text-to-speech request and returns the audio bytes plus
// the response content-type.
func (e *Engine) Synthesize(ctx context.Context, text, voiceName string, speed float64) (engine.Audio, error) {
	if strings.TrimSpace(text) == "" {
		return engine.Audio{}, fmt.Errorf("empty text")
	}

	model := e.cfg.TTSModel
	if model == "" {
		model = defaultTTSModel
	}

	payload, err := json.Marshal(speechRequest{
		Model:          model,
		Input:          text,
		Voice:          voiceName,
		ResponseFormat: "mp3",
		Speed:          speed,
	})
	if err != nil {
		return engine.Audio{}, err
	}

	urls := e.baseURLs(OpTTS)
	if len(urls) == 0 {
		return engine.Audio{}, fmt.Errorf("voice provider is set to \"local\" but no %s is configured — set it in Settings → Voice", OpTTS.field())
	}

	var lastErr error
	for _, base := range urls {
		audio, contentType, status, err := e.doSynthesize(ctx, base, payload)
		if shouldFallthrough(status, err) {
			if err != nil {
				lastErr = err
			} else {
				lastErr = fmt.Errorf("provider %s returned status %d", base, status)
			}
			continue
		}
		if err != nil {
			return engine.Audio{}, err
		}
		if status >= 400 {
			return engine.Audio{}, fmt.Errorf("speech failed: status %d: %s", status, strconv.Quote(string(audio)))
		}
		return engine.Audio{Data: audio, ContentType: contentType}, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no provider succeeded")
	}
	return engine.Audio{}, fmt.Errorf("speech failed: %w", lastErr)
}

// doSynthesize performs a single TTS request against one base URL. It returns
// the audio bytes, content-type, HTTP status (0 on transport error), and any error.
func (e *Engine) doSynthesize(ctx context.Context, base string, payload []byte) ([]byte, string, int, error) {
	endpoint := base + "/v1/audio/speech"
	resp, data, err := e.doRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(payload), "application/json")
	if err != nil {
		// On a transport/build error resp is nil; on a body-read error resp is set.
		if resp != nil {
			return nil, "", resp.StatusCode, err
		}
		return nil, "", 0, err
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "audio/mpeg"
	}
	return data, contentType, resp.StatusCode, nil
}

// discoverGET issues a short-timeout GET against {base}/{path} for one
// operation's base URL and returns the raw response body. It soft-fails: the
// timeout is intentionally tight so a down/slow local server doesn't hang the
// Settings tab, and the caller turns any error into an empty list.
func (e *Engine) discoverGET(o Op, path string) ([]byte, error) {
	base := e.base(o)
	if base == "" {
		return nil, fmt.Errorf("no %s configured — set it in Settings → Voice", o.field())
	}

	ctx, cancel := context.WithTimeout(context.Background(), discoverTimeout)
	defer cancel()

	resp, data, err := e.doRequest(ctx, http.MethodGet, base+path, nil, "")
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
// operation and returns the available model ids. It tolerates the standard
// {"data":[{"id":...}]} shape as well as {"models":[...]} or a bare array;
// elements may be strings or objects with an id/name.
//
// It soft-fails: on any error it returns an empty slice plus the error so the
// frontend can fall back to its curated option list without surfacing a crash.
func (e *Engine) ListModels(o Op) ([]string, error) {
	data, err := e.discoverGET(o, "/v1/models")
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

// ListVoiceNames probes the TTS server's voices endpoint
// ({base}/v1/audio/voices) and returns the available voice ids. The response
// is expected as {"voices":[...]} where each element is a string or an object
// with an id/name; a bare array is also tolerated.
//
// It soft-fails like ListModels: any error yields an empty slice plus the error.
func (e *Engine) ListVoiceNames() ([]string, error) {
	data, err := e.discoverGET(OpTTS, "/v1/audio/voices")
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

// Voices adapts ListVoiceNames to the engine.Engine interface. The remote
// server does not expose numeric ids or languages, so only Name is populated
// (ID is the list index).
func (e *Engine) Voices() ([]engine.Voice, error) {
	names, err := e.ListVoiceNames()
	if err != nil {
		return nil, err
	}
	out := make([]engine.Voice, len(names))
	for i, n := range names {
		out[i] = engine.Voice{ID: i, Name: n}
	}
	return out, nil
}

// Ping probes whether the configured server for one operation is reachable.
// It issues a short-timeout GET to {base}/v1/models. Semantics:
//   - the URL for that op is unset → ok=false, "no STT|TTS URL configured".
//   - ANY HTTP response (even non-2xx) → the server is listening, ok=true with
//     a helpful detail (a non-2xx status is still "server up").
//   - connection refused / timeout / DNS failure → ok=false naming the host:port.
func (e *Engine) Ping(o Op) (bool, string) {
	base := e.base(o)
	if base == "" {
		kind := "STT"
		if o == OpTTS {
			kind = "TTS"
		}
		return false, "no " + kind + " URL configured"
	}

	hostPort := base
	if u, perr := url.Parse(base); perr == nil && u.Host != "" {
		hostPort = u.Host
	}

	ctx, cancel := context.WithTimeout(context.Background(), discoverTimeout)
	defer cancel()

	// doRequest builds + performs the request and fully reads (drains) the body
	// so the connection can be reused. A nil resp means a build or transport
	// error (invalid URL / connection refused / timeout / DNS) — i.e. not
	// reachable. A body-read error with a non-nil resp still means the server
	// responded, so we fall through to the status-based "server up" logic below.
	resp, _, err := e.doRequest(ctx, http.MethodGet, base+"/v1/models", nil, "")
	if err != nil && resp == nil {
		// Connection refused / timeout / DNS failure: the server is not listening.
		return false, fmt.Sprintf("not reachable — is the server running on %s?", hostPort)
	}

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return true, "reachable"
	}
	// Any other response still means the server is up and listening.
	return true, fmt.Sprintf("reachable (HTTP %d on /v1/models — server up)", resp.StatusCode)
}

// Ready reports whether at least one endpoint is configured. It performs no
// network I/O; use Ping for a liveness probe.
func (e *Engine) Ready() (bool, string) {
	if e.cfg.STTBaseURL == "" && e.cfg.TTSBaseURL == "" {
		return false, "no custom STT/TTS endpoint configured"
	}
	return true, ""
}

// Unload is a no-op: this backend holds no local resources.
func (e *Engine) Unload() {}
