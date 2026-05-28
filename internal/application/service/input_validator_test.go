package service

import (
	"strings"
	"testing"

	"quant/internal/domain/entity"
)

// TestValidateInputs_EmptySpecs verifies the spec==0 short-circuit returns nil.
func TestValidateInputs_EmptySpecs(t *testing.T) {
	if err := validateInputs(nil, nil); err != nil {
		t.Errorf("nil specs + nil inbound: want nil err, got %v", err)
	}
	if err := validateInputs([]entity.JobInputSpec{}, map[string]any{"x": 1}); err != nil {
		t.Errorf("empty specs + non-nil inbound: want nil err, got %v", err)
	}
}

// TestValidateInputs covers presence, type-matching, and the "all five types"
// table required by acceptance.
func TestValidateInputs(t *testing.T) {
	cases := []struct {
		name      string
		specs     []entity.JobInputSpec
		inbound   map[string]any
		wantErr   bool
		wantInErr []string // substrings expected when wantErr is true
	}{
		{
			name: "all-required-present-valid",
			specs: []entity.JobInputSpec{
				{Key: "linearId", Type: "string", Required: true},
				{Key: "count", Type: "number", Required: true},
			},
			inbound: map[string]any{"linearId": "MAX-86", "count": 1.0},
			wantErr: false,
		},
		{
			name: "missing-required-names-key",
			specs: []entity.JobInputSpec{
				{Key: "linearId", Type: "string", Required: true},
				{Key: "count", Type: "number", Required: false},
			},
			inbound:   map[string]any{"count": 1.0},
			wantErr:   true,
			wantInErr: []string{"linearId", "missing"},
		},
		{
			name: "wrong-type-string-vs-number",
			specs: []entity.JobInputSpec{
				{Key: "linearId", Type: "string", Required: true},
			},
			inbound:   map[string]any{"linearId": 42},
			wantErr:   true,
			wantInErr: []string{"linearId", "expected string", "got number"},
		},
		{
			name: "wrong-type-object-vs-array",
			specs: []entity.JobInputSpec{
				{Key: "tags", Type: "array", Required: true},
			},
			inbound:   map[string]any{"tags": map[string]any{"a": 1}},
			wantErr:   true,
			wantInErr: []string{"tags", "expected array", "got object"},
		},
		{
			name: "optional-missing-ok",
			specs: []entity.JobInputSpec{
				{Key: "linearId", Type: "string", Required: true},
				{Key: "tag", Type: "string", Required: false},
			},
			inbound: map[string]any{"linearId": "x"},
			wantErr: false,
		},
		{
			name: "nil-inbound-but-required",
			specs: []entity.JobInputSpec{
				{Key: "linearId", Type: "string", Required: true},
			},
			inbound:   nil,
			wantErr:   true,
			wantInErr: []string{"linearId"},
		},
		{
			name: "extra-keys-ignored",
			specs: []entity.JobInputSpec{
				{Key: "linearId", Type: "string", Required: true},
			},
			inbound: map[string]any{"linearId": "x", "rogue": "ok", "more": 5.0},
			wantErr: false,
		},
		// All five recognised types: string, number, boolean, object, array.
		{
			name: "all-five-types-match",
			specs: []entity.JobInputSpec{
				{Key: "s", Type: "string", Required: true},
				{Key: "n", Type: "number", Required: true},
				{Key: "b", Type: "boolean", Required: true},
				{Key: "o", Type: "object", Required: true},
				{Key: "a", Type: "array", Required: true},
			},
			inbound: map[string]any{
				"s": "hi",
				"n": 3.14,
				"b": true,
				"o": map[string]any{"k": "v"},
				"a": []any{1.0, 2.0},
			},
			wantErr: false,
		},
		{
			name: "boolean-wrong-type",
			specs: []entity.JobInputSpec{
				{Key: "flag", Type: "boolean", Required: true},
			},
			inbound:   map[string]any{"flag": "true"},
			wantErr:   true,
			wantInErr: []string{"flag", "expected boolean", "got string"},
		},
		{
			name: "object-wrong-type",
			specs: []entity.JobInputSpec{
				{Key: "obj", Type: "object", Required: true},
			},
			inbound:   map[string]any{"obj": []any{1.0}},
			wantErr:   true,
			wantInErr: []string{"obj", "expected object", "got array"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateInputs(tc.specs, tc.inbound)
			if (err != nil) != tc.wantErr {
				t.Fatalf("wantErr=%v, got err=%v", tc.wantErr, err)
			}
			if err != nil {
				msg := err.Error()
				for _, want := range tc.wantInErr {
					if !strings.Contains(msg, want) {
						t.Errorf("err %q missing substring %q", msg, want)
					}
				}
			}
		})
	}
}

// TestValidateInputs_MultipleErrorsCombined ensures both classes of error
// surface together for a single call.
func TestValidateInputs_MultipleErrorsCombined(t *testing.T) {
	specs := []entity.JobInputSpec{
		{Key: "a", Type: "string", Required: true},
		{Key: "b", Type: "number", Required: true},
	}
	err := validateInputs(specs, map[string]any{"b": "not-a-number"})
	if err == nil {
		t.Fatalf("expected combined error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "missing") || !strings.Contains(msg, "\"a\"") {
		t.Errorf("missing 'a' not in %q", msg)
	}
	if !strings.Contains(msg, "\"b\"") || !strings.Contains(msg, "expected number") {
		t.Errorf("type error for 'b' not in %q", msg)
	}
}
