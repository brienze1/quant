// Package service contains application service implementations with business logic.
package service

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
	"quant/internal/domain/enums/jobrunstatus"
	"quant/internal/domain/enums/jobtype"
)

// jobManagerService implements the adapter.JobManager interface.
type jobManagerService struct {
	findJob        usecase.FindJob
	saveJob        usecase.SaveJob
	updateJob      usecase.UpdateJob
	deleteJob      usecase.DeleteJob
	findJobTrigger usecase.FindJobTrigger
	saveJobTrigger usecase.SaveJobTrigger
	findJobRun     usecase.FindJobRun
	saveJobRun     usecase.SaveJobRun
	findAgent      usecase.FindAgent

	mu           sync.RWMutex
	runningProcs map[string]*os.Process // runID -> process
	triggerCtx   map[string]string      // runID -> trigger context for prompt injection
}

// NewJobManagerService creates a new JobManager service.
func NewJobManagerService(
	findJob usecase.FindJob,
	saveJob usecase.SaveJob,
	updateJob usecase.UpdateJob,
	deleteJob usecase.DeleteJob,
	findJobTrigger usecase.FindJobTrigger,
	saveJobTrigger usecase.SaveJobTrigger,
	findJobRun usecase.FindJobRun,
	saveJobRun usecase.SaveJobRun,
	findAgent usecase.FindAgent,
) adapter.JobManager {
	return &jobManagerService{
		findJob:        findJob,
		saveJob:        saveJob,
		updateJob:      updateJob,
		deleteJob:      deleteJob,
		findJobTrigger: findJobTrigger,
		saveJobTrigger: saveJobTrigger,
		findJobRun:     findJobRun,
		saveJobRun:     saveJobRun,
		findAgent:      findAgent,
		runningProcs:   make(map[string]*os.Process),
		triggerCtx:     make(map[string]string),
	}
}

// CreateJob creates a new job with optional trigger chains.
func (s *jobManagerService) CreateJob(job entity.Job, onSuccess []string, onFailure []string) (*entity.Job, error) {
	now := time.Now()
	job.ID = uuid.New().String()
	job.CreatedAt = now
	job.UpdatedAt = now

	err := s.saveJob.SaveJob(job)
	if err != nil {
		return nil, fmt.Errorf("failed to save job: %w", err)
	}

	err = s.createTriggers(job.ID, onSuccess, onFailure)
	if err != nil {
		return nil, fmt.Errorf("failed to create triggers: %w", err)
	}

	return &job, nil
}

// UpdateJob updates an existing job and replaces its trigger chains.
func (s *jobManagerService) UpdateJob(job entity.Job, onSuccess []string, onFailure []string) (*entity.Job, error) {
	existing, err := s.findJob.FindJobByID(job.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to find job: %w", err)
	}

	if existing == nil {
		return nil, fmt.Errorf("job not found: %s", job.ID)
	}

	job.UpdatedAt = time.Now()

	err = s.updateJob.UpdateJob(job)
	if err != nil {
		return nil, fmt.Errorf("failed to update job: %w", err)
	}

	// Delete existing triggers and re-create them.
	err = s.saveJobTrigger.DeleteTriggersBySourceJobID(job.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to delete existing triggers: %w", err)
	}

	err = s.createTriggers(job.ID, onSuccess, onFailure)
	if err != nil {
		return nil, fmt.Errorf("failed to create triggers: %w", err)
	}

	return &job, nil
}

// DeleteJob removes a job by ID.
func (s *jobManagerService) DeleteJob(id string) error {
	job, err := s.findJob.FindJobByID(id)
	if err != nil {
		return fmt.Errorf("failed to find job: %w", err)
	}

	if job == nil {
		return fmt.Errorf("job not found: %s", id)
	}

	// Delete triggers where this job is the source.
	err = s.saveJobTrigger.DeleteTriggersBySourceJobID(id)
	if err != nil {
		return fmt.Errorf("failed to delete triggers: %w", err)
	}

	err = s.deleteJob.DeleteJob(id)
	if err != nil {
		return fmt.Errorf("failed to delete job: %w", err)
	}

	return nil
}

// GetJob returns a job by ID.
func (s *jobManagerService) GetJob(id string) (*entity.Job, error) {
	job, err := s.findJob.FindJobByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get job: %w", err)
	}

	if job == nil {
		return nil, fmt.Errorf("job not found: %s", id)
	}

	return job, nil
}

// ListJobs returns all jobs.
func (s *jobManagerService) ListJobs() ([]entity.Job, error) {
	jobs, err := s.findJob.FindAllJobs()
	if err != nil {
		return nil, fmt.Errorf("failed to list jobs: %w", err)
	}

	return jobs, nil
}

// GetTriggersForJob returns triggers organized by relationship and outcome.
func (s *jobManagerService) GetTriggersForJob(jobID string) (onSuccess []entity.JobTrigger, onFailure []entity.JobTrigger, triggeredBy []entity.JobTrigger, err error) {
	// Find triggers where this job is the source (this job triggers others).
	sourceTriggers, err := s.findJobTrigger.FindTriggersBySourceJobID(jobID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to find source triggers: %w", err)
	}

	for _, t := range sourceTriggers {
		switch t.TriggerOn {
		case "success":
			onSuccess = append(onSuccess, t)
		case "failure":
			onFailure = append(onFailure, t)
		}
	}

	// Find triggers where this job is the target (other jobs trigger this one).
	triggeredBy, err = s.findJobTrigger.FindTriggersByTargetJobID(jobID)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to find target triggers: %w", err)
	}

	return onSuccess, onFailure, triggeredBy, nil
}

// RunJob starts a new run for a job. Supports retries with history for Claude jobs.
func (s *jobManagerService) RunJob(jobID string, triggeredByRunID string, correlationID ...string) (*entity.JobRun, error) {
	job, err := s.findJob.FindJobByID(jobID)
	if err != nil {
		return nil, fmt.Errorf("failed to find job: %w", err)
	}
	if job == nil {
		return nil, fmt.Errorf("job not found: %s", jobID)
	}

	now := time.Now()
	run := entity.JobRun{
		ID:          uuid.New().String(),
		JobID:       jobID,
		Status:      jobrunstatus.Running,
		TriggeredBy: triggeredByRunID,
		StartedAt:   now,
	}

	if len(correlationID) > 0 && correlationID[0] != "" {
		run.CorrelationID = correlationID[0]
	} else if triggeredByRunID == "" {
		run.CorrelationID = uuid.New().String()
	}

	if err := s.saveJobRun.SaveJobRun(run); err != nil {
		return nil, fmt.Errorf("failed to save run: %w", err)
	}

	// Update last run timestamp on the job
	job.LastRunAt = &now
	_ = s.updateJob.UpdateJob(*job)

	// Execute asynchronously
	go s.executeWithRetries(job, &run)

	return &run, nil
}

