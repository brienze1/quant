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

// TestWithDefaultsSeedsLangVoices verifies both languages get default voice +
// speed entries and the top-level Voice/Speed mirror the selected language.
func TestWithDefaultsSeedsLangVoices(t *testing.T) {
	v := VoiceConfig{Language: "pt-br"}.WithDefaults()
	if v.LangVoices["en"].Voice != "af_heart" || v.LangVoices["en"].Speed != 1.2 {
		t.Errorf("en entry = %+v, want {af_heart 1.2}", v.LangVoices["en"])
	}
	if v.LangVoices["pt-br"].Voice != "pf_dora" || v.LangVoices["pt-br"].Speed != 1.2 {
		t.Errorf("pt-br entry = %+v, want {pf_dora 1.2}", v.LangVoices["pt-br"])
	}
	// Selected language is pt-br → top-level mirrors it.
	if v.Voice != "pf_dora" || v.Speed != 1.2 {
		t.Errorf("mirrored top-level = {%q %v}, want {pf_dora 1.2}", v.Voice, v.Speed)
	}
}

// TestWithDefaultsMigratesLegacyVoice verifies a pre-per-language config (single
// Voice/Speed, no LangVoices) migrates the value into the selected language slot.
func TestWithDefaultsMigratesLegacyVoice(t *testing.T) {
	v := VoiceConfig{Language: "en", Voice: "am_onyx", Speed: 1.5}.WithDefaults()
	if got := v.LangVoices["en"]; got.Voice != "am_onyx" || got.Speed != 1.5 {
		t.Errorf("migrated en entry = %+v, want {am_onyx 1.5}", got)
	}
	// pt-br still seeded with its default (untouched by the migration).
	if v.LangVoices["pt-br"].Voice != "pf_dora" {
		t.Errorf("pt-br entry = %+v, want default pf_dora", v.LangVoices["pt-br"])
	}
}

// TestVoiceForLangAndSpeedForLang covers the per-language accessors, including
// normalization + defaults for an unconfigured language.
func TestVoiceForLangAndSpeedForLang(t *testing.T) {
	v := VoiceConfig{
		LangVoices: map[string]LangVoiceConfig{
			"en":    {Voice: "am_onyx", Speed: 1.4},
			"pt-br": {Voice: "pm_alex", Speed: 0.9},
		},
	}
	if got := v.VoiceForLang("PT-BR"); got != "pm_alex" { // case-insensitive
		t.Errorf("VoiceForLang(PT-BR) = %q, want pm_alex", got)
	}
	if got := v.SpeedForLang("en"); got != 1.4 {
		t.Errorf("SpeedForLang(en) = %v, want 1.4", got)
	}
	// Unknown language normalizes to en.
	if got := v.VoiceForLang("fr"); got != "am_onyx" {
		t.Errorf("VoiceForLang(fr) = %q, want am_onyx (en)", got)
	}
	// Missing entry falls back to language default.
	empty := VoiceConfig{}
	if got := empty.VoiceForLang("pt-br"); got != "pf_dora" {
		t.Errorf("VoiceForLang(pt-br) on empty = %q, want pf_dora", got)
	}
	if got := empty.SpeedForLang("en"); got != 1.2 {
		t.Errorf("SpeedForLang(en) on empty = %v, want 1.2", got)
	}
}
