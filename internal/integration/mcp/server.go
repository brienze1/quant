// Package mcp implements an MCP server that exposes Quant's job management
// to Claude Code and other MCP clients.
package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	appAdapter "quant/internal/application/adapter"
	"quant/internal/domain/entity"
)

// QuantMCPServer wraps an MCP server that exposes job and agent management tools.
type QuantMCPServer struct {
	jobManager   appAdapter.JobManager
	agentManager appAdapter.AgentManager
	httpServer   *http.Server
}

// NewQuantMCPServer creates a new MCP server with all job and agent management tools registered.
func NewQuantMCPServer(jobManager appAdapter.JobManager, agentManager appAdapter.AgentManager) *QuantMCPServer {
	mcpServer := server.NewMCPServer("quant", "1.0.0")

	s := &QuantMCPServer{jobManager: jobManager, agentManager: agentManager}

	s.registerTools(mcpServer)

	streamable := server.NewStreamableHTTPServer(mcpServer)

	mux := http.NewServeMux()
	mux.Handle("/mcp", streamable)

	s.httpServer = &http.Server{
		Addr:    ":52945",
		Handler: mux,
	}

	return s
}

// Start begins listening for MCP requests in a background goroutine.
func (s *QuantMCPServer) Start() error {
	go s.httpServer.ListenAndServe()
	return nil
}

// Stop gracefully shuts down the HTTP server with a 2-second timeout.
func (s *QuantMCPServer) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.httpServer.Shutdown(ctx)
}