// RunJobWithContext starts a new run for a job, injecting arbitrary context into its prompt.
// The context string is prepended to the job's prompt in the same format as trigger context,
// so existing jobs that parse TASK_IDENTIFIER= etc. work without modification.
func (s *jobManagerService) RunJobWithContext(jobID string, context string) (*entity.JobRun, error) {
	run, err := s.RunJob(jobID, "")
	if err != nil {
		return nil, err
	}

	if context != "" {
		s.mu.Lock()
		s.triggerCtx[run.ID] = context
		s.mu.Unlock()
	}

	return run, nil
}

// RerunJob creates a new run for a job, preserving the trigger context from a previous run.
// It looks up the original run's triggeredBy parent and rebuilds the same context injection.
func (s *jobManagerService) RerunJob(jobID string, originalRunID string) (*entity.JobRun, error) {
	// Look up the original run to get its triggeredBy and CorrelationID
	originalRun, err := s.findJobRun.FindJobRunByID(originalRunID)
	if err != nil || originalRun == nil {
		// Fallback: run without trigger context
		return s.RunJob(jobID, "")
	}

	cid := originalRun.CorrelationID

	parentRunID := originalRun.TriggeredBy
	if parentRunID == "" {
		// Original was manual, just run fresh
		return s.RunJob(jobID, "", cid)
	}

	// Rebuild trigger context from the parent run
	parentRun, err := s.findJobRun.FindJobRunByID(parentRunID)
	if err != nil || parentRun == nil {
		return s.RunJob(jobID, "")
	}

	parentJob, _ := s.findJob.FindJobByID(parentRun.JobID)
	parentJobName := parentRun.JobID
	if parentJob != nil {
		parentJobName = parentJob.Name
	}

	sourceOutput := parentRun.Result
	metadataSection := ""
	if idx := strings.Index(sourceOutput, "\n\n--- metadata ---\n"); idx >= 0 {
		metadataSection = sourceOutput[idx+len("\n\n--- metadata ---\n"):]
		sourceOutput = sourceOutput[:idx]
	}
	if len(sourceOutput) > 3000 {
		sourceOutput = sourceOutput[len(sourceOutput)-3000:]
	}

	triggerOn := "success"
	if parentRun.Status == jobrunstatus.Failed {
		triggerOn = "failure"
	}

	var ctx string
	if metadataSection != "" {
		ctx = fmt.Sprintf(
			"## Trigger context\n"+
				"This job was triggered by the %s of job \"%s\" (run: %s).\n"+
				"\n### Structured metadata from \"%s\":\n```json\n%s\n```\n",
			triggerOn, parentJobName, parentRun.ID, parentJobName, metadataSection,
		)
	} else {
		ctx = fmt.Sprintf(
			"## Trigger context\n"+
				"This job was triggered by the %s of job \"%s\" (run: %s).\n"+
				"\n### Output from \"%s\":\n```\n%s\n```\n",
			triggerOn, parentJobName, parentRun.ID, parentJobName, sourceOutput,
		)
	}

	newRun, err := s.RunJob(jobID, parentRunID, cid)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.triggerCtx[newRun.ID] = ctx
	s.mu.Unlock()

	return newRun, nil
}

// ResumeJob creates a new run for a job that was in "waiting" status, injecting resolution context.
func (s *jobManagerService) ResumeJob(runID string, extraContext string) (*entity.JobRun, error) {
	// Look up the specific waiting run
	waitingRun, err := s.findJobRun.FindJobRunByID(runID)
	if err != nil {
		return nil, fmt.Errorf("failed to find run: %w", err)
	}
	if waitingRun == nil {
		return nil, fmt.Errorf("run not found: %s", runID)
	}
	if waitingRun.Status != jobrunstatus.Waiting {
		return nil, fmt.Errorf("run %s is not in waiting status (current: %s)", runID, waitingRun.Status)
	}

	job, err := s.findJob.FindJobByID(waitingRun.JobID)
	if err != nil {
		return nil, fmt.Errorf("failed to find job: %w", err)
	}
	if job == nil {
		return nil, fmt.Errorf("job not found: %s", waitingRun.JobID)
	}

	now := time.Now()
	run := entity.JobRun{
		ID:            uuid.New().String(),
		JobID:         waitingRun.JobID,
		Status:        jobrunstatus.Running,
		CorrelationID: waitingRun.CorrelationID,
		StartedAt:     now,
	}

	if err := s.saveJobRun.SaveJobRun(run); err != nil {
		return nil, fmt.Errorf("failed to save run: %w", err)
	}

	job.LastRunAt = &now
	_ = s.updateJob.UpdateJob(*job)

	if extraContext != "" {
		s.mu.Lock()
		s.triggerCtx[run.ID] = fmt.Sprintf(
			"## Resume context\n"+
				"This job is being resumed after human intervention.\n\n"+
				"%s\n", extraContext)
		s.mu.Unlock()
	}

	go s.executeWithRetries(job, &run)

	return &run, nil
}

