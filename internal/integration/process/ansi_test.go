package process

import (
	"testing"
)

func TestStripANSI(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain text passes through", "hello world", "hello world"},
		{"newline and tab kept", "line1\nline2\tend", "line1\nline2\tend"},
		{"carriage return dropped", "prompt\r\nnext", "prompt\nnext"},
		{"backspace and bell dropped", "a\bb\x07c", "abc"},
		{"CSI color codes removed", "\x1b[31mred\x1b[0m plain", "red plain"},
		{"CSI cursor movement removed", "\x1b[2J\x1b[1;1Htop", "top"},
		{"CSI private modes removed", "\x1b[?25lhidden\x1b[?25h", "hidden"},
		{"OSC title with BEL removed", "\x1b]0;window title\x07after", "after"},
		{"OSC with ST terminator removed", "\x1b]8;;http://x\x1b\\link", "link"},
		{"bare ESC two-byte sequence removed", "\x1b(Btext", "text"},
		{"esc to interrupt text survives", "\x1b[33m… esc to interrupt\x1b[0m", "… esc to interrupt"},
		{"unicode passes through", "❯ Do you want", "❯ Do you want"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, state := stripANSI([]byte(tc.in), ansiGround)
			if string(got) != tc.want {
				t.Fatalf("stripANSI(%q) = %q, want %q", tc.in, got, tc.want)
			}
			if state != ansiGround {
				t.Fatalf("stripANSI(%q) left parser in state %d, want ground", tc.in, state)
			}
		})
	}
}

// TestStripANSI_SplitAcrossChunks verifies the parser state carries partial
// escape sequences across chunk boundaries, at every possible split point.
func TestStripANSI_SplitAcrossChunks(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"CSI split", "\x1b[31mred\x1b[0m", "red"},
		{"OSC split", "\x1b]0;title\x07ok", "ok"},
		{"OSC ST split", "\x1b]8;;u\x1b\\ok", "ok"},
		{"bare ESC split", "\x1b(Bok", "ok"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for cut := 1; cut < len(tc.in); cut++ {
				first, state := stripANSI([]byte(tc.in[:cut]), ansiGround)
				second, state := stripANSI([]byte(tc.in[cut:]), state)
				got := string(first) + string(second)
				if got != tc.want {
					t.Fatalf("split at %d: got %q, want %q", cut, got, tc.want)
				}
				if state != ansiGround {
					t.Fatalf("split at %d: left parser in state %d, want ground", cut, state)
				}
			}
		})
	}
}
