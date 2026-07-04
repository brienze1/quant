// Package sherpaengine implements the embedded local speech engine on top of
// sherpa-onnx: Kokoro (multi-lang v1.0, int8) for TTS and Whisper small (int8)
// for STT. The engine serves one language at a time (English or Brazilian
// Portuguese) and rebuilds its TTS/STT objects when the language changes, since
// a sherpa instance's language is fixed at build time. Models are loaded lazily
// on first use and unloaded again after an idle period so quant does not hold
// ~1 GB of RAM while voice mode is not in use. All sherpa calls are serialized
// through one mutex (the C objects are not safe for concurrent use).
package sherpaengine

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	sherpa "github.com/k2-fsa/sherpa-onnx-go/sherpa_onnx"

	"quant/internal/integration/voice/engine"
)

// Model directory names under Config.ModelsDir. The voice runtime installer
// extracts the model archives into exactly these directories; Ready() and the
// installer's isInstalled check agree via RequiredFilesFor().
const (
	KokoroDirName = "kokoro-int8-multi-lang-v1_0"

	// WhisperEnDirName holds the English-only Whisper small.en model (file
	// prefix "small.en"). WhisperMultiDirName holds the multilingual Whisper
	// small model (file prefix "small") used for Portuguese.
	WhisperEnDirName    = "sherpa-onnx-whisper-small.en"
	WhisperMultiDirName = "sherpa-onnx-whisper-small"

	// WhisperDirName is a deprecated alias for WhisperEnDirName kept so existing
	// callers keep compiling. Prefer sttDirName(lang) / WhisperEnDirName.
	WhisperDirName = WhisperEnDirName
)

// Supported languages. Language is fixed per sherpa instance.
const (
	LangEN   = "en"
	LangPTBR = "pt-br"
)

const (
	defaultNumThreads = 4
	defaultIdleUnload = 10 * time.Minute

	// defaultSpeakerID is af_heart, quant's default English voice.
	defaultSpeakerID = 3

	whisperSampleRate = 16000
	whisperFeatureDim = 80

	defaultVoiceEN   = "af_heart"
	defaultVoicePTBR = "pf_dora"
)

// normalizeLang collapses any input to a supported language: LangPTBR only for
// "pt-br" (case-insensitive), otherwise LangEN (covers "" and unknowns).
func normalizeLang(lang string) string {
	if strings.ToLower(strings.TrimSpace(lang)) == LangPTBR {
		return LangPTBR
	}
	return LangEN
}

// sttDirName is the Whisper model directory for a language.
func sttDirName(lang string) string {
	if normalizeLang(lang) == LangPTBR {
		return WhisperMultiDirName
	}
	return WhisperEnDirName
}

// sttFilePrefix is the Whisper file prefix for a language ("small" vs "small.en").
func sttFilePrefix(lang string) string {
	if normalizeLang(lang) == LangPTBR {
		return "small"
	}
	return "small.en"
}

// whisperLang is the Whisper decoder Language value for a language.
func whisperLang(lang string) string {
	if normalizeLang(lang) == LangPTBR {
		return "pt"
	}
	return "en"
}

// DefaultVoice returns the default Kokoro voice name for a language.
func DefaultVoice(lang string) string {
	if normalizeLang(lang) == LangPTBR {
		return defaultVoicePTBR
	}
	return defaultVoiceEN
}

// kokoroFiles is the shared Kokoro model file set (same on disk for all langs).
func kokoroFiles() []string {
	return []string{
		"model.int8.onnx",
		"voices.bin",
		"tokens.txt",
		"espeak-ng-data",
		"dict",
		"lexicon-us-en.txt",
		"lexicon-gb-en.txt",
		"lexicon-zh.txt",
		"date-zh.fst",
		"number-zh.fst",
		"phone-zh.fst",
	}
}

// sttFiles is the Whisper file set for a language.
func sttFiles(lang string) []string {
	p := sttFilePrefix(lang)
	return []string{
		p + "-encoder.int8.onnx",
		p + "-decoder.int8.onnx",
		p + "-tokens.txt",
	}
}

// RequiredFilesFor returns, per model directory, the files (or directories)
// that must exist under {ModelsDir}/{dir}/ for the engine to serve lang: the
// shared Kokoro set plus the Whisper dir for that language.
func RequiredFilesFor(lang string) map[string][]string {
	return map[string][]string{
		KokoroDirName:    kokoroFiles(),
		sttDirName(lang): sttFiles(lang),
	}
}