// AdvancePipeline handles all pipeline advancement from a waiting run.
// - No targetJobID: mark waiting run as success, fire natural triggers (flow B)
// - targetJobID set: mark waiting run as resolved, run target job with same correlationID (flows C/D)
// - extraContext: injected into the downstream/target run's prompt
func (s *jobManagerService) AdvancePipeline(runID string, targetJobID string, extraContext string) (*entity.JobRun, error) {
	run, err := s.findJobRun.FindJobRunByID(runID)
	if err != nil {
		return nil, fmt.Errorf("failed to find run: %w", err)
	}
	if run == nil {
		return nil, fmt.Errorf("run not found: %s", runID)
	}
	if run.Status != jobrunstatus.Waiting {
		return nil, fmt.Errorf("run %s is not in waiting status (current: %s)", runID, run.Status)
	}

	now := time.Now()

	if targetJobID == "" {
		// Flow B: continue to natural next step via triggers
		run.Status = jobrunstatus.Success
		run.FinishedAt = &now
		run.ErrorMessage = ""
		if err := s.saveJobRun.UpdateJobRun(*run); err != nil {
			return nil, fmt.Errorf("failed to update run: %w", err)
		}

		if extraContext != "" {
			s.mu.Lock()
			s.triggerCtx["continue:"+run.ID] = extraContext
			s.mu.Unlock()
		}

		s.fireTriggers(run.JobID, run)
		return run, nil
	}

	// Flow C/D: advance to a specific job — mark as success since user approved
	run.Status = jobrunstatus.Success
	run.FinishedAt = &now
	run.ErrorMessage = "resolved: pipeline advanced to " + targetJobID
	if err := s.saveJobRun.UpdateJobRun(*run); err != nil {
		return nil, fmt.Errorf("failed to update run: %w", err)
	}

	newRun, err := s.RunJob(targetJobID, "", run.CorrelationID)
	if err != nil {
		return nil, err
	}

	if extraContext != "" {
		s.mu.Lock()
		s.triggerCtx[newRun.ID] = fmt.Sprintf(
			"## Pipeline advance context\n"+
				"This job was started after human intervention on a waiting pipeline.\n\n"+
				"%s\n", extraContext)
		s.mu.Unlock()
	}

	return newRun, nil
}

// ListRunsByCorrelation returns all runs sharing a correlation ID.
func (s *jobManagerService) ListRunsByCorrelation(correlationID string) ([]entity.JobRun, error) {
	return s.findJobRun.FindJobRunsByCorrelationID(correlationID)
}

// executeWithRetries runs the job, retrying on failure up to MaxRetries.
// For Claude jobs, each retry includes the previous attempt's output so Claude can pick up.
func (s *jobManagerService) executeWithRetries(job *entity.Job, run *entity.JobRun) {
	maxAttempts := job.MaxRetries + 1
	if maxAttempts < 1 {
		maxAttempts = 1
	}

	var lastOutput string
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		// Write attempt header to log file (the execution itself streams output there)
		if attempt > 1 {
			s.writeRunLog(run.ID, "", attempt)
		}

		start := time.Now()
		var result string
		var execErr error

		switch job.Type {
		case jobtype.Claude:
			result, execErr = s.executeClaudeJob(job, run, attempt, lastOutput)
		case jobtype.Bash:
			result, execErr = s.executeBashJob(job, run)
		default:
			execErr = fmt.Errorf("unknown job type: %s", job.Type)
		}

		duration := time.Since(start)
		run.DurationMs += duration.Milliseconds()

		if execErr != nil {
			// Check if the run was cancelled while executing
			currentRun, _ := s.findJobRun.FindJobRunByID(run.ID)
			if currentRun != nil && currentRun.Status == jobrunstatus.Cancelled {
				// Already cancelled — don't overwrite status, don't retry
				return
			}

			// Timeout — don't retry, fail immediately
			if strings.Contains(execErr.Error(), "timed out") {
				now := time.Now()
				run.Status = jobrunstatus.Failed
				run.ErrorMessage = execErr.Error()
				run.Result = result
				run.FinishedAt = &now
				_ = s.saveJobRun.UpdateJobRun(*run)
				s.fireTriggers(job.ID, run)
				return
			}

			// Execution error (crash, non-zero exit) — retry
			lastOutput = result
			lastErr = execErr
			if attempt < maxAttempts {
				time.Sleep(3 * time.Second)
			}
			continue
		}

		// Execution completed — run evaluation to determine success/failure + extract metadata
		if job.Type == jobtype.Claude {
			eval, evalErr := s.evaluateJobResult(job, result, run)
			if evalErr != nil {
				// Evaluation failed — treat as success with raw result
				eval = &jobEvaluation{Result: "success", Metadata: map[string]interface{}{}}
			}

			now := time.Now()
			run.Result = result
			run.FinishedAt = &now

			// Handle waiting status — no retry, NO triggers (pipeline pauses here)
			if eval.Result == "waiting" {
				run.Status = jobrunstatus.Waiting
				// Extract reason from metadata if available
				reason := "waiting for human intervention"
				if r, ok := eval.Metadata["reason"].(string); ok && r != "" {
					reason = r
				} else if r, ok := eval.Metadata["summary"].(string); ok && r != "" {
					reason = r
				} else if r, ok := eval.Metadata["message"].(string); ok && r != "" {
					reason = r
				}
				run.ErrorMessage = reason
				if metaJSON, err := json.Marshal(eval.Metadata); err == nil {
					run.Result = result + "\n\n--- metadata ---\n" + string(metaJSON)
				}
				_ = s.saveJobRun.UpdateJobRun(*run)
				return
			}

			if eval.Result == "failure" {
				run.Status = jobrunstatus.Failed
				run.ErrorMessage = "task evaluated as failure"
				// On failure, retry if attempts remain
				if attempt < maxAttempts {
					lastOutput = result
					lastErr = fmt.Errorf("task evaluated as failure")
					time.Sleep(3 * time.Second)
					continue
				}
			} else {
				run.Status = jobrunstatus.Success
			}

			// Store metadata as JSON in the result for triggered jobs to use
			if metaJSON, err := json.Marshal(eval.Metadata); err == nil {
				run.Result = result + "\n\n--- metadata ---\n" + string(metaJSON)
			}

			_ = s.saveJobRun.UpdateJobRun(*run)
			s.fireTriggers(job.ID, run)
			return
		}

		// Bash jobs — no evaluation, just success
		now := time.Now()
		run.Status = jobrunstatus.Success
		run.Result = result
		run.FinishedAt = &now
		_ = s.saveJobRun.UpdateJobRun(*run)
		s.fireTriggers(job.ID, run)
		return
	}

	// All attempts exhausted — check if cancelled before setting failed
	currentRun, _ := s.findJobRun.FindJobRunByID(run.ID)
	if currentRun != nil && currentRun.Status == jobrunstatus.Cancelled {
		return
	}

	now := time.Now()
	run.Status = jobrunstatus.Failed
	run.ErrorMessage = lastErr.Error()
	run.Result = lastOutput
	run.FinishedAt = &now
	_ = s.saveJobRun.UpdateJobRun(*run)
	s.fireTriggers(job.ID, run)
}

