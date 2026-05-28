package e2e

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"quant/internal/domain/entity"
)

const pollTimeout = 30 * time.Second

// in is a tiny constructor for an input spec.
func in(key, typ string, required bool) entity.JobInputSpec {
	return entity.JobInputSpec{Key: key, Type: typ, Required: required}
}

// outP / outT build produced / passthrough output specs.
func outP(key, typ string) entity.JobOutputSpec {
	return entity.JobOutputSpec{Key: key, Type: typ, Source: "produced"}
}
func outT(key, typ string) entity.JobOutputSpec {
	return entity.JobOutputSpec{Key: key, Type: typ, Source: "passthrough"}
}

// createBash creates a bash job and returns its id.
func (h *harness) createBash(t *testing.T, name, script string, inputs []entity.JobInputSpec, outputs []entity.JobOutputSpec) string {
	t.Helper()
	args := map[string]any{
		"name":           name,
		"type":           "bash",
		"workspaceId":    h.wsID,
		"interpreter":    "/bin/bash",
		"scriptContent":  script,
		"timeoutSeconds": 60,
	}
	if inputs != nil {
		args["inputs"] = specJSON(t, inputs)
	}
	if outputs != nil {
		args["outputs"] = specJSON(t, outputs)
	}
	job := h.call("create_job", args)
	id, _ := job["id"].(string)
	if id == "" {
		t.Fatalf("create_job %s returned no id: %v", name, job)
	}
	return id
}