// BaseRequiredFiles is the English/base required file set.
func BaseRequiredFiles() map[string][]string {
	return RequiredFilesFor(LangEN)
}

// RequiredFiles returns the base (English) required file set. Deprecated:
// prefer RequiredFilesFor / BaseRequiredFiles. Kept for back-compat with the
// voice runtime installer's isInstalled check.
func RequiredFiles() map[string][]string {
	return BaseRequiredFiles()
}

// FilesByDir returns the union of required files across all supported
// languages, keyed by model directory. Kokoro appears once; each language's
// Whisper directory appears with its own file set.
func FilesByDir() map[string][]string {
	out := map[string][]string{}
	for _, lang := range []string{LangEN, LangPTBR} {
		for dir, files := range RequiredFilesFor(lang) {
			if _, ok := out[dir]; !ok {
				out[dir] = files
			}
		}
	}
	return out
}

// speakersJSON is the Kokoro multi-lang v1.0 speaker table (id → name/lang),
// captured from the model's own id2speaker map. Embedded so Voices() works
// without loading the model.
//
//go:embed speakers_kokoro_v1_0.json
var speakersJSON []byte

var (
	speakersOnce  sync.Once
	speakerTable  []engine.Voice
	speakerByName map[string]int
	speakersErr   error
)

func loadSpeakers() ([]engine.Voice, map[string]int, error) {
	speakersOnce.Do(func() {
		if err := json.Unmarshal(speakersJSON, &speakerTable); err != nil {
			speakersErr = fmt.Errorf("invalid embedded speaker table: %w", err)
			return
		}
		speakerByName = make(map[string]int, len(speakerTable))
		for _, v := range speakerTable {
			speakerByName[v.Name] = v.ID
		}
	})
	return speakerTable, speakerByName, speakersErr
}

// Config configures the embedded engine.
type Config struct {
	// ModelsDir is the directory containing KokoroDirName and the Whisper dirs.
	ModelsDir string
	// NumThreads is the ONNX intra-op thread count (default 4).
	NumThreads int
	// IdleUnload is how long the loaded models are kept in memory after the
	// last call before being released (default 10 minutes).
	IdleUnload time.Duration
}

// Engine is the embedded sherpa-onnx speech engine. Construct with New.
type Engine struct {
	cfg Config

	// mu serializes ALL sherpa calls and guards the fields below.
	mu sync.Mutex
	// lang is the language the engine currently serves.
	lang string
	tts  *sherpa.OfflineTts
	// ttsLang is the language e.tts was built for ("" when not loaded).
	ttsLang string
	rec     *sherpa.OfflineRecognizer
	// recLang is the language e.rec was built for ("" when not loaded).
	recLang  string
	idle     *time.Timer
	lastUsed time.Time
}

// New creates an embedded engine rooted at cfg.ModelsDir. It defaults to
// English; no models are loaded until the first Transcribe/Synthesize call.
func New(cfg Config) *Engine {
	if cfg.NumThreads <= 0 {
		cfg.NumThreads = defaultNumThreads
	}
	if cfg.IdleUnload <= 0 {
		cfg.IdleUnload = defaultIdleUnload
	}
	return &Engine{cfg: cfg, lang: LangEN}
}

// SetLanguage sets the language the engine serves. It normalizes and stores the
// value; the TTS/STT rebuild is deferred to the next call.
func (e *Engine) SetLanguage(lang string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lang = normalizeLang(lang)
}

// currentLang returns the engine's current language. Caller must hold e.mu.
func (e *Engine) currentLang() string {
	if e.lang == "" {
		return LangEN
	}
	return e.lang
}

// ReadyFor reports whether all model files required to serve lang exist on disk
// (no model is loaded to answer this). When files are missing, the detail names
// them.
func (e *Engine) ReadyFor(lang string) (bool, string) {
	required := RequiredFilesFor(lang)
	dirs := make([]string, 0, len(required))
	for dir := range required {
		dirs = append(dirs, dir)
	}
	sort.Strings(dirs)

	var missing []string
	total := 0
	for _, dir := range dirs {
		for _, f := range required[dir] {
			total++
			if _, err := os.Stat(filepath.Join(e.cfg.ModelsDir, dir, f)); err != nil {
				missing = append(missing, filepath.Join(dir, f))
			}
		}
	}
	if len(missing) == total {
		return false, "voice models are not installed"
	}
	if len(missing) > 0 {
		return false, "missing voice model files: " + strings.Join(missing, ", ")
	}
	return true, ""
}

