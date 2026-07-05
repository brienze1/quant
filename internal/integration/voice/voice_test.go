package voice

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"quant/internal/domain/entity"
	"quant/internal/integration/voice/engine/httpengine"
	"quant/internal/integration/voice/engine/sherpaengine"
)

// stubConfigManager is a minimal adapter.ConfigManager for tests. Only GetConfig
// is exercised by the voice controller.
type stubConfigManager struct {
	cfg *entity.Config
}

func (s *stubConfigManager) GetConfig() (*entity.Config, error) { return s.cfg, nil }
func (s *stubConfigManager) SaveConfig(*entity.Config) error    { return nil }
func (s *stubConfigManager) ResetDatabase() error               { return nil }
func (s *stubConfigManager) ClearSessionLogs() error            { return nil }
func (s *stubConfigManager) GetDatabasePath() string            { return "" }
func (s *stubConfigManager) SendNotification(string, string) error {
	return nil
}

// newController builds a controller whose embedded engine points at an empty
// temp dir, so the sherpa path is never ready and the selector exercises the
// HTTP / not-installed branches deterministically.
func newController(t *testing.T, cfg entity.VoiceConfig) *voiceController {
	t.Helper()
	return NewVoiceControllerWithEngine(
		&stubConfigManager{cfg: &entity.Config{Voice: cfg}}, nil, nil,
		sherpaengine.New(sherpaengine.Config{ModelsDir: t.TempDir()}),
	)
}

// stubMessenger records the messages StartVoiceSession writes to a session's PTY.
type stubMessenger struct {
	calls   []struct{ id, message string }
	failOn  string // if non-empty, SendMessage(failOn-id, ...) returns an error
	failErr error
}

func (s *stubMessenger) SendMessage(id, message string) error {
	if s.failOn != "" && id == s.failOn {
		return s.failErr
	}
	s.calls = append(s.calls, struct{ id, message string }{id, message})
	return nil
}

func TestStartVoiceSessionInjectsPersonaAndSubmits(t *testing.T) {
	msgr := &stubMessenger{}
	c := NewVoiceController(&stubConfigManager{cfg: &entity.Config{}}, nil, msgr)

	if err := c.StartVoiceSession("sess-1"); err != nil {
		t.Fatalf("StartVoiceSession: %v", err)
	}

	if len(msgr.calls) != 2 {
		t.Fatalf("expected 2 SendMessage calls (persona + Enter), got %d: %+v", len(msgr.calls), msgr.calls)
	}
	if msgr.calls[0].id != "sess-1" || msgr.calls[0].message != VoicePersona {
		t.Errorf("first call should inject VoicePersona into sess-1, got id=%q message=%q", msgr.calls[0].id, msgr.calls[0].message)
	}
	if msgr.calls[1].id != "sess-1" || msgr.calls[1].message != "\r" {
		t.Errorf("second call should submit (Enter) for sess-1, got id=%q message=%q", msgr.calls[1].id, msgr.calls[1].message)
	}
}

func TestStartVoiceSessionAppendsCustomInstructions(t *testing.T) {
	const custom = "Be a concise pair-programming buddy."
	msgr := &stubMessenger{}
	c := NewVoiceController(
		&stubConfigManager{cfg: &entity.Config{Voice: entity.VoiceConfig{Instructions: "  " + custom + "  "}}},
		nil, msgr,
	)

	if err := c.StartVoiceSession("sess-1"); err != nil {
		t.Fatalf("StartVoiceSession: %v", err)
	}
	if len(msgr.calls) != 2 {
		t.Fatalf("expected 2 SendMessage calls, got %d: %+v", len(msgr.calls), msgr.calls)
	}
	kickoff := msgr.calls[0].message
	if !strings.HasPrefix(kickoff, VoicePersona) {
		t.Errorf("kickoff should start with VoicePersona, got %q", kickoff)
	}
	if !strings.Contains(kickoff, custom) {
		t.Errorf("kickoff should contain the trimmed custom instructions, got %q", kickoff)
	}
	if strings.Contains(kickoff, "  "+custom) {
		t.Errorf("custom instructions should be trimmed, got %q", kickoff)
	}
}