// TestScenario1_TypedContractBashChain validates the deterministic A->B->C
// typed-metadata chain: last-block-wins, passthrough integrity (no HACKED),
// type preservation, and correlation propagation.
func TestScenario1_TypedContractBashChain(t *testing.T) {
	h := newHarness(t)

	markerPath := filepath.Join(t.TempDir(), "triage-marker-s1")

	// Job A: echoes chatter + a DECOY block, then the REAL final block.
	// The decoy sets prUrl to a wrong value; the last block must win.
	scriptA := `echo "human chatter line one"
echo '<quant-output>{"prUrl":"https://decoy/DECOY","filesChanged":0,"labels":[],"analysis":{}}</quant-output>'
echo "more chatter"
echo '<quant-output>{"prUrl":"https://github.com/x/y/pull/42","filesChanged":7,"labels":["bug","urgent"],"analysis":{"risk":"low","score":3}}</quant-output>'`
	aID := h.createBash(t, "s1-job-A", scriptA,
		[]entity.JobInputSpec{in("linearId", "string", true), in("priority", "number", true), in("dryRun", "boolean", true)},
		[]entity.JobOutputSpec{outP("prUrl", "string"), outP("filesChanged", "number"), outP("labels", "array"), outP("analysis", "object"),
			outT("linearId", "string"), outT("priority", "number"), outT("dryRun", "boolean")})

	// Job B: tries to HACK linearId (must be dropped by passthrough), produces
	// reviewBucket + deployTarget.
	scriptB := `echo '<quant-output>{"linearId":"HACKED","reviewBucket":"fast-track","deployTarget":"staging"}</quant-output>'`
	bID := h.createBash(t, "s1-job-B", scriptB,
		[]entity.JobInputSpec{in("linearId", "string", true), in("priority", "number", true), in("dryRun", "boolean", true),
			in("prUrl", "string", true), in("filesChanged", "number", true), in("labels", "array", true), in("analysis", "object", true)},
		[]entity.JobOutputSpec{outP("reviewBucket", "string"), outP("deployTarget", "string"),
			outT("linearId", "string"), outT("priority", "number"), outT("dryRun", "boolean"), outT("prUrl", "string"), outT("analysis", "object")})

	// Job C: terminal node, produces finalStatus.
	scriptC := `echo '<quant-output>{"finalStatus":"complete"}</quant-output>'`
	cID := h.createBash(t, "s1-job-C", scriptC,
		[]entity.JobInputSpec{in("linearId", "string", true), in("reviewBucket", "string", true), in("deployTarget", "string", true),
			in("prUrl", "string", true), in("analysis", "object", true)},
		[]entity.JobOutputSpec{outP("finalStatus", "string"), outT("linearId", "string"), outT("prUrl", "string")})

	// Job T: triage marker (onFailure target for A).
	scriptT := `echo "triage" > "` + markerPath + `"`
	tID := h.createBash(t, "s1-job-T", scriptT, nil, nil)

	// Wire triggers: A.onSuccess=[B], A.onFailure=[T], B.onSuccess=[C].
	h.call("update_job", map[string]any{"id": aID, "onSuccess": jsonStr(t, []string{bID}), "onFailure": jsonStr(t, []string{tID})})
	h.call("update_job", map[string]any{"id": bID, "onSuccess": jsonStr(t, []string{cID})})

	// Run A with valid typed inputs.
	rootRun := h.call("run_job", map[string]any{"id": aID, "inputs": jsonStr(t, map[string]any{
		"linearId": "MAX-1234", "priority": 3, "dryRun": true})})
	rootRunID, _ := rootRun["id"].(string)
	correlationID, _ := rootRun["correlationId"].(string)
	if rootRunID == "" || correlationID == "" {
		t.Fatalf("run_job A missing id/correlationId: %v", rootRun)
	}

	// Wait for A, then C (terminal) to complete via the cascade.
	h.pollRunTerminal(rootRunID, pollTimeout)
	h.pollCorrelationJob(correlationID, cID, pollTimeout)

	// Gather full run objects for each job under the correlation.
	corr := h.call("list_runs_by_correlation", map[string]any{"correlationId": correlationID})
	runs, _ := corr["runs"].([]any)
	byJob := map[string]string{} // jobID -> runID
	for _, r := range runs {
		rm, _ := r.(map[string]any)
		if rm == nil {
			continue
		}
		jid, _ := rm["jobId"].(string)
		rid, _ := rm["id"].(string)
		// All runs must share the correlation id.
		if cid, _ := rm["correlationId"].(string); cid != correlationID {
			t.Errorf("run %s has correlationId %q, expected %q", rid, cid, correlationID)
		}
		byJob[jid] = rid
	}

	for _, jid := range []string{aID, bID, cID} {
		if byJob[jid] == "" {
			t.Fatalf("no run found for job %s under correlation", jid)
		}
	}

	aRun := h.call("get_run", map[string]any{"runId": byJob[aID]})
	bRun := h.call("get_run", map[string]any{"runId": byJob[bID]})
	cRun := h.call("get_run", map[string]any{"runId": byJob[cID]})

	// All three succeeded.
	for name, run := range map[string]map[string]any{"A": aRun, "B": bRun, "C": cRun} {
		if run["status"] != "success" {
			t.Errorf("job %s expected status success, got %v (validationError=%v)", name, run["status"], run["validationError"])
		}
	}

	aMeta, _ := aRun["metadata"].(map[string]any)
	bMeta, _ := bRun["metadata"].(map[string]any)
	cMeta, _ := cRun["metadata"].(map[string]any)

	// Last-block-wins: A's prUrl is the REAL block, not the decoy.
	if aMeta["prUrl"] != "https://github.com/x/y/pull/42" {
		t.Errorf("A last-block-wins failed: prUrl=%v (decoy leaked?)", aMeta["prUrl"])
	}
	// Type preservation in A.
	if _, ok := aMeta["analysis"].(map[string]any); !ok {
		t.Errorf("A analysis should be object, got %T (%v)", aMeta["analysis"], aMeta["analysis"])
	}
	if _, ok := aMeta["labels"].([]any); !ok {
		t.Errorf("A labels should be array, got %T (%v)", aMeta["labels"], aMeta["labels"])
	}
	if _, ok := aMeta["priority"].(float64); !ok {
		t.Errorf("A priority should be number, got %T (%v)", aMeta["priority"], aMeta["priority"])
	}
	if _, ok := aMeta["dryRun"].(bool); !ok {
		t.Errorf("A dryRun should be bool, got %T (%v)", aMeta["dryRun"], aMeta["dryRun"])
	}

	// Passthrough integrity: B's linearId is the root value, NOT "HACKED".
	if bMeta["linearId"] != "MAX-1234" {
		t.Errorf("B passthrough integrity failed: linearId=%v (expected MAX-1234, HACK should be dropped)", bMeta["linearId"])
	}
	// B carried A's produced prUrl + analysis through passthrough.
	if bMeta["prUrl"] != "https://github.com/x/y/pull/42" {
		t.Errorf("B should carry A's prUrl, got %v", bMeta["prUrl"])
	}
	if bMeta["reviewBucket"] != "fast-track" || bMeta["deployTarget"] != "staging" {
		t.Errorf("B produced outputs wrong: reviewBucket=%v deployTarget=%v", bMeta["reviewBucket"], bMeta["deployTarget"])
	}

	// C's inbound got B-derived reviewBucket/deployTarget AND A's prUrl AND root linearId.
	if cMeta["finalStatus"] != "complete" {
		t.Errorf("C finalStatus wrong: %v", cMeta["finalStatus"])
	}
	if cMeta["linearId"] != "MAX-1234" {
		t.Errorf("C linearId passthrough wrong: %v", cMeta["linearId"])
	}
	if cMeta["prUrl"] != "https://github.com/x/y/pull/42" {
		t.Errorf("C prUrl passthrough wrong: %v", cMeta["prUrl"])
	}

	// Triage marker must NOT exist (A succeeded, onFailure didn't fire).
	if _, err := os.Stat(markerPath); err == nil {
		t.Errorf("triage marker exists but A succeeded — onFailure should not have fired")
	}
}

