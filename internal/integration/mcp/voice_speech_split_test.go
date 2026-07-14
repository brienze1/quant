package mcp

import (
	"strings"
	"testing"
)

// TestSplitForSpeechShortUnchanged: text under the cap is a single chunk equal
// to the trimmed input (the common case must not change behavior).
func TestSplitForSpeechShortUnchanged(t *testing.T) {
	in := "  Hello there. How are you?  "
	got := splitForSpeech(in, speechChunkChars)
	if len(got) != 1 || got[0] != "Hello there. How are you?" {
		t.Fatalf("got %#v, want single trimmed chunk", got)
	}
}

func TestSplitForSpeechEmpty(t *testing.T) {
	if got := splitForSpeech("   ", speechChunkChars); got != nil {
		t.Fatalf("empty input: got %#v, want nil", got)
	}
}

// TestSplitForSpeechPacksSentences: several sentences pack into as few chunks as
// fit under maxChars, each chunk stays within the cap, and every sentence keeps
// its terminator.
func TestSplitForSpeechPacksSentences(t *testing.T) {
	// 5 sentences of ~20 chars each; cap 50 → ~2 sentences per chunk.
	in := "One two three four. Five six seven eight. Nine ten eleven twelve. A b c d e f g. Last one here now."
	got := splitForSpeech(in, 50)
	if len(got) < 2 {
		t.Fatalf("expected multiple chunks, got %#v", got)
	}
	for _, c := range got {
		if len(c) > 50 {
			t.Errorf("chunk exceeds cap (%d): %q", len(c), c)
		}
	}
	// No words lost or reordered.
	if gotWords, wantWords := strings.Fields(strings.Join(got, " ")), strings.Fields(in); !equalSlices(gotWords, wantWords) {
		t.Errorf("words changed:\n got  %v\n want %v", gotWords, wantWords)
	}
}

// TestSplitForSpeechHardSplitsLongSentence: a single sentence longer than the
// cap is broken on word boundaries, never mid-word.
func TestSplitForSpeechHardSplitsLongSentence(t *testing.T) {
	in := "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike"
	got := splitForSpeech(in, 25)
	if len(got) < 2 {
		t.Fatalf("expected the long sentence to hard-split, got %#v", got)
	}
	for _, c := range got {
		if len(c) > 25 {
			t.Errorf("chunk exceeds cap (%d): %q", len(c), c)
		}
		for _, w := range strings.Fields(c) {
			if !strings.Contains(in, w) {
				t.Errorf("word %q was cut mid-word", w)
			}
		}
	}
	if gotWords, wantWords := strings.Fields(strings.Join(got, " ")), strings.Fields(in); !equalSlices(gotWords, wantWords) {
		t.Errorf("words changed:\n got  %v\n want %v", gotWords, wantWords)
	}
}

// TestSplitForSpeechKeepsSingleHugeWord: a lone word longer than the cap is
// emitted whole rather than lost or cut.
func TestSplitForSpeechKeepsSingleHugeWord(t *testing.T) {
	huge := strings.Repeat("x", 60)
	got := splitForSpeech(huge, 25)
	if len(got) != 1 || got[0] != huge {
		t.Fatalf("got %#v, want the whole word as one chunk", got)
	}
}

// TestSplitForSpeechDecimalNotSplit: a decimal like 3.14 must not trigger a
// sentence break (the dot is followed by a digit, not a space).
func TestSplitForSpeechDecimalNotSplit(t *testing.T) {
	in := "Pi is about 3.14 today."
	got := splitForSpeech(in, speechChunkChars)
	if len(got) != 1 || got[0] != in {
		t.Fatalf("got %#v, want single chunk (decimal not a boundary)", got)
	}
}

func equalSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
