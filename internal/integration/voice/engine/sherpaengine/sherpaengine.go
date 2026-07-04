// Package sherpaengine implements the embedded local speech engine on top of
// sherpa-onnx: Kokoro (multi-lang v1.0, int8) for TTS and Whisper small.en
// (int8) for STT. Models are loaded lazily on first use and unloaded again
// after an idle period so quant does not hold ~1 GB of RAM while voice mode is
// not in use. All sherpa calls are serialized through one mutex (the C objects
// are not safe for concurrent use).
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
// installer's isInstalled check agree via RequiredFiles().
const (
	KokoroDirName  = "kokoro-int8-multi-lang-v1_0"
	WhisperDirName = "sherpa-onnx-whisper-small.en"
)

const (
	defaultNumThreads = 4
	defaultIdleUnload = 10 * time.Minute

	// defaultSpeakerID is am_onyx, quant's default voice.
	defaultSpeakerID = 17

	whisperSampleRate = 16000
	whisperFeatureDim = 80
)

// RequiredFiles returns, per model directory, the files (or directories) that
// must exist under {ModelsDir}/{dir}/ for the engine to be considered
// installed. Exported for the voice runtime installer's isInstalled check.
func RequiredFiles() map[string][]string {
	return map[string][]string{
		KokoroDirName: {
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
		},
		WhisperDirName: {
			"small.en-encoder.int8.onnx",
			"small.en-decoder.int8.onnx",
			"small.en-tokens.txt",
		},
	}
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
	// ModelsDir is the directory containing KokoroDirName and WhisperDirName.
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
	mu       sync.Mutex
	tts      *sherpa.OfflineTts
	rec      *sherpa.OfflineRecognizer
	idle     *time.Timer
	lastUsed time.Time
}

// New creates an embedded engine rooted at cfg.ModelsDir. No models are
// loaded until the first Transcribe/Synthesize call.
func New(cfg Config) *Engine {
	if cfg.NumThreads <= 0 {
		cfg.NumThreads = defaultNumThreads
	}
	if cfg.IdleUnload <= 0 {
		cfg.IdleUnload = defaultIdleUnload
	}
	return &Engine{cfg: cfg}
}

// Ready reports whether all required model files exist on disk (no model is
// loaded to answer this). When files are missing, the detail names them.
func (e *Engine) Ready() (bool, string) {
	required := RequiredFiles()
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

// speakerID maps a voice name (e.g. "am_onyx") or a numeric speaker-id string
// to a Kokoro speaker id. Unknown or empty names fall back to am_onyx.
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
		return "", fmt.Errorf("embedded voice engine requires 16-bit PCM WAV audio: %w", err)
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

// ensureTTS lazily loads the Kokoro model. Caller must hold e.mu.
func (e *Engine) ensureTTS() error {
	if e.tts != nil {
		return nil
	}
	if ok, detail := e.Ready(); !ok {
		return fmt.Errorf("embedded voice engine not ready: %s", detail)
	}
	dir := filepath.Join(e.cfg.ModelsDir, KokoroDirName)
	cfg := sherpa.OfflineTtsConfig{
		Model: sherpa.OfflineTtsModelConfig{
			Kokoro: sherpa.OfflineTtsKokoroModelConfig{
				Model:   filepath.Join(dir, "model.int8.onnx"),
				Voices:  filepath.Join(dir, "voices.bin"),
				Tokens:  filepath.Join(dir, "tokens.txt"),
				DataDir: filepath.Join(dir, "espeak-ng-data"),
				DictDir: filepath.Join(dir, "dict"),
				Lexicon: filepath.Join(dir, "lexicon-us-en.txt") + "," + filepath.Join(dir, "lexicon-zh.txt"),
				Lang:    "en-us",
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
	return nil
}

// ensureSTT lazily loads the Whisper model. Caller must hold e.mu.
func (e *Engine) ensureSTT() error {
	if e.rec != nil {
		return nil
	}
	if ok, detail := e.Ready(); !ok {
		return fmt.Errorf("embedded voice engine not ready: %s", detail)
	}
	dir := filepath.Join(e.cfg.ModelsDir, WhisperDirName)
	cfg := sherpa.OfflineRecognizerConfig{
		FeatConfig: sherpa.FeatureConfig{SampleRate: whisperSampleRate, FeatureDim: whisperFeatureDim},
		ModelConfig: sherpa.OfflineModelConfig{
			Whisper: sherpa.OfflineWhisperModelConfig{
				Encoder:  filepath.Join(dir, "small.en-encoder.int8.onnx"),
				Decoder:  filepath.Join(dir, "small.en-decoder.int8.onnx"),
				Language: "en",
				Task:     "transcribe",
			},
			Tokens:     filepath.Join(dir, "small.en-tokens.txt"),
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
	if e.rec != nil {
		sherpa.DeleteOfflineRecognizer(e.rec)
		e.rec = nil
	}
	if e.idle != nil {
		e.idle.Stop()
		e.idle = nil
	}
}