// TestScenario2_InputGateNegatives validates the pre-run input gate: missing
// required input and wrong-typed input both fail BEFORE execution, and the
// onFailure triage cascade fires on the missing-input case.
func TestScenario2_InputGateNegatives(t *testing.T) {
	h := newHarness(t)

	t.Run("missing_required_input_fires_triage", func(t *testing.T) {
		markerPath := filepath.Join(t.TempDir(), "triage-marker-missing")

		aScript := `echo '<quant-output>{"prUrl":"https://x/y/1"}</quant-output>'`
		aID := h.createBash(t, "s2a-job-A", aScript,
			[]entity.JobInputSpec{in("linearId", "string", true), in("priority", "number", true), in("dryRun", "boolean", true)},
			[]entity.JobOutputSpec{outP("prUrl", "string")})
		tScript := `echo "triage" > "` + markerPath + `"`
		tID := h.createBash(t, "s2a-job-T", tScript, nil, nil)
		h.call("update_job", map[string]any{"id": aID, "onFailure": jsonStr(t, []string{tID})})

		// Missing required linearId.
		run := h.call("run_job", map[string]any{"id": aID, "inputs": jsonStr(t, map[string]any{"priority": 3})})
		runID, _ := run["id"].(string)
		correlationID, _ := run["correlationId"].(string)
		final := h.pollRunTerminal(runID, pollTimeout)

		if final["status"] != "failed" {
			t.Errorf("expected failed, got %v", final["status"])
		}
		ve, _ := final["validationError"].(string)
		if !strings.Contains(ve, "linearId") {
			t.Errorf("validationError should mention linearId, got %q", ve)
		}
		if tok, _ := final["tokensUsed"].(float64); tok != 0 {
			t.Errorf("expected ~0 tokens (no execution), got %v", tok)
		}
		// onFailure triage cascade fired -> marker exists.
		h.pollCorrelationJob(correlationID, tID, pollTimeout)
		if _, err := os.Stat(markerPath); err != nil {
			t.Errorf("triage marker missing — onFailure cascade did not fire: %v", err)
		}
	})

	t.Run("wrong_typed_input_no_execution", func(t *testing.T) {
		// Fresh job; produced block would set a sentinel if it ran. We assert it
		// does NOT run by checking failure + no metadata + type-problem message.
		aID := h.createBash(t, "s2b-job-A", `echo '<quant-output>{"prUrl":"https://x/y/2"}</quant-output>'`,
			[]entity.JobInputSpec{in("linearId", "string", true), in("priority", "number", true), in("dryRun", "boolean", true)},
			[]entity.JobOutputSpec{outP("prUrl", "string")})

		// linearId is a number, not a string -> type mismatch.
		run := h.call("run_job", map[string]any{"id": aID, "inputs": jsonStr(t, map[string]any{
			"linearId": 123, "priority": 3, "dryRun": true})})
		runID, _ := run["id"].(string)
		final := h.pollRunTerminal(runID, pollTimeout)

		if final["status"] != "failed" {
			t.Errorf("expected failed, got %v", final["status"])
		}
		ve, _ := final["validationError"].(string)
		if !strings.Contains(ve, "linearId") || !strings.Contains(ve, "expected") {
			t.Errorf("validationError should indicate a type problem for linearId, got %q", ve)
		}
		// The gate blocked execution before the script ran, so no PRODUCED
		// output exists. (Root-run metadata still holds the seeded inputs — the
		// failed gate never overwrites it with produced outputs.)
		if meta, _ := final["metadata"].(map[string]any); meta["prUrl"] != nil {
			t.Errorf("expected no produced prUrl (gate should block execution), got %v", meta["prUrl"])
		}
	})
}