// Ready reports whether the model files for the current language exist on disk.
func (e *Engine) Ready() (bool, string) {
	e.mu.Lock()
	lang := e.currentLang()
	e.mu.Unlock()
	return e.ReadyFor(lang)
}

// Voices returns the embedded Kokoro speaker table without loading the model.
func (e *Engine) Voices() ([]engine.Voice, error) {
	table, _, err := loadSpeakers()
	if err != nil {
		return nil, err
	}
	out := make([]engine.Voice, len(table))
	copy(out, table)
	return out, nil
}

// speakerID maps a voice name (e.g. "af_heart") or a numeric speaker-id string
// to a Kokoro speaker id. Unknown or empty names fall back to af_heart.
func speakerID(voiceName string) int {
	name := strings.TrimSpace(voiceName)
	if name == "" {
		return defaultSpeakerID
	}
	table, byName, err := loadSpeakers()
	if err != nil {
		return defaultSpeakerID
	}
	if id, ok := byName[name]; ok {
		return id
	}
	if n, err := strconv.Atoi(name); err == nil && n >= 0 && n < len(table) {
		return n
	}
	return defaultSpeakerID
}

// Transcribe decodes the WAV payload and runs it through Whisper. The audio
// must be a 16-bit PCM WAV; AcceptWaveform resamples internally, so any
// sample rate is accepted.
func (e *Engine) Transcribe(ctx context.Context, audio []byte, _ string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	samples, sampleRate, err := engine.DecodeWAV(audio)
	if err != nil {
		return "", fmt.Errorf("embedded voice engine could not decode the audio: %w", err)
	}
	if len(samples) == 0 {
		return "", fmt.Errorf("empty audio")
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.ensureSTT(); err != nil {
		return "", err
	}
	defer e.touch()

	stream := sherpa.NewOfflineStream(e.rec)
	defer sherpa.DeleteOfflineStream(stream)
	stream.AcceptWaveform(sampleRate, samples)
	e.rec.Decode(stream)
	return strings.TrimSpace(stream.GetResult().Text), nil
}

// Synthesize renders text with Kokoro and returns a complete 16-bit PCM mono
// WAV (24 kHz).
func (e *Engine) Synthesize(ctx context.Context, text, voiceName string, speed float64) (engine.Audio, error) {
	if err := ctx.Err(); err != nil {
		return engine.Audio{}, err
	}
	if strings.TrimSpace(text) == "" {
		return engine.Audio{}, fmt.Errorf("empty text")
	}
	if speed <= 0 {
		speed = 1.0
	}
	sid := speakerID(voiceName)

	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.ensureTTS(); err != nil {
		return engine.Audio{}, err
	}
	defer e.touch()

	audio := e.tts.Generate(text, sid, float32(speed))
	if audio == nil || len(audio.Samples) == 0 {
		return engine.Audio{}, fmt.Errorf("TTS generated no audio")
	}
	return engine.Audio{Data: audio.ToBuffer(), ContentType: "audio/wav"}, nil
}

// Unload releases the loaded models. Idempotent; safe to call while other
// calls are in flight (it serializes on the engine mutex).
func (e *Engine) Unload() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.unloadLocked()
}

// kokoroLangLexicon returns the Kokoro Lang value and lexicon file list for a
// language. English uses the en+zh lexicons; other languages keep only the
// Chinese lexicon (so zh still branches) and route through espeak-ng G2P.
func kokoroLangLexicon(lang, dir string) (string, string) {
	if normalizeLang(lang) == LangPTBR {
		return "pt-br", filepath.Join(dir, "lexicon-zh.txt")
	}
	return "en-us", filepath.Join(dir, "lexicon-us-en.txt") + "," + filepath.Join(dir, "lexicon-zh.txt")
}