// buildClaudePrompt wraps the user's prompt with autonomous job instructions.
// On retries, includes the previous attempt's output for continuity.
// When triggered by another job, includes the trigger context (source job name, outcome, output).
func (s *jobManagerService) buildClaudePrompt(job *entity.Job, run *entity.JobRun, attempt int, previousOutput string) string {
	timeout := job.TimeoutSeconds
	if timeout <= 0 {
		timeout = 1800
	}

	var sb strings.Builder

	sb.WriteString("You are executing an autonomous job. No user is available to respond.\n")
	sb.WriteString(fmt.Sprintf("This task will timeout in %d minutes.\n", timeout/60))
	sb.WriteString("Complete the task fully without stopping for confirmation.\n")
	sb.WriteString("Do not ask questions — make reasonable decisions and proceed.\n")

	// Include trigger context if this job was triggered by another
	s.mu.RLock()
	ctx, hasTriggerCtx := s.triggerCtx[run.ID]
	s.mu.RUnlock()
	if hasTriggerCtx {
		sb.WriteString("\n")
		sb.WriteString(ctx)
		// Persist injected context on the run for UI visibility
		run.InjectedContext = ctx
		_ = s.saveJobRun.UpdateJobRun(*run)
		// Clean up after use
		s.mu.Lock()
		delete(s.triggerCtx, run.ID)
		s.mu.Unlock()
	}

	if attempt > 1 && previousOutput != "" {
		sb.WriteString(fmt.Sprintf("\n## Previous attempt (%d) failed. Here is its output:\n", attempt-1))
		sb.WriteString("```\n")
		if len(previousOutput) > 4000 {
			sb.WriteString("... (truncated) ...\n")
			sb.WriteString(previousOutput[len(previousOutput)-4000:])
		} else {
			sb.WriteString(previousOutput)
		}
		sb.WriteString("\n```\n")
		sb.WriteString("Continue from where the previous attempt left off.\n")
	}

	sb.WriteString("\n## Task\n")
	sb.WriteString(job.Prompt)

	return sb.String()
}

// executeClaudeJob runs Claude CLI with -p flag (non-interactive, exits when done).
// Exit code 0 = success, non-zero = failure. All output captured.
// The prompt is passed via stdin to avoid shell quoting issues with multi-line text.
func (s *jobManagerService) executeClaudeJob(job *entity.Job, run *entity.JobRun, attempt int, previousOutput string) (string, error) {
	prompt := s.buildClaudePrompt(job, run, attempt, previousOutput)

	claudeCmd := job.ClaudeCommand
	if claudeCmd == "" {
		claudeCmd = "claude"
	}

	// Build CLI args — use stream-json for both live output AND token data
	var cliArgs []string
	cliArgs = append(cliArgs, "-p", "-")
	cliArgs = append(cliArgs, "--output-format", "stream-json", "--verbose")
	if job.AllowBypass {
		cliArgs = append(cliArgs, "--dangerously-skip-permissions")
	}
	if job.Model != "" && job.Model != "cli default" {
		cliArgs = append(cliArgs, "--model", job.Model)
	}

	// If job has an agent, build system prompt and pass via env var to avoid shell escaping issues.
	// The --system-prompt flag references $QUANT_AGENT_SYSTEM_PROMPT which preserves newlines.
	var agentSystemPrompt string
	if job.AgentID != "" && s.findAgent != nil {
		agent, agentErr := s.findAgent.FindAgentByID(job.AgentID)
		if agentErr == nil && agent != nil {
			agentSystemPrompt = buildAgentSystemPrompt(agent)
			if agentSystemPrompt != "" {
				cliArgs = append(cliArgs, "--system-prompt", "$QUANT_AGENT_SYSTEM_PROMPT")
			}
			// Use agent's model as fallback if job doesn't specify one
			if (job.Model == "" || job.Model == "cli default") && agent.Model != "" && agent.Model != "cli default" {
				cliArgs = append(cliArgs, "--model", agent.Model)
			}
		}
	}

	dir := expandPath(job.WorkingDirectory)

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	parts := make([]string, 0, len(cliArgs)+1)
	parts = append(parts, claudeCmd)
	for _, a := range cliArgs {
		if a == "-" {
			parts = append(parts, a)
		} else {
			parts = append(parts, shellQuote(a))
		}
	}
	cmdStr := strings.Join(parts, " ")

	home, _ := os.UserHomeDir()
	var rcFile string
	switch filepath.Base(shell) {
	case "zsh":
		rcFile = filepath.Join(home, ".zshrc")
	case "bash":
		rcFile = filepath.Join(home, ".bashrc")
	}

	var fullCmd string
	if rcFile != "" {
		fullCmd = fmt.Sprintf("[ -f '%s' ] && . '%s' 2>/dev/null; eval %s", rcFile, rcFile, cmdStr)
	} else {
		fullCmd = fmt.Sprintf("eval %s", cmdStr)
	}

	cmd := exec.Command(shell, "-l", "-c", fullCmd)
	cmd.Dir = dir
	cmd.Env = append(shellEnv(), "TERM=dumb")

	// Inject agent system prompt as env var (avoids shell escaping issues with newlines)
	if agentSystemPrompt != "" {
		cmd.Env = append(cmd.Env, "QUANT_AGENT_SYSTEM_PROMPT="+agentSystemPrompt)
	}

	// Inject agent env vars into subprocess
	if job.AgentID != "" && s.findAgent != nil {
		if agent, err := s.findAgent.FindAgentByID(job.AgentID); err == nil && agent != nil {
			for k, v := range agent.EnvVariables {
				cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
			}
		}
	}
	// Inject job-level env vars
	for k, v := range job.EnvVariables {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	cmd.Stdin = strings.NewReader(prompt)

	// Prepare log file for streaming human-readable output
	logPath := runLogPath(run.ID)
	_ = os.MkdirAll(filepath.Dir(logPath), 0755)
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		if logFile != nil {
			_ = logFile.Close()
		}
		return "", fmt.Errorf("failed to start claude: %w", err)
	}

	// Track process for cancellation
	s.mu.Lock()
	s.runningProcs[run.ID] = cmd.Process
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.runningProcs, run.ID)
		s.mu.Unlock()
	}()

	// Parse stream-json output line by line
	// - "assistant" events contain the text content (stream to log)
	// - "result" event has the final token usage stats
	var resultText strings.Builder
	outputDone := make(chan struct{})

	go func() {
		defer close(outputDone)
		scanner := bufio.NewScanner(stdoutPipe)
		scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB line buffer
		for scanner.Scan() {
			line := scanner.Bytes()
			var event map[string]interface{}
			if err := json.Unmarshal(line, &event); err != nil {
				continue
			}

			eventType, _ := event["type"].(string)

			switch eventType {
			case "assistant":
				// Extract text content from assistant message
				msg, _ := event["message"].(map[string]interface{})
				if msg == nil {
					continue
				}
				contents, _ := msg["content"].([]interface{})
				for _, c := range contents {
					block, _ := c.(map[string]interface{})
					if block == nil {
						continue
					}
					if block["type"] == "text" {
						text, _ := block["text"].(string)
						if text != "" {
							resultText.WriteString(text)
							resultText.WriteString("\n")
							if logFile != nil {
								_, _ = logFile.WriteString(text + "\n")
								_ = logFile.Sync()
							}
						}
					}
				}

			case "result":
				// Extract token usage and model from the final result event
				usage, _ := event["usage"].(map[string]interface{})
				if usage != nil {
					inputTokens, _ := usage["input_tokens"].(float64)
					outputTokens, _ := usage["output_tokens"].(float64)
					run.TokensUsed = int(inputTokens + outputTokens)
				}
				// Log and store which model actually ran
				if model, ok := event["model"].(string); ok && model != "" {
					run.ModelUsed = model
					if logFile != nil {
						_, _ = logFile.WriteString(fmt.Sprintf("\n--- model: %s ---\n", model))
						_ = logFile.Sync()
					}
					// Warn if model doesn't match what was requested
					if job.Model != "" && job.Model != "cli default" && model != job.Model {
						if logFile != nil {
							_, _ = logFile.WriteString(fmt.Sprintf("WARNING: requested model %q but got %q\n", job.Model, model))
						}
					}
				}
				// Also get the result text if we missed it
				if resultText.Len() == 0 {
					if r, ok := event["result"].(string); ok {
						resultText.WriteString(r)
						if logFile != nil {
							_, _ = logFile.WriteString(r)
							_ = logFile.Sync()
						}
					}
				}
			}
		}
	}()

	// Apply timeout
	timeout := time.Duration(job.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	var execErr error

	select {
	case err := <-done:
		if err != nil {
			execErr = fmt.Errorf("claude exited with error: %w", err)
		}
	case <-time.After(timeout):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		execErr = fmt.Errorf("job timed out after %v", timeout)
	}

	<-outputDone

	result := resultText.String()
	if stderr.Len() > 0 {
		result += "\n--- stderr ---\n" + stderr.String()
		if logFile != nil {
			_, _ = logFile.WriteString("\n--- stderr ---\n" + stderr.String())
		}
	}

	if logFile != nil {
		_ = logFile.Sync()
		_ = logFile.Close()
	}

	return result, execErr
}

