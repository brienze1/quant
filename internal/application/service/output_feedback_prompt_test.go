package service

import (
	"strings"
	"testing"

	"quant/internal/domain/entity"
)

// TestBuildClaudePromptOutputFeedback covers issue #50's self-correction loop:
// when a Claude job's previous attempt failed output-contract validation, the
// next attempt's prompt must carry the exact errors plus an explicit instruction
// to re-emit a valid <quant-output> block. When there is no feedback, that
// section must be absent so normal runs aren't polluted.
func TestBuildClaudePromptOutputFeedback(t *testing.T) {
	s := &jobManagerService{} // zero value: no trigger context, no deps touched
	job := &entity.Job{Prompt: "do the thing", TimeoutSeconds: 600}
	run := &entity.JobRun{ID: "run-1"}

	const feedback = `produced output "prUrl" missing from job result`

	t.Run("feedback present on retry", func(t *testing.T) {
		got := s.buildClaudePrompt(job, run, 2, "raw previous output", feedback)
		for _, want := range []string{
			"Output contract not satisfied on the previous attempt",
			feedback,
			"<quant-output>",
		} {
			if !strings.Contains(got, want) {
				t.Errorf("prompt missing %q\n---\n%s", want, got)
			}
		}
	})

	t.Run("no feedback section on a clean first attempt", func(t *testing.T) {
		got := s.buildClaudePrompt(job, run, 1, "", "")
		if strings.Contains(got, "Output contract not satisfied") {
			t.Errorf("unexpected feedback section in clean prompt\n---\n%s", got)
		}
	})
}
