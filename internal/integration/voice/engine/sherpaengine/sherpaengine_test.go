package sherpaengine

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"quant/internal/integration/voice/engine"
)

func TestVoicesEmbeddedTable(t *testing.T) {
	e := New(Config{ModelsDir: t.TempDir()})
	voices, err := e.Voices()
	if err != nil {
		t.Fatalf("Voices: %v", err)
	}
	if len(voices) != 53 {
		t.Fatalf("got %d voices, want 53", len(voices))
	}
	if voices[17].Name != "am_onyx" || voices[17].ID != 17 || voices[17].Lang != "en-us" {
		t.Errorf("voices[17] = %+v, want am_onyx/17/en-us", voices[17])
	}
	if voices[25].Name != "bm_fable" || voices[25].Lang != "en-gb" {
		t.Errorf("voices[25] = %+v, want bm_fable/en-gb", voices[25])
	}
	if voices[52].Name != "zm_yunyang" || voices[52].Lang != "zh" {
		t.Errorf("voices[52] = %+v, want zm_yunyang/zh", voices[52])
	}
}

func TestSpeakerIDMapping(t *testing.T) {
	cases := map[string]int{
		"am_onyx":    17,
		"af_heart":   3,
		"af_bella":   2,
		"zm_yunyang": 52,
		"17":         17,
		"0":          0,
		"52":         52,
		"":           3,  // empty → default (af_heart)
		"  am_onyx ": 17, // trimmed
		"nope":       3,  // unknown → default
		"999":        3,  // out of range → default
		"-1":         3,
	}
	for name, want := range cases {
		if got := speakerID(name); got != want {
			t.Errorf("speakerID(%q) = %d, want %d", name, got, want)
		}
	}
}

func TestReadyNamesMissingFiles(t *testing.T) {
	dir := t.TempDir()
	e := New(Config{ModelsDir: dir})

	// Nothing installed → generic message.
	ok, detail := e.Ready()
	if ok || detail != "voice models are not installed" {
		t.Errorf("empty dir Ready() = %v %q", ok, detail)
	}

	// Create everything except the whisper decoder → detail names it.
	for mdl, files := range RequiredFiles() {
		for _, f := range files {
			if f == "small.en-decoder.int8.onnx" {
				continue
			}
			path := filepath.Join(dir, mdl, f)
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	ok, detail = e.Ready()
	if ok {
		t.Fatal("Ready() = true with a missing decoder")
	}
	if !strings.Contains(detail, "small.en-decoder.int8.onnx") {
		t.Errorf("detail should name the missing file, got %q", detail)
	}

	// Complete the set → ready.
	path := filepath.Join(dir, WhisperDirName, "small.en-decoder.int8.onnx")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if ok, detail = e.Ready(); !ok {
		t.Errorf("Ready() = false %q after all files created", detail)
	}
}

func TestUnloadIdempotentWithoutModels(t *testing.T) {
	e := New(Config{ModelsDir: t.TempDir()})
	e.Unload()
	e.Unload()
}

// TestRealRoundTrip synthesizes speech with Kokoro and transcribes it back
// with Whisper against real model files. It runs only when
// QUANT_SHERPA_MODELS_DIR points at a directory containing the
// kokoro-int8-multi-lang-v1_0/ and sherpa-onnx-whisper-small.en/ layouts.
func TestRealRoundTrip(t *testing.T) {
	modelsDir := os.Getenv("QUANT_SHERPA_MODELS_DIR")
	if modelsDir == "" {
		t.Skip("QUANT_SHERPA_MODELS_DIR not set; skipping real sherpa round trip")
	}

	e := New(Config{ModelsDir: modelsDir, IdleUnload: time.Minute})
	defer e.Unload()

	if ok, detail := e.Ready(); !ok {
		t.Fatalf("engine not ready under %s: %s", modelsDir, detail)
	}

	const text = "Hello, this is the quant embedded voice engine round trip test."
	ctx := context.Background()

	audio, err := e.Synthesize(ctx, text, "am_onyx", 1.2)
	if err != nil {
		t.Fatalf("Synthesize: %v", err)
	}
	if audio.ContentType != "audio/wav" {
		t.Errorf("ContentType = %q, want audio/wav", audio.ContentType)
	}
	if len(audio.Data) < 1000 {
		t.Fatalf("suspiciously small audio: %d bytes", len(audio.Data))
	}
	// The output must be a decodable 16-bit PCM WAV at Kokoro's 24 kHz.
	samples, rate, err := engine.DecodeWAV(audio.Data)
	if err != nil {
		t.Fatalf("synthesized audio is not decodable WAV: %v", err)
	}
	if rate != 24000 {
		t.Errorf("synthesized sample rate = %d, want 24000", rate)
	}
	t.Logf("synthesized %.2fs of audio (%d bytes)", float64(len(samples))/float64(rate), len(audio.Data))

	transcript, err := e.Transcribe(ctx, audio.Data, "audio/wav")
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	t.Logf("transcript: %q", transcript)

	norm := strings.ToLower(transcript)
	for _, word := range []string{"quant", "embedded", "voice", "round trip"} {
		if !strings.Contains(norm, word) {
			t.Errorf("transcript %q missing %q", transcript, word)
		}
	}

	// Unload and use again: models must lazily reload.
	e.Unload()
	transcript2, err := e.Transcribe(ctx, audio.Data, "audio/wav")
	if err != nil {
		t.Fatalf("Transcribe after Unload: %v", err)
	}
	if strings.TrimSpace(transcript2) == "" {
		t.Error("empty transcript after Unload/reload")
	}
}