func TestStartVoiceSessionPropagatesSendError(t *testing.T) {
	wantErr := io.ErrUnexpectedEOF
	msgr := &stubMessenger{failOn: "sess-x", failErr: wantErr}
	c := NewVoiceController(&stubConfigManager{cfg: &entity.Config{}}, nil, msgr)

	err := c.StartVoiceSession("sess-x")
	if err == nil {
		t.Fatal("expected error when the session has no running process, got nil")
	}
	if !strings.Contains(err.Error(), "sess-x") {
		t.Errorf("error should name the session, got: %v", err)
	}
}

func TestStartVoiceSessionRequiresSessionID(t *testing.T) {
	c := NewVoiceController(&stubConfigManager{cfg: &entity.Config{}}, nil, &stubMessenger{})
	if err := c.StartVoiceSession("  "); err == nil {
		t.Fatal("expected error for blank sessionId, got nil")
	}
}

// TestTranscribeRoutesToCustomEndpoint proves the controller keeps the exact
// HTTP proxy behavior when a custom STT endpoint is configured and the
// embedded engine is not installed.
func TestTranscribeRoutesToCustomEndpoint(t *testing.T) {
	const marker = "the quick brown fox"
	var gotModel, gotAuth, gotFilename string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			t.Fatalf("ParseMultipartForm: %v", err)
		}
		gotModel = r.FormValue("model")
		_, hdr, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("FormFile: %v", err)
		}
		gotFilename = hdr.Filename
		_, _ = io.WriteString(w, marker+"\n")
	}))
	defer srv.Close()

	c := newController(t, entity.VoiceConfig{
		Provider:   "local",
		STTBaseURL: srv.URL,
		APIKey:     "sk-test-123",
		STTModel:   "whisper-1",
	})

	transcript, err := c.Transcribe(base64.StdEncoding.EncodeToString([]byte("FAKE_WEBM_AUDIO")), "audio/webm", "")
	if err != nil {
		t.Fatalf("Transcribe error: %v", err)
	}
	if transcript != marker {
		t.Errorf("transcript = %q, want %q (trimmed)", transcript, marker)
	}
	if gotModel != "whisper-1" {
		t.Errorf("model field = %q, want whisper-1", gotModel)
	}
	if gotAuth != "Bearer sk-test-123" {
		t.Errorf("Authorization = %q, want Bearer sk-test-123", gotAuth)
	}
	if gotFilename != "audio.webm" {
		t.Errorf("filename = %q, want audio.webm", gotFilename)
	}
}