// jobEvaluation is the structured result from the evaluation prompt.
type jobEvaluation struct {
	Result   string                 `json:"result"`   // "success" or "failure"
	Metadata map[string]interface{} `json:"metadata"` // structured context for triggered jobs
}

// evaluateJobResult runs a follow-up Claude prompt to determine success/failure and extract metadata.
// This runs after the main task completes, using a fresh Claude call with the task output as context.
func (s *jobManagerService) evaluateJobResult(job *entity.Job, taskOutput string, run *entity.JobRun) (*jobEvaluation, error) {
	var evalPrompt strings.Builder

	// System instruction — be extremely directive to avoid hallucination
	evalPrompt.WriteString("SYSTEM: You are a job result evaluator. You MUST respond with ONLY a raw JSON object. No markdown, no code blocks, no explanations, no text before or after the JSON. Just the JSON object itself.\n\n")

	evalPrompt.WriteString("TASK OUTPUT:\n")
	if len(taskOutput) > 3000 {
		evalPrompt.WriteString(taskOutput[len(taskOutput)-3000:])
	} else {
		evalPrompt.WriteString(taskOutput)
	}
	evalPrompt.WriteString("\n\nEND OF TASK OUTPUT.\n\n")

	// Build evaluation criteria
	hasSuccess := job.SuccessPrompt != ""
	hasFailure := job.FailurePrompt != ""

	evalPrompt.WriteString("EVALUATION RULES:\n")
	if hasSuccess && hasFailure {
		evalPrompt.WriteString(fmt.Sprintf("- Set result to \"success\" if: %s\n", job.SuccessPrompt))
		evalPrompt.WriteString(fmt.Sprintf("- Set result to \"failure\" if: %s\n", job.FailurePrompt))
		evalPrompt.WriteString("- If neither criteria clearly matches, default to \"success\".\n")
	} else if hasSuccess {
		evalPrompt.WriteString(fmt.Sprintf("- Set result to \"success\" if: %s\n", job.SuccessPrompt))
		evalPrompt.WriteString("- Set result to \"failure\" if the success criteria is NOT met.\n")
	} else if hasFailure {
		evalPrompt.WriteString(fmt.Sprintf("- Set result to \"failure\" if: %s\n", job.FailurePrompt))
		evalPrompt.WriteString("- Set result to \"success\" if the failure criteria is NOT met.\n")
	} else {
		evalPrompt.WriteString("- No evaluation criteria defined. Set result to \"success\".\n")
	}

	// Triage criteria — only when TriagePrompt is set
	if job.TriagePrompt != "" {
		evalPrompt.WriteString(fmt.Sprintf("- Set result to \"waiting\" if: %s\n", job.TriagePrompt))
		evalPrompt.WriteString("- Use \"waiting\" when the issue needs human input to resolve (ambiguous requirements, missing permissions, design decisions).\n")
	}

	// Metadata instructions — be very prescriptive about the exact keys
	evalPrompt.WriteString("\nMETADATA EXTRACTION:\n")
	if job.MetadataPrompt != "" {
		evalPrompt.WriteString(fmt.Sprintf("Extract EXACTLY these fields into the metadata object (use these exact key names): %s\n", job.MetadataPrompt))
		evalPrompt.WriteString("You MUST use the exact field names specified above. Do not rename them or add extra fields.\n")
	} else {
		evalPrompt.WriteString("Add a 'summary' field with a one-sentence description of what happened.\n")
	}
	evalPrompt.WriteString("Use simple string/number/boolean/array values only. Use snake_case keys.\n")

	// Build a concrete example that matches the user's metadata prompt
	evalPrompt.WriteString("\nRESPOND WITH ONLY A RAW JSON OBJECT (no markdown, no code blocks, no explanation):\n")
	resultExample := "success"
	if job.TriagePrompt != "" {
		resultExample = "success|failure|waiting"
	}
	if job.MetadataPrompt != "" {
		evalPrompt.WriteString(fmt.Sprintf("{\"result\":\"%s\",\"metadata\":{%s}}\n", resultExample, buildMetadataExample(job.MetadataPrompt)))
	} else {
		evalPrompt.WriteString(fmt.Sprintf("{\"result\":\"%s\",\"metadata\":{\"summary\":\"brief description\"}}\n", resultExample))
	}

	claudeCmd := job.ClaudeCommand
	if claudeCmd == "" {
		claudeCmd = "claude"
	}

	// Run a simple -p call (no streaming needed, this is a quick eval)
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	home, _ := os.UserHomeDir()
	var rcFile string
	switch filepath.Base(shell) {
	case "zsh":
		rcFile = filepath.Join(home, ".zshrc")
	case "bash":
		rcFile = filepath.Join(home, ".bashrc")
	}

	args := []string{claudeCmd, "'-p'", "'-'"}
	if job.Model != "" && job.Model != "cli default" {
		args = append(args, shellQuote("--model"), shellQuote(job.Model))
	}
	cmdStr := strings.Join(args, " ")

	var fullCmd string
	if rcFile != "" {
		fullCmd = fmt.Sprintf("[ -f '%s' ] && . '%s' 2>/dev/null; eval %s", rcFile, rcFile, cmdStr)
	} else {
		fullCmd = fmt.Sprintf("eval %s", cmdStr)
	}

	cmd := exec.Command(shell, "-l", "-c", fullCmd)
	cmd.Dir = expandPath(job.WorkingDirectory)
	cmd.Env = append(shellEnv(), "TERM=dumb")
	cmd.Stdin = strings.NewReader(evalPrompt.String())

	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &bytes.Buffer{}

	// Timeout for evaluation (5 minutes — needs time for session boot + metadata extraction)
	done := make(chan error, 1)
	go func() { done <- cmd.Run() }()

	select {
	case <-done:
	case <-time.After(300 * time.Second):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return &jobEvaluation{Result: "success", Metadata: map[string]interface{}{"error": "evaluation timed out"}}, nil
	}

	// Parse JSON from response — look for {...} in the output
	output := strings.TrimSpace(stdout.String())
	var eval jobEvaluation
	eval.Metadata = make(map[string]interface{})

	// Strip markdown code blocks if Claude wrapped the response
	cleaned := output
	if idx := strings.Index(cleaned, "```json"); idx >= 0 {
		cleaned = cleaned[idx+7:]
	} else if idx := strings.Index(cleaned, "```"); idx >= 0 {
		cleaned = cleaned[idx+3:]
	}
	if idx := strings.LastIndex(cleaned, "```"); idx >= 0 {
		cleaned = cleaned[:idx]
	}
	cleaned = strings.TrimSpace(cleaned)

	// Find the JSON object in the cleaned output
	jsonStart := strings.Index(cleaned, "{")
	jsonEnd := strings.LastIndex(cleaned, "}")
	if jsonStart >= 0 && jsonEnd > jsonStart {
		jsonStr := cleaned[jsonStart : jsonEnd+1]
		if err := json.Unmarshal([]byte(jsonStr), &eval); err != nil {
			eval.Result = "success"
			eval.Metadata["parse_error"] = err.Error()
			eval.Metadata["raw_eval"] = output
		}
	} else {
		eval.Result = "success"
		eval.Metadata["raw_eval"] = output
	}

	// Validate result value
	if job.TriagePrompt != "" && eval.Result == "waiting" {
		// Keep "waiting" — valid when TriagePrompt is set
	} else if eval.Result != "failure" {
		eval.Result = "success"
	}
	if eval.Metadata == nil {
		eval.Metadata = make(map[string]interface{})
	}

	// Log the evaluation
	if logFile, err := os.OpenFile(runLogPath(run.ID), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644); err == nil {
		metaJSON, _ := json.MarshalIndent(eval.Metadata, "", "  ")
		_, _ = logFile.WriteString(fmt.Sprintf("\n\n--- evaluation ---\nresult: %s\nmetadata:\n%s\n", eval.Result, string(metaJSON)))
		_ = logFile.Close()
	}

	return &eval, nil
}

