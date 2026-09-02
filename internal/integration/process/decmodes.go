package process

import (
	"bytes"
	"io"
	"sort"
	"strconv"
	"strings"
)

// decModeScanBuf is the read size used when scanning elided output for mode
// changes. Session logs reach tens of megabytes, so the scan streams.
const decModeScanBuf = 64 * 1024

// maxTrackedDECModes caps how many distinct private modes are remembered, so a
// stream of junk that happens to look like mode sequences cannot grow the map
// without bound.
const maxTrackedDECModes = 64

// decModePreamble returns the DEC private mode sequences a terminal must be
// given before it is handed a truncated replay.
//
// The replay is capped to the tail of the output file, but the sequences that
// put the terminal into the state the running application believes it is in are
// emitted once, when the CLI starts, and are long gone by then. Bracketed paste
// (?2004h) is the one that bites: a terminal that mounts without it treats a
// paste as raw keystrokes, so the agent's TUI submits at the first newline and
// the paste arrives cut in half — until the session is restarted and the CLI
// enables the mode again. Replaying the final state of every private mode seen
// in the elided output restores what the tail alone cannot.
func decModePreamble(r io.Reader) string {
	modes := scanDECModes(r)
	if len(modes) == 0 {
		return ""
	}

	numbers := make([]int, 0, len(modes))
	for mode := range modes {
		if bufferSwitchDECModes[mode] {
			continue
		}
		numbers = append(numbers, mode)
	}
	if len(numbers) == 0 {
		return ""
	}
	sort.Ints(numbers)

	var b strings.Builder
	for _, mode := range numbers {
		b.WriteString("\x1b[?")
		b.WriteString(strconv.Itoa(mode))
		if modes[mode] {
			b.WriteString("h")
		} else {
			b.WriteString("l")
		}
	}
	return b.String()
}

// bufferSwitchDECModes are the private modes that swap the terminal between the
// normal and alternate screen buffer. They are deliberately NOT replayed: the
// alternate buffer has no scrollback, so restoring it would render the replayed
// tail into a screen the user cannot scroll back through. The application's own
// output keeps rendering exactly as it does today.
var bufferSwitchDECModes = map[int]bool{47: true, 1047: true, 1048: true, 1049: true}

// DEC private mode parser states. A sequence looks like ESC [ ? 1000;1002 h,
// and may be split across reads, so the state carries between chunks.
const (
	decStateNormal = iota
	decStateEsc
	decStateCSI
	decStateParams
)

// scanDECModes reports the final on/off state of every DEC private mode set or
// reset in the stream.
func scanDECModes(r io.Reader) map[int]bool {
	modes := make(map[int]bool)
	state := decStateNormal
	var params []byte
	buf := make([]byte, decModeScanBuf)

	for {
		n, err := r.Read(buf)
		chunk := buf[:n]
		for len(chunk) > 0 {
			if state == decStateNormal {
				// Nothing to track until the next escape.
				idx := bytes.IndexByte(chunk, 0x1b)
				if idx < 0 {
					break
				}
				state = decStateEsc
				chunk = chunk[idx+1:]
				continue
			}

			c := chunk[0]
			chunk = chunk[1:]
			switch state {
			case decStateEsc:
				switch c {
				case '[':
					state = decStateCSI
				case 0x1b:
					// Stay in escape: a new sequence started.
				default:
					state = decStateNormal
				}
			case decStateCSI:
				if c == '?' {
					state, params = decStateParams, params[:0]
				} else if c == 0x1b {
					state = decStateEsc
				} else {
					state = decStateNormal
				}
			case decStateParams:
				switch {
				case (c >= '0' && c <= '9') || c == ';':
					if len(params) < 64 {
						params = append(params, c)
					}
				case c == 'h' || c == 'l':
					applyDECModes(modes, params, c == 'h')
					state = decStateNormal
				case c == 0x1b:
					state = decStateEsc
				default:
					state = decStateNormal
				}
			}
		}
		if err != nil {
			return modes
		}
	}
}

// applyDECModes records the on/off state of every mode in a ";"-separated
// parameter list.
func applyDECModes(modes map[int]bool, params []byte, on bool) {
	for _, field := range bytes.Split(params, []byte(";")) {
		if len(field) == 0 {
			continue
		}
		mode, err := strconv.Atoi(string(field))
		if err != nil || mode <= 0 {
			continue
		}
		if _, known := modes[mode]; !known && len(modes) >= maxTrackedDECModes {
			continue
		}
		modes[mode] = on
	}
}
