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
	if voices[42].Name != "pf_dora" || voices[42].ID != 42 || voices[42].Lang != "pt-br" {
		t.Errorf("voices[42] = %+v, want pf_dora/42/pt-br", voices[42])
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
		"pf_dora":    42,
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

func TestNormalizeLang(t *testing.T) {
	cases := map[string]string{
		"pt-br":  LangPTBR,
		"PT-BR":  LangPTBR,
		" pt-br": LangPTBR,
		"en":     LangEN,
		"":       LangEN,
		"fr":     LangEN,
		"pt":     LangEN, // only "pt-br" maps to Portuguese
	}
	for in, want := range cases {
		if got := normalizeLang(in); got != want {
			t.Errorf("normalizeLang(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDefaultVoice(t *testing.T) {
	if got := DefaultVoice(LangEN); got != "af_heart" {
		t.Errorf("DefaultVoice(en) = %q, want af_heart", got)
	}
	if got := DefaultVoice(LangPTBR); got != "pf_dora" {
		t.Errorf("DefaultVoice(pt-br) = %q, want pf_dora", got)
	}
	if got := DefaultVoice(""); got != "af_heart" {
		t.Errorf("DefaultVoice(\"\") = %q, want af_heart", got)
	}
}

func TestSTTDirNameAndPrefix(t *testing.T) {
	if sttDirName(LangEN) != WhisperEnDirName || sttFilePrefix(LangEN) != "small.en" {
		t.Errorf("EN stt = %q/%q, want %q/small.en", sttDirName(LangEN), sttFilePrefix(LangEN), WhisperEnDirName)
	}
	if sttDirName(LangPTBR) != WhisperMultiDirName || sttFilePrefix(LangPTBR) != "small" {
		t.Errorf("PT stt = %q/%q, want %q/small", sttDirName(LangPTBR), sttFilePrefix(LangPTBR), WhisperMultiDirName)
	}
	if whisperLang(LangEN) != "en" || whisperLang(LangPTBR) != "pt" {
		t.Errorf("whisperLang en=%q pt=%q, want en/pt", whisperLang(LangEN), whisperLang(LangPTBR))
	}
}

func TestRequiredFilesSets(t *testing.T) {
	// Base == EN, and RequiredFiles back-compat alias == base.
	en := RequiredFilesFor(LangEN)
	if _, ok := en[KokoroDirName]; !ok {
		t.Error("RequiredFilesFor(en) missing kokoro dir")
	}
	if _, ok := en[WhisperEnDirName]; !ok {
		t.Error("RequiredFilesFor(en) missing whisper.en dir")
	}
	if len(BaseRequiredFiles()) != len(en) {
		t.Error("BaseRequiredFiles != RequiredFilesFor(en)")
	}
	if len(RequiredFiles()) != len(en) {
		t.Error("RequiredFiles() (back-compat) != base set")
	}

	pt := RequiredFilesFor(LangPTBR)
	if _, ok := pt[WhisperMultiDirName]; !ok {
		t.Error("RequiredFilesFor(pt-br) missing multilingual whisper dir")
	}
	if _, ok := pt[WhisperEnDirName]; ok {
		t.Error("RequiredFilesFor(pt-br) should not reference the en-only whisper dir")
	}
	// PT whisper files use the "small" (no .en) prefix.
	for _, f := range pt[WhisperMultiDirName] {
		if strings.Contains(f, "small.en") {
			t.Errorf("pt whisper file %q should not carry small.en prefix", f)
		}
	}

	// FilesByDir unions all three model dirs.
	byDir := FilesByDir()
	for _, dir := range []string{KokoroDirName, WhisperEnDirName, WhisperMultiDirName} {
		if _, ok := byDir[dir]; !ok {
			t.Errorf("FilesByDir missing %q", dir)
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
	path := filepath.Join(dir, WhisperEnDirName, "small.en-decoder.int8.onnx")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if ok, detail = e.Ready(); !ok {
		t.Errorf("Ready() = false %q after all files created", detail)
	}

	// The EN files satisfy EN but not PT-BR (multilingual whisper is absent).
	if ok, _ := e.ReadyFor(LangEN); !ok {
		t.Error("ReadyFor(en) = false with EN files present")
	}
	if ok, detail := e.ReadyFor(LangPTBR); ok {
		t.Error("ReadyFor(pt-br) = true without the multilingual whisper model")
	} else if !strings.Contains(detail, WhisperMultiDirName) {
		t.Errorf("ReadyFor(pt-br) detail should name %q, got %q", WhisperMultiDirName, detail)
	}
}

func TestSetLanguageSwitchesReadiness(t *testing.T) {
	dir := t.TempDir()
	e := New(Config{ModelsDir: dir})
	// Only EN files installed.
	for mdl, files := range RequiredFilesFor(LangEN) {
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
	if ok, _ := e.Ready(); !ok {
		t.Fatal("default (en) Ready() = false with EN files")
	}
	e.SetLanguage(LangPTBR)
	if ok, _ := e.Ready(); ok {
		t.Fatal("Ready() = true after switching to pt-br without PT models")
	}
	e.SetLanguage("anything-unknown") // normalizes back to en
	if ok, _ := e.Ready(); !ok {
		t.Fatal("Ready() = false after switching back to en")
	}
}

func TestUnloadIdempotentWithoutModels(t *testing.T) {
	e := New(Config{ModelsDir: t.TempDir()})
	e.Unload()
	e.Unload()
}

// TestRealRoundTrip synthesizes speech with Kokoro and transcribes it back
// with Whisper against real model files. It runs only when
// QUANT_SHERPA_MODELS_DIR points at a directory containing the model layouts.
// The English round trip runs whenever ReadyFor(en) holds; the Portuguese round
// trip runs only when ReadyFor(pt-br) also holds (multilingual whisper present).
func TestRealRoundTrip(t *testing.T) {
	modelsDir := os.Getenv("QUANT_SHERPA_MODELS_DIR")
	if modelsDir == "" {
		t.Skip("QUANT_SHERPA_MODELS_DIR not set; skipping real sherpa round trip")
	}

	e := New(Config{ModelsDir: modelsDir, IdleUnload: time.Minute})
	defer e.Unload()

	ctx := context.Background()

	// Portuguese first (when available) so the English pass exercises a rebuild.
	if ok, _ := e.ReadyFor(LangPTBR); ok {
		e.SetLanguage(LangPTBR)
		const ptText = "Olá, este é o teste de voz em português do quant."
		audio, err := e.Synthesize(ctx, ptText, DefaultVoice(LangPTBR), 1.0)
		if err != nil {
			t.Fatalf("Synthesize(pt): %v", err)
		}
		if len(audio.Data) < 1000 {
			t.Fatalf("suspiciously small pt audio: %d bytes", len(audio.Data))
		}
		transcript, err := e.Transcribe(ctx, audio.Data, "audio/wav")
		if err != nil {
			t.Fatalf("Transcribe(pt): %v", err)
		}
		t.Logf("pt transcript: %q", transcript)
		if strings.TrimSpace(transcript) == "" {
			t.Error("empty pt-br transcript")
		}
	} else {
		t.Log("ReadyFor(pt-br) false; skipping Portuguese round trip")
	}

	// English round trip (proves rebuild when we came from pt-br).
	e.SetLanguage(LangEN)
	if ok, detail := e.Ready(); !ok {
		t.Fatalf("engine not ready (en) under %s: %s", modelsDir, detail)
	}

	const text = "Hello, this is the quant embedded voice engine round trip test."
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
