package service

import (
	"reflect"
	"strings"
	"testing"

	"quant/internal/domain/entity"
)

// TestExtractSentinelOutputs tests the regex-based sentinel block extraction:
// presence, absence, malformed JSON, and the multi-block "last wins" rule
// documented in the source comment.
func TestExtractSentinelOutputs(t *testing.T) {
	cases := []struct {
		name   string
		input  string
		want   map[string]any
		wantOK bool
	}{
		{
			name:   "basic-single-block",
			input:  `prefix <quant-output>{"a":1}</quant-output> suffix`,
			want:   map[string]any{"a": float64(1)},
			wantOK: true,
		},
		{
			name:   "no-block-returns-false",
			input:  `just plain text with no sentinel`,
			want:   nil,
			wantOK: false,
		},
		{
			name:   "malformed-json-last-block-returns-false",
			input:  `<quant-output>{not-json}</quant-output>`,
			want:   nil,
			wantOK: false,
		},
		{
			name:   "multiple-blocks-last-wins",
			input:  `<quant-output>{"a":1}</quant-output>...<quant-output>{"a":2,"b":3}</quant-output>`,
			want:   map[string]any{"a": float64(2), "b": float64(3)},
			wantOK: true,
		},
		{
			name: "multiline-json-body",
			input: "<quant-output>{\n  \"prUrl\": \"https://x/pr/1\",\n  \"status\": \"open\"\n}</quant-output>",
			want: map[string]any{
				"prUrl":  "https://x/pr/1",
				"status": "open",
			},
			wantOK: true,
		},
		{
			name:   "empty-input",
			input:  "",
			want:   nil,
			wantOK: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := extractSentinelOutputs(tc.input)
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want=%v (got=%v)", ok, tc.wantOK, got)
			}
			if ok && !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %v want %v", got, tc.want)
			}
		})
	}
}

// TestApplyPassthrough_OverridesProduced verifies that when a key is declared
// passthrough the inbound value is used and any LLM-emitted value for that
// same key is dropped.
func TestApplyPassthrough_OverridesProduced(t *testing.T) {
	specs := []entity.JobOutputSpec{
		{Key: "linearId", Type: "string", Source: "passthrough"},
		{Key: "prUrl", Type: "string", Source: "produced"},
	}
	produced := map[string]any{
		"linearId": "LLM-LIES",
		"prUrl":    "https://x/pr/1",
		"rogue":    "dropped",
	}
	inbound := map[string]any{"linearId": "MAX-86"}

	got, errs := applyPassthrough(specs, produced, inbound)
	if len(errs) != 0 {
		t.Fatalf("unexpected errs: %v", errs)
	}
	if got["linearId"] != "MAX-86" {
		t.Errorf("passthrough not enforced: %v", got["linearId"])
	}
	if got["prUrl"] != "https://x/pr/1" {
		t.Errorf("produced value lost: %v", got["prUrl"])
	}
	if _, has := got["rogue"]; has {
		t.Errorf("rogue undeclared key was not dropped")
	}
}

// TestApplyPassthrough_TypeMismatch_Produced ensures produced-source values
// that don't match the declared type produce an error string.
func TestApplyPassthrough_TypeMismatch_Produced(t *testing.T) {
	specs := []entity.JobOutputSpec{
		{Key: "count", Type: "number", Source: "produced"},
	}
	produced := map[string]any{"count": "not-a-number"}
	_, errs := applyPassthrough(specs, produced, map[string]any{})
	if len(errs) != 1 {
		t.Fatalf("want 1 err, got %v", errs)
	}
	if !strings.Contains(errs[0], "count") || !strings.Contains(errs[0], "declared number") {
		t.Errorf("err %q missing key/type details", errs[0])
	}
}

// TestApplyPassthrough_TypeMismatch_Passthrough ensures passthrough values
// that don't match the declared type produce an error string.
func TestApplyPassthrough_TypeMismatch_Passthrough(t *testing.T) {
	specs := []entity.JobOutputSpec{
		{Key: "linearId", Type: "string", Source: "passthrough"},
	}
	inbound := map[string]any{"linearId": 42}
	_, errs := applyPassthrough(specs, map[string]any{}, inbound)
	if len(errs) != 1 {
		t.Fatalf("want 1 err, got %v", errs)
	}
	if !strings.Contains(errs[0], "linearId") || !strings.Contains(errs[0], "declared string") {
		t.Errorf("err %q missing key/type details", errs[0])
	}
}

// TestApplyPassthrough_MissingProduced surfaces an error when a produced key
// is required but absent.
func TestApplyPassthrough_MissingProduced(t *testing.T) {
	specs := []entity.JobOutputSpec{
		{Key: "prUrl", Type: "string", Source: "produced"},
	}
	_, errs := applyPassthrough(specs, map[string]any{}, map[string]any{})
	if len(errs) != 1 {
		t.Fatalf("want 1 err, got %v", errs)
	}
	if !strings.Contains(errs[0], "prUrl") {
		t.Errorf("err %q must name the missing key", errs[0])
	}
}

// TestApplyPassthrough_MissingPassthrough surfaces an error when a
// passthrough key is required but absent from inbound.
func TestApplyPassthrough_MissingPassthrough(t *testing.T) {
	specs := []entity.JobOutputSpec{
		{Key: "linearId", Type: "string", Source: "passthrough"},
	}
	_, errs := applyPassthrough(specs, map[string]any{}, map[string]any{})
	if len(errs) != 1 {
		t.Fatalf("want 1 err, got %v", errs)
	}
	if !strings.Contains(errs[0], "linearId") {
		t.Errorf("err %q must name the missing key", errs[0])
	}
}

