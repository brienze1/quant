// Package controller contains Wails-bound entrypoint controllers.
package controller

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"

	appAdapter "quant/internal/application/adapter"
	"quant/internal/domain/entity"
	intAdapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/dto"
)

// agentController implements the intAdapter.AgentController interface.
type agentController struct {
	ctx              context.Context
	agentManager     appAdapter.AgentManager
	workspaceManager appAdapter.WorkspaceManager
}

// NewAgentController creates a new Wails-bound agent controller.
func NewAgentController(agentManager appAdapter.AgentManager, workspaceManager appAdapter.WorkspaceManager) intAdapter.AgentController {
	return &agentController{
		agentManager:     agentManager,
		workspaceManager: workspaceManager,
	}
}

func (c *agentController) OnStartup(ctx context.Context) {
	c.ctx = ctx
}

func (c *agentController) OnShutdown(_ context.Context) {}

// CreateAgent handles agent creation requests.
func (c *agentController) CreateAgent(request dto.CreateAgentRequest) (*dto.AgentResponse, error) {
	agent := entity.Agent{
		Name:           request.Name,
		Color:          request.Color,
		Role:           request.Role,
		Goal:           request.Goal,
		Model:          request.Model,
		AutonomousMode: request.AutonomousMode,
		McpServers:     request.McpServers,
		EnvVariables:   request.EnvVariables,
		Boundaries:     request.Boundaries,
		Skills:         request.Skills,
		WorkspaceID:    request.WorkspaceID,
	}

	created, err := c.agentManager.CreateAgent(agent)
	if err != nil {
		return nil, err
	}

	return dto.AgentResponseFromEntityPtr(created), nil
}

// UpdateAgent handles agent update requests.
func (c *agentController) UpdateAgent(request dto.UpdateAgentRequest) (*dto.AgentResponse, error) {
	agent := entity.Agent{
		ID:             request.ID,
		Name:           request.Name,
		Color:          request.Color,
		Role:           request.Role,
		Goal:           request.Goal,
		Model:          request.Model,
		AutonomousMode: request.AutonomousMode,
		McpServers:     request.McpServers,
		EnvVariables:   request.EnvVariables,
		Boundaries:     request.Boundaries,
		Skills:         request.Skills,
		WorkspaceID:    request.WorkspaceID,
	}

	updated, err := c.agentManager.UpdateAgent(agent)
	if err != nil {
		return nil, err
	}

	return dto.AgentResponseFromEntityPtr(updated), nil
}

// DeleteAgent handles agent deletion.
func (c *agentController) DeleteAgent(id string) error {
	return c.agentManager.DeleteAgent(id)
}

// GetAgent retrieves an agent by ID.
func (c *agentController) GetAgent(id string) (*dto.AgentResponse, error) {
	agent, err := c.agentManager.GetAgent(id)
	if err != nil {
		return nil, err
	}

	return dto.AgentResponseFromEntityPtr(agent), nil
}

// ListAgents retrieves all agents.
func (c *agentController) ListAgents() ([]dto.AgentResponse, error) {
	agents, err := c.agentManager.ListAgents()
	if err != nil {
		return nil, err
	}

	return dto.AgentResponseListFromEntities(agents), nil
}

// resolveSkillsDir returns the skills directory for the given workspace,
// falling back to ~/.claude/skills when the workspace has no custom path.
// ClaudeConfigPath is the project root; .claude/skills is appended automatically.
func (c *agentController) resolveSkillsDir(workspaceID string) string {
	if workspaceID != "" {
		ws, err := c.workspaceManager.GetWorkspace(workspaceID)
		if err == nil && ws != nil && ws.ClaudeConfigPath != "" {
			return filepath.Join(ws.ClaudeConfigPath, ".claude", "skills")
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".claude", "skills")
}

// resolveMcpConfigPath returns the .mcp.json path for the given workspace,
// falling back to ~/.mcp.json when the workspace has no custom path.
// McpConfigPath is the project root; .mcp.json is appended automatically.
func (c *agentController) resolveMcpConfigPath(workspaceID string) string {
	if workspaceID != "" {
		ws, err := c.workspaceManager.GetWorkspace(workspaceID)
		if err == nil && ws != nil && ws.McpConfigPath != "" {
			return filepath.Join(ws.McpConfigPath, ".mcp.json")
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".mcp.json")
}

// ListAvailableSkills reads Claude skill files from the workspace's configured path or ~/.claude/skills/.
func (c *agentController) ListAvailableSkills(workspaceID string) ([]dto.SkillInfo, error) {
	skillsDir := c.resolveSkillsDir(workspaceID)
	if skillsDir == "" {
		return []dto.SkillInfo{}, nil
	}

	entries, err := os.ReadDir(skillsDir)
	if err != nil {
		return []dto.SkillInfo{}, nil
	}

	var skills []dto.SkillInfo
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() {
			skillFile := filepath.Join(skillsDir, name, "SKILL.md")
			if _, err := os.Stat(skillFile); err == nil {
				skills = append(skills, dto.SkillInfo{
					Name:     name,
					FilePath: skillFile,
				})
			}
			continue
		}
		if strings.HasSuffix(name, ".md") {
			skills = append(skills, dto.SkillInfo{
				Name:     strings.TrimSuffix(name, ".md"),
				FilePath: filepath.Join(skillsDir, name),
			})
		}
	}

	sort.Slice(skills, func(i, j int) bool {
		return skills[i].Name < skills[j].Name
	})

	return skills, nil
}

// ListAvailableMcpServers reads MCP server names from the workspace's configured path or ~/.mcp.json.
func (c *agentController) ListAvailableMcpServers(workspaceID string) ([]string, error) {
	mcpPath := c.resolveMcpConfigPath(workspaceID)
	if mcpPath == "" {
		return []string{}, nil
	}

	data, err := os.ReadFile(mcpPath)
	if err != nil {
		return []string{}, nil
	}

	var config map[string]interface{}
	if json.Unmarshal(data, &config) != nil {
		return []string{}, nil
	}

	servers, ok := config["mcpServers"].(map[string]interface{})
	if !ok {
		return []string{}, nil
	}

	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}

	sort.Strings(names)
	return names, nil
}