// buildMetadataExample parses the user's metadata prompt to generate a JSON example
// with the exact field names they specified. This helps Claude follow the schema.
func buildMetadataExample(metadataPrompt string) string {
	// Common patterns: "Extract: field1 (type), field2 (type)" or "field1, field2, field3"
	// We extract words that look like field names and generate placeholder values
	prompt := strings.ToLower(metadataPrompt)

	// Remove common prefixes
	for _, prefix := range []string{"extract:", "extract ", "fields:", "include:"} {
		if strings.HasPrefix(prompt, prefix) {
			prompt = strings.TrimPrefix(prompt, prefix)
		}
	}

	// Split by common delimiters
	parts := strings.FieldsFunc(prompt, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n'
	})

	var fields []string
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		// Extract the field name (first word or words before parentheses)
		name := part
		if idx := strings.Index(name, "("); idx > 0 {
			name = strings.TrimSpace(name[:idx])
		}
		// Convert to snake_case
		name = strings.ReplaceAll(strings.TrimSpace(name), " ", "_")
		// Remove non-alphanumeric chars except underscores
		cleaned := strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
				return r
			}
			return -1
		}, name)
		if cleaned != "" && len(cleaned) < 40 {
			fields = append(fields, cleaned)
		}
	}

	if len(fields) == 0 {
		return "\"summary\":\"brief description\""
	}

	var examples []string
	for _, f := range fields {
		examples = append(examples, fmt.Sprintf("\"%s\":\"...\"", f))
	}
	return strings.Join(examples, ",")
}