// TestScenario3_ClaudeSelfCorrection validates the Claude output-contract
// self-correction loop and the fail-closed behavior without retry budget.
func TestScenario3_ClaudeSelfCorrection(t *testing.T) {
	h := newHarness(t)

	t.Run("self_corrects_within_retry_budget", func(t *testing.T) {
		workDir := t.TempDir()
		fake := writeFakeClaude(t, workDir, "selfcorrect", "https://github.com/x/y/pull/99")

		job := h.call("create_job", map[string]any{
			"name":           "s3-job-D",
			"type":           "claude",
			"workspaceId":    h.wsID,
			"prompt":         "produce the pr url",
			"claudeCommand":  fake,
			"workingDirectory": workDir,
			"maxRetries":     1,
			"allowBypass":    true,
			"timeoutSeconds": 60,
			"outputs":        specJSON(t, []entity.JobOutputSpec{outP("prUrl", "string")}),
		})
		dID, _ := job["id"].(string)

		run := h.call("run_job", map[string]any{"id": dID})
		runID, _ := run["id"].(string)
		final := h.pollRunTerminal(runID, pollTimeout)

		if final["status"] != "success" {
			t.Fatalf("expected success after self-correction, got %v (validationError=%v)", final["status"], final["validationError"])
		}
		meta, _ := final["metadata"].(map[string]any)
		if meta["prUrl"] != "https://github.com/x/y/pull/99" {
			t.Errorf("expected corrected prUrl, got %v", meta["prUrl"])
		}

		// Counter shows exactly 2 task invocations (one retry).
		count := readCount(t, workDir)
		if count != 2 {
			t.Errorf("expected 2 fake-claude task invocations, got %d", count)
		}
		// Attempt-2 prompt carried the corrective feedback.
		p2 := filepath.Join(workDir, "attempt-2.prompt")
		data, err := os.ReadFile(p2)
		if err != nil {
			t.Fatalf("read attempt-2 prompt: %v", err)
		}
		if !strings.Contains(string(data), "Output contract not satisfied") {
			t.Errorf("attempt-2 prompt missing corrective feedback section; got:\n%s", string(data))
		}
	})

	t.Run("fails_closed_without_retry_budget", func(t *testing.T) {
		workDir := t.TempDir()
		fake := writeFakeClaude(t, workDir, "alwaysbad", "")

		job := h.call("create_job", map[string]any{
			"name":           "s3-job-E",
			"type":           "claude",
			"workspaceId":    h.wsID,
			"prompt":         "produce the pr url",
			"claudeCommand":  fake,
			"workingDirectory": workDir,
			"maxRetries":     0,
			"allowBypass":    true,
			"timeoutSeconds": 60,
			"outputs":        specJSON(t, []entity.JobOutputSpec{outP("prUrl", "string")}),
		})
		eID, _ := job["id"].(string)

		run := h.call("run_job", map[string]any{"id": eID})
		runID, _ := run["id"].(string)
		final := h.pollRunTerminal(runID, pollTimeout)

		if final["status"] != "failed" {
			t.Fatalf("expected failed, got %v", final["status"])
		}
		ve, _ := final["validationError"].(string)
		if !strings.HasPrefix(ve, "output validation failed") {
			t.Errorf("validationError should start with 'output validation failed', got %q", ve)
		}
		// No self-correction retry without budget: exactly 1 task invocation.
		count := readCount(t, workDir)
		if count != 1 {
			t.Errorf("expected exactly 1 fake-claude task invocation (no retry), got %d", count)
		}
	})
}

func readCount(t *testing.T, workDir string) int {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(workDir, "task_count"))
	if err != nil {
		t.Fatalf("read task_count: %v", err)
	}
	n := 0
	for _, c := range strings.TrimSpace(string(data)) {
		if c < '0' || c > '9' {
			t.Fatalf("non-numeric task_count: %q", string(data))
		}
		n = n*10 + int(c-'0')
	}
	return n
}
