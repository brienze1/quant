package mcp

import (
	"strings"
	"unicode"
)

// speechChunkChars caps how much text a single voice_speak request carries. A
// chunk this size is well under a minute of synthesized speech, so each speak
// request comfortably finishes within voice.SpeakTimeout (60s). Splitting long
// replies into several such requests — each with its own fresh timeout budget —
// lets an arbitrarily long reply play in full WITHOUT keeping any one request
// alive past its deadline (an unbounded keepalive is what broke mobile voice in
// v3.1.55: it disabled the SpeakTimeout safety net and the tool hung).
const speechChunkChars = 400

// splitForSpeech breaks text into speech-sized chunks on sentence boundaries,
// each at most maxChars bytes where possible. Sentences are kept whole and
// greedily packed; a sentence longer than maxChars is hard-split on spaces
// (never mid-word). Whitespace is normalized. Short text returns a single chunk
// identical to the trimmed input, so the common case is unchanged.
func splitForSpeech(text string, maxChars int) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	if maxChars <= 0 {
		return []string{text}
	}

	var chunks []string
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			chunks = append(chunks, strings.TrimSpace(cur.String()))
			cur.Reset()
		}
	}
	add := func(s string) {
		if cur.Len() > 0 {
			cur.WriteByte(' ')
		}
		cur.WriteString(s)
	}

	for _, sent := range splitSentences(text) {
		if len(sent) > maxChars {
			// A single sentence that overflows the cap: emit what we have, then
			// hard-split the long sentence on word boundaries.
			flush()
			chunks = append(chunks, hardSplit(sent, maxChars)...)
			continue
		}
		if cur.Len() > 0 && cur.Len()+1+len(sent) > maxChars {
			flush()
		}
		add(sent)
	}
	flush()

	if len(chunks) == 0 {
		return []string{text}
	}
	return chunks
}

// splitSentences splits text at sentence-ending punctuation (. ! ?) and hard
// line breaks, keeping the punctuation with its sentence. It does not try to be
// clever about abbreviations: an occasional over-split just yields a slightly
// shorter chunk (a natural pause), which is harmless for speech.
func splitSentences(text string) []string {
	var out []string
	var b strings.Builder
	runes := []rune(text)
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		b.WriteRune(r)
		if r != '.' && r != '!' && r != '?' && r != '\n' {
			continue
		}
		// Absorb a run of trailing terminators ("?!", "...") into this sentence.
		j := i + 1
		for j < len(runes) && (runes[j] == '.' || runes[j] == '!' || runes[j] == '?') {
			b.WriteRune(runes[j])
			j++
		}
		// End the sentence only at a following space or end-of-text, so a decimal
		// like "3.14" (digit right after the dot) does not split.
		if j >= len(runes) || unicode.IsSpace(runes[j]) {
			if s := strings.TrimSpace(b.String()); s != "" {
				out = append(out, s)
			}
			b.Reset()
			i = j - 1
		}
	}
	if s := strings.TrimSpace(b.String()); s != "" {
		out = append(out, s)
	}
	return out
}

// hardSplit breaks an overlong sentence into <=maxChars pieces on word
// boundaries. A single word longer than maxChars (e.g. a URL) is emitted whole
// rather than cut mid-word.
func hardSplit(s string, maxChars int) []string {
	var out []string
	var b strings.Builder
	for _, w := range strings.Fields(s) {
		if b.Len() > 0 && b.Len()+1+len(w) > maxChars {
			out = append(out, b.String())
			b.Reset()
		}
		if b.Len() > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(w)
	}
	if b.Len() > 0 {
		out = append(out, b.String())
	}
	return out
}
