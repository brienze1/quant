package engine

import (
	"encoding/binary"
	"math"
	"strings"
	"testing"
)

// chunk builds one RIFF chunk (id + little-endian size + body + pad byte when
// the body length is odd).
func chunk(id string, body []byte) []byte {
	out := make([]byte, 0, 8+len(body)+1)
	out = append(out, id...)
	out = binary.LittleEndian.AppendUint32(out, uint32(len(body)))
	out = append(out, body...)
	if len(body)%2 == 1 {
		out = append(out, 0)
	}
	return out
}

// fmtChunk builds a "fmt " chunk for the given encoding.
func fmtChunk(format, channels uint16, sampleRate uint32, bits uint16) []byte {
	body := make([]byte, 16)
	binary.LittleEndian.PutUint16(body[0:], format)
	binary.LittleEndian.PutUint16(body[2:], channels)
	binary.LittleEndian.PutUint32(body[4:], sampleRate)
	byteRate := sampleRate * uint32(channels) * uint32(bits) / 8
	binary.LittleEndian.PutUint32(body[8:], byteRate)
	binary.LittleEndian.PutUint16(body[12:], channels*bits/8)
	binary.LittleEndian.PutUint16(body[14:], bits)
	return chunk("fmt ", body)
}

// wavFile assembles a full RIFF/WAVE file from the given chunks.
func wavFile(chunks ...[]byte) []byte {
	var body []byte
	body = append(body, "WAVE"...)
	for _, c := range chunks {
		body = append(body, c...)
	}
	out := append([]byte("RIFF"), 0, 0, 0, 0)
	binary.LittleEndian.PutUint32(out[4:], uint32(len(body)))
	return append(out, body...)
}

func pcm16(samples ...int16) []byte {
	out := make([]byte, 0, 2*len(samples))
	for _, s := range samples {
		out = binary.LittleEndian.AppendUint16(out, uint16(s))
	}
	return out
}

func TestDecodeWAVMono(t *testing.T) {
	data := wavFile(fmtChunk(1, 1, 16000, 16), chunk("data", pcm16(0, 16384, -16384, 32767, -32768)))

	samples, rate, err := DecodeWAV(data)
	if err != nil {
		t.Fatalf("DecodeWAV: %v", err)
	}
	if rate != 16000 {
		t.Errorf("sample rate = %d, want 16000", rate)
	}
	want := []float32{0, 0.5, -0.5, 32767.0 / 32768, -1}
	if len(samples) != len(want) {
		t.Fatalf("got %d samples, want %d", len(samples), len(want))
	}
	for i := range want {
		if math.Abs(float64(samples[i]-want[i])) > 1e-6 {
			t.Errorf("sample[%d] = %v, want %v", i, samples[i], want[i])
		}
	}
}

func TestDecodeWAVStereoDownmix(t *testing.T) {
	// Frames: (16384, -16384) → 0, (16384, 16384) → 0.5.
	data := wavFile(fmtChunk(1, 2, 24000, 16), chunk("data", pcm16(16384, -16384, 16384, 16384)))

	samples, rate, err := DecodeWAV(data)
	if err != nil {
		t.Fatalf("DecodeWAV: %v", err)
	}
	if rate != 24000 {
		t.Errorf("sample rate = %d, want 24000", rate)
	}
	if len(samples) != 2 {
		t.Fatalf("got %d samples, want 2", len(samples))
	}
	if samples[0] != 0 || math.Abs(float64(samples[1]-0.5)) > 1e-6 {
		t.Errorf("downmixed samples = %v, want [0 0.5]", samples)
	}
}

func TestDecodeWAVSkipsExtraChunks(t *testing.T) {
	// LIST before fmt, an odd-length junk chunk (exercises pad-byte skipping)
	// between fmt and data.
	data := wavFile(
		chunk("LIST", []byte("INFOISFT quant")),
		fmtChunk(1, 1, 8000, 16),
		chunk("junk", []byte("odd")),
		chunk("data", pcm16(16384)),
	)

	samples, rate, err := DecodeWAV(data)
	if err != nil {
		t.Fatalf("DecodeWAV: %v", err)
	}
	if rate != 8000 || len(samples) != 1 || samples[0] != 0.5 {
		t.Errorf("got rate=%d samples=%v, want rate=8000 samples=[0.5]", rate, samples)
	}
}

func float32le(samples ...float32) []byte {
	out := make([]byte, 0, 4*len(samples))
	for _, s := range samples {
		out = binary.LittleEndian.AppendUint32(out, math.Float32bits(s))
	}
	return out
}

// The browser VAD/PTT capture (@ricky0123/vad-web) emits 32-bit IEEE float WAV
// by default — the format the embedded STT engine actually receives.
func TestDecodeWAVFloat32Mono(t *testing.T) {
	data := wavFile(fmtChunk(3, 1, 16000, 32), chunk("data", float32le(0, 0.5, -0.5, 1, -1)))

	samples, rate, err := DecodeWAV(data)
	if err != nil {
		t.Fatalf("DecodeWAV: %v", err)
	}
	if rate != 16000 {
		t.Errorf("sample rate = %d, want 16000", rate)
	}
	want := []float32{0, 0.5, -0.5, 1, -1}
	if len(samples) != len(want) {
		t.Fatalf("got %d samples, want %d", len(samples), len(want))
	}
	for i := range want {
		if math.Abs(float64(samples[i]-want[i])) > 1e-6 {
			t.Errorf("sample[%d] = %v, want %v", i, samples[i], want[i])
		}
	}
}

func TestDecodeWAVFloat32StereoDownmix(t *testing.T) {
	data := wavFile(fmtChunk(3, 2, 24000, 32), chunk("data", float32le(0.5, -0.5, 1, 1)))
	samples, _, err := DecodeWAV(data)
	if err != nil {
		t.Fatalf("DecodeWAV: %v", err)
	}
	if len(samples) != 2 || samples[0] != 0 || math.Abs(float64(samples[1]-1)) > 1e-6 {
		t.Errorf("downmixed float32 = %v, want [0 1]", samples)
	}
}

func TestDecodeWAVRejectsUnsupported(t *testing.T) {
	// Format 3 IEEE float but 64-bit (only 32-bit float is supported).
	data := wavFile(fmtChunk(3, 1, 16000, 64), chunk("data", make([]byte, 8)))
	if _, _, err := DecodeWAV(data); err == nil || !strings.Contains(err.Error(), "unsupported WAV encoding") {
		t.Errorf("64-bit float error = %v, want unsupported-encoding", err)
	}

	// PCM but 8-bit.
	data = wavFile(fmtChunk(1, 1, 16000, 8), chunk("data", make([]byte, 4)))
	if _, _, err := DecodeWAV(data); err == nil || !strings.Contains(err.Error(), "unsupported WAV encoding") {
		t.Errorf("8-bit error = %v, want unsupported-encoding", err)
	}
}

func TestDecodeWAVRejectsGarbage(t *testing.T) {
	for name, data := range map[string][]byte{
		"empty":       nil,
		"not riff":    []byte("OggS this is not a wav file at all"),
		"webm magic":  {0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
		"no data":     wavFile(fmtChunk(1, 1, 16000, 16)),
		"truncated":   wavFile(fmtChunk(1, 1, 16000, 16), chunk("data", pcm16(1, 2, 3)))[:30],
		"data no fmt": wavFile(chunk("data", pcm16(1, 2))),
	} {
		if _, _, err := DecodeWAV(data); err == nil {
			t.Errorf("%s: expected error, got nil", name)
		}
	}
}