// executeBashJob runs a bash script and captures its output.
func (s *jobManagerService) executeBashJob(job *entity.Job, run *entity.JobRun) (string, error) {
	interpreter := job.Interpreter
	if interpreter == "" {
		interpreter = "/bin/bash"
	}

	dir := expandPath(job.WorkingDirectory)

	cmd := exec.Command(interpreter)
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(job.ScriptContent)

	cmd.Env = os.Environ()
	for k, v := range job.EnvVariables {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	// Inject trigger context as env var so bash scripts can read upstream metadata
	s.mu.Lock()
	if ctx, ok := s.triggerCtx[run.ID]; ok {
		cmd.Env = append(cmd.Env, fmt.Sprintf("QUANT_TRIGGER_CONTEXT=%s", ctx))
		delete(s.triggerCtx, run.ID)
	}
	s.mu.Unlock()

	// Stream output to log file in real-time
	logPath := runLogPath(run.ID)
	_ = os.MkdirAll(filepath.Dir(logPath), 0755)
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)

	var stdout, stderr bytes.Buffer
	if logFile != nil {
		cmd.Stdout = io.MultiWriter(&stdout, logFile)
	} else {
		cmd.Stdout = &stdout
	}
	cmd.Stderr = &stderr

	// Apply timeout
	timeout := time.Duration(job.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}

	if err := cmd.Start(); err != nil {
		if logFile != nil {
			_ = logFile.Close()
		}
		return "", fmt.Errorf("failed to start script: %w", err)
	}

	// Track process for cancellation
	s.mu.Lock()
	s.runningProcs[run.ID] = cmd.Process
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.runningProcs, run.ID)
		s.mu.Unlock()
	}()

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	var result string
	var execErr error

	select {
	case err := <-done:
		result = stdout.String()
		if stderr.Len() > 0 {
			result += "\n--- stderr ---\n" + stderr.String()
		}
		if err != nil {
			execErr = fmt.Errorf("script failed: %w", err)
		}

	case <-time.After(timeout):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		result = stdout.String()
		execErr = fmt.Errorf("job timed out after %v", timeout)
	}

	if logFile != nil {
		if stderr.Len() > 0 {
			_, _ = logFile.WriteString("\n--- stderr ---\n" + stderr.String())
		}
		_ = logFile.Close()
	}

	return result, execErr
}

// fireTriggers fires trigger chains after a job run completes.
func (s *jobManagerService) fireTriggers(jobID string, run *entity.JobRun) {
	if run.Status == jobrunstatus.Waiting {
		return
	}

	triggers, err := s.findJobTrigger.FindTriggersBySourceJobID(jobID)
	if err != nil {
		return
	}

	triggerOn := "success"
	if run.Status == jobrunstatus.Failed {
		triggerOn = "failure"
	}

	// Get source job name for context
	sourceJob, _ := s.findJob.FindJobByID(jobID)
	sourceJobName := jobID
	if sourceJob != nil {
		sourceJobName = sourceJob.Name
	}

	// Extract metadata from the run result (if present)
	sourceOutput := run.Result
	metadataSection := ""
	if idx := strings.Index(sourceOutput, "\n\n--- metadata ---\n"); idx >= 0 {
		metadataSection = sourceOutput[idx+len("\n\n--- metadata ---\n"):]
		sourceOutput = sourceOutput[:idx]
	}
	if len(sourceOutput) > 3000 {
		sourceOutput = sourceOutput[len(sourceOutput)-3000:]
	}

	for _, trigger := range triggers {
		if trigger.TriggerOn == triggerOn {
			// Build trigger context — prefer structured metadata over raw output
			var ctx string
			if metadataSection != "" {
				ctx = fmt.Sprintf(
					"## Trigger context\n"+
						"This job was triggered by the %s of job \"%s\" (run: %s).\n"+
						"\n### Structured metadata from \"%s\":\n```json\n%s\n```\n",
					triggerOn, sourceJobName, run.ID, sourceJobName, metadataSection,
				)
			} else {
				ctx = fmt.Sprintf(
					"## Trigger context\n"+
						"This job was triggered by the %s of job \"%s\" (run: %s).\n"+
						"\n### Output from \"%s\":\n```\n%s\n```\n",
					triggerOn, sourceJobName, run.ID, sourceJobName, sourceOutput,
				)
			}

			// Store context for the new run to pick up
			newRun, err := s.RunJob(trigger.TargetJobID, run.ID, run.CorrelationID)
			if err == nil && newRun != nil {
				s.mu.Lock()
				// Append continue_pipeline context if present
				if continueCtx, ok := s.triggerCtx["continue:"+run.ID]; ok {
					ctx += fmt.Sprintf("\n## Human intervention context\n%s\n", continueCtx)
					delete(s.triggerCtx, "continue:"+run.ID)
				}
				s.triggerCtx[newRun.ID] = ctx
				s.mu.Unlock()
			}
		}
	}
}

// runLogPath returns the path to a run's log file.
func runLogPath(runID string) string {
	homeDir, _ := os.UserHomeDir()
	return filepath.Join(homeDir, ".quant", "job_runs", runID+".log")
}

// writeRunLog appends attempt output to the run's log file.
// For retries, each attempt is appended with a header.
func (s *jobManagerService) writeRunLog(runID string, output string, attempt int) {
	logPath := runLogPath(runID)
	_ = os.MkdirAll(filepath.Dir(logPath), 0755)

	header := fmt.Sprintf("\n\n=== Attempt %d ===\n", attempt)

	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString(header + output)
}

// CancelRun cancels a running job run.
func (s *jobManagerService) CancelRun(runID string) error {
	run, err := s.findJobRun.FindJobRunByID(runID)
	if err != nil {
		return fmt.Errorf("failed to find run: %w", err)
	}
	if run == nil {
		return fmt.Errorf("run not found: %s", runID)
	}
	if run.Status != jobrunstatus.Running {
		return fmt.Errorf("run is not running: %s", run.Status)
	}

	// Kill the process if it's tracked
	s.mu.RLock()
	proc, exists := s.runningProcs[runID]
	s.mu.RUnlock()
	if exists && proc != nil {
		_ = proc.Kill()
	}

	now := time.Now()
	run.Status = jobrunstatus.Cancelled
	run.FinishedAt = &now
	return s.saveJobRun.UpdateJobRun(*run)
}

