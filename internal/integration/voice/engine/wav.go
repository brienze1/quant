package engine

import (
	"encoding/binary"
	"fmt"
)

// DecodeWAV decodes an in-memory 16-bit PCM RIFF/WAVE file into normalized
// float32 samples in [-1, 1] plus the sample rate. Stereo input is downmixed
// to mono by averaging the channels. Chunks other than "fmt " and "data"
// (LIST, fact, ...) are skipped, including their word-alignment pad bytes.
// Non-PCM or non-16-bit encodings are rejected with a clear error.
func DecodeWAV(data []byte) ([]float32, int, error) {
	if len(data) < 12 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return nil, 0, fmt.Errorf("not a RIFF/WAVE file")
	}

	var (
		haveFmt    bool
		format     int
		channels   int
		sampleRate int
		bits       int
	)

	pos := 12
	for pos+8 <= len(data) {
		id := string(data[pos : pos+4])
		size := int(binary.LittleEndian.Uint32(data[pos+4 : pos+8]))
		body := pos + 8
		if size < 0 || body+size > len(data) {
			return nil, 0, fmt.Errorf("corrupt WAV: chunk %q overruns file", id)
		}

		switch id {
		case "fmt ":
			if size < 16 {
				return nil, 0, fmt.Errorf("corrupt WAV: fmt chunk too short (%d bytes)", size)
			}
			format = int(binary.LittleEndian.Uint16(data[body:]))
			channels = int(binary.LittleEndian.Uint16(data[body+2:]))
			sampleRate = int(binary.LittleEndian.Uint32(data[body+4:]))
			bits = int(binary.LittleEndian.Uint16(data[body+14:]))
			haveFmt = true

		case "data":
			if !haveFmt {
				return nil, 0, fmt.Errorf("corrupt WAV: data chunk before fmt chunk")
			}
			if format != 1 {
				return nil, 0, fmt.Errorf("unsupported WAV encoding (format %d): only 16-bit PCM is supported", format)
			}
			if bits != 16 {
				return nil, 0, fmt.Errorf("unsupported WAV bit depth (%d): only 16-bit PCM is supported", bits)
			}
			if channels != 1 && channels != 2 {
				return nil, 0, fmt.Errorf("unsupported WAV channel count (%d): only mono or stereo is supported", channels)
			}
			if sampleRate <= 0 {
				return nil, 0, fmt.Errorf("corrupt WAV: invalid sample rate %d", sampleRate)
			}
			return decodePCM16(data[body:body+size], channels), sampleRate, nil
		}

		pos = body + size
		if size%2 == 1 {
			pos++ // RIFF chunks are word-aligned; skip the pad byte
		}
	}
	return nil, 0, fmt.Errorf("corrupt WAV: no data chunk")
}

// decodePCM16 converts little-endian 16-bit PCM bytes to normalized float32
// samples, averaging channel pairs into mono when channels == 2. A trailing
// partial frame is dropped.
func decodePCM16(pcm []byte, channels int) []float32 {
	frameBytes := 2 * channels
	frames := len(pcm) / frameBytes
	samples := make([]float32, frames)
	for i := 0; i < frames; i++ {
		off := i * frameBytes
		if channels == 1 {
			samples[i] = float32(int16(binary.LittleEndian.Uint16(pcm[off:]))) / 32768
			continue
		}
		l := float32(int16(binary.LittleEndian.Uint16(pcm[off:])))
		r := float32(int16(binary.LittleEndian.Uint16(pcm[off+2:])))
		samples[i] = (l + r) / 2 / 32768
	}
	return samples
}
