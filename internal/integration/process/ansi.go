package process

// ansiState carries the escape-sequence parser state across chunk boundaries,
// so a sequence split between two PTY reads is still stripped correctly.
type ansiState int

const (
	ansiGround    ansiState = iota
	ansiEscape              // after a bare ESC
	ansiCSI                 // inside an ESC [ ... sequence
	ansiOSC                 // inside an ESC ] ... sequence
	ansiOSCEscape           // inside an OSC, after ESC (expecting the ST terminator)
)

// stripANSI removes terminal escape sequences (CSI, OSC and bare ESC sequences)
// and non-printable control bytes from data, keeping newlines and tabs. It
// returns the stripped text and the parser state to carry into the next chunk.
func stripANSI(data []byte, state ansiState) ([]byte, ansiState) {
	out := make([]byte, 0, len(data))
	for _, b := range data {
		switch state {
		case ansiGround:
			switch {
			case b == 0x1b:
				state = ansiEscape
			case b == '\n' || b == '\t':
				out = append(out, b)
			case b < 0x20 || b == 0x7f:
				// Drop \r, backspace, BEL and other control bytes.
			default:
				out = append(out, b)
			}
		case ansiEscape:
			switch {
			case b == '[':
				state = ansiCSI
			case b == ']':
				state = ansiOSC
			case b == 0x1b:
				// ESC ESC: stay armed for the next sequence.
			case b >= 0x20 && b <= 0x2f:
				// Intermediate byte (e.g. the '(' of ESC ( B) — final byte follows.
			default:
				// Final byte of a bare escape sequence.
				state = ansiGround
			}
		case ansiCSI:
			// Parameter (0x30–0x3F) and intermediate (0x20–0x2F) bytes continue
			// the sequence; a final byte (0x40–0x7E) ends it.
			if b >= 0x40 && b <= 0x7e {
				state = ansiGround
			}
		case ansiOSC:
			if b == 0x07 {
				state = ansiGround
			} else if b == 0x1b {
				state = ansiOSCEscape
			}
		case ansiOSCEscape:
			if b == '\\' {
				state = ansiGround
			} else if b != 0x1b {
				state = ansiOSC
			}
		}
	}
	return out, state
}
