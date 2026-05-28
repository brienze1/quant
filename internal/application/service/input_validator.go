package service

import (
	"fmt"
	"sort"
	"strings"

	"quant/internal/domain/entity"
)

// ValidationError captures pre-run validation failures as a structured object
// so the frontend can render it nicely. The .Error() form is what gets stored
// in run.ValidationError for machine-readable diagnostics.
type ValidationError struct {
	MissingKeys []string          // required keys absent from inbound
	WrongTypes  map[string]string // key -> "expected <T>, got <U>"
}

// Error renders a deterministic, human-readable summary of the failures.
func (e *ValidationError) Error() string {
	parts := []string{}
	if len(e.MissingKeys) > 0 {
		sorted := append([]string(nil), e.MissingKeys...)
		sort.Strings(sorted)
		parts = append(parts, "missing required input "+formatKeyList(sorted))
	}
	if len(e.WrongTypes) > 0 {
		keys := make([]string, 0, len(e.WrongTypes))
		for k := range e.WrongTypes {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			parts = append(parts, fmt.Sprintf("input %q: %s", k, e.WrongTypes[k]))
		}
	}
	return strings.Join(parts, "; ")
}

func formatKeyList(keys []string) string {
	quoted := make([]string, len(keys))
	for i, k := range keys {
		quoted[i] = fmt.Sprintf("%q", k)
	}
	return strings.Join(quoted, ", ")
}

// validateInputs checks an inbound metadata map against a job's declared
// input specs. Returns nil when valid; *ValidationError otherwise.
//
// Rules:
//   - spec.Required and key absent  -> MissingKeys
//   - key present but type mismatch -> WrongTypes
//   - key absent and not required   -> ignored
//   - extra keys not declared       -> ignored (open-world model)
func validateInputs(specs []entity.JobInputSpec, inbound map[string]any) error {
	if len(specs) == 0 {
		return nil
	}
	if inbound == nil {
		inbound = map[string]any{}
	}
	verr := &ValidationError{WrongTypes: map[string]string{}}
	for _, spec := range specs {
		v, present := inbound[spec.Key]
		if !present {
			if spec.Required {
				verr.MissingKeys = append(verr.MissingKeys, spec.Key)
			}
			continue
		}
		if !typeMatches(spec.Type, v) {
			verr.WrongTypes[spec.Key] = fmt.Sprintf("expected %s, got %s", spec.Type, jsonTypeOf(v))
		}
	}
	if len(verr.MissingKeys) == 0 && len(verr.WrongTypes) == 0 {
		return nil
	}
	return verr
}

// typeMatches reports whether v satisfies the declared spec type.
// Spec types: "string"|"number"|"boolean"|"object"|"array".
// "" or "any" matches anything (escape hatch for legacy/loose specs).
func typeMatches(declared string, v any) bool {
	switch declared {
	case "", "any":
		return true
	case "string":
		_, ok := v.(string)
		return ok
	case "number":
		switch v.(type) {
		case float64, float32, int, int32, int64, uint, uint32, uint64:
			return true
		}
		return false
	case "boolean":
		_, ok := v.(bool)
		return ok
	case "object":
		_, ok := v.(map[string]any)
		return ok
	case "array":
		_, ok := v.([]any)
		return ok
	}
	return false
}

// jsonTypeOf returns the JSON-style type name of a Go value, for diagnostics.
func jsonTypeOf(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64, float32, int, int32, int64, uint, uint32, uint64:
		return "number"
	case map[string]any:
		return "object"
	case []any:
		return "array"
	default:
		return fmt.Sprintf("%T", v)
	}
}
