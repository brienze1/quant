package entity

import "testing"

// TestVoiceConfigWithDefaultsLanguage verifies Language normalizes to "en"
// unless explicitly "pt-br" (covering unset/legacy/unknown values).
func TestVoiceConfigWithDefaultsLanguage(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", "en"},
		{"en", "en"},
		{"pt-br", "pt-br"},
		{"fr", "en"},
		{"PT-BR", "en"}, // WithDefaults does not lowercase; only the exact value passes
	}
	for _, c := range cases {
		got := VoiceConfig{Language: c.in}.WithDefaults().Language
		if got != c.want {
			t.Errorf("WithDefaults Language(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestNewDefaultConfigVoiceLanguage confirms a fresh config defaults to English.
func TestNewDefaultConfigVoiceLanguage(t *testing.T) {
	if got := NewDefaultConfig().Voice.Language; got != "en" {
		t.Fatalf("default voice language = %q, want \"en\"", got)
	}
}