// TestApplyPassthrough_UnknownSource surfaces a deterministic error.
func TestApplyPassthrough_UnknownSource(t *testing.T) {
	specs := []entity.JobOutputSpec{
		{Key: "x", Type: "string", Source: "magic"},
	}
	_, errs := applyPassthrough(specs, map[string]any{}, map[string]any{})
	if len(errs) != 1 {
		t.Fatalf("want 1 err, got %v", errs)
	}
	if !strings.Contains(errs[0], "magic") {
		t.Errorf("err %q must name the bad source", errs[0])
	}
}

// TestApplyPassthrough_DefaultSourceIsProduced verifies that Source=="" is
// treated equivalently to "produced".
func TestApplyPassthrough_DefaultSourceIsProduced(t *testing.T) {
	specs := []entity.JobOutputSpec{
		{Key: "prUrl", Type: "string"}, // Source omitted
	}
	produced := map[string]any{"prUrl": "https://x"}
	got, errs := applyPassthrough(specs, produced, map[string]any{})
	if len(errs) != 0 {
		t.Fatalf("unexpected errs: %v", errs)
	}
	if got["prUrl"] != "https://x" {
		t.Errorf("default-source did not pick up produced value: %v", got)
	}
}

// TestFinalizeMetadata_EmptySpecsPermissive ensures back-compat: when no
// specs are declared, the sentinel output (or {}) is returned verbatim.
func TestFinalizeMetadata_EmptySpecsPermissive(t *testing.T) {
	t.Run("with-sentinel", func(t *testing.T) {
		out, errs := finalizeMetadata(nil,
			`<quant-output>{"any":"thing","extra":42}</quant-output>`,
			nil, nil)
		if len(errs) != 0 {
			t.Fatalf("errs: %v", errs)
		}
		want := map[string]any{"any": "thing", "extra": float64(42)}
		if !reflect.DeepEqual(out, want) {
			t.Errorf("got %v want %v", out, want)
		}
	})
	t.Run("without-sentinel-no-fallback", func(t *testing.T) {
		out, errs := finalizeMetadata(nil, "no sentinel here", nil, nil)
		if len(errs) != 0 {
			t.Fatalf("errs: %v", errs)
		}
		if out == nil || len(out) != 0 {
			t.Errorf("want empty non-nil map, got %v", out)
		}
	})
}

// TestFinalizeMetadata_StrictMixed exercises a realistic mixed schema with
// both a passthrough key and a produced key in the same call.
func TestFinalizeMetadata_StrictMixed(t *testing.T) {
	specs := []entity.JobOutputSpec{
		{Key: "linearId", Type: "string", Source: "passthrough"},
		{Key: "prUrl", Type: "string", Source: "produced"},
	}
	output := `<quant-output>{"prUrl":"https://x/pr/1","linearId":"LLM-LIES"}</quant-output>`
	inbound := map[string]any{"linearId": "MAX-86"}

	out, errs := finalizeMetadata(specs, output, inbound, nil)
	if len(errs) != 0 {
		t.Fatalf("errs: %v", errs)
	}
	if out["linearId"] != "MAX-86" {
		t.Errorf("passthrough not enforced: %v", out["linearId"])
	}
	if out["prUrl"] != "https://x/pr/1" {
		t.Errorf("produced lost: %v", out["prUrl"])
	}
}

// TestFinalizeMetadata_FallbackUsedWhenNoSentinel ensures the eval fallback
// is invoked when (and only when) there is no sentinel block.
func TestFinalizeMetadata_FallbackUsedWhenNoSentinel(t *testing.T) {
	specs := []entity.JobOutputSpec{
		{Key: "prUrl", Type: "string", Source: "produced"},
	}
	called := false
	fallback := func() (map[string]any, error) {
		called = true
		return map[string]any{"prUrl": "https://x/from-eval"}, nil
	}
	out, errs := finalizeMetadata(specs, "no sentinel", nil, fallback)
	if !called {
		t.Fatalf("fallback was not invoked")
	}
	if len(errs) != 0 {
		t.Fatalf("errs: %v", errs)
	}
	if out["prUrl"] != "https://x/from-eval" {
		t.Errorf("fallback value not used: %v", out)
	}
}

// TestFinalizeMetadata_FallbackSkippedWhenSentinelPresent verifies fallback
// is bypassed once a sentinel block exists.
func TestFinalizeMetadata_FallbackSkippedWhenSentinelPresent(t *testing.T) {
	specs := []entity.JobOutputSpec{
		{Key: "prUrl", Type: "string", Source: "produced"},
	}
	called := false
	fallback := func() (map[string]any, error) {
		called = true
		return map[string]any{"prUrl": "should-not-be-used"}, nil
	}
	out, _ := finalizeMetadata(specs,
		`<quant-output>{"prUrl":"https://x/from-sentinel"}</quant-output>`,
		nil, fallback)
	if called {
		t.Errorf("fallback should not run when sentinel block exists")
	}
	if out["prUrl"] != "https://x/from-sentinel" {
		t.Errorf("sentinel value should win: %v", out)
	}
}

// TestJoinExtractionErrs verifies the deterministic alphabetical joining
// used for log/error rendering.
func TestJoinExtractionErrs(t *testing.T) {
	if got := joinExtractionErrs(nil); got != "" {
		t.Errorf("nil => %q want \"\"", got)
	}
	got := joinExtractionErrs([]string{"b err", "a err", "c err"})
	if got != "a err; b err; c err" {
		t.Errorf("unexpected order: %q", got)
	}
}
