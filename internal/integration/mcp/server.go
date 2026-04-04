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

// QuantMCPServer wraps an MCP server that exposes job, agent, session, workspace, and repo management tools.
type QuantMCPServer struct {
	jobManager       appAdapter.JobManager
	agentManager     appAdapter.AgentManager
	sessionManager   appAdapter.SessionManager
	workspaceManager appAdapter.WorkspaceManager
	repoManager      appAdapter.RepoManager
	jobGroupManager  appAdapter.JobGroupManager
	httpServer       *http.Server
}

// NewQuantMCPServer creates a new MCP server with all management tools registered.
func NewQuantMCPServer(jobManager appAdapter.JobManager, agentManager appAdapter.AgentManager, sessionManager appAdapter.SessionManager, workspaceManager appAdapter.WorkspaceManager, repoManager appAdapter.RepoManager, jobGroupManager appAdapter.JobGroupManager) *QuantMCPServer {
	mcpServer := server.NewMCPServer("quant", "1.0.0")

	s := &QuantMCPServer{
		jobManager:       jobManager,
		agentManager:     agentManager,
		sessionManager:   sessionManager,
		workspaceManager: workspaceManager,
		repoManager:      repoManager,
		jobGroupManager:  jobGroupManager,
	}

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
			mcp.WithDescription(`List jobs (lightweight summary: id, name, type, workspaceId, scheduleEnabled, agentName). Optionally filter by workspace. Use get_job(id) for full details.`),
			mcp.WithString("workspaceId", mcp.Description("Filter by workspace ID (optional — omit to list all)")),
		),
		s.handleListJobs,
	)

	// 2. get_job
	mcpServer.AddTool(
		mcp.NewTool("get_job",
			mcp.WithDescription(`Get a job by ID with full configuration. Returns a single job object with all fields.

If the job has an agentId, the response includes agentName and agentRole inline for quick reference. Use get_agent(agentId) for the full agent config (boundaries, skills, env vars, MCP servers).

Use this to inspect a job's prompt, schedule, triggers, and agent assignment before running or modifying it.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job ID (get from list_jobs)")),
		),
		s.handleGetJob,
	)

	// 3. create_job
	mcpServer.AddTool(
		mcp.NewTool("create_job",
			mcp.WithDescription(`Create a new automated job in Quant. Jobs can be:
- 'claude' type: runs a Claude CLI session with a prompt (use for code reviews, analysis, complex tasks)
- 'bash' type: runs a shell script (use for health checks, deployments, notifications, data pipelines)

Jobs run autonomously with permissions bypassed by default. After creating, use update_job to wire trigger chains (onSuccess/onFailure arrays with target job IDs).

Trigger chains: when a job finishes, it can trigger other jobs based on the outcome. Use onSuccess/onFailure to build pipelines like: health-check → deploy (on success) → notify (on deploy success), health-check → incident-report (on failure).

For claude jobs, after execution a second evaluation prompt runs to determine success/failure and extract structured metadata that gets passed to triggered jobs, saving tokens vs passing raw output.

IMPORTANT: timeoutSeconds must be at least 60. For claude jobs, use 600 (10 min) as the default — they need time for the main task plus a follow-up evaluation call. 5 min is tight, 10 min is safe. For bash jobs, 60-120s is usually enough.

The Quant canvas UI auto-refreshes every 10 seconds and auto-layouts new jobs that don't have positions yet. After creating multiple jobs, they will appear organized on the canvas automatically.

Workflow for building pipelines:
1. Create all jobs first (they appear on canvas automatically)
2. Wire triggers with update_job onSuccess/onFailure
3. Use run_job to test the entry point — downstream jobs fire automatically

Returns the created job object with the generated ID. Use this ID for run_job, update_job, list_runs, etc.`),
			mcp.WithString("name", mcp.Required(), mcp.Description("Unique job name (e.g. health-check, deploy-staging, code-review-bot). Shown on canvas nodes")),
			mcp.WithString("description", mcp.Description("What the job does — shown in the canvas UI tooltip and job details")),
			mcp.WithString("type", mcp.Required(), mcp.Description("'claude' for Claude CLI sessions, 'bash' for shell scripts")),
			mcp.WithString("workingDirectory", mcp.Description("Working directory (supports ~/path). Leave empty for home dir. This is where Claude or the script runs")),
			// Schedule
			mcp.WithBoolean("scheduleEnabled", mcp.Description("Enable scheduled execution. False = manual/trigger only. Default: false")),
			mcp.WithString("scheduleType", mcp.Description("'recurring' (repeats on interval/cron) or 'one_time' (runs once then auto-disables). Default: 'recurring'")),
			mcp.WithString("cronExpression", mcp.Description("Cron expression (e.g. '0 9 * * 1-5' for weekdays 9am, '*/30 * * * *' for every 30 min). Alternative to scheduleInterval. Standard 5-field cron format")),
			mcp.WithNumber("scheduleInterval", mcp.Description("Repeat interval in minutes (e.g. 30 for every 30min). Alternative to cronExpression. Simpler but less flexible")),
			mcp.WithNumber("timeoutSeconds", mcp.Description("Max execution time in seconds. Claude jobs: use 600 (10 min, safe default). Bash jobs: 60-120s. Minimum 60. Job process is killed after this")),
			// Claude config
			mcp.WithString("prompt", mcp.Description("Main task prompt for claude jobs. Be specific about what to do, which files to read, which tools to use, and what output format to produce. This is piped to Claude via stdin with -p flag")),
			mcp.WithNumber("maxRetries", mcp.Description("Retry count on failure (claude only). Each retry includes the previous attempt's output as context so Claude can learn from errors. Default: 0")),
			mcp.WithString("model", mcp.Description("Claude model (e.g. 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'). Empty = CLI default. Agent model is used as fallback if set")),
			mcp.WithString("claudeCommand", mcp.Description("Claude CLI command/alias (e.g. 'claude', 'claude-bl'). Supports shell aliases from ~/.zshrc. Default: 'claude'")),
			mcp.WithString("agentId", mcp.Description("Agent ID to use for this job. The agent's role, goal, boundaries, skills, MCP servers, and env vars are injected as a system prompt. Use list_agents to get IDs")),
			mcp.WithString("overrideRepoCommand", mcp.Description("Custom repo command override for Claude CLI (advanced). Overrides the default command used to interact with the repository")),
			mcp.WithString("successPrompt", mcp.Description("How to evaluate success after the main task completes (max 300 chars). E.g. 'All tests passed and PR was created'. Claude runs a second evaluation call using this. Optional — if omitted, exit code determines success")),
			mcp.WithString("failurePrompt", mcp.Description("How to evaluate failure after the main task completes (max 300 chars). E.g. 'Tests failed, build errors, or no PR created'. Used in the evaluation call. Optional")),
			mcp.WithString("metadataPrompt", mcp.Description("What structured data to extract for triggered downstream jobs (max 500 chars). E.g. 'Extract PR URL, test count, error summary as JSON'. This metadata is passed as context to downstream triggered jobs, saving tokens vs passing raw output. Optional")),
			// Bash config
			mcp.WithString("interpreter", mcp.Description("Shell interpreter for bash jobs: '/bin/bash' (default), '/bin/zsh', 'python3', 'node', etc. The scriptContent is piped to this via stdin")),
			mcp.WithString("scriptContent", mcp.Description("Script content for bash jobs. Piped to the interpreter via stdin. Exit 0 = success (fires onSuccess triggers), non-zero = failure (fires onFailure triggers). Stdout/stderr are captured as run output")),
			// Environment
			mcp.WithString("envVariables", mcp.Description("JSON object of environment variables injected at runtime. E.g. '{\"API_KEY\":\"xxx\",\"ENV\":\"prod\"}'. For claude jobs, these are set before the CLI runs. For bash jobs, available in the script. Agent env vars are merged (job takes precedence)")),
			// Triggers
			mcp.WithString("onSuccess", mcp.Description("JSON array of job IDs to trigger on success. E.g. '[\"job-id-1\",\"job-id-2\"]'. All listed jobs run in parallel. Use list_jobs to get IDs")),
			mcp.WithString("onFailure", mcp.Description("JSON array of job IDs to trigger on failure. E.g. '[\"job-id-1\"]'. All listed jobs run in parallel. Use list_jobs to get IDs")),
			// Flags
			mcp.WithBoolean("allowBypass", mcp.Description("Allow --dangerously-skip-permissions flag for claude jobs. Default: true. Set to false to require manual permission grants during execution")),
			mcp.WithBoolean("autonomousMode", mcp.Description("Run in autonomous mode without stopping to ask the user. Default: true. Set to false for interactive jobs that need human approval")),
		),
		s.handleCreateJob,
	)

	// 4. update_job
	mcpServer.AddTool(
		mcp.NewTool("update_job",
			mcp.WithDescription(`Update a job's configuration. Only provided fields are changed — omitted fields keep their current values. Also use this to wire trigger chains by setting onSuccess/onFailure with arrays of target job IDs.

Returns the full updated job object.

Common workflows:
- Wire triggers: update_job(id, onSuccess='["target-job-id"]')
- Change prompt: update_job(id, prompt="new prompt")
- Enable schedule: update_job(id, scheduleEnabled=true, scheduleInterval=30)
- Add evaluation: update_job(id, successPrompt="...", failurePrompt="...")
- Assign agent: update_job(id, agentId="agent-uuid")
- Unassign agent: update_job(id, agentId="")
- Add env vars: update_job(id, envVariables='{"KEY":"value"}')
- Disable bypass: update_job(id, allowBypass=false)`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job ID to update (get from list_jobs)")),
			mcp.WithString("name", mcp.Description("Job name")),
			mcp.WithString("description", mcp.Description("Job description")),
			mcp.WithString("type", mcp.Description("'claude' or 'bash'")),
			mcp.WithString("workingDirectory", mcp.Description("Working directory (supports ~/path)")),
			mcp.WithBoolean("scheduleEnabled", mcp.Description("Enable/disable scheduled execution")),
			mcp.WithString("scheduleType", mcp.Description("'recurring' or 'one_time'")),
			mcp.WithString("cronExpression", mcp.Description("Cron expression (5-field format)")),
			mcp.WithNumber("scheduleInterval", mcp.Description("Interval in minutes")),
			mcp.WithNumber("timeoutSeconds", mcp.Description("Timeout in seconds (min 60)")),
			mcp.WithString("prompt", mcp.Description("Task prompt for claude jobs")),
			mcp.WithNumber("maxRetries", mcp.Description("Retry count on failure (claude jobs)")),
			mcp.WithString("model", mcp.Description("Claude model (e.g. 'claude-sonnet-4-6')")),
			mcp.WithString("claudeCommand", mcp.Description("Claude CLI command/alias")),
			mcp.WithString("agentId", mcp.Description("Agent ID. Use list_agents to get IDs. Set to empty string to unassign")),
			mcp.WithString("overrideRepoCommand", mcp.Description("Custom repo command override (advanced)")),
			mcp.WithString("successPrompt", mcp.Description("Success evaluation criteria (max 300 chars)")),
			mcp.WithString("failurePrompt", mcp.Description("Failure evaluation criteria (max 300 chars)")),
			mcp.WithString("metadataPrompt", mcp.Description("Metadata extraction instructions (max 500 chars)")),
			mcp.WithString("interpreter", mcp.Description("Script interpreter for bash jobs")),
			mcp.WithString("scriptContent", mcp.Description("Script content for bash jobs")),
			mcp.WithString("envVariables", mcp.Description("JSON object of env vars. E.g. '{\"KEY\":\"value\"}'. Replaces existing env vars")),
			mcp.WithString("onSuccess", mcp.Description("JSON array of job IDs to trigger on success. E.g. '[\"id1\",\"id2\"]'. Replaces existing triggers")),
			mcp.WithString("onFailure", mcp.Description("JSON array of job IDs to trigger on failure. E.g. '[\"id1\"]'. Replaces existing triggers")),
			mcp.WithBoolean("allowBypass", mcp.Description("Allow --dangerously-skip-permissions for claude jobs")),
			mcp.WithBoolean("autonomousMode", mcp.Description("Run without stopping to ask the user")),
		),
		s.handleUpdateJob,
	)

	// 5. delete_job
	mcpServer.AddTool(
		mcp.NewTool("delete_job",
			mcp.WithDescription(`Delete a job and all its trigger chains and run history. This is irreversible.

Deleting a job also removes:
- All trigger connections TO and FROM this job (other jobs' onSuccess/onFailure entries referencing this job are cleaned up)
- All run records and their output logs
- The job's position on the canvas

Returns a confirmation message. Use list_jobs to verify deletion.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job ID to delete (get from list_jobs)")),
		),
		s.handleDeleteJob,
	)

	// 6. run_job
	mcpServer.AddTool(
		mcp.NewTool("run_job",
			mcp.WithDescription(`Trigger a job to run immediately. Returns the run object with a run ID and initial status 'pending'.

The job executes asynchronously in a background goroutine:
1. Status transitions: pending → running → success/failed/timed_out
2. If the job has onSuccess/onFailure trigger chains, downstream jobs fire automatically when this run completes
3. For claude jobs with maxRetries > 0, failed runs are automatically retried with the previous output as context

To monitor execution:
- get_run(runId) — check status, duration, tokens used
- get_run_output(runId) — get the live output (updates while running, polled every few seconds)
- get_pipeline_status(runId) — trace the full cascade of triggered downstream jobs

The Quant canvas UI shows running jobs with a pulsing green border and highlights the active pipeline path in real-time.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job ID to run (get from list_jobs)")),
		),
		s.handleRunJob,
	)

	// 6b. rerun_job
	mcpServer.AddTool(
		mcp.NewTool("rerun_job",
			mcp.WithDescription(`Rerun a job preserving the trigger context from a previous run.

When a job was originally triggered by an upstream job, this recreates the same trigger context (metadata or output from the parent run) so the rerun receives the same input as the original.

If the original run was manual (no triggeredBy), this behaves identically to run_job.

Use this instead of run_job when you want to retry a specific run with the same input it originally received.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job ID to rerun (get from list_jobs)")),
			mcp.WithString("originalRunId", mcp.Required(), mcp.Description("Run ID of the original run to replay trigger context from (get from list_runs)")),
		),
		s.handleRerunJob,
	)

	// 7. get_run
	mcpServer.AddTool(
		mcp.NewTool("get_run",
			mcp.WithDescription(`Get details of a specific job run.

Returns a run object with:
- id: unique run ID
- jobId: which job this run belongs to
- status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'timed_out'
- triggeredBy: run ID of the upstream job that triggered this run (empty if manual)
- sessionId: Claude session ID (for claude-type jobs — can be used to view the session)
- modelUsed: which Claude model actually executed (extracted from stream output)
- durationMs: execution time in milliseconds
- tokensUsed: total tokens consumed (input + output, claude jobs only)
- result: the evaluation result text (if successPrompt/failurePrompt configured)
- errorMessage: error details if the run failed
- startedAt: ISO timestamp when execution began
- finishedAt: ISO timestamp when execution completed (null while running)

Use after run_job to check if execution completed, or to inspect historical run details.`),
			mcp.WithString("runId", mcp.Required(), mcp.Description("Run ID (returned by run_job or list_runs)")),
		),
		s.handleGetRun,
	)

	// 8. list_runs
	mcpServer.AddTool(
		mcp.NewTool("list_runs",
			mcp.WithDescription(`List runs for a job, sorted by most recent first. Paginated — default limit 10.

Returns lightweight summaries: id, status, durationMs, tokensUsed, startedAt, finishedAt, errorMessage (if failed).
Use get_run(id) for full details. Use get_run_output(id) for logs.`),
			mcp.WithString("jobId", mcp.Required(), mcp.Description("Job ID (get from list_jobs)")),
			mcp.WithNumber("limit", mcp.Description("Max runs to return (default 10)")),
			mcp.WithNumber("offset", mcp.Description("Skip this many runs (default 0, for pagination)")),
		),
		s.handleListRuns,
	)

	// 9. get_run_output
	mcpServer.AddTool(
		mcp.NewTool("get_run_output",
			mcp.WithDescription(`Get the output/logs of a job run. Paginated — returns a window of the output text.

Supports tail/head/offset for navigating large outputs. Default: last 200 lines (tail). Pass lines=0 for full output (can be very large).

For debugging: start with the default (last 200 lines) to see the end of the run. If you need earlier context, use offset to page backwards.`),
			mcp.WithString("runId", mcp.Required(), mcp.Description("Run ID (from list_runs or run_job)")),
			mcp.WithNumber("lines", mcp.Description("Number of lines to return (default 200, 0 = full output)")),
			mcp.WithNumber("offset", mcp.Description("Skip this many lines from the start (default: show last N lines)")),
			mcp.WithString("mode", mcp.Description("'tail' (default, last N lines) or 'head' (first N lines) or 'offset' (from offset, N lines)")),
		),
		s.handleGetRunOutput,
	)

	// 10. cancel_run
	mcpServer.AddTool(
		mcp.NewTool("cancel_run",
			mcp.WithDescription(`Cancel a currently running job. Kills the process immediately (SIGKILL).

Effects:
- Run status is set to 'cancelled'
- No onSuccess/onFailure triggers are fired (the pipeline stops here)
- Duration is recorded up to the cancellation point
- Any partial output is preserved and accessible via get_run_output

Only works on runs with status 'running' or 'pending'. Returns a confirmation message.`),
			mcp.WithString("runId", mcp.Required(), mcp.Description("Run ID to cancel (from list_runs or run_job)")),
		),
		s.handleCancelRun,
	)

	// 11. get_triggers
	mcpServer.AddTool(
		mcp.NewTool("get_triggers",
			mcp.WithDescription(`Get the full trigger graph showing how all jobs are connected. Returns an array of trigger info objects.

Each object contains:
- job_id: the job's UUID
- job_name: human-readable name
- on_success: array of job names this job triggers on success
- on_failure: array of job names this job triggers on failure
- triggered_by: array of job names that can trigger this job

Only includes jobs that have at least one trigger connection. Use this to:
- Understand the pipeline topology before wiring new connections
- Verify trigger chains are correctly configured after update_job
- Identify entry points (jobs with no triggered_by) and terminal nodes (jobs with no on_success/on_failure)
- Debug why a downstream job didn't fire (check the trigger graph)`),
		),
		s.handleGetTriggers,
	)

	// -----------------------------------------------------------------------
	// Agent tools
	// -----------------------------------------------------------------------

	// 13. list_agents
	mcpServer.AddTool(
		mcp.NewTool("list_agents",
			mcp.WithDescription(`List all agents (lightweight summary: id, name, role, model, color). Use get_agent(id) for full details like boundaries, skills, MCP servers, and env vars.`),
		),
		s.handleListAgents,
	)

	// 14. get_agent
	mcpServer.AddTool(
		mcp.NewTool("get_agent",
			mcp.WithDescription(`Get an agent by ID. Returns full configuration including:
- id, name, color: identity and UI representation
- role: who the agent is (identity, tone, expertise)
- goal: what the agent should achieve (success criteria)
- model: Claude model fallback
- autonomousMode: whether the agent runs without stopping to ask
- boundaries: array of hard rules the agent must never violate
- skills: map of skill name → enabled (from ~/.claude/skills/)
- mcpServers: map of MCP server name → enabled
- envVariables: map of env var name → value (secrets, tokens)
- createdAt, updatedAt: timestamps

Use get_agent_system_prompt(id) to see the actual system prompt that gets injected.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Agent ID (get from list_agents)")),
		),
		s.handleGetAgent,
	)

	// 15. create_agent
	mcpServer.AddTool(
		mcp.NewTool("create_agent",
			mcp.WithDescription(`Create a new agent persona for Claude jobs. Agents are task-specific — create many small focused agents, not monoliths.

An agent's config is injected as a system prompt when a job runs. The system prompt includes:
- role: who the agent is (identity, tone, expertise) — max 500 chars, be semantically dense
- goal: success criteria — max 500 chars
- boundaries: hard rules the agent must never violate (e.g. "never push to main", "never modify production databases")
- skills: which Claude skills the agent can use (from ~/.claude/skills/) — these provide domain-specific knowledge and patterns
- mcpServers: which MCP servers the agent can access (e.g. database, Linear, GitHub)
- envVariables: private secrets only this agent knows (e.g. API tokens, database URLs)
- autonomousMode: true (default) = agent executes without stopping to ask

After creating, assign to a job with update_job(id, agentId="agent-uuid").

Design tips:
- One agent per role: "code_reviewer", "devops_engineer", "data_analyst" — not "do_everything"
- Role should describe expertise and communication style: "Senior Go engineer focused on clean architecture. Direct, concise."
- Goal should be measurable: "Review PR for architectural violations and security issues. Report findings in markdown."
- Boundaries are hard stops, not suggestions: "never push to main", "never run DROP statements"
- Skills provide patterns the agent follows: architecture rules, testing conventions, etc.

Returns the created agent object with generated ID.`),
			mcp.WithString("name", mcp.Required(), mcp.Description("Agent name (e.g. 'code_reviewer', 'devops_engineer', 'data_analyst'). Used in job canvas UI")),
			mcp.WithString("color", mcp.Description("Hex color for UI (e.g. '#10B981' green, '#3B82F6' blue, '#EF4444' red). Default: green")),
			mcp.WithString("role", mcp.Description("Who is this agent? Identity, expertise, and tone. Max 500 chars. Be semantically dense. E.g. 'Senior Go engineer focused on clean architecture and DDD. Direct, concise, prefers code over explanations.'")),
			mcp.WithString("goal", mcp.Description("What does this agent achieve? Measurable success criteria. Max 500 chars. E.g. 'Review changes for architectural violations, security issues, and test coverage. Report findings in structured markdown.'")),
			mcp.WithString("model", mcp.Description("Claude model (e.g. 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'). Used as fallback when the job doesn't specify a model")),
			mcp.WithBoolean("autonomousMode", mcp.Description("Execute without stopping to ask the user. Default: true. Set false for agents that should pause for human approval")),
			mcp.WithString("boundaries", mcp.Description("JSON array of anti-prompt rules. Hard constraints the agent must never violate. E.g. '[\"never push to main\",\"never delete databases\",\"never modify files outside src/\"]'")),
			mcp.WithString("skills", mcp.Description("JSON object of skill toggles. Skills from ~/.claude/skills/ provide domain knowledge. E.g. '{\"architecture\":true,\"bdd-testing\":true}'. Use list_available_skills to see what's available")),
			mcp.WithString("mcpServers", mcp.Description("JSON object of MCP server toggles. Controls which external tools the agent can access. E.g. '{\"dbhub\":true,\"linear\":true,\"figma\":false}'. Use list_available_mcp_servers to see what's configured")),
			mcp.WithString("envVariables", mcp.Description("JSON object of private env vars. Secrets injected into the agent's environment at runtime. E.g. '{\"GITHUB_TOKEN\":\"ghp_xxx\",\"DATABASE_URL\":\"postgres://...\"}'. Only this agent sees these values")),
		),
		s.handleCreateAgent,
	)

	// 16. update_agent
	mcpServer.AddTool(
		mcp.NewTool("update_agent",
			mcp.WithDescription(`Update an agent's configuration. Only provided fields are changed — omitted fields keep their current values.

Note: for map/array fields (boundaries, skills, mcpServers, envVariables), the provided value REPLACES the entire field. To add a single boundary, include all existing ones plus the new one.

Returns the full updated agent object.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Agent ID to update (get from list_agents)")),
			mcp.WithString("name", mcp.Description("Agent name")),
			mcp.WithString("color", mcp.Description("Hex color for UI (e.g. '#10B981')")),
			mcp.WithString("role", mcp.Description("Role description — who the agent is (max 500 chars)")),
			mcp.WithString("goal", mcp.Description("Goal description — success criteria (max 500 chars)")),
			mcp.WithString("model", mcp.Description("Claude model fallback")),
			mcp.WithBoolean("autonomousMode", mcp.Description("Execute without stopping to ask")),
			mcp.WithString("boundaries", mcp.Description("JSON array of anti-prompt rules. REPLACES all existing boundaries")),
			mcp.WithString("skills", mcp.Description("JSON object of skill toggles. REPLACES all existing skills")),
			mcp.WithString("mcpServers", mcp.Description("JSON object of MCP server toggles. REPLACES all existing MCP servers")),
			mcp.WithString("envVariables", mcp.Description("JSON object of env vars. REPLACES all existing env vars")),
		),
		s.handleUpdateAgent,
	)

	// 17. delete_agent
	mcpServer.AddTool(
		mcp.NewTool("delete_agent",
			mcp.WithDescription(`Delete an agent permanently. This is irreversible.

Side effects:
- Jobs using this agent will have their agentId cleared (they become agent-less)
- The agent's system prompt will no longer be injected into those jobs
- Existing run history is preserved (historical runs still reference the agent ID)

Returns a confirmation message.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Agent ID to delete (get from list_agents)")),
		),
		s.handleDeleteAgent,
	)

	// 18. list_available_skills
	mcpServer.AddTool(
		mcp.NewTool("list_available_skills",
			mcp.WithDescription(`List all Claude skills available in ~/.claude/skills/. Returns an array of skill name strings.

Skills are markdown files or directories that provide domain-specific knowledge and patterns to Claude. Examples:
- architecture: clean architecture patterns and layer separation rules
- bdd-testing: BDD/Gherkin test writing conventions
- code-review: code review checklist and standards

Use these names as keys in the agent 'skills' parameter. E.g. create_agent(skills='{"architecture":true,"bdd-testing":true}').

Skills are read from the filesystem at agent creation time. The agent's system prompt includes the content of all enabled skills.`),
		),
		s.handleListAvailableSkills,
	)

	// 19. list_available_mcp_servers
	mcpServer.AddTool(
		mcp.NewTool("list_available_mcp_servers",
			mcp.WithDescription(`List all MCP servers configured in ~/.mcp.json. Returns an array of server name strings.

MCP servers provide external tool access to agents. Common examples:
- dbhub: database querying (SQL)
- linear: project management (issues, tasks)
- figma: design file access
- context7: documentation lookup

Use these names as keys in the agent 'mcpServers' parameter. E.g. create_agent(mcpServers='{"dbhub":true,"linear":true}').

When an agent has MCP servers enabled, the Claude CLI session is started with access to those servers' tools.`),
		),
		s.handleListAvailableMcpServers,
	)

	// 20. get_agent_system_prompt
	mcpServer.AddTool(
		mcp.NewTool("get_agent_system_prompt",
			mcp.WithDescription(`Preview the exact system prompt that would be injected for a given agent when a job runs.

The system prompt is constructed from the agent's configuration:
- Role and goal are included as identity context
- Boundaries are listed as hard rules
- Enabled skills have their full markdown content injected
- MCP server access is documented

Use this to debug agent behavior:
- Verify the system prompt reads correctly before running a job
- Check that skills are being included properly
- Ensure boundaries are clear and unambiguous
- Test prompt changes after update_agent

Returns the full system prompt text, or a message indicating the prompt is empty.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Agent ID (get from list_agents)")),
		),
		s.handleGetAgentSystemPrompt,
	)

	// -----------------------------------------------------------------------
	// Session tools
	// -----------------------------------------------------------------------

	mcpServer.AddTool(
		mcp.NewTool("list_sessions",
			mcp.WithDescription(`List sessions (lightweight summary: id, name, status, sessionType, workspaceId, repoId). Optionally filter by workspace. Use get_session(id) for full details.`),
			mcp.WithString("workspaceId", mcp.Description("Filter by workspace ID (optional — omit to list all)")),
		),
		s.handleListSessions,
	)

	mcpServer.AddTool(
		mcp.NewTool("get_session",
			mcp.WithDescription(`Get a session by ID. Returns the full session object including status, directory, branch, PID, and all metadata.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Session ID (get from list_sessions)")),
		),
		s.handleGetSession,
	)

	mcpServer.AddTool(
		mcp.NewTool("create_session",
			mcp.WithDescription(`Create a new session. Sessions can be:
- 'claude' type: a Claude CLI interactive session
- 'terminal' type: a plain terminal session

Returns the created session object with generated ID. The session starts in 'idle' status — use start_session to begin execution.`),
			mcp.WithString("name", mcp.Required(), mcp.Description("Session name (e.g. 'review-pr-123', 'debug-auth')")),
			mcp.WithString("description", mcp.Description("What this session is for")),
			mcp.WithString("sessionType", mcp.Required(), mcp.Description("'claude' or 'terminal'")),
			mcp.WithString("repoId", mcp.Description("Repository ID to associate with this session (get from list_repos)")),
			mcp.WithString("taskId", mcp.Description("Task ID to associate with this session")),
			mcp.WithString("workspaceId", mcp.Description("Workspace ID to assign the session to")),
			mcp.WithBoolean("useWorktree", mcp.Description("Create a git worktree for this session. Default: false")),
			mcp.WithBoolean("skipPermissions", mcp.Description("Skip permission prompts (--dangerously-skip-permissions). Default: false")),
			mcp.WithString("model", mcp.Description("Claude model for claude sessions (e.g. 'claude-sonnet-4-6')")),
		),
		s.handleCreateSession,
	)

	mcpServer.AddTool(
		mcp.NewTool("start_session",
			mcp.WithDescription(`Start an idle session. The session must be in 'idle' status. Transitions the session to 'running'.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Session ID to start (get from list_sessions)")),
		),
		s.handleStartSession,
	)

	mcpServer.AddTool(
		mcp.NewTool("stop_session",
			mcp.WithDescription(`Stop a running session. Terminates the session process. The session can be resumed later with resume_session.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Session ID to stop")),
		),
		s.handleStopSession,
	)

	mcpServer.AddTool(
		mcp.NewTool("resume_session",
			mcp.WithDescription(`Resume a paused session. Restarts the session process and replays saved terminal output.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Session ID to resume")),
		),
		s.handleResumeSession,
	)

	mcpServer.AddTool(
		mcp.NewTool("delete_session",
			mcp.WithDescription(`Delete a session permanently. Stops the process if running, removes worktree if applicable. This is irreversible.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Session ID to delete")),
		),
		s.handleDeleteSession,
	)

	mcpServer.AddTool(
		mcp.NewTool("send_message",
			mcp.WithDescription(`Send a message to a running session. The message is written to the session's terminal stdin. For claude sessions, this sends text to the Claude CLI.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Session ID (must be running)")),
			mcp.WithString("message", mcp.Required(), mcp.Description("Message text to send to the session")),
		),
		s.handleSendMessage,
	)

	mcpServer.AddTool(
		mcp.NewTool("get_session_output",
			mcp.WithDescription(`Get terminal output of a session. Paginated — default: last 200 lines. Pass lines=0 for full output. Same pagination as get_run_output.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Session ID")),
			mcp.WithNumber("lines", mcp.Description("Number of lines to return (default 200, 0 = full)")),
			mcp.WithNumber("offset", mcp.Description("Skip this many lines from start")),
			mcp.WithString("mode", mcp.Description("'tail' (default), 'head', or 'offset'")),
		),
		s.handleGetSessionOutput,
	)

	mcpServer.AddTool(
		mcp.NewTool("archive_session",
			mcp.WithDescription(`Archive a session. Archived sessions are hidden from the default list but can be unarchived later.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Session ID to archive")),
		),
		s.handleArchiveSession,
	)

	mcpServer.AddTool(
		mcp.NewTool("rename_session",
			mcp.WithDescription(`Rename a session. Updates the session's display name.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Session ID to rename")),
			mcp.WithString("newName", mcp.Required(), mcp.Description("New name for the session")),
		),
		s.handleRenameSession,
	)

	// -----------------------------------------------------------------------
	// Workspace tools
	// -----------------------------------------------------------------------

	mcpServer.AddTool(
		mcp.NewTool("list_workspaces",
			mcp.WithDescription(`List all workspaces. Returns an array of workspace objects with id, name, and timestamps. Workspaces are visual groupings for organizing sessions, jobs, and agents.`),
		),
		s.handleListWorkspaces,
	)

	mcpServer.AddTool(
		mcp.NewTool("create_workspace",
			mcp.WithDescription(`Create a new workspace. Returns the created workspace object with generated ID.`),
			mcp.WithString("name", mcp.Required(), mcp.Description("Workspace name (e.g. 'backend', 'frontend', 'devops')")),
		),
		s.handleCreateWorkspace,
	)

	mcpServer.AddTool(
		mcp.NewTool("delete_workspace",
			mcp.WithDescription(`Delete a workspace permanently. Sessions and jobs in this workspace are not deleted but will become unassigned.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Workspace ID to delete (get from list_workspaces)")),
		),
		s.handleDeleteWorkspace,
	)

	mcpServer.AddTool(
		mcp.NewTool("move_job_to_workspace",
			mcp.WithDescription(`Move a job to a different workspace. Updates the job's workspaceId. Use an empty workspaceId to unassign.`),
			mcp.WithString("jobId", mcp.Required(), mcp.Description("Job ID to move (get from list_jobs)")),
			mcp.WithString("workspaceId", mcp.Required(), mcp.Description("Target workspace ID (get from list_workspaces). Use empty string to unassign")),
		),
		s.handleMoveJobToWorkspace,
	)

	mcpServer.AddTool(
		mcp.NewTool("move_session_to_workspace",
			mcp.WithDescription(`Move a session to a different workspace. Updates the session's workspaceId.`),
			mcp.WithString("sessionId", mcp.Required(), mcp.Description("Session ID")),
			mcp.WithString("workspaceId", mcp.Required(), mcp.Description("Target workspace ID")),
		),
		s.handleMoveSessionToWorkspace,
	)

	mcpServer.AddTool(
		mcp.NewTool("move_agent_to_workspace",
			mcp.WithDescription(`Move an agent to a different workspace. Updates the agent's workspaceId.`),
			mcp.WithString("agentId", mcp.Required(), mcp.Description("Agent ID")),
			mcp.WithString("workspaceId", mcp.Required(), mcp.Description("Target workspace ID")),
		),
		s.handleMoveAgentToWorkspace,
	)

	// -----------------------------------------------------------------------
	// Repo tools
	// -----------------------------------------------------------------------

	mcpServer.AddTool(
		mcp.NewTool("list_repos",
			mcp.WithDescription(`List all repositories for a workspace. Returns an array of repo objects with id, name, path, workspaceId, and timestamps.`),
			mcp.WithString("workspaceId", mcp.Required(), mcp.Description("Workspace ID (get from list_workspaces)")),
		),
		s.handleListRepos,
	)

	// --- Job Group tools ---

	mcpServer.AddTool(
		mcp.NewTool("list_job_groups",
			mcp.WithDescription(`List all job groups for a workspace. Groups visually organize jobs on the canvas. Returns id, name, jobIds array, workspaceId.`),
			mcp.WithString("workspaceId", mcp.Required(), mcp.Description("Workspace ID")),
		),
		s.handleListJobGroups,
	)

	mcpServer.AddTool(
		mcp.NewTool("create_job_group",
			mcp.WithDescription(`Create a new job group with the given jobs. Groups appear as visual containers on the job canvas.`),
			mcp.WithString("name", mcp.Required(), mcp.Description("Group name")),
			mcp.WithString("workspaceId", mcp.Required(), mcp.Description("Workspace ID")),
			mcp.WithString("jobIds", mcp.Required(), mcp.Description("JSON array of job IDs to include. E.g. '[\"job-id-1\",\"job-id-2\"]'")),
		),
		s.handleCreateJobGroup,
	)

	mcpServer.AddTool(
		mcp.NewTool("update_job_group",
			mcp.WithDescription(`Update a job group — rename it or change which jobs belong to it.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job group ID")),
			mcp.WithString("name", mcp.Description("New name (leave empty to keep current)")),
			mcp.WithString("jobIds", mcp.Description("JSON array of job IDs (replaces all current members). E.g. '[\"job-id-1\",\"job-id-2\"]'")),
		),
		s.handleUpdateJobGroup,
	)

	mcpServer.AddTool(
		mcp.NewTool("delete_job_group",
			mcp.WithDescription(`Delete a job group. Jobs are NOT deleted — they just become ungrouped.`),
			mcp.WithString("id", mcp.Required(), mcp.Description("Job group ID")),
		),
		s.handleDeleteJobGroup,
	)

	mcpServer.AddTool(
		mcp.NewTool("add_jobs_to_group",
			mcp.WithDescription(`Add one or more jobs to an existing group without removing current members.`),
			mcp.WithString("groupId", mcp.Required(), mcp.Description("Job group ID")),
			mcp.WithString("jobIds", mcp.Required(), mcp.Description("JSON array of job IDs to add")),
		),
		s.handleAddJobsToGroup,
	)

	mcpServer.AddTool(
		mcp.NewTool("remove_jobs_from_group",
			mcp.WithDescription(`Remove one or more jobs from a group. The jobs are not deleted, just ungrouped.`),
			mcp.WithString("groupId", mcp.Required(), mcp.Description("Job group ID")),
			mcp.WithString("jobIds", mcp.Required(), mcp.Description("JSON array of job IDs to remove")),
		),
		s.handleRemoveJobsFromGroup,
	)

	mcpServer.AddTool(
		mcp.NewTool("move_group_to_workspace",
			mcp.WithDescription(`Move a job group and all its member jobs to a different workspace.`),
			mcp.WithString("groupId", mcp.Required(), mcp.Description("Job group ID")),
			mcp.WithString("workspaceId", mcp.Required(), mcp.Description("Target workspace ID")),
		),
		s.handleMoveGroupToWorkspace,
	)

	// 12. get_pipeline_status
	mcpServer.AddTool(
		mcp.NewTool("get_pipeline_status",
			mcp.WithDescription(`Given a run ID, trace the full chain of triggered runs downstream using BFS. Shows the complete cascade of the pipeline execution.

Returns an array of pipeline step objects, each with:
- run_id: the run's UUID
- job_name: human-readable name of the job
- status: pending/running/success/failed/cancelled/timed_out
- duration_ms: execution time in milliseconds
- tokens_used: total tokens consumed (claude jobs only)
- triggered_by_run: the upstream run ID that triggered this step
- error: error message if the step failed (omitted if empty)

Use after run_job to see the full pipeline execution result without manually checking each job. The first element is always the initial run, followed by downstream triggered runs in BFS order.

Example flow: run_job("health-check") → get_pipeline_status(runId) shows:
1. health-check (success, 45s, 12k tokens)
2. deploy-staging (success, 120s, 8k tokens, triggered by health-check)
3. notify-slack (success, 5s, 0 tokens, triggered by deploy-staging)`),
			mcp.WithString("runId", mcp.Required(), mcp.Description("The initial run ID to trace from (returned by run_job or list_runs)")),
		),
		s.handleGetPipelineStatus,
	)
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

func (s *QuantMCPServer) handleListJobs(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	jobs, err := s.jobManager.ListJobs()
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	wsFilter := stringArg(request.GetArguments(), "workspaceId")

	// Return lightweight summaries — use get_job(id) for full details
	result := make([]map[string]any, 0, len(jobs))
	for i := range jobs {
		j := &jobs[i]
		if wsFilter != "" && j.WorkspaceID != wsFilter {
			continue
		}
		m := map[string]any{
			"id":              j.ID,
			"name":            j.Name,
			"type":            j.Type,
			"workspaceId":     j.WorkspaceID,
			"scheduleEnabled": j.ScheduleEnabled,
		}
		if j.AgentID != "" {
			m["agentId"] = j.AgentID
			if agent, err := s.agentManager.GetAgent(j.AgentID); err == nil && agent != nil {
				m["agentName"] = agent.Name
			}
		}
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
		Name:                stringArg(args, "name"),
		Description:         stringArg(args, "description"),
		Type:                stringArg(args, "type"),
		WorkingDirectory:    stringArg(args, "workingDirectory"),
		ScheduleEnabled:     boolArg(args, "scheduleEnabled"),
		ScheduleType:        stringArg(args, "scheduleType"),
		CronExpression:      stringArg(args, "cronExpression"),
		ScheduleInterval:    intArg(args, "scheduleInterval"),
		TimeoutSeconds:      intArg(args, "timeoutSeconds"),
		Prompt:              stringArg(args, "prompt"),
		AllowBypass:         true,
		AutonomousMode:      true,
		MaxRetries:          intArg(args, "maxRetries"),
		Model:               stringArg(args, "model"),
		ClaudeCommand:       stringArg(args, "claudeCommand"),
		AgentID:             stringArg(args, "agentId"),
		OverrideRepoCommand: stringArg(args, "overrideRepoCommand"),
		SuccessPrompt:       stringArg(args, "successPrompt"),
		FailurePrompt:       stringArg(args, "failurePrompt"),
		MetadataPrompt:      stringArg(args, "metadataPrompt"),
		Interpreter:         stringArg(args, "interpreter"),
		ScriptContent:       stringArg(args, "scriptContent"),
		EnvVariables:        mapStringArg(args, "envVariables"),
	}

	// Allow explicit override of flags (default to true)
	if v, ok := args["allowBypass"]; ok {
		job.AllowBypass, _ = v.(bool)
	}
	if v, ok := args["autonomousMode"]; ok {
		job.AutonomousMode, _ = v.(bool)
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
	if v, ok := args["overrideRepoCommand"]; ok {
		existing.OverrideRepoCommand, _ = v.(string)
	}
	if _, ok := args["envVariables"]; ok {
		existing.EnvVariables = mapStringArg(args, "envVariables")
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

func (s *QuantMCPServer) handleRerunJob(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	originalRunID, err := requiredString(request, "originalRunId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	run, err := s.jobManager.RerunJob(id, originalRunID)
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

	// Paginate
	limit := intArg(request.GetArguments(), "limit")
	offset := intArg(request.GetArguments(), "offset")
	if limit <= 0 {
		limit = 10
	}
	if offset < 0 {
		offset = 0
	}
	total := len(runs)
	if offset >= total {
		return marshalResult(map[string]any{"total": total, "offset": offset, "limit": limit, "runs": []any{}})
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := runs[offset:end]

	// Lightweight summaries
	summaries := make([]map[string]any, 0, len(page))
	for i := range page {
		r := &page[i]
		m := map[string]any{
			"id":         r.ID,
			"status":     r.Status,
			"durationMs": r.DurationMs,
			"tokensUsed": r.TokensUsed,
			"startedAt":  r.StartedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
		if r.FinishedAt != nil {
			m["finishedAt"] = r.FinishedAt.Format("2006-01-02T15:04:05Z07:00")
		}
		if r.ErrorMessage != "" {
			m["errorMessage"] = r.ErrorMessage
		}
		if r.TriggeredBy != "" {
			m["triggeredBy"] = r.TriggeredBy
		}
		summaries = append(summaries, m)
	}

	return marshalResult(map[string]any{"total": total, "offset": offset, "limit": limit, "runs": summaries})
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

	return paginateText(output, request), nil
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

	// Return lightweight summaries — use get_agent(id) for full details
	result := make([]map[string]any, 0, len(agents))
	for i := range agents {
		a := &agents[i]
		result = append(result, map[string]any{
			"id":    a.ID,
			"name":  a.Name,
			"role":  a.Role,
			"model": a.Model,
			"color": a.Color,
		})
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
// Session handlers
// ---------------------------------------------------------------------------

func (s *QuantMCPServer) handleListSessions(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	sessions, err := s.sessionManager.ListSessions()
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	wsFilter := stringArg(request.GetArguments(), "workspaceId")

	// Return lightweight summaries — use get_session(id) for full details
	result := make([]map[string]any, 0, len(sessions))
	for i := range sessions {
		sess := &sessions[i]
		if wsFilter != "" && sess.WorkspaceID != wsFilter {
			continue
		}
		result = append(result, map[string]any{
			"id":          sess.ID,
			"name":        sess.Name,
			"status":      sess.Status,
			"sessionType": sess.SessionType,
			"workspaceId": sess.WorkspaceID,
			"repoId":      sess.RepoID,
		})
	}

	return marshalResult(result)
}

func (s *QuantMCPServer) handleGetSession(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	session, err := s.sessionManager.GetSession(id)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(sessionToMap(session))
}

func (s *QuantMCPServer) handleCreateSession(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	name, err := requiredString(request, "name")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	sessionType, err := requiredString(request, "sessionType")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	args := request.GetArguments()
	description := stringArg(args, "description")
	repoID := stringArg(args, "repoId")
	taskID := stringArg(args, "taskId")

	opts := entity.SessionOptions{
		UseWorktree:     boolArg(args, "useWorktree"),
		SkipPermissions: boolArg(args, "skipPermissions"),
		Model:           stringArg(args, "model"),
		WorkspaceID:     stringArg(args, "workspaceId"),
		NoFlicker:       true,
	}

	session, err := s.sessionManager.CreateSession(name, description, sessionType, repoID, taskID, opts)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(sessionToMap(session))
}

func (s *QuantMCPServer) handleStartSession(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.sessionManager.StartSession(id, 40, 120); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Session %s started successfully", id)), nil
}

func (s *QuantMCPServer) handleStopSession(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.sessionManager.StopSession(id); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Session %s stopped successfully", id)), nil
}

func (s *QuantMCPServer) handleResumeSession(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.sessionManager.ResumeSession(id, 40, 120); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Session %s resumed successfully", id)), nil
}

func (s *QuantMCPServer) handleDeleteSession(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.sessionManager.DeleteSession(id); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Session %s deleted successfully", id)), nil
}

func (s *QuantMCPServer) handleSendMessage(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	message, err := requiredString(request, "message")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.sessionManager.SendMessage(id, message); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Message sent to session %s", id)), nil
}

func (s *QuantMCPServer) handleGetSessionOutput(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	output, err := s.sessionManager.GetSessionOutput(id)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return paginateText(output, request), nil
}

func (s *QuantMCPServer) handleArchiveSession(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.sessionManager.ArchiveSession(id); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Session %s archived successfully", id)), nil
}

func (s *QuantMCPServer) handleRenameSession(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	newName, err := requiredString(request, "newName")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.sessionManager.RenameSession(id, newName); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Session %s renamed to '%s'", id, newName)), nil
}

// ---------------------------------------------------------------------------
// Workspace handlers
// ---------------------------------------------------------------------------

func (s *QuantMCPServer) handleListWorkspaces(_ context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	workspaces, err := s.workspaceManager.ListWorkspaces()
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	result := make([]map[string]any, 0, len(workspaces))
	for i := range workspaces {
		result = append(result, workspaceToMap(&workspaces[i]))
	}

	return marshalResult(result)
}

func (s *QuantMCPServer) handleCreateWorkspace(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	name, err := requiredString(request, "name")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	workspace, err := s.workspaceManager.CreateWorkspace(entity.Workspace{Name: name})
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(workspaceToMap(workspace))
}

func (s *QuantMCPServer) handleDeleteWorkspace(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.workspaceManager.DeleteWorkspace(id); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Workspace %s deleted successfully", id)), nil
}

func (s *QuantMCPServer) handleMoveJobToWorkspace(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	jobID, err := requiredString(request, "jobId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	workspaceID, err := requiredString(request, "workspaceId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	job, err := s.jobManager.GetJob(jobID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	job.WorkspaceID = workspaceID

	// Preserve existing triggers
	existingSuccess, existingFailure, _, _ := s.jobManager.GetTriggersForJob(jobID)
	onSuccess := make([]string, len(existingSuccess))
	for i, t := range existingSuccess {
		onSuccess[i] = t.TargetJobID
	}
	onFailure := make([]string, len(existingFailure))
	for i, t := range existingFailure {
		onFailure[i] = t.TargetJobID
	}

	updated, err := s.jobManager.UpdateJob(*job, onSuccess, onFailure)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(jobToMap(updated))
}

func (s *QuantMCPServer) handleMoveSessionToWorkspace(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	sessionID, err := requiredString(request, "sessionId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	workspaceID, err := requiredString(request, "workspaceId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := s.sessionManager.UpdateSessionWorkspace(sessionID, workspaceID); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Session %s moved to workspace %s", sessionID, workspaceID)), nil
}

func (s *QuantMCPServer) handleMoveAgentToWorkspace(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID, err := requiredString(request, "agentId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	workspaceID, err := requiredString(request, "workspaceId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	agent, err := s.agentManager.GetAgent(agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if agent == nil {
		return mcp.NewToolResultError("agent not found: " + agentID), nil
	}

	agent.WorkspaceID = workspaceID
	updated, err := s.agentManager.UpdateAgent(*agent)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return marshalResult(map[string]any{"id": updated.ID, "name": updated.Name, "workspaceId": updated.WorkspaceID})
}

// ---------------------------------------------------------------------------
// Repo handlers
// ---------------------------------------------------------------------------

func (s *QuantMCPServer) handleListRepos(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	workspaceID, err := requiredString(request, "workspaceId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	repos, err := s.repoManager.ListReposByWorkspace(workspaceID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	result := make([]map[string]any, 0, len(repos))
	for i := range repos {
		result = append(result, repoToMap(&repos[i]))
	}

	return marshalResult(result)
}

// ---------------------------------------------------------------------------
// Job Group handlers
// ---------------------------------------------------------------------------

func (s *QuantMCPServer) handleListJobGroups(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	workspaceID, err := requiredString(request, "workspaceId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	groups, err := s.jobGroupManager.ListJobGroupsByWorkspace(workspaceID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	result := make([]map[string]any, 0, len(groups))
	for i := range groups {
		result = append(result, jobGroupToMap(&groups[i]))
	}
	return marshalResult(result)
}

func (s *QuantMCPServer) handleCreateJobGroup(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	name, err := requiredString(request, "name")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	workspaceID, err := requiredString(request, "workspaceId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	jobIDs := stringSliceArg(request.GetArguments(), "jobIds")

	group := entity.JobGroup{
		Name:        name,
		WorkspaceID: workspaceID,
		JobIDs:      jobIDs,
	}
	created, err := s.jobGroupManager.CreateJobGroup(group)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return marshalResult(jobGroupToMap(created))
}

func (s *QuantMCPServer) handleUpdateJobGroup(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	existing, err := s.jobGroupManager.GetJobGroup(id)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if existing == nil {
		return mcp.NewToolResultError("job group not found: " + id), nil
	}

	name := stringArg(request.GetArguments(), "name")
	if name != "" {
		existing.Name = name
	}
	jobIDs := stringSliceArg(request.GetArguments(), "jobIds")
	if jobIDs != nil {
		existing.JobIDs = jobIDs
	}

	updated, err := s.jobGroupManager.UpdateJobGroup(*existing)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return marshalResult(jobGroupToMap(updated))
}

func (s *QuantMCPServer) handleDeleteJobGroup(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	id, err := requiredString(request, "id")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if err := s.jobGroupManager.DeleteJobGroup(id); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultText("deleted"), nil
}

func (s *QuantMCPServer) handleAddJobsToGroup(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	groupID, err := requiredString(request, "groupId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	newJobIDs := stringSliceArg(request.GetArguments(), "jobIds")
	if len(newJobIDs) == 0 {
		return mcp.NewToolResultError("jobIds is required"), nil
	}

	existing, err := s.jobGroupManager.GetJobGroup(groupID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if existing == nil {
		return mcp.NewToolResultError("job group not found: " + groupID), nil
	}

	// Merge — add new IDs not already present
	idSet := make(map[string]bool, len(existing.JobIDs))
	for _, id := range existing.JobIDs {
		idSet[id] = true
	}
	for _, id := range newJobIDs {
		if !idSet[id] {
			existing.JobIDs = append(existing.JobIDs, id)
		}
	}

	updated, err := s.jobGroupManager.UpdateJobGroup(*existing)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return marshalResult(jobGroupToMap(updated))
}

func (s *QuantMCPServer) handleRemoveJobsFromGroup(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	groupID, err := requiredString(request, "groupId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	removeIDs := stringSliceArg(request.GetArguments(), "jobIds")
	if len(removeIDs) == 0 {
		return mcp.NewToolResultError("jobIds is required"), nil
	}

	existing, err := s.jobGroupManager.GetJobGroup(groupID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if existing == nil {
		return mcp.NewToolResultError("job group not found: " + groupID), nil
	}

	removeSet := make(map[string]bool, len(removeIDs))
	for _, id := range removeIDs {
		removeSet[id] = true
	}
	filtered := make([]string, 0, len(existing.JobIDs))
	for _, id := range existing.JobIDs {
		if !removeSet[id] {
			filtered = append(filtered, id)
		}
	}
	existing.JobIDs = filtered

	updated, err := s.jobGroupManager.UpdateJobGroup(*existing)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return marshalResult(jobGroupToMap(updated))
}

func (s *QuantMCPServer) handleMoveGroupToWorkspace(_ context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	groupID, err := requiredString(request, "groupId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	workspaceID, err := requiredString(request, "workspaceId")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	// Fetch the group
	existing, err := s.jobGroupManager.GetJobGroup(groupID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if existing == nil {
		return mcp.NewToolResultError("job group not found: " + groupID), nil
	}

	// Move the group itself
	existing.WorkspaceID = workspaceID
	if _, err := s.jobGroupManager.UpdateJobGroup(*existing); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	// Move all member jobs to the same workspace
	for _, jobID := range existing.JobIDs {
		job, jobErr := s.jobManager.GetJob(jobID)
		if jobErr != nil || job == nil {
			continue
		}
		job.WorkspaceID = workspaceID
		onSuccess, onFailure, _, _ := s.jobManager.GetTriggersForJob(jobID)
		successIDs := make([]string, len(onSuccess))
		for i, t := range onSuccess {
			successIDs[i] = t.TargetJobID
		}
		failureIDs := make([]string, len(onFailure))
		for i, t := range onFailure {
			failureIDs[i] = t.TargetJobID
		}
		_, _ = s.jobManager.UpdateJob(*job, successIDs, failureIDs)
	}

	return mcp.NewToolResultText(fmt.Sprintf("moved group '%s' and %d jobs to workspace %s", existing.Name, len(existing.JobIDs), workspaceID)), nil
}

func jobGroupToMap(g *entity.JobGroup) map[string]any {
	jobIDs := g.JobIDs
	if jobIDs == nil {
		jobIDs = []string{}
	}
	return map[string]any{
		"id":          g.ID,
		"name":        g.Name,
		"jobIds":      jobIDs,
		"workspaceId": g.WorkspaceID,
		"createdAt":   g.CreatedAt.Format(time.RFC3339),
		"updatedAt":   g.UpdatedAt.Format(time.RFC3339),
	}
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

// paginateText slices raw text output by lines. Supports three modes:
//   - tail (default): last N lines — best for debugging (see the end of logs)
//   - head: first N lines
//   - offset: from line offset, N lines
//
// Default: 200 lines. Max: 500 lines (to prevent token blowout).
func paginateText(text string, request mcp.CallToolRequest) *mcp.CallToolResult {
	lines := strings.Split(text, "\n")
	totalLines := len(lines)

	limit := intArg(request.GetArguments(), "lines")
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	offset := intArg(request.GetArguments(), "offset")
	mode := stringArg(request.GetArguments(), "mode")
	if mode == "" {
		mode = "tail"
	}

	var start, end int
	switch mode {
	case "head":
		start = 0
		end = limit
	case "offset":
		start = offset
		end = offset + limit
	default: // tail
		start = totalLines - limit
		end = totalLines
	}

	if start < 0 {
		start = 0
	}
	if end > totalLines {
		end = totalLines
	}

	page := strings.Join(lines[start:end], "\n")
	header := fmt.Sprintf("[lines %d-%d of %d total | mode=%s]\n", start+1, end, totalLines, mode)
	return mcp.NewToolResultText(header + page)
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
		"id":                  job.ID,
		"name":                job.Name,
		"description":         job.Description,
		"type":                job.Type,
		"workingDirectory":    job.WorkingDirectory,
		"scheduleEnabled":     job.ScheduleEnabled,
		"scheduleType":        job.ScheduleType,
		"cronExpression":      job.CronExpression,
		"scheduleInterval":    job.ScheduleInterval,
		"timeoutSeconds":      job.TimeoutSeconds,
		"prompt":              job.Prompt,
		"allowBypass":         job.AllowBypass,
		"autonomousMode":      job.AutonomousMode,
		"maxRetries":          job.MaxRetries,
		"model":               job.Model,
		"claudeCommand":       job.ClaudeCommand,
		"agentId":             job.AgentID,
		"overrideRepoCommand": job.OverrideRepoCommand,
		"successPrompt":       job.SuccessPrompt,
		"failurePrompt":       job.FailurePrompt,
		"metadataPrompt":      job.MetadataPrompt,
		"interpreter":         job.Interpreter,
		"scriptContent":       job.ScriptContent,
		"createdAt":           job.CreatedAt,
		"updatedAt":           job.UpdatedAt,
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

func sessionToMap(session *entity.Session) map[string]any {
	if session == nil {
		return nil
	}
	m := map[string]any{
		"id":           session.ID,
		"name":         session.Name,
		"description":  session.Description,
		"sessionType":  session.SessionType,
		"status":       session.Status,
		"directory":    session.Directory,
		"worktreePath": session.WorktreePath,
		"branchName":   session.BranchName,
		"repoId":       session.RepoID,
		"taskId":       session.TaskID,
		"workspaceId":  session.WorkspaceID,
		"model":        session.Model,
		"createdAt":    session.CreatedAt,
		"updatedAt":    session.UpdatedAt,
		"lastActiveAt": session.LastActiveAt,
	}
	if session.ArchivedAt != nil {
		m["archivedAt"] = *session.ArchivedAt
	}
	return m
}

func workspaceToMap(workspace *entity.Workspace) map[string]any {
	if workspace == nil {
		return nil
	}
	return map[string]any{
		"id":        workspace.ID,
		"name":      workspace.Name,
		"createdAt": workspace.CreatedAt,
		"updatedAt": workspace.UpdatedAt,
	}
}

func repoToMap(repo *entity.Repo) map[string]any {
	if repo == nil {
		return nil
	}
	m := map[string]any{
		"id":          repo.ID,
		"name":        repo.Name,
		"path":        repo.Path,
		"workspaceId": repo.WorkspaceID,
		"createdAt":   repo.CreatedAt,
		"updatedAt":   repo.UpdatedAt,
	}
	if repo.ClosedAt != nil {
		m["closedAt"] = *repo.ClosedAt
	}
	return m
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