func (s *QuantMCPServer) registerTools(mcpServer *server.MCPServer) {
	// 1. list_jobs
	mcpServer.AddTool(
		mcp.NewTool("list_jobs",
			mcp.WithDescription(`List all configured jobs with their full configuration.

Each job may have an agentId linking to an agent persona. When a job runs, the agent's configuration (role, goal, boundaries, skills) is injected as a system prompt into the Claude CLI session. The agent also provides env vars and a fallback model. Use get_agent(agentId) to see the full agent config.

Key fields in the response:
- agentId: UUID of the assigned agent (empty = no agent). The agent defines WHO executes the job (persona, rules, skills). Use get_agent to see details.
- agentName/agentRole: inline summary of the assigned agent (empty if no agent)
- claudeCommand: which Claude CLI binary/alias to invoke (e.g. 'claude', 'claude-bl')
- prompt: the task instructions sent to Claude (what to do)
- successPrompt/failurePrompt: evaluation criteria run after the main task to determine success/failure
- metadataPrompt: instructions for extracting structured data passed to triggered downstream jobs`),
		),
		s.handleListJobs,
	)

	// 2. get_job
	mcpServer.AddTool(
		mcp.NewTool("get_job",
			mcp.WithDescription("Get a job by ID with full configuration. If the job has an agentId, the response includes agentName and agentRole inline. Use get_agent(agentId) for the full agent config (boundaries, skills, env vars)."),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job ID")),
		),
		s.handleGetJob,
	)

	// 3. create_job
	mcpServer.AddTool(
		mcp.NewTool("create_job",
			mcp.WithDescription(`Create a new automated job in Quant. Jobs can be:
- 'claude' type: runs a Claude CLI session with a prompt (use for code reviews, analysis, complex tasks)
- 'bash' type: runs a shell script (use for health checks, deployments, notifications)

Jobs run autonomously with permissions bypassed. After creating, use update_job to wire trigger chains (onSuccess/onFailure arrays with target job IDs).

Trigger chains: when a job finishes, it can trigger other jobs based on the outcome. Use onSuccess/onFailure to build pipelines like: health-check → deploy (on success) → notify (on deploy success), health-check → incident-report (on failure).

For claude jobs, after execution a second evaluation prompt runs to determine success/failure and extract structured metadata that gets passed to triggered jobs, saving tokens vs passing raw output.

IMPORTANT: timeoutSeconds must be at least 60. For claude jobs, use 600 (10 min) as the default — they need time for the main task plus a follow-up evaluation call. 5 min is tight, 10 min is safe. For bash jobs, 60-120s is usually enough.

The Quant canvas UI auto-refreshes every 10 seconds and auto-layouts new jobs that don't have positions yet. After creating multiple jobs, they will appear organized on the canvas automatically.

Workflow for building pipelines:
1. Create all jobs first (they appear on canvas automatically)
2. Wire triggers with update_job onSuccess/onFailure
3. Use run_job to test the entry point — downstream jobs fire automatically`),
			mcp.WithString("name", mcp.Required(), mcp.Description("Unique job name (e.g. health-check, deploy-staging, code-review-bot)")),
			mcp.WithString("description", mcp.Description("What the job does — shown in the canvas UI")),
			mcp.WithString("type", mcp.Required(), mcp.Description("'claude' for Claude CLI sessions, 'bash' for shell scripts")),
			mcp.WithString("workingDirectory", mcp.Description("Working directory (supports ~/path). Leave empty for home dir")),
			// Schedule
			mcp.WithBoolean("scheduleEnabled", mcp.Description("Enable scheduled execution. False = manual/trigger only")),
			mcp.WithString("scheduleType", mcp.Description("'recurring' (repeats on interval/cron) or 'one_time' (runs once then auto-disables)")),
			mcp.WithString("cronExpression", mcp.Description("Cron expression (e.g. '0 9 * * 1-5' for weekdays 9am). Alternative to scheduleInterval")),
			mcp.WithNumber("scheduleInterval", mcp.Description("Repeat interval in minutes (e.g. 30 for every 30min). Alternative to cronExpression")),
			mcp.WithNumber("timeoutSeconds", mcp.Description("Max execution time in seconds. Claude jobs: use 600 (10 min, safe default). Bash jobs: 60-120s. Never set below 60. Job is killed after this")),
			// Claude config
			mcp.WithString("prompt", mcp.Description("Main task prompt for claude jobs. Be specific about what to do and what tools to use")),
			mcp.WithNumber("maxRetries", mcp.Description("Retry count on failure (claude only). Each retry includes previous output as context")),
			mcp.WithString("model", mcp.Description("Claude model (e.g. 'claude-sonnet-4-6'). Empty = CLI default")),
			mcp.WithString("claudeCommand", mcp.Description("Claude CLI command/alias (e.g. 'claude', 'claude-bl'). Supports shell aliases from ~/.zshrc")),
			mcp.WithString("agentId", mcp.Description("Agent ID to use for this job. The agent's role, goal, boundaries, and skills are injected as a system prompt. Use list_agents to get IDs")),
			mcp.WithString("successPrompt", mcp.Description("How to evaluate success (max 300 chars). E.g. 'All tests passed and PR was approved'. Optional")),
			mcp.WithString("failurePrompt", mcp.Description("How to evaluate failure (max 300 chars). E.g. 'Tests failed or errors occurred'. Optional")),
			mcp.WithString("metadataPrompt", mcp.Description("What structured data to extract for triggered jobs (max 500 chars). E.g. 'Extract PR URLs, test counts, error details'. Saves tokens vs raw output")),
			// Bash config
			mcp.WithString("interpreter", mcp.Description("Shell for bash jobs: '/bin/bash', '/bin/zsh', 'python3'")),
			mcp.WithString("scriptContent", mcp.Description("Script content for bash jobs. Exit 0 = success (fires onSuccess triggers), non-zero = failure (fires onFailure triggers)")),
			// Triggers
			mcp.WithString("onSuccess", mcp.Description("JSON array of job IDs to trigger on success. E.g. '[\"job-id-1\",\"job-id-2\"]'. Use list_jobs to get IDs")),
			mcp.WithString("onFailure", mcp.Description("JSON array of job IDs to trigger on failure. E.g. '[\"job-id-1\"]'. Use list_jobs to get IDs")),
		),
		s.handleCreateJob,
	)

	// 4. update_job
	mcpServer.AddTool(
		mcp.NewTool("update_job",
			mcp.WithDescription(`Update a job's configuration. Only provided fields are changed. Also use this to wire trigger chains by setting onSuccess/onFailure with arrays of target job IDs.

Common workflows:
- Wire triggers: update_job(id, onSuccess=["target-job-id"])
- Change prompt: update_job(id, prompt="new prompt")
- Enable schedule: update_job(id, scheduleEnabled=true, scheduleInterval=30)
- Add evaluation: update_job(id, successPrompt="...", failurePrompt="...")`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job ID to update (get from list_jobs)")),
			mcp.WithString("name", mcp.Description("Job name")),
			mcp.WithString("description", mcp.Description("Job description")),
			mcp.WithString("type", mcp.Description("'claude' or 'bash'")),
			mcp.WithString("workingDirectory", mcp.Description("Working directory")),
			mcp.WithBoolean("scheduleEnabled", mcp.Description("Enable/disable schedule")),
			mcp.WithString("scheduleType", mcp.Description("'recurring' or 'one_time'")),
			mcp.WithString("cronExpression", mcp.Description("Cron expression")),
			mcp.WithNumber("scheduleInterval", mcp.Description("Interval in minutes")),
			mcp.WithNumber("timeoutSeconds", mcp.Description("Timeout in seconds")),
			mcp.WithString("prompt", mcp.Description("Task prompt (claude jobs)")),
			mcp.WithNumber("maxRetries", mcp.Description("Retry count (claude jobs)")),
			mcp.WithString("model", mcp.Description("Claude model")),
			mcp.WithString("claudeCommand", mcp.Description("Claude CLI command/alias")),
			mcp.WithString("agentId", mcp.Description("Agent ID. Use list_agents to get IDs. Set to empty string to unassign")),
			mcp.WithString("successPrompt", mcp.Description("Success evaluation criteria (max 300 chars)")),
			mcp.WithString("failurePrompt", mcp.Description("Failure evaluation criteria (max 300 chars)")),
			mcp.WithString("metadataPrompt", mcp.Description("Metadata extraction instructions (max 500 chars)")),
			mcp.WithString("interpreter", mcp.Description("Script interpreter (bash jobs)")),
			mcp.WithString("scriptContent", mcp.Description("Script content (bash jobs)")),
			mcp.WithString("onSuccess", mcp.Description("JSON array of job IDs to trigger on success. E.g. '[\"id1\",\"id2\"]'. Replaces existing triggers")),
			mcp.WithString("onFailure", mcp.Description("JSON array of job IDs to trigger on failure. E.g. '[\"id1\"]'. Replaces existing triggers")),
		),
		s.handleUpdateJob,
	)

	// 5. delete_job
	mcpServer.AddTool(
		mcp.NewTool("delete_job",
			mcp.WithDescription("Delete a job and all its trigger chains and run history. This is irreversible."),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job ID to delete (get from list_jobs)")),
		),
		s.handleDeleteJob,
	)

	// 6. run_job
	mcpServer.AddTool(
		mcp.NewTool("run_job",
			mcp.WithDescription("Trigger a job to run immediately. Returns the run object with a run ID. The job executes asynchronously — use list_runs or get_run to check status. If the job has trigger chains, downstream jobs will fire automatically when this run completes."),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job ID to run (get from list_jobs)")),
		),
		s.handleRunJob,
	)

	// 7. get_run
	mcpServer.AddTool(
		mcp.NewTool("get_run",
			mcp.WithDescription("Get details of a specific job run including status (pending/running/success/failed/cancelled), duration, tokens used, and result. Use after run_job to check if execution completed."),
			mcp.WithString("runId", mcp.Required(), mcp.Description("Run ID (returned by run_job or list_runs)")),
		),
		s.handleGetRun,
	)

	// 8. list_runs
	mcpServer.AddTool(
		mcp.NewTool("list_runs",
			mcp.WithDescription("List all runs for a job, sorted by most recent first. Shows run ID, status, duration, tokens used, and whether it was triggered by another job. Use to check job history and find specific run IDs."),
			mcp.WithString("jobId", mcp.Required(), mcp.Description("Job ID (get from list_jobs)")),
		),
		s.handleListRuns,
	)

	// 9. get_run_output
	mcpServer.AddTool(
		mcp.NewTool("get_run_output",
			mcp.WithDescription("Get the full output/logs of a job run. For claude jobs this includes the Claude session output. For bash jobs this includes stdout/stderr. Also includes evaluation results and extracted metadata if configured."),
			mcp.WithString("runId", mcp.Required(), mcp.Description("Run ID (from list_runs or run_job)")),
		),
		s.handleGetRunOutput,
	)

	// 10. cancel_run
	mcpServer.AddTool(
		mcp.NewTool("cancel_run",
			mcp.WithDescription("Cancel a currently running job. Kills the process immediately. The run status is set to 'cancelled' and no triggers are fired."),
			mcp.WithString("runId", mcp.Required(), mcp.Description("Run ID to cancel")),
		),
		s.handleCancelRun,
	)

	// 11. get_triggers
	mcpServer.AddTool(
		mcp.NewTool("get_triggers",
			mcp.WithDescription("Get the full trigger graph showing how all jobs are connected. Returns each job with its onSuccess and onFailure targets, plus which jobs trigger it. Use this to understand the pipeline topology before wiring new connections."),
		),
		s.handleGetTriggers,
	)

	// -----------------------------------------------------------------------
	// Agent tools
	// -----------------------------------------------------------------------

	// 13. list_agents
	mcpServer.AddTool(
		mcp.NewTool("list_agents",
			mcp.WithDescription("List all configured agents. Agents define identity (role, goal), access (MCP servers, env vars), boundaries (anti-prompt rules), and skills for Claude jobs. Assign an agent to a job to give it a persona and behavioral constraints."),
		),
		s.handleListAgents,
	)

	// 14. get_agent
	mcpServer.AddTool(
		mcp.NewTool("get_agent",
			mcp.WithDescription("Get an agent by ID. Returns full configuration including role, goal, boundaries, skills, MCP access, and env vars."),
			mcp.WithString("id", mcp.Required(), mcp.Description("Agent ID")),
		),
		s.handleGetAgent,
	)

	// 15. create_agent
	mcpServer.AddTool(
		mcp.NewTool("create_agent",
			mcp.WithDescription(`Create a new agent persona for Claude jobs. Agents are task-specific — create many small focused agents, not monoliths.

An agent's config is injected as a system prompt when a job runs:
- role: who the agent is (identity, tone) — max 200 chars, be dense
- goal: success criteria — max 200 chars
- boundaries: hard rules the agent must never violate (e.g. "never push to main")
- skills: which Claude skills the agent can use (from ~/.claude/skills/)
- mcpServers: which MCP servers the agent can access
- envVariables: private secrets only this agent knows (e.g. API tokens)
- autonomousMode: true (default) = agent executes without stopping to ask

After creating, assign to a job with update_job(id, agentId="...").`),
			mcp.WithString("name", mcp.Required(), mcp.Description("Agent name (e.g. 'code_reviewer', 'devops_engineer')")),
			mcp.WithString("color", mcp.Description("Hex color for UI (e.g. '#10B981'). Default: green")),
			mcp.WithString("role", mcp.Description("Who is this agent? Identity and tone. Max 500 chars. Be semantically dense")),
			mcp.WithString("goal", mcp.Description("What does this agent achieve? Success criteria. Max 500 chars")),
			mcp.WithString("model", mcp.Description("Claude model (e.g. 'claude-opus-4-6'). Used as fallback when job doesn't specify")),
			mcp.WithBoolean("autonomousMode", mcp.Description("Execute without stopping to ask. Default: true")),
			mcp.WithString("boundaries", mcp.Description("JSON array of anti-prompt rules. E.g. '[\"never push to main\",\"never delete databases\"]'")),
			mcp.WithString("skills", mcp.Description("JSON object of skill toggles. E.g. '{\"architecture\":true,\"bdd-testing\":true}'. Use list_available_skills to see options")),
			mcp.WithString("mcpServers", mcp.Description("JSON object of MCP server toggles. E.g. '{\"dbhub\":true,\"linear\":false}'. Use list_available_mcp_servers to see options")),
			mcp.WithString("envVariables", mcp.Description("JSON object of env vars. E.g. '{\"GITHUB_TOKEN\":\"ghp_xxx\"}'")),
		),
		s.handleCreateAgent,
	)

	// 16. update_agent
	mcpServer.AddTool(
		mcp.NewTool("update_agent",
			mcp.WithDescription("Update an agent's configuration. Only provided fields are changed."),
			mcp.WithString("id", mcp.Required(), mcp.Description("Agent ID to update")),
			mcp.WithString("name", mcp.Description("Agent name")),
			mcp.WithString("color", mcp.Description("Hex color for UI")),
			mcp.WithString("role", mcp.Description("Role description (max 200 chars)")),
			mcp.WithString("goal", mcp.Description("Goal description (max 200 chars)")),
			mcp.WithString("model", mcp.Description("Claude model")),
			mcp.WithBoolean("autonomousMode", mcp.Description("Execute without stopping")),
			mcp.WithString("boundaries", mcp.Description("JSON array of anti-prompt rules. Replaces existing")),
			mcp.WithString("skills", mcp.Description("JSON object of skill toggles. Replaces existing")),
			mcp.WithString("mcpServers", mcp.Description("JSON object of MCP server toggles. Replaces existing")),
			mcp.WithString("envVariables", mcp.Description("JSON object of env vars. Replaces existing")),
		),
		s.handleUpdateAgent,
	)

	// 17. delete_agent
	mcpServer.AddTool(
		mcp.NewTool("delete_agent",
			mcp.WithDescription("Delete an agent. Jobs using this agent will have their agentId cleared. This is irreversible."),
			mcp.WithString("id", mcp.Required(), mcp.Description("Agent ID to delete")),
		),
		s.handleDeleteAgent,
	)

	// 18. list_available_skills
	mcpServer.AddTool(
		mcp.NewTool("list_available_skills",
			mcp.WithDescription("List all Claude skills available in ~/.claude/skills/. Returns skill names that can be used in agent skill toggles. Skills are architecture patterns, testing guidelines, coding conventions, etc."),
		),
		s.handleListAvailableSkills,
	)

	// 19. list_available_mcp_servers
	mcpServer.AddTool(
		mcp.NewTool("list_available_mcp_servers",
			mcp.WithDescription("List all MCP servers configured in ~/.mcp.json. Returns server names that can be used in agent MCP server toggles."),
		),
		s.handleListAvailableMcpServers,
	)

	// 20. get_agent_system_prompt
	mcpServer.AddTool(
		mcp.NewTool("get_agent_system_prompt",
			mcp.WithDescription("Preview the system prompt that would be injected for a given agent. Useful for debugging agent behavior before running a job."),
			mcp.WithString("id", mcp.Required(), mcp.Description("Agent ID")),
		),
		s.handleGetAgentSystemPrompt,
	)

	// 12. get_pipeline_status
	mcpServer.AddTool(
		mcp.NewTool("get_pipeline_status",
			mcp.WithDescription("Given a run ID, trace the full chain of triggered runs downstream. Shows the cascade: which jobs were triggered, their statuses, durations, and token usage. Use after run_job to see the full pipeline execution result without manually checking each job."),
			mcp.WithString("runId", mcp.Required(), mcp.Description("The initial run ID to trace from (returned by run_job)")),
		),
		s.handleGetPipelineStatus,
	)
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

func (s *QuantMCPServer) handleListJobs(_ context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	jobs, err := s.jobManager.ListJobs()
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	result := make([]map[string]any, 0, len(jobs))
	for i := range jobs {
		m := jobToMap(&jobs[i])
		s.enrichJobWithAgent(m, jobs[i].AgentID)
		result = append(result, m)
	}

	return marshalResult(result)
}

func (s *QuantMCPServer) handleGetJob(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	job, err := s.jobManager.GetJob(id)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	m := jobToMap(job)
	s.enrichJobWithAgent(m, job.AgentID)
	return marshalResult(m)
}

func (s *QuantMCPServer) handleCreateJob(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := request.GetArguments()

	job := entity.Job{
		Name:             stringArg(args, "name"),
		Description:      stringArg(args, "description"),
		Type:             stringArg(args, "type"),
		WorkingDirectory: stringArg(args, "workingDirectory"),
		ScheduleEnabled:  boolArg(args, "scheduleEnabled"),
		ScheduleType:     stringArg(args, "scheduleType"),
		CronExpression:   stringArg(args, "cronExpression"),
		ScheduleInterval: intArg(args, "scheduleInterval"),
		TimeoutSeconds:   intArg(args, "timeoutSeconds"),
		Prompt:           stringArg(args, "prompt"),
		AllowBypass:      true,
		AutonomousMode:   true,
		MaxRetries:       intArg(args, "maxRetries"),
		Model:            stringArg(args, "model"),
		ClaudeCommand:    stringArg(args, "claudeCommand"),
		AgentID:          stringArg(args, "agentId"),
		SuccessPrompt:    stringArg(args, "successPrompt"),
		FailurePrompt:    stringArg(args, "failurePrompt"),
		MetadataPrompt:   stringArg(args, "metadataPrompt"),
		Interpreter:      stringArg(args, "interpreter"),
		ScriptContent:    stringArg(args, "scriptContent"),
	}

	onSuccess := stringSliceArg(args, "onSuccess")
	onFailure := stringSliceArg(args, "onFailure")

	created, err := s.jobManager.CreateJob(job, onSuccess, onFailure)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(jobToMap(created))
}

func (s *QuantMCPServer) handleUpdateJob(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := request.GetArguments()

	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	existing, err := s.jobManager.GetJob(id)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	// Merge provided fields onto existing job.
	if v, ok := args["name"]; ok {
		existing.Name = v.(string)
	}
	if v, ok := args["description"]; ok {
		existing.Description = v.(string)
	}
	if v, ok := args["type"]; ok {
		existing.Type = v.(string)
	}
	if v, ok := args["workingDirectory"]; ok {
		existing.WorkingDirectory = v.(string)
	}
	if v, ok := args["scheduleEnabled"]; ok {
		existing.ScheduleEnabled, _ = v.(bool)
	}
	if v, ok := args["scheduleType"]; ok {
		existing.ScheduleType = v.(string)
	}
	if v, ok := args["cronExpression"]; ok {
		existing.CronExpression = v.(string)
	}
	if v, ok := args["scheduleInterval"]; ok {
		existing.ScheduleInterval = toInt(v)
	}
	if v, ok := args["timeoutSeconds"]; ok {
		existing.TimeoutSeconds = toInt(v)
	}
	if v, ok := args["prompt"]; ok {
		existing.Prompt = v.(string)
	}
	if v, ok := args["allowBypass"]; ok {
		existing.AllowBypass, _ = v.(bool)
	}
	if v, ok := args["autonomousMode"]; ok {
		existing.AutonomousMode, _ = v.(bool)
	}
	if v, ok := args["maxRetries"]; ok {
		existing.MaxRetries = toInt(v)
	}
	if v, ok := args["model"]; ok {
		existing.Model = v.(string)
	}
	if v, ok := args["claudeCommand"]; ok {
		existing.ClaudeCommand = v.(string)
	}
	if v, ok := args["agentId"]; ok {
		existing.AgentID, _ = v.(string)
	}
	if v, ok := args["successPrompt"]; ok {
		existing.SuccessPrompt = v.(string)
	}
	if v, ok := args["failurePrompt"]; ok {
		existing.FailurePrompt = v.(string)
	}
	if v, ok := args["metadataPrompt"]; ok {
		existing.MetadataPrompt = v.(string)
	}
	if v, ok := args["interpreter"]; ok {
		existing.Interpreter = v.(string)
	}
	if v, ok := args["scriptContent"]; ok {
		existing.ScriptContent = v.(string)
	}

	// Only update triggers if explicitly provided — nil means "don't change"
	onSuccess := stringSliceArg(args, "onSuccess")
	onFailure := stringSliceArg(args, "onFailure")

	// If neither provided, preserve existing triggers
	if onSuccess == nil && onFailure == nil {
		existingSuccess, existingFailure, _, _ := s.jobManager.GetTriggersForJob(id)
		onSuccess = make([]string, len(existingSuccess))
		for i, t := range existingSuccess {
			onSuccess[i] = t.TargetJobID
		}
		onFailure = make([]string, len(existingFailure))
		for i, t := range existingFailure {
			onFailure[i] = t.TargetJobID
		}
	}

	updated, err := s.jobManager.UpdateJob(*existing, onSuccess, onFailure)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(jobToMap(updated))
}

func (s *QuantMCPServer) handleDeleteJob(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.jobManager.DeleteJob(id); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Job %s deleted successfully", id)), nil
}

func (s *QuantMCPServer) handleRunJob(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	run, err := s.jobManager.RunJob(id, "")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(runToMap(run))
}

func (s *QuantMCPServer) handleGetRun(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	runID, err := requiredString(request, "runId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	run, err := s.jobManager.GetRun(runID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(runToMap(run))
}

func (s *QuantMCPServer) handleListRuns(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	jobID, err := requiredString(request, "jobId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	runs, err := s.jobManager.ListRunsByJob(jobID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	result := make([]map[string]any, 0, len(runs))
	for i := range runs {
		result = append(result, runToMap(&runs[i]))
	}

	return marshalResult(result)
}

func (s *QuantMCPServer) handleGetRunOutput(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	runID, err := requiredString(request, "runId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	output, err := s.jobManager.GetRunOutput(runID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(output), nil
}

func (s *QuantMCPServer) handleCancelRun(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	runID, err := requiredString(request, "runId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.jobManager.CancelRun(runID); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Run %s cancelled successfully", runID)), nil
}

func (s *QuantMCPServer) handleGetTriggers(_ context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	jobs, err := s.jobManager.ListJobs()
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	type triggerInfo struct {
		JobID       string   `json:"job_id"`
		JobName     string   `json:"job_name"`
		OnSuccess   []string `json:"on_success"`
		OnFailure   []string `json:"on_failure"`
		TriggeredBy []string `json:"triggered_by"`
	}

	// Build name lookup
	nameMap := make(map[string]string)
	for _, j := range jobs {
		nameMap[j.ID] = j.Name
	}

	var result []triggerInfo
	for _, j := range jobs {
		onSuccess, onFailure, triggeredBy, err := s.jobManager.GetTriggersForJob(j.ID)
		if err != nil {
			continue
		}

		info := triggerInfo{
			JobID:   j.ID,
			JobName: j.Name,
		}
		for _, t := range onSuccess {
			name := nameMap[t.TargetJobID]
			if name == "" {
				name = t.TargetJobID
			}
			info.OnSuccess = append(info.OnSuccess, name)
		}
		for _, t := range onFailure {
			name := nameMap[t.TargetJobID]
			if name == "" {
				name = t.TargetJobID
			}
			info.OnFailure = append(info.OnFailure, name)
		}
		for _, t := range triggeredBy {
			name := nameMap[t.SourceJobID]
			if name == "" {
				name = t.SourceJobID
			}
			info.TriggeredBy = append(info.TriggeredBy, name)
		}

		// Only include jobs that have any trigger connections
		if len(info.OnSuccess) > 0 || len(info.OnFailure) > 0 || len(info.TriggeredBy) > 0 {
			result = append(result, info)
		}
	}

	return marshalResult(result)
}

func (s *QuantMCPServer) handleGetPipelineStatus(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	runID, err := requiredString(request, "runId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	// Build name lookup
	jobs, _ := s.jobManager.ListJobs()
	nameMap := make(map[string]string)
	for _, j := range jobs {
		nameMap[j.ID] = j.Name
	}

	type pipelineStep struct {
		RunID       string `json:"run_id"`
		JobName     string `json:"job_name"`
		Status      string `json:"status"`
		DurationMs  int64  `json:"duration_ms"`
		TokensUsed  int    `json:"tokens_used"`
		TriggeredBy string `json:"triggered_by_run"`
		Error       string `json:"error,omitempty"`
	}

	var steps []pipelineStep
	visited := make(map[string]bool)

	// BFS from the initial run, following triggered_by references
	queue := []string{runID}
	for len(queue) > 0 {
		currentID := queue[0]
		queue = queue[1:]

		if visited[currentID] {
			continue
		}
		visited[currentID] = true

		run, err := s.jobManager.GetRun(currentID)
		if err != nil {
			continue
		}

		step := pipelineStep{
			RunID:       run.ID,
			JobName:     nameMap[run.JobID],
			Status:      run.Status,
			DurationMs:  run.DurationMs,
			TokensUsed:  run.TokensUsed,
			TriggeredBy: run.TriggeredBy,
			Error:       run.ErrorMessage,
		}
		if step.JobName == "" {
			step.JobName = run.JobID
		}
		steps = append(steps, step)

		// Find runs that were triggered by this run
		for _, j := range jobs {
			runs, err := s.jobManager.ListRunsByJob(j.ID)
			if err != nil {
				continue
			}
			for _, r := range runs {
				if r.TriggeredBy == currentID && !visited[r.ID] {
					queue = append(queue, r.ID)
				}
			}
		}
	}

	return marshalResult(steps)
}

// ---------------------------------------------------------------------------
// Agent handlers
// ---------------------------------------------------------------------------

func (s *QuantMCPServer) handleListAgents(_ context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agents, err := s.agentManager.ListAgents()
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	result := make([]map[string]any, 0, len(agents))
	for i := range agents {
		result = append(result, agentToMap(&agents[i]))
	}

	return marshalResult(result)
}

func (s *QuantMCPServer) handleGetAgent(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	agent, err := s.agentManager.GetAgent(id)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if agent == nil {
		return mcp.NewToolResultError(fmt.Sprintf("agent not found: %s", id)), nil
	}

	return marshalResult(agentToMap(agent))
}

func (s *QuantMCPServer) handleCreateAgent(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := request.GetArguments()

	agent := entity.Agent{
		Name:           stringArg(args, "name"),
		Color:          stringArg(args, "color"),
		Role:           stringArg(args, "role"),
		Goal:           stringArg(args, "goal"),
		Model:          stringArg(args, "model"),
		AutonomousMode: true,
	}

	if v, ok := args["autonomousMode"]; ok {
		agent.AutonomousMode, _ = v.(bool)
	}

	agent.Boundaries = stringSliceArg(args, "boundaries")
	if agent.Boundaries == nil {
		agent.Boundaries = []string{}
	}

	agent.Skills = mapBoolArg(args, "skills")
	agent.McpServers = mapBoolArg(args, "mcpServers")
	agent.EnvVariables = mapStringArg(args, "envVariables")

	created, err := s.agentManager.CreateAgent(agent)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(agentToMap(created))
}

func (s *QuantMCPServer) handleUpdateAgent(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := request.GetArguments()

	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	existing, err := s.agentManager.GetAgent(id)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if existing == nil {
		return mcp.NewToolResultError(fmt.Sprintf("agent not found: %s", id)), nil
	}

	if v, ok := args["name"]; ok {
		existing.Name, _ = v.(string)
	}
	if v, ok := args["color"]; ok {
		existing.Color, _ = v.(string)
	}
	if v, ok := args["role"]; ok {
		existing.Role, _ = v.(string)
	}
	if v, ok := args["goal"]; ok {
		existing.Goal, _ = v.(string)
	}
	if v, ok := args["model"]; ok {
		existing.Model, _ = v.(string)
	}
	if v, ok := args["autonomousMode"]; ok {
		existing.AutonomousMode, _ = v.(bool)
	}
	if _, ok := args["boundaries"]; ok {
		existing.Boundaries = stringSliceArg(args, "boundaries")
		if existing.Boundaries == nil {
			existing.Boundaries = []string{}
		}
	}
	if _, ok := args["skills"]; ok {
		existing.Skills = mapBoolArg(args, "skills")
	}
	if _, ok := args["mcpServers"]; ok {
		existing.McpServers = mapBoolArg(args, "mcpServers")
	}
	if _, ok := args["envVariables"]; ok {
		existing.EnvVariables = mapStringArg(args, "envVariables")
	}

	updated, err := s.agentManager.UpdateAgent(*existing)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(agentToMap(updated))
}

func (s *QuantMCPServer) handleDeleteAgent(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.agentManager.DeleteAgent(id); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Agent %s deleted successfully", id)), nil
}

func (s *QuantMCPServer) handleListAvailableSkills(_ context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	skillsDir := filepath.Join(home, ".claude", "skills")
	entries, err := os.ReadDir(skillsDir)
	if err != nil {
		return marshalResult([]string{})
	}

	var skills []string
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			skillFile := filepath.Join(skillsDir, name, "SKILL.md")
			if _, err := os.Stat(skillFile); err == nil {
				skills = append(skills, name)
			}
			continue
		}
		if strings.HasSuffix(name, ".md") {
			skills = append(skills, strings.TrimSuffix(name, ".md"))
		}
	}

	return marshalResult(skills)
}

func (s *QuantMCPServer) handleListAvailableMcpServers(_ context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	mcpPath := filepath.Join(home, ".mcp.json")
	data, err := os.ReadFile(mcpPath)
	if err != nil {
		return marshalResult([]string{})
	}

	var config map[string]interface{}
	if json.Unmarshal(data, &config) != nil {
		return marshalResult([]string{})
	}

	servers, ok := config["mcpServers"].(map[string]interface{})
	if !ok {
		return marshalResult([]string{})
	}

	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}

	return marshalResult(names)
}

func (s *QuantMCPServer) handleGetAgentSystemPrompt(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	prompt, err := s.agentManager.BuildSystemPrompt(id)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if prompt == "" {
		return mcp.NewToolResultText("(empty system prompt — agent has no role, goal, boundaries, or skills configured)"), nil
	}

	return mcp.NewToolResultText(prompt), nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// enrichJobWithAgent adds agentName and agentRole to a job map when an agent is assigned.
func (s *QuantMCPServer) enrichJobWithAgent(m map[string]any, agentID string) {
	if agentID == "" || s.agentManager == nil {
		return
	}
	agent, err := s.agentManager.GetAgent(agentID)
	if err != nil || agent == nil {
		return
	}
	m["agentName"] = agent.Name
	m["agentRole"] = agent.Role
}

func jobToMap(job *entity.Job) map[string]any {
	if job == nil {
		return nil
	}
	m := map[string]any{
		"id":               job.ID,
		"name":             job.Name,
		"description":      job.Description,
		"type":             job.Type,
		"workingDirectory": job.WorkingDirectory,
		"scheduleEnabled":  job.ScheduleEnabled,
		"scheduleType":     job.ScheduleType,
		"cronExpression":   job.CronExpression,
		"scheduleInterval": job.ScheduleInterval,
		"timeoutSeconds":   job.TimeoutSeconds,
		"prompt":           job.Prompt,
		"allowBypass":      job.AllowBypass,
		"autonomousMode":   job.AutonomousMode,
		"maxRetries":       job.MaxRetries,
		"model":            job.Model,
		"claudeCommand":    job.ClaudeCommand,
		"agentId":          job.AgentID,
		"successPrompt":    job.SuccessPrompt,
		"failurePrompt":    job.FailurePrompt,
		"metadataPrompt":   job.MetadataPrompt,
		"interpreter":      job.Interpreter,
		"scriptContent":    job.ScriptContent,
		"createdAt":        job.CreatedAt,
		"updatedAt":        job.UpdatedAt,
	}
	if job.ScheduleStartTime != nil {
		m["scheduleStartTime"] = *job.ScheduleStartTime
	}
	if job.EnvVariables != nil {
		m["envVariables"] = job.EnvVariables
	}
	return m
}

func runToMap(run *entity.JobRun) map[string]any {
	if run == nil {
		return nil
	}
	m := map[string]any{
		"id":           run.ID,
		"jobId":        run.JobID,
		"status":       run.Status,
		"triggeredBy":  run.TriggeredBy,
		"sessionId":    run.SessionID,
		"modelUsed":    run.ModelUsed,
		"durationMs":   run.DurationMs,
		"tokensUsed":   run.TokensUsed,
		"result":       run.Result,
		"errorMessage": run.ErrorMessage,
		"startedAt":    run.StartedAt,
	}
	if run.FinishedAt != nil {
		m["finishedAt"] = *run.FinishedAt
	}
	return m
}

func marshalResult(v any) (*mcp.CallToolResult, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to serialize result: %s", err.Error())), nil
	}
	return mcp.NewToolResultText(string(data)), nil
}

func requiredString(request mcp.CallToolRequest, key string) (string, error) {
	args := request.GetArguments()
	v, ok := args[key]
	if !ok || v == nil {
		return "", fmt.Errorf("missing required parameter: %s", key)
	}
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("parameter %s must be a string", key)
	}
	return s, nil
}

func stringArg(args map[string]any, key string) string {
	v, ok := args[key]
	if !ok || v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

func boolArg(args map[string]any, key string) bool {
	v, ok := args[key]
	if !ok || v == nil {
		return false
	}
	b, _ := v.(bool)
	return b
}

func intArg(args map[string]any, key string) int {
	v, ok := args[key]
	if !ok || v == nil {
		return 0
	}
	return toInt(v)
}

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return 0
	}
}

