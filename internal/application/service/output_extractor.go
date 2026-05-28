package service

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"quant/internal/domain/entity"
)

// sentinelRe matches a <quant-output>...</quant-output> block. The capture
// group is the JSON body. Non-greedy + DOTALL so multi-line JSON works and we
// don't accidentally span across two blocks.
//
// We extract ALL matches (not just the first) so jobs can prepend transient
// status lines and have the LAST sentinel be the source of truth.
var sentinelRe = regexp.MustCompile(`(?s)<quant-output>\s*(\{.*?\})\s*</quant-output>`)

// extractSentinelOutputs scans the FULL job output for the LAST
// <quant-output>{...}</quant-output> block and parses its JSON body.
//
// Returns (parsed, true) when a valid block is found.
// Returns (nil, false) when no block exists, or the last block's JSON is
// malformed. (Earlier valid blocks are intentionally NOT used as fallback —
// the contract is "the last block wins"; treating a malformed last block as
// "no sentinel" lets the LLM-eval fallback engage and surfaces the bug
// instead of silently using stale data.)
func extractSentinelOutputs(output string) (map[string]any, bool) {
	matches := sentinelRe.FindAllStringSubmatch(output, -1)
	if len(matches) == 0 {
		return nil, false
	}
	last := matches[len(matches)-1][1]
	var parsed map[string]any
	if err := json.Unmarshal([]byte(last), &parsed); err != nil {
		return nil, false
	}
	return parsed, true
}

// applyPassthrough merges produced (extracted) outputs with inbound metadata
// according to a job's declared output spec, enforcing passthrough integrity.
//
// Per spec entry:
//   - source == "passthrough": value is copied verbatim from inbound; any
//     value the job emitted for this key is DROPPED. Missing inbound value or
//     type mismatch -> error string.
//   - source == "produced" (or ""): value comes from produced; missing or
//     wrong-type -> error string.
//   - unknown source -> error string.
//
// Extra emitted keys NOT in the spec are dropped silently — when a spec is
// declared, it is the contract.
//
// Returns the final metadata map and an ordered slice of error strings
// (deterministic order matches the spec order so logs are stable).
func applyPassthrough(specs []entity.JobOutputSpec, produced, inbound map[string]any) (map[string]any, []string) {
	out := map[string]any{}
	var errs []string
	if produced == nil {
		produced = map[string]any{}
	}
	if inbound == nil {
		inbound = map[string]any{}
	}

	for _, s := range specs {
		switch s.Source {
		case "passthrough":
			v, ok := inbound[s.Key]
			if !ok {
				errs = append(errs, fmt.Sprintf("passthrough output %q has no inbound value", s.Key))
				continue
			}
			if !typeMatches(s.Type, v) {
				errs = append(errs, fmt.Sprintf("passthrough output %q: inbound type %s != declared %s", s.Key, jsonTypeOf(v), s.Type))
				continue
			}
			out[s.Key] = v
		case "produced", "":
			v, ok := produced[s.Key]
			if !ok {
				errs = append(errs, fmt.Sprintf("produced output %q missing from job result", s.Key))
				continue
			}
			if !typeMatches(s.Type, v) {
				errs = append(errs, fmt.Sprintf("produced output %q: %s != declared %s", s.Key, jsonTypeOf(v), s.Type))
				continue
			}
			out[s.Key] = v
		default:
			errs = append(errs, fmt.Sprintf("output %q: unknown source %q", s.Key, s.Source))
		}
	}
	return out, errs
}

// finalizeMetadata is the single entry point executeWithRetries calls after a
// successful job execution. It runs the two-stage extraction (sentinel then
// optional LLM eval fallback) and applies passthrough enforcement.
//
// Behavior matrix:
//   - len(specs) == 0  -> permissive back-compat: return produced verbatim
//     (or {} if nothing was extracted). No errors.
//   - len(specs) >  0  -> strict: applyPassthrough governs the final map;
//     errors are returned for the caller to mark the run failed.
//
// The fallback (`evalFallback`) is invoked only when there is NO sentinel
// block AND the caller passed a non-nil callable (caller decides whether the
// job qualifies — typically Claude jobs with a non-empty MetadataPrompt).
// When the fallback errors or returns nil, produced stays nil and the strict
// branch below will surface "missing" errors for any declared produced keys.
func finalizeMetadata(
	specs []entity.JobOutputSpec,
	fullOutput string,
	inbound map[string]any,
	evalFallback func() (map[string]any, error),
) (map[string]any, []string) {
	produced, found := extractSentinelOutputs(fullOutput)
	if !found && evalFallback != nil {
		if fb, err := evalFallback(); err == nil && fb != nil {
			produced = fb
		}
	}

	if len(specs) == 0 {
		// Back-compat permissive path: when no schema declared, expose
		// whatever was produced (possibly nil -> {}) and skip validation.
		if produced == nil {
			return map[string]any{}, nil
		}
		return produced, nil
	}

	return applyPassthrough(specs, produced, inbound)
}

// joinExtractionErrs renders a slice of extraction errors as a stable,
// deterministic single-line string for run.ValidationError / run.ErrorMessage.
// Sorted alphabetically so log diffs are stable.
func joinExtractionErrs(errs []string) string {
	if len(errs) == 0 {
		return ""
	}
	sorted := append([]string(nil), errs...)
	sort.Strings(sorted)
	return strings.Join(sorted, "; ")
}