// expandPath resolves ~ in paths and provides a fallback.
func expandPath(dir string) string {
	if dir == "" {
		d, _ := os.UserHomeDir()
		return d
	}
	if strings.HasPrefix(dir, "~/") {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, dir[2:])
	}
	return dir
}

// shellQuote wraps a string in single quotes for safe shell usage.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// resolveCommand resolves a command name (including aliases) to an actual binary path.
// It sources the user's shell rc file and uses `type -p` or `which` to find the real path.
// Falls back to the original command name if resolution fails.
func resolveCommand(name string) string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	// First try: resolve via the user's login shell with rc file sourced
	home, _ := os.UserHomeDir()
	var rcFile string
	switch filepath.Base(shell) {
	case "zsh":
		rcFile = filepath.Join(home, ".zshrc")
	case "bash":
		rcFile = filepath.Join(home, ".bashrc")
	}

	// Use `whence -p` (zsh) or `type -P` (bash) to resolve aliases to actual paths
	var resolveExpr string
	if filepath.Base(shell) == "zsh" {
		resolveExpr = fmt.Sprintf("[ -f %s ] && . %s 2>/dev/null; whence -p %s 2>/dev/null || which %s 2>/dev/null || echo %s", rcFile, rcFile, name, name, name)
	} else {
		resolveExpr = fmt.Sprintf("[ -f %s ] && . %s 2>/dev/null; type -P %s 2>/dev/null || which %s 2>/dev/null || echo %s", rcFile, rcFile, name, name, name)
	}

	cmd := exec.Command(shell, "-l", "-c", resolveExpr)
	output, err := cmd.Output()
	if err == nil {
		resolved := strings.TrimSpace(string(output))
		if resolved != "" {
			return resolved
		}
	}

	return name
}

// shellEnv returns environment variables from the user's login shell.
func shellEnv() []string {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	cmd := exec.Command(shell, "-l", "-c", "env")
	output, err := cmd.Output()
	if err != nil {
		return os.Environ()
	}
	var env []string
	for _, line := range strings.Split(string(output), "\n") {
		if strings.Contains(line, "=") {
			env = append(env, line)
		}
	}
	if len(env) == 0 {
		return os.Environ()
	}
	return env
}

// GetRun returns a job run by ID.
func (s *jobManagerService) GetRun(runID string) (*entity.JobRun, error) {
	run, err := s.findJobRun.FindJobRunByID(runID)
	if err != nil {
		return nil, fmt.Errorf("failed to get run: %w", err)
	}

	if run == nil {
		return nil, fmt.Errorf("run not found: %s", runID)
	}

	return run, nil
}

// ListRunsByJob returns all runs for a given job.
func (s *jobManagerService) ListRunsByJob(jobID string) ([]entity.JobRun, error) {
	runs, err := s.findJobRun.FindJobRunsByJobID(jobID)
	if err != nil {
		return nil, fmt.Errorf("failed to list runs: %w", err)
	}

	return runs, nil
}

// ListRunsByJobPaginated returns a page of runs for a given job.
func (s *jobManagerService) ListRunsByJobPaginated(jobID string, limit, offset int) ([]entity.JobRun, error) {
	runs, err := s.findJobRun.FindJobRunsByJobIDPaginated(jobID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list runs (paginated): %w", err)
	}

	return runs, nil
}

// GetRunOutput returns the full output of a job run from the log file.
func (s *jobManagerService) GetRunOutput(runID string) (string, error) {
	run, err := s.findJobRun.FindJobRunByID(runID)
	if err != nil {
		return "", fmt.Errorf("failed to find run: %w", err)
	}
	if run == nil {
		return "", fmt.Errorf("run not found: %s", runID)
	}

	// Try to read the run log file (includes all attempts)
	homeDir, _ := os.UserHomeDir()
	logPath := filepath.Join(homeDir, ".quant", "job_runs", runID+".log")
	data, err := os.ReadFile(logPath)
	if err == nil {
		return string(data), nil
	}

	// Fall back to the stored result in DB
	return run.Result, nil
}

// createTriggers creates trigger records for on-success and on-failure target job IDs.
func (s *jobManagerService) createTriggers(sourceJobID string, onSuccess []string, onFailure []string) error {
	for _, targetID := range onSuccess {
		trigger := entity.JobTrigger{
			ID:          uuid.New().String(),
			SourceJobID: sourceJobID,
			TargetJobID: targetID,
			TriggerOn:   "success",
		}
		if err := s.saveJobTrigger.SaveJobTrigger(trigger); err != nil {
			return fmt.Errorf("failed to save success trigger: %w", err)
		}
	}

	for _, targetID := range onFailure {
		trigger := entity.JobTrigger{
			ID:          uuid.New().String(),
			SourceJobID: sourceJobID,
			TargetJobID: targetID,
			TriggerOn:   "failure",
		}
		if err := s.saveJobTrigger.SaveJobTrigger(trigger); err != nil {
			return fmt.Errorf("failed to save failure trigger: %w", err)
		}
	}

	return nil
}

// buildAgentSystemPrompt constructs a system prompt from the agent's configuration.
// Uses XML tags for structured sections following Anthropic's prompting best practices.
func buildAgentSystemPrompt(agent *entity.Agent) string {
	var sb strings.Builder

	if agent.Role != "" {
		sb.WriteString("<role>\n")
		sb.WriteString(agent.Role)
		sb.WriteString("\n</role>\n\n")
	}

	if agent.Goal != "" {
		sb.WriteString("<goal>\n")
		sb.WriteString(agent.Goal)
		sb.WriteString("\n</goal>\n\n")
	}

	if len(agent.Boundaries) > 0 {
		sb.WriteString("<boundaries>\nYou MUST follow these rules at all times:\n")
		for _, b := range agent.Boundaries {
			sb.WriteString("- ")
			sb.WriteString(b)
			sb.WriteString("\n")
		}
		sb.WriteString("</boundaries>\n\n")
	}

	enabledSkills := []string{}
	for name, enabled := range agent.Skills {
		if enabled {
			enabledSkills = append(enabledSkills, name)
		}
	}
	if len(enabledSkills) > 0 {
		sort.Strings(enabledSkills)
		sb.WriteString("<skills>\nYou have access to these skills: ")
		sb.WriteString(strings.Join(enabledSkills, ", "))
		sb.WriteString("\n</skills>\n")
	}

	return sb.String()
}