func agentToMap(agent *entity.Agent) map[string]any {
	if agent == nil {
		return nil
	}
	return map[string]any{
		"id":             agent.ID,
		"name":           agent.Name,
		"color":          agent.Color,
		"role":           agent.Role,
		"goal":           agent.Goal,
		"model":          agent.Model,
		"autonomousMode": agent.AutonomousMode,
		"mcpServers":     agent.McpServers,
		"envVariables":   agent.EnvVariables,
		"boundaries":     agent.Boundaries,
		"skills":         agent.Skills,
		"createdAt":      agent.CreatedAt,
		"updatedAt":      agent.UpdatedAt,
	}
}

func mapBoolArg(args map[string]any, key string) map[string]bool {
	v, ok := args[key]
	if !ok || v == nil {
		return nil
	}
	// Native JSON object
	if m, ok := v.(map[string]any); ok {
		result := make(map[string]bool, len(m))
		for k, val := range m {
			result[k], _ = val.(bool)
		}
		return result
	}
	// JSON string
	if s, ok := v.(string); ok && s != "" {
		var result map[string]bool
		if json.Unmarshal([]byte(s), &result) == nil {
			return result
		}
	}
	return nil
}

func mapStringArg(args map[string]any, key string) map[string]string {
	v, ok := args[key]
	if !ok || v == nil {
		return nil
	}
	// Native JSON object
	if m, ok := v.(map[string]any); ok {
		result := make(map[string]string, len(m))
		for k, val := range m {
			result[k], _ = val.(string)
		}
		return result
	}
	// JSON string
	if s, ok := v.(string); ok && s != "" {
		var result map[string]string
		if json.Unmarshal([]byte(s), &result) == nil {
			return result
		}
	}
	return nil
}

func stringSliceArg(args map[string]any, key string) []string {
	v, ok := args[key]
	if !ok || v == nil {
		return nil
	}

	// Handle []any (from native JSON arrays)
	if arr, ok := v.([]any); ok {
		result := make([]string, 0, len(arr))
		for _, item := range arr {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	}

	// Handle string (JSON-encoded array from MCP string field)
	if s, ok := v.(string); ok && s != "" {
		s = strings.TrimSpace(s)
		if strings.HasPrefix(s, "[") {
			var result []string
			if err := json.Unmarshal([]byte(s), &result); err == nil {
				return result
			}
		}
	}

	return nil
}
