package process

import (
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Terminal input delivery.
//
// A message handed to a session (send_message, crew reports, voice kickoffs)
// used to be written to the PTY master in one call. The kernel hands it to the
// child in pieces of roughly a kilobyte, and the Claude CLI's paste handling
// does not cope with pieces landing while it is still applying the previous
// one: everything before the last piece is dropped, so the session sees only
// the tail of the message, without the "[session · name]" prefix.
//
// The CLI enables bracketed paste mode (it prints ESC[?2004h at start-up). In
// that mode a terminal wraps pasted text in ESC[200~ ... ESC[201~ and the
// application buffers everything in between and inserts it once, however many
// reads it took to arrive. We do the same: the output loop watches for the
// mode switches, and text written while the mode is on is framed as one paste.
// Writes are also cut into chunks with a short pause between them so a child
// that has not asked for bracketed paste (a plain shell) gets time to keep up.
const (
	pasteModeOn  = "\x1b[?2004h"
	pasteModeOff = "\x1b[?2004l"
	pasteBegin   = "\x1b[200~"
	pasteEnd     = "\x1b[201~"

	// inputChunkBytes is the largest single PTY write; the kernel's own input
	// queue is about a kilobyte, so nothing is gained by writing more at once.
	inputChunkBytes = 512
	// inputChunkGap is the pause between chunks.
	inputChunkGap = 5 * time.Millisecond
)

// pasteTracker remembers whether the child currently has bracketed paste mode
// switched on, by watching its output for the mode switches. It keeps the
// tail of the previous read so a switch split across two reads is still seen.
type pasteTracker struct {
	mu   sync.Mutex
	on   bool
	tail []byte
}

// observe scans one output chunk for bracketed paste mode switches.
func (p *pasteTracker) observe(chunk []byte) {
	if len(chunk) == 0 {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	joined := append(append([]byte{}, p.tail...), chunk...)
	lastOn := strings.LastIndex(string(joined), pasteModeOn)
	lastOff := strings.LastIndex(string(joined), pasteModeOff)
	if lastOn >= 0 || lastOff >= 0 {
		p.on = lastOn > lastOff
	}

	keep := len(pasteModeOn) - 1
	if len(joined) > keep {
		joined = joined[len(joined)-keep:]
	}
	p.tail = append(p.tail[:0], joined...)
}

// enabled reports whether the child has bracketed paste mode on.
func (p *pasteTracker) enabled() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.on
}

// inputFrames returns the PTY writes that deliver data, in order. Text is
// framed as one bracketed paste when the child asked for the mode; a single
// keystroke or an escape sequence (a paste already framed by the terminal, a
// cursor key) is passed through as it is. Every frame is at most
// inputChunkBytes long and never splits a UTF-8 sequence or a paste marker.
func inputFrames(data string, paste bool) []string {
	if data == "" {
		return nil
	}
	if paste && isPastedText(data) {
		data = pasteBegin + data + pasteEnd
	}
	var frames []string
	for len(data) > 0 {
		n := inputChunkBytes
		if n >= len(data) {
			frames = append(frames, data)
			break
		}
		for n > 0 && !utf8.RuneStart(data[n]) {
			n--
		}
		if n == 0 {
			n = inputChunkBytes
		}
		frames = append(frames, data[:n])
		data = data[n:]
	}
	return frames
}

// isPastedText reports whether data is text a person would paste rather than
// a keystroke: more than one character and not an escape sequence.
func isPastedText(data string) bool {
	return utf8.RuneCountInString(data) > 1 && !strings.HasPrefix(data, "\x1b")
}

// writeInput delivers data to the child through the PTY master, framed and
// chunked by inputFrames.
func (cp *claudeProcess) writeInput(data string) error {
	frames := inputFrames(data, cp.paste.enabled())
	for i, frame := range frames {
		if i > 0 {
			time.Sleep(inputChunkGap)
		}
		if _, err := cp.ptm.Write([]byte(frame)); err != nil {
			return err
		}
	}
	return nil
}
