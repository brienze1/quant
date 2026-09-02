package process

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDECModePreamble(t *testing.T) {
	t.Run("replays the final state of every private mode", func(t *testing.T) {
		out := decModePreamble(strings.NewReader(
			"boot\x1b[?2004h\x1b[?25lwork\x1b[?1000;1002;1006h\x1b[?25h",
		))
		want := "\x1b[?25h\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?2004h"
		if out != want {
			t.Errorf("preamble: got %q, want %q", out, want)
		}
	})

	t.Run("a mode turned off stays off", func(t *testing.T) {
		out := decModePreamble(strings.NewReader("\x1b[?2004h text \x1b[?2004l"))
		if out != "\x1b[?2004l" {
			t.Errorf("preamble: got %q, want the reset", out)
		}
	})

	t.Run("no mode sequences means no preamble", func(t *testing.T) {
		if out := decModePreamble(strings.NewReader("plain \x1b[31mred\x1b[0m output")); out != "" {
			t.Errorf("preamble: got %q, want empty", out)
		}
	})

	t.Run("a sequence split across reads is still parsed", func(t *testing.T) {
		// A reader that hands over one byte at a time exercises the state
		// machine's carry-over between chunks, which is what a 64KB read
		// boundary does in production.
		out := decModePreamble(&iotest{data: []byte("\x1b[?2004h")})
		if out != "\x1b[?2004h" {
			t.Errorf("preamble: got %q, want the split sequence parsed", out)
		}
	})
}

// iotest hands out one byte per Read, so multi-byte sequences always straddle a
// chunk boundary.
type iotest struct {
	data []byte
	pos  int
}

func (r *iotest) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, fmt.Errorf("eof")
	}
	p[0] = r.data[r.pos]
	r.pos++
	return 1, nil
}

func TestGetOutputRestoresModesAfterTruncation(t *testing.T) {
	dir := t.TempDir()
	m := &processManager{processes: make(map[string]*claudeProcess), outputDir: dir}

	// A long-running session: the CLI enabled bracketed paste at startup, then
	// produced more output than the replay window holds.
	var log bytes.Buffer
	log.WriteString("\x1b[?2004h\x1b[?1049h")
	log.Write(bytes.Repeat([]byte("a"), int(maxReplayBytes)*2))
	log.WriteString("tail-marker")
	if err := os.WriteFile(filepath.Join(dir, "s1.log"), log.Bytes(), 0644); err != nil {
		t.Fatalf("write log: %v", err)
	}

	out, err := m.GetOutput("s1")
	if err != nil {
		t.Fatalf("GetOutput: %v", err)
	}
	text := string(out)
	if !strings.HasPrefix(text, "\x1b[?2004h") {
		t.Errorf("replay should open by restoring bracketed paste, got %q", text[:min(40, len(text))])
	}
	if strings.Contains(text, "\x1b[?1049") {
		t.Error("the alternate-screen switch must not be replayed — it would cost the replay its scrollback")
	}
	if !strings.Contains(text, "tail-marker") {
		t.Error("replay lost the tail")
	}
	if !strings.Contains(text, "earlier output truncated") {
		t.Error("replay lost the truncation notice")
	}
}

func TestGetOutputShortLogIsUntouched(t *testing.T) {
	dir := t.TempDir()
	m := &processManager{processes: make(map[string]*claudeProcess), outputDir: dir}

	if err := os.WriteFile(filepath.Join(dir, "s2.log"), []byte("\x1b[?2004hhello"), 0644); err != nil {
		t.Fatalf("write log: %v", err)
	}

	out, err := m.GetOutput("s2")
	if err != nil {
		t.Fatalf("GetOutput: %v", err)
	}
	if string(out) != "\x1b[?2004hhello" {
		t.Errorf("a log inside the replay window should be returned verbatim, got %q", out)
	}
}
