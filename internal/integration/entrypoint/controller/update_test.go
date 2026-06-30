package controller

import "testing"

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v3.1.41", "v3.1.40", 1},
		{"v3.1.40", "v3.1.41", -1},
		{"v3.1.41", "v3.1.41", 0},
		{"3.1.41", "v3.1.41", 0},       // tolerate missing "v"
		{"v3.2.0", "v3.1.99", 1},       // minor beats patch
		{"v4.0.0", "v3.99.99", 1},      // major beats minor
		{"v3.1.41-beta", "v3.1.41", 0}, // ignore pre-release suffix
		{"v3.1", "v3.1.0", 0},          // tolerate missing patch
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestMacAppBundle(t *testing.T) {
	cases := []struct {
		exe, want string
	}{
		{"/Applications/Quant.app/Contents/MacOS/quant", "/Applications/Quant.app"},
		{"/opt/homebrew/bin/quant", ""},
		{"/usr/local/bin/quant", ""},
	}
	for _, c := range cases {
		if got := macAppBundle(c.exe); got != c.want {
			t.Errorf("macAppBundle(%q) = %q, want %q", c.exe, got, c.want)
		}
	}
}
