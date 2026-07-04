package httpengine

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTranscribeMultipartAndAuth(t *testing.T) {
	const marker = "the quick brown fox"
	var gotModel, gotRespFormat, gotAuth, gotFilename string
	var gotFileContents []byte

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			t.Fatalf("ParseMultipartForm: %v", err)
		}
		gotModel = r.FormValue("model")
		gotRespFormat = r.FormValue("response_format")
		file, hdr, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("FormFile: %v", err)
		}
		defer file.Close()
		gotFilename = hdr.Filename
		gotFileContents, _ = io.ReadAll(file)
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, marker+"\n")
	}))
	defer srv.Close()

	e := New(Config{STTBaseURL: srv.URL, APIKey: "sk-test-123", STTModel: "whisper-1"}, nil)

	audio := []byte("FAKE_WEBM_AUDIO")
	transcript, err := e.Transcribe(context.Background(), audio, "audio/webm")
	if err != nil {
		t.Fatalf("Transcribe error: %v", err)
	}

	if transcript != marker {
		t.Errorf("transcript = %q, want %q (trimmed)", transcript, marker)
	}
	if gotModel != "whisper-1" {
		t.Errorf("model field = %q, want whisper-1", gotModel)
	}
	if gotRespFormat != "text" {
		t.Errorf("response_format = %q, want text", gotRespFormat)
	}
	if gotAuth != "Bearer sk-test-123" {
		t.Errorf("Authorization = %q, want Bearer sk-test-123", gotAuth)
	}
	if gotFilename != "audio.webm" {
		t.Errorf("filename = %q, want audio.webm", gotFilename)
	}
	if string(gotFileContents) != string(audio) {
		t.Errorf("file contents = %q, want %q", gotFileContents, audio)
	}
}

func TestTranscribeDefaultModelAndWavFilename(t *testing.T) {
	var gotModel, gotFilename string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseMultipartForm(10 << 20)
		gotModel = r.FormValue("model")
		_, hdr, _ := r.FormFile("file")
		gotFilename = hdr.Filename
		_, _ = io.WriteString(w, "ok")
	}))
	defer srv.Close()

	e := New(Config{STTBaseURL: srv.URL}, nil)
	if _, err := e.Transcribe(context.Background(), []byte("x"), "audio/wav"); err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if gotModel != defaultSTTModel {
		t.Errorf("default model = %q, want %q", gotModel, defaultSTTModel)
	}
	if gotFilename != "audio.wav" {
		t.Errorf("filename = %q, want audio.wav", gotFilename)
	}
}

func TestSynthesizeJSONBodyAndBytes(t *testing.T) {
	audioBytes := []byte("ID3\x00\x00\x00FAKEMP3")
	var body speechRequest
	var gotAuth string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", ct)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(audioBytes)
	}))
	defer srv.Close()

	e := New(Config{TTSBaseURL: srv.URL, APIKey: "sk-tts", TTSModel: "kokoro"}, nil)

	res, err := e.Synthesize(context.Background(), "hello world", "am_onyx", 1.2)
	if err != nil {
		t.Fatalf("Synthesize error: %v", err)
	}

	if string(res.Data) != string(audioBytes) {
		t.Errorf("audio = %q, want %q", res.Data, audioBytes)
	}
	if res.ContentType != "audio/mpeg" {
		t.Errorf("content-type = %q, want audio/mpeg", res.ContentType)
	}
	if gotAuth != "Bearer sk-tts" {
		t.Errorf("Authorization = %q, want Bearer sk-tts", gotAuth)
	}
	if body.Model != "kokoro" {
		t.Errorf("model = %q, want kokoro", body.Model)
	}
	if body.Input != "hello world" {
		t.Errorf("input = %q, want 'hello world'", body.Input)
	}
	if body.Voice != "am_onyx" {
		t.Errorf("voice = %q, want am_onyx", body.Voice)
	}
	if body.ResponseFormat != "mp3" {
		t.Errorf("response_format = %q, want mp3", body.ResponseFormat)
	}
	if body.Speed != 1.2 {
		t.Errorf("speed = %v, want 1.2", body.Speed)
	}
}

func TestTranscribeFallbackOrdering(t *testing.T) {
	const marker = "second wins"
	var firstHit, secondHit bool

	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		firstHit = true
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, "boom")
	}))
	defer first.Close()

	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secondHit = true
		_, _ = io.WriteString(w, marker)
	}))
	defer second.Close()

	// The proxy tries provider base URLs in order, falling through 5xx/transport
	// errors to the next. We exercise that fallthrough by invoking doTranscribe
	// directly on each server (first 500 → fallthrough, second 200 → success).
	e := New(Config{STTBaseURL: second.URL}, nil)
	_, status, err := e.doTranscribe(context.Background(), strings.TrimRight(first.URL, "/"), "whisper-1", "audio.webm", []byte("a"))
	if err != nil {
		t.Fatalf("doTranscribe first: %v", err)
	}
	if !shouldFallthrough(status, nil) {
		t.Fatalf("status %d should fall through", status)
	}
	text, status2, err := e.doTranscribe(context.Background(), strings.TrimRight(second.URL, "/"), "whisper-1", "audio.webm", []byte("a"))
	if err != nil {
		t.Fatalf("doTranscribe second: %v", err)
	}
	if status2 != http.StatusOK || strings.TrimSpace(text) != marker {
		t.Fatalf("second response = %d %q, want 200 %q", status2, text, marker)
	}
	if !firstHit || !secondHit {
		t.Fatalf("expected both servers hit; first=%v second=%v", firstHit, secondHit)
	}
}