// ensureTTS lazily loads (or rebuilds) the Kokoro model for the current
// language. Caller must hold e.mu.
func (e *Engine) ensureTTS() error {
	lang := e.currentLang()
	if e.tts != nil && e.ttsLang == lang {
		return nil
	}
	if e.tts != nil {
		sherpa.DeleteOfflineTts(e.tts)
		e.tts = nil
		e.ttsLang = ""
	}
	if ok, detail := e.ReadyFor(lang); !ok {
		return fmt.Errorf("embedded voice engine not ready: %s", detail)
	}
	dir := filepath.Join(e.cfg.ModelsDir, KokoroDirName)
	ttsLang, lexicon := kokoroLangLexicon(lang, dir)
	cfg := sherpa.OfflineTtsConfig{
		Model: sherpa.OfflineTtsModelConfig{
			Kokoro: sherpa.OfflineTtsKokoroModelConfig{
				Model:   filepath.Join(dir, "model.int8.onnx"),
				Voices:  filepath.Join(dir, "voices.bin"),
				Tokens:  filepath.Join(dir, "tokens.txt"),
				DataDir: filepath.Join(dir, "espeak-ng-data"),
				DictDir: filepath.Join(dir, "dict"),
				Lexicon: lexicon,
				Lang:    ttsLang,
			},
			NumThreads: e.cfg.NumThreads,
			Debug:      0,
			Provider:   "cpu",
		},
		MaxNumSentences: 1,
	}
	tts := sherpa.NewOfflineTts(&cfg)
	if tts == nil {
		return fmt.Errorf("failed to load Kokoro TTS model from %s", dir)
	}
	e.tts = tts
	e.ttsLang = lang
	return nil
}

// ensureSTT lazily loads (or rebuilds) the Whisper model for the current
// language. Caller must hold e.mu.
func (e *Engine) ensureSTT() error {
	lang := e.currentLang()
	if e.rec != nil && e.recLang == lang {
		return nil
	}
	if e.rec != nil {
		sherpa.DeleteOfflineRecognizer(e.rec)
		e.rec = nil
		e.recLang = ""
	}
	if ok, detail := e.ReadyFor(lang); !ok {
		return fmt.Errorf("embedded voice engine not ready: %s", detail)
	}
	dir := filepath.Join(e.cfg.ModelsDir, sttDirName(lang))
	prefix := sttFilePrefix(lang)
	cfg := sherpa.OfflineRecognizerConfig{
		FeatConfig: sherpa.FeatureConfig{SampleRate: whisperSampleRate, FeatureDim: whisperFeatureDim},
		ModelConfig: sherpa.OfflineModelConfig{
			Whisper: sherpa.OfflineWhisperModelConfig{
				Encoder:  filepath.Join(dir, prefix+"-encoder.int8.onnx"),
				Decoder:  filepath.Join(dir, prefix+"-decoder.int8.onnx"),
				Language: whisperLang(lang),
				Task:     "transcribe",
			},
			Tokens:     filepath.Join(dir, prefix+"-tokens.txt"),
			NumThreads: e.cfg.NumThreads,
			Debug:      0,
			Provider:   "cpu",
			ModelType:  "whisper",
		},
		DecodingMethod: "greedy_search",
	}
	rec := sherpa.NewOfflineRecognizer(&cfg)
	if rec == nil {
		return fmt.Errorf("failed to load Whisper STT model from %s", dir)
	}
	e.rec = rec
	e.recLang = lang
	return nil
}

// touch marks the engine as just used and (re)arms the idle-unload timer.
// Caller must hold e.mu.
func (e *Engine) touch() {
	e.lastUsed = time.Now()
	if e.idle == nil {
		e.idle = time.AfterFunc(e.cfg.IdleUnload, e.idleUnload)
		return
	}
	e.idle.Reset(e.cfg.IdleUnload)
}

// idleUnload fires when the idle timer elapses. A call may have slipped in
// between the timer firing and the lock being acquired; in that case the timer
// was already re-armed by touch, so just skip the unload.
func (e *Engine) idleUnload() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if time.Since(e.lastUsed) < e.cfg.IdleUnload {
		return
	}
	e.unloadLocked()
}

// unloadLocked deletes the sherpa objects and stops the idle timer. Caller
// must hold e.mu.
func (e *Engine) unloadLocked() {
	if e.tts != nil {
		sherpa.DeleteOfflineTts(e.tts)
		e.tts = nil
	}
	e.ttsLang = ""
	if e.rec != nil {
		sherpa.DeleteOfflineRecognizer(e.rec)
		e.rec = nil
	}
	e.recLang = ""
	if e.idle != nil {
		e.idle.Stop()
		e.idle = nil
	}
}