// TestSynthesizeUsesConfigDefaultsForVoiceAndSpeed asserts the controller
// resolves blank voice / zero speed from the (defaulted) config before hitting
// the backend.
func TestSynthesizeUsesConfigDefaultsForVoiceAndSpeed(t *testing.T) {
	var body struct {
		Model string  `json:"model"`
		Voice string  `json:"voice"`
		Speed float64 `json:"speed"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, _ = w.Write([]byte("mp3"))
	}))
	defer srv.Close()

	c := newController(t, entity.VoiceConfig{Provider: "local", TTSBaseURL: srv.URL})
	if _, err := c.Synthesize("hi", "", 0, ""); err != nil {
		t.Fatalf("Synthesize: %v", err)
	}
	wantVoice := sherpaengine.DefaultVoice(sherpaengine.LangEN)
	if body.Voice != wantVoice {
		t.Errorf("voice = %q, want %q", body.Voice, wantVoice)
	}
	if body.Speed != defaultSpeed {
		t.Errorf("speed = %v, want %v", body.Speed, defaultSpeed)
	}
	if body.Model != "tts-1" {
		t.Errorf("model = %q, want tts-1 (http default)", body.Model)
	}
}

// TestSynthesizeReturnsBase64AndContentType covers the SpeechResult contract
// on the http path.
func TestSynthesizeReturnsBase64AndContentType(t *testing.T) {
	audioBytes := []byte("ID3\x00\x00\x00FAKEMP3")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(audioBytes)
	}))
	defer srv.Close()

	c := newController(t, entity.VoiceConfig{Provider: "local", TTSBaseURL: srv.URL})
	res, err := c.Synthesize("hello world", "am_onyx", 1.2, "")
	if err != nil {
		t.Fatalf("Synthesize error: %v", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(res.AudioB64)
	if err != nil {
		t.Fatalf("returned audio not valid base64: %v", err)
	}
	if string(decoded) != string(audioBytes) {
		t.Errorf("audio = %q, want %q", decoded, audioBytes)
	}
	if res.ContentType != "audio/mpeg" {
		t.Errorf("content-type = %q, want audio/mpeg", res.ContentType)
	}
}

// TestNotInstalledError is the new no-backend contract: with the embedded
// models absent and no custom endpoint configured, every speech call points
// the user at the one-click install in Settings → Voice.
func TestNotInstalledError(t *testing.T) {
	c := newController(t, entity.VoiceConfig{Provider: "local"})

	if _, err := c.Transcribe(base64.StdEncoding.EncodeToString([]byte("x")), "audio/webm", ""); err == nil || !strings.Contains(err.Error(), "download it in Settings → Voice") {
		t.Errorf("Transcribe error = %v, want download-voice-mode error", err)
	}
	if _, err := c.Synthesize("hi", "", 0, ""); err == nil || !strings.Contains(err.Error(), "download it in Settings → Voice") {
		t.Errorf("Synthesize error = %v, want download-voice-mode error", err)
	}
}

// TestLocalOnlyNoCloudEgress is the core local-only guarantee: NO provider
// value — including the legacy "auto" and "cloud" — may ever yield the OpenAI
// cloud URL from resolveBase (it only returns user-configured endpoints), and
// WithDefaults must rewrite any such legacy provider to "local" so it persists
// as local on the next save.
func TestLocalOnlyNoCloudEgress(t *testing.T) {
	const cloudHost = "api.openai.com"

	for _, provider := range []string{"auto", "cloud", "local", ""} {
		vc := entity.VoiceConfig{Provider: provider, BaseURL: "http://localhost:9/"}
		for _, o := range []httpengine.Op{httpengine.OpSTT, httpengine.OpTTS} {
			if u := resolveBase(vc, o); strings.Contains(u, cloudHost) {
				t.Errorf("provider %q op %v resolveBase leaked cloud URL: %q", provider, o, u)
			}
		}
		// With NO configured URL there is no fallback of any kind.
		if got := resolveBase(entity.VoiceConfig{Provider: provider}, httpengine.OpSTT); got != "" {
			t.Errorf("provider %q with no URL should resolve empty (no cloud fallback), got %q", provider, got)
		}
	}

	// WithDefaults migrates any legacy provider to "local".
	for _, provider := range []string{"auto", "cloud", "", "anything"} {
		if got := (entity.VoiceConfig{Provider: provider}).WithDefaults().Provider; got != "local" {
			t.Errorf("WithDefaults({provider:%q}).Provider = %q, want local", provider, got)
		}
	}
}

func TestIsLocal(t *testing.T) {
	cases := map[string]bool{
		"http://localhost:8080":     true,
		"http://127.0.0.1:9000/v1":  true,
		"https://[::1]:1234":        true,
		"http://0.0.0.0:8080":       false,
		"https://api.openai.com":    false,
		"http://192.168.1.5:8080":   false,
		"":                          false,
		"https://example.com/local": false,
	}
	for url, want := range cases {
		if got := isLocal(url); got != want {
			t.Errorf("isLocal(%q) = %v, want %v", url, got, want)
		}
	}
}

// TestResolveBasePerOperation asserts STT and TTS resolve from their own URLs
// first, then fall back to the shared legacy BaseURL, and are trimmed of the
// trailing slash.
func TestResolveBasePerOperation(t *testing.T) {
	vc := entity.VoiceConfig{
		Provider:   "local",
		BaseURL:    "http://shared:1",
		STTBaseURL: "http://localhost:2022/",
		TTSBaseURL: "http://localhost:8880/",
	}
	if got := resolveBase(vc, httpengine.OpSTT); got != "http://localhost:2022" {
		t.Errorf("STT URL = %q, want http://localhost:2022", got)
	}
	if got := resolveBase(vc, httpengine.OpTTS); got != "http://localhost:8880" {
		t.Errorf("TTS URL = %q, want http://localhost:8880", got)
	}

	// Fallback to the shared legacy BaseURL when the specific one is empty.
	fb := entity.VoiceConfig{Provider: "local", BaseURL: "http://shared:1/"}
	if got := resolveBase(fb, httpengine.OpSTT); got != "http://shared:1" {
		t.Errorf("STT fallback to BaseURL = %q", got)
	}
	if got := resolveBase(fb, httpengine.OpTTS); got != "http://shared:1" {
		t.Errorf("TTS fallback to BaseURL = %q", got)
	}

	// No URL at all → "" (caller surfaces the not-installed error).
	if got := resolveBase(entity.VoiceConfig{Provider: "local"}, httpengine.OpSTT); got != "" {
		t.Errorf("local with no URL should resolve empty, got %q", got)
	}
}

// TestTranscribeAndSynthesizeHitSeparateURLs proves that with custom endpoints
// configured, STT goes to STTBaseURL and TTS goes to TTSBaseURL — two distinct
// servers.
func TestTranscribeAndSynthesizeHitSeparateURLs(t *testing.T) {
	var sttHit, ttsHit bool

	stt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sttHit = true
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Errorf("STT server got unexpected path: %s", r.URL.Path)
		}
		_, _ = io.WriteString(w, "hi from whisper")
	}))
	defer stt.Close()

	tts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ttsHit = true
		if r.URL.Path != "/v1/audio/speech" {
			t.Errorf("TTS server got unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("MP3"))
	}))
	defer tts.Close()

	c := newController(t, entity.VoiceConfig{
		Provider:   "local",
		STTBaseURL: stt.URL,
		TTSBaseURL: tts.URL,
	})

	transcript, err := c.Transcribe(base64.StdEncoding.EncodeToString([]byte("x")), "audio/webm", "")
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if transcript != "hi from whisper" {
		t.Errorf("transcript = %q", transcript)
	}
	if _, err := c.Synthesize("hello", "", 0, ""); err != nil {
		t.Fatalf("Synthesize: %v", err)
	}
	if !sttHit {
		t.Error("STT server was not hit by Transcribe")
	}
	if !ttsHit {
		t.Error("TTS server was not hit by Synthesize")
	}
}

// TestWithDefaultsMigratesLegacyLocalhostURLs pins the migration contract: the
// previously auto-filled localhost engine URLs are stripped back to "" (empty
// now means "use the embedded engine"), while genuinely custom endpoints
// survive, and the provider always normalizes to "local".
func TestWithDefaultsMigratesLegacyLocalhostURLs(t *testing.T) {
	d := entity.VoiceConfig{
		STTBaseURL: "http://localhost:2022",
		TTSBaseURL: "http://localhost:8880",
	}.WithDefaults()
	if d.Provider != "local" {
		t.Errorf("provider = %q, want local", d.Provider)
	}
	if d.STTBaseURL != "" || d.TTSBaseURL != "" {
		t.Errorf("legacy localhost URLs should migrate to empty, got %q / %q", d.STTBaseURL, d.TTSBaseURL)
	}

	// A blank config stays blank (no localhost auto-fill anymore).
	b := entity.VoiceConfig{}.WithDefaults()
	if b.STTBaseURL != "" || b.TTSBaseURL != "" {
		t.Errorf("blank config URLs = %q / %q, want empty", b.STTBaseURL, b.TTSBaseURL)
	}
	if b.Voice != "af_heart" || b.Speed != 1.2 || b.PauseMs != 3000 {
		t.Errorf("voice defaults = %q/%v/%d, want af_heart/1.2/3000", b.Voice, b.Speed, b.PauseMs)
	}

	// Custom endpoints survive untouched.
	c := entity.VoiceConfig{STTBaseURL: "http://192.168.1.5:2022", TTSBaseURL: "http://myserver:8880"}.WithDefaults()
	if c.STTBaseURL != "http://192.168.1.5:2022" || c.TTSBaseURL != "http://myserver:8880" {
		t.Errorf("custom URLs were mangled: %q / %q", c.STTBaseURL, c.TTSBaseURL)
	}
}

// TestPingSemantics covers the three-way probe: custom endpoint listening →
// Ok=true; custom endpoint down → Ok=false naming the host:port; nothing
// configured/installed → Ok=false pointing at the one-click install.
func TestPingSemantics(t *testing.T) {
	// 2xx server → reachable.
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer ok.Close()

	// 404 server → still listening, so reachable.
	notFound := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer notFound.Close()

	c := newController(t, entity.VoiceConfig{Provider: "local", STTBaseURL: ok.URL, TTSBaseURL: notFound.URL})

	if r, _ := c.Ping("stt"); !r.Ok {
		t.Errorf("Ping(stt) on 2xx server = %+v, want Ok=true", r)
	}
	if r, _ := c.Ping("tts"); !r.Ok {
		t.Errorf("Ping(tts) on 404 server = %+v, want Ok=true (server is up)", r)
	}

	// Refused connection (closed server) → not reachable.
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close()
	c2 := newController(t, entity.VoiceConfig{Provider: "local", STTBaseURL: deadURL, TTSBaseURL: deadURL})
	if r, _ := c2.Ping("stt"); r.Ok || !strings.Contains(r.Detail, "not reachable") {
		t.Errorf("Ping(stt) on closed server = %+v, want Ok=false and 'not reachable'", r)
	}

	// Nothing installed, nothing configured → point at the one-click install.
	c3 := newController(t, entity.VoiceConfig{})
	if r, _ := c3.Ping("stt"); r.Ok || !strings.Contains(r.Detail, "not installed") {
		t.Errorf("Ping(stt) with no backend = %+v, want Ok=false 'not installed'", r)
	}
}

// TestListModelsAndVoicesSherpaStub asserts the fixed embedded-engine answers
// are used once the models are installed. It fakes an install by creating the
// required files as empty stand-ins (Ready only stats them).
func TestListModelsAndVoicesSherpaStub(t *testing.T) {
	dir := t.TempDir()
	writeFakeSherpaModels(t, dir)
	c := NewVoiceControllerWithEngine(
		&stubConfigManager{cfg: &entity.Config{}}, nil, nil,
		sherpaengine.New(sherpaengine.Config{ModelsDir: dir}),
	)

	models, err := c.ListModels("stt")
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if len(models) != 1 || models[0] != sherpaSTTModel {
		t.Errorf("models = %v, want [%s]", models, sherpaSTTModel)
	}

	// ListVoices filters the 53-speaker table by language. English (en-us +
	// en-gb) = 28 voices and must include am_onyx; Brazilian Portuguese = 3.
	enVoices, err := c.ListVoices("en")
	if err != nil {
		t.Fatalf("ListVoices(en): %v", err)
	}
	if len(enVoices) != 28 {
		t.Errorf("got %d English voices, want 28", len(enVoices))
	}
	if !containsStr(enVoices, "am_onyx") {
		t.Errorf("English voices %v missing am_onyx", enVoices)
	}
	if containsStr(enVoices, "pf_dora") {
		t.Errorf("English voices %v should not include the pt-br voice pf_dora", enVoices)
	}
	ptVoices, err := c.ListVoices("pt-br")
	if err != nil {
		t.Fatalf("ListVoices(pt-br): %v", err)
	}
	if len(ptVoices) != 3 || !containsStr(ptVoices, "pf_dora") {
		t.Errorf("got %d pt-br voices (%v), want 3 including pf_dora", len(ptVoices), ptVoices)
	}

	if r, _ := c.Ping("stt"); !r.Ok || !strings.Contains(r.Detail, "embedded") {
		t.Errorf("Ping with models installed = %+v, want embedded-ready", r)
	}
}

// containsStr reports whether s is in xs.
func containsStr(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

// writeFakeSherpaModels creates every file RequiredFiles demands as an empty
// stand-in so sherpa's Ready() reports installed without real models.
func writeFakeSherpaModels(t *testing.T, dir string) {
	t.Helper()
	for mdl, files := range sherpaengine.RequiredFiles() {
		for _, f := range files {
			path := filepath.Join(dir, mdl, f)
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
}
