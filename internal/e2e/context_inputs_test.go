package e2e

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"quant/internal/domain/entity"
)

// TestScenario4_RunJobWithContextFeedsGate covers the issue #50 gap that the
// trigger-edge path did not: a job entered OUTSIDE a real trigger edge — via
// run_job_with_context (orchestrator kickoff, retry, self-heal re-fire) — can
// now satisfy `required` inputs by passing the structured `inputs` arg.
//
//   - The freeform `context` arg is PROMPT-ONLY (env QUANT_TRIGGER_CONTEXT for
//     bash). It never reaches the validation gate, so context alone leaves a
//     required job failing the gate before it executes.
//   - The new `inputs` arg pre-seeds the root run's metadata (the "inbound" the
//     gate validates), so the same job passes — and both can be supplied at
//     once: the agent gets human-readable context AND the contract is met.
func TestScenario4_RunJobWithContextFeedsGate(t *testing.T) {
	h := newHarness(t)

	// A job that declares a required input (linearId) and passes it through,
	// plus a produced output. Its script records the injected context to a
	// marker file so we can prove (a) context injection still works and
	// (b) the gate blocked execution when it should have (no marker).
	makeJob := func(name, marker string) string {
		script := `echo "ctx=$QUANT_TRIGGER_CONTEXT" > "` + marker + `"
echo '<quant-output>{"prUrl":"https://github.com/x/y/pull/7"}</quant-output>'`
		return h.createBash(t, name, script,
			[]entity.JobInputSpec{in("linearId", "string", true)},
			[]entity.JobOutputSpec{outP("prUrl", "string"), outT("linearId", "string")})
	}

	t.Run("context_only_fails_gate", func(t *testing.T) {
		marker := filepath.Join(t.TempDir(), "ctx-only-marker")
		jID := makeJob("s4a-job", marker)

		// Prompt context but NO structured inputs: the gate must fail before
		// the script runs (this is the pre-fix behavior the orchestrator hit).
		run := h.call("run_job_with_context", map[string]any{
			"id":      jID,
			"context": "TASK_IDENTIFIER=MAX-99\nNOTE=kickoff",
		})
		runID, _ := run["id"].(string)
		final := h.pollRunTerminal(runID, pollTimeout)

		if final["status"] != "failed" {
			t.Errorf("expected failed (gate), got %v", final["status"])
		}
		ve, _ := final["validationError"].(string)
		if !strings.Contains(ve, "linearId") {
			t.Errorf("validationError should mention linearId, got %q", ve)
		}
		// Gate blocked execution before the script ran -> no marker written.
		if _, err := os.Stat(marker); err == nil {
			t.Errorf("marker exists but the gate should have blocked execution")
		}
	})

	t.Run("inputs_feed_gate_and_context_still_injected", func(t *testing.T) {
		marker := filepath.Join(t.TempDir(), "both-marker")
		jID := makeJob("s4b-job", marker)

		ctxStr := "TASK_IDENTIFIER=MAX-99\nNOTE=kickoff"
		run := h.call("run_job_with_context", map[string]any{
			"id":      jID,
			"context": ctxStr,
			"inputs":  jsonStr(t, map[string]any{"linearId": "MAX-99"}),
		})
		runID, _ := run["id"].(string)
		final := h.pollRunTerminal(runID, pollTimeout)

		if final["status"] != "success" {
			t.Fatalf("expected success, got %v (validationError=%v)", final["status"], final["validationError"])
		}
		meta, _ := final["metadata"].(map[string]any)
		// Produced output proves the script ran (gate passed).
		if meta["prUrl"] != "https://github.com/x/y/pull/7" {
			t.Errorf("expected produced prUrl, got %v", meta["prUrl"])
		}
		// linearId passthrough proves the `inputs` arg became inbound metadata
		// the gate validated and carried forward — not just prompt text.
		if meta["linearId"] != "MAX-99" {
			t.Errorf("expected linearId passthrough from inputs, got %v", meta["linearId"])
		}
		// And the freeform context was still injected (bash env path).
		data, err := os.ReadFile(marker)
		if err != nil {
			t.Fatalf("read context marker: %v", err)
		}
		if !strings.Contains(string(data), "TASK_IDENTIFIER=MAX-99") {
			t.Errorf("injected context missing from QUANT_TRIGGER_CONTEXT; got %q", string(data))
		}
	})

	t.Run("invalid_inputs_json_is_rejected", func(t *testing.T) {
		jID := makeJob("s4c-job", filepath.Join(t.TempDir(), "noop-marker"))
		errText := h.callExpectError("run_job_with_context", map[string]any{
			"id":      jID,
			"context": "x",
			"inputs":  "{not valid json",
		})
		if !strings.Contains(errText, "invalid inputs JSON") {
			t.Errorf("expected 'invalid inputs JSON' error, got %q", errText)
		}
	})
}
