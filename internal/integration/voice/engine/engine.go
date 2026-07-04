// Package engine defines the speech backend abstraction behind quant's voice
// mode. Two implementations exist: the embedded sherpa-onnx runtime
// (sherpaengine, the default once its models are installed) and the HTTP proxy
// for user-supplied OpenAI-compatible endpoints (httpengine). Both are
// LOCAL-ONLY: audio and text never leave the machine.
package engine

import "context"

// Engine is a speech backend capable of speech-to-text and text-to-speech.
type Engine interface {
	// Transcribe converts spoken audio (an encoded container such as WAV) to
	// trimmed transcript text.
	Transcribe(ctx context.Context, audio []byte, mime string) (string, error)
	// Synthesize renders text to spoken audio with the given voice and speed.
	Synthesize(ctx context.Context, text, voiceName string, speed float64) (Audio, error)
	// Voices lists the voices this engine can synthesize with.
	Voices() ([]Voice, error)
	// Ready reports whether the engine can serve requests; when it cannot, the
	// string names what is missing.
	Ready() (bool, string)
	// Unload releases any loaded models/resources. Idempotent.
	Unload()
}

// Audio is a synthesized audio payload.
type Audio struct {
	Data        []byte
	ContentType string
}

// Voice describes one selectable TTS voice.
type Voice struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Lang string `json:"lang"`
}
