package process

import (
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/creack/pty"
)

func TestInputFramesWrapsTextWhenPasteModeIsOn(t *testing.T) {
	frames := inputFrames("[session · qa] hello\nworld", true)
	joined := strings.Join(frames, "")
	if !strings.HasPrefix(joined, pasteBegin) || !strings.HasSuffix(joined, pasteEnd) {
		t.Fatalf("text not framed as a bracketed paste: %q", joined)
	}
	if strings.TrimSuffix(strings.TrimPrefix(joined, pasteBegin), pasteEnd) != "[session · qa] hello\nworld" {
		t.Fatalf("payload altered: %q", joined)
	}
}

func TestInputFramesLeavesTextAloneWhenPasteModeIsOff(t *testing.T) {
	frames := inputFrames("echo hi", false)
	if got := strings.Join(frames, ""); got != "echo hi" {
		t.Fatalf("plain shell input altered: %q", got)
	}
}

func TestInputFramesNeverWrapsKeystrokesOrEscapes(t *testing.T) {
	for _, in := range []string{"\r", "q", "é", "\x1b[A", pasteBegin + "already framed" + pasteEnd} {
		frames := inputFrames(in, true)
		if got := strings.Join(frames, ""); got != in {
			t.Errorf("%q should pass through unchanged, got %q", in, got)
		}
	}
}

func TestInputFramesChunksWithoutSplittingRunes(t *testing.T) {
	// 3-byte runes: no chunk boundary may fall inside one.
	msg := strings.Repeat("日本語 ", 400)
	frames := inputFrames(msg, true)
	if len(frames) < 2 {
		t.Fatalf("expected several chunks, got %d", len(frames))
	}
	for i, f := range frames {
		if len(f) > inputChunkBytes {
			t.Errorf("chunk %d is %d bytes, over the limit", i, len(f))
		}
	}
	if got := strings.Join(frames, ""); got != pasteBegin+msg+pasteEnd {
		t.Fatal("chunks do not reassemble into the framed message")
	}
	for i, f := range frames {
		if !strings.HasPrefix(f, pasteBegin) && !strings.HasPrefix(f, "日") && !strings.HasPrefix(f, " ") && !strings.HasPrefix(f, "本") && !strings.HasPrefix(f, "語") {
			t.Errorf("chunk %d starts mid-rune: %q", i, f[:4])
		}
	}
}

func TestPasteTrackerFollowsModeSwitchesAcrossReads(t *testing.T) {
	var p pasteTracker
	if p.enabled() {
		t.Fatal("paste mode should start off")
	}
	p.observe([]byte("banner\x1b[?2004h"))
	if !p.enabled() {
		t.Fatal("mode on not seen")
	}
	// The off switch split across two reads.
	p.observe([]byte("output\x1b[?20"))
	p.observe([]byte("04l bye"))
	if p.enabled() {
		t.Fatal("mode off split across reads not seen")
	}
	// The last switch in a chunk wins.
	p.observe([]byte("\x1b[?2004l\x1b[?2004h"))
	if !p.enabled() {
		t.Fatal("last switch in the chunk should win")
	}
}

// TestWriteInputDeliversWholeMessageToSlowChild drives a real PTY whose child
// switches bracketed paste on, then reads slowly. A message far longer than
// the kernel's input queue must arrive complete and framed, in order.
func TestWriteInputDeliversWholeMessageToSlowChild(t *testing.T) {
	cmd := exec.Command("sh", "-c", `stty raw -echo; printf '\033[?2004h'; while IFS= read -r line; do printf '%s\n' "$line"; sleep 0.01; done`)
	ptm, err := pty.Start(cmd)
	if err != nil {
		t.Fatalf("pty.Start: %v", err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = ptm.Close() }()
	cp := &claudeProcess{cmd: cmd, ptm: ptm}

	var got strings.Builder
	done := make(chan struct{})
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptm.Read(buf)
			if n > 0 {
				cp.paste.observe(buf[:n])
				got.Write(buf[:n])
			}
			if err != nil || strings.Contains(got.String(), pasteEnd) {
				close(done)
				return
			}
		}
	}()

	deadline := time.Now().Add(2 * time.Second)
	for !cp.paste.enabled() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !cp.paste.enabled() {
		t.Fatal("child never switched bracketed paste on")
	}

	var msg strings.Builder
	msg.WriteString("[session · sender] ")
	for i := 0; i < 80; i++ {
		msg.WriteString(strings.Repeat("x", 50))
		msg.WriteString("\n")
	}
	msg.WriteString("END-OF-MESSAGE\n")
	if err := cp.writeInput(msg.String()); err != nil {
		t.Fatalf("writeInput: %v", err)
	}
	// The end marker follows the last newline; a keystroke flushes that line.
	if err := cp.writeInput("\n"); err != nil {
		t.Fatalf("writeInput: %v", err)
	}

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("child never echoed the paste end marker")
	}
	out := got.String()
	if !strings.Contains(out, pasteBegin+"[session · sender] ") {
		t.Error("message head missing or not framed as a paste")
	}
	if strings.Count(out, strings.Repeat("x", 50)) != 80 {
		t.Errorf("expected 80 body lines, got %d", strings.Count(out, strings.Repeat("x", 50)))
	}
	if !strings.Contains(out, pasteEnd) {
		t.Error("paste end marker missing")
	}
}