// TestNoAuthHeaderWhenKeyEmpty asserts that an empty API key sends NO
// Authorization header (local servers may reject an empty bearer), while a set
// key sends the bearer header.
func TestNoAuthHeaderWhenKeyEmpty(t *testing.T) {
	var hadAuthHeader bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, hadAuthHeader = r.Header["Authorization"]
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("MP3"))
	}))
	defer srv.Close()

	// Empty key → no header.
	e := New(Config{TTSBaseURL: srv.URL}, nil)
	if _, err := e.Synthesize(context.Background(), "hi", "am_onyx", 1.2); err != nil {
		t.Fatalf("Synthesize (no key): %v", err)
	}
	if hadAuthHeader {
		t.Error("Authorization header should be absent when API key is empty")
	}

	// Non-empty key → header present.
	hadAuthHeader = false
	e2 := New(Config{TTSBaseURL: srv.URL, APIKey: "sk-x"}, nil)
	if _, err := e2.Synthesize(context.Background(), "hi", "am_onyx", 1.2); err != nil {
		t.Fatalf("Synthesize (with key): %v", err)
	}
	if !hadAuthHeader {
		t.Error("Authorization header should be present when API key is set")
	}
}

func TestMissingURLErrors(t *testing.T) {
	e := New(Config{}, nil)

	if _, err := e.Transcribe(context.Background(), []byte("x"), "audio/wav"); err == nil || !strings.Contains(err.Error(), "STT (Whisper) URL") {
		t.Errorf("Transcribe with no URL = %v, want missing STT URL error", err)
	}
	if _, err := e.Synthesize(context.Background(), "hi", "am_onyx", 1.2); err == nil || !strings.Contains(err.Error(), "TTS (Kokoro) URL") {
		t.Errorf("Synthesize with no URL = %v, want missing TTS URL error", err)
	}
	if _, err := e.ListVoiceNames(); err == nil || !strings.Contains(err.Error(), "TTS (Kokoro) URL") {
		t.Errorf("ListVoiceNames with no URL = %v, want missing TTS URL error", err)
	}
}

// TestPingReachableAndNonReachable covers the connection-probe semantics: a
// listening server (even a non-2xx /v1/models) → ok=true; a refused connection
// → ok=false naming the host:port; no URL → ok=false "no STT|TTS URL configured".
func TestPingReachableAndNonReachable(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer ok.Close()

	notFound := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer notFound.Close()

	e := New(Config{STTBaseURL: ok.URL, TTSBaseURL: notFound.URL}, nil)
	if up, detail := e.Ping(OpSTT); !up {
		t.Errorf("Ping(stt) on 2xx server = %v %q, want ok", up, detail)
	}
	if up, detail := e.Ping(OpTTS); !up {
		t.Errorf("Ping(tts) on 404 server = %v %q, want ok (server is up)", up, detail)
	}

	// Refused connection (closed server) → not reachable.
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close()
	e2 := New(Config{STTBaseURL: deadURL}, nil)
	if up, detail := e2.Ping(OpSTT); up || !strings.Contains(detail, "not reachable") {
		t.Errorf("Ping(stt) on closed server = %v %q, want not reachable", up, detail)
	}

	// No URL configured → named clearly.
	e3 := New(Config{}, nil)
	if up, detail := e3.Ping(OpTTS); up || detail != "no TTS URL configured" {
		t.Errorf("Ping(tts) with no URL = %v %q", up, detail)
	}
}

func TestListVoicesAndModelsParsing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/voices":
			_, _ = io.WriteString(w, `{"voices":["am_onyx",{"id":"af_bella"},{"name":"bm_fable"}]}`)
		case "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"whisper-1"},"kokoro"]}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	e := New(Config{STTBaseURL: srv.URL, TTSBaseURL: srv.URL}, nil)

	voices, err := e.ListVoiceNames()
	if err != nil {
		t.Fatalf("ListVoiceNames: %v", err)
	}
	if len(voices) != 3 || voices[0] != "am_onyx" || voices[1] != "af_bella" || voices[2] != "bm_fable" {
		t.Errorf("voices = %v", voices)
	}

	models, err := e.ListModels(OpSTT)
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if len(models) != 2 || models[0] != "whisper-1" || models[1] != "kokoro" {
		t.Errorf("models = %v", models)
	}
}
