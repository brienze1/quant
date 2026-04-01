// Package service contains application service implementations.
package service

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"quant/internal/application/adapter"
	"quant/internal/application/usecase"
	"quant/internal/domain/entity"
)

// agentManagerService implements the adapter.AgentManager interface.
type agentManagerService struct {
	findAgent   usecase.FindAgent
	saveAgent   usecase.SaveAgent
	updateAgent usecase.UpdateAgent
	deleteAgent usecase.DeleteAgent
}

// NewAgentManagerService creates a new agent manager service.
func NewAgentManagerService(
	findAgent usecase.FindAgent,
	saveAgent usecase.SaveAgent,
	updateAgent usecase.UpdateAgent,
	deleteAgent usecase.DeleteAgent,
) adapter.AgentManager {
	return &agentManagerService{
		findAgent:   findAgent,
		saveAgent:   saveAgent,
		updateAgent: updateAgent,
		deleteAgent: deleteAgent,
	}
}

// CreateAgent creates a new agent with a generated ID and timestamps.
func (s *agentManagerService) CreateAgent(agent entity.Agent) (*entity.Agent, error) {
	now := time.Now()
	agent.ID = uuid.New().String()
	agent.CreatedAt = now
	agent.UpdatedAt = now

	if agent.Color == "" {
		agent.Color = "#10B981"
	}

	if err := s.saveAgent.SaveAgent(agent); err != nil {
		return nil, fmt.Errorf("failed to create agent: %w", err)
	}

	return &agent, nil
}

// UpdateAgent updates an existing agent.
func (s *agentManagerService) UpdateAgent(agent entity.Agent) (*entity.Agent, error) {
	existing, err := s.findAgent.FindAgentByID(agent.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to find agent: %w", err)
	}
	if existing == nil {
		return nil, fmt.Errorf("agent not found: %s", agent.ID)
	}

	agent.CreatedAt = existing.CreatedAt
	agent.UpdatedAt = time.Now()

	if err := s.updateAgent.UpdateAgent(agent); err != nil {
		return nil, fmt.Errorf("failed to update agent: %w", err)
	}

	return &agent, nil
}

// DeleteAgent deletes an agent by ID.
func (s *agentManagerService) DeleteAgent(id string) error {
	return s.deleteAgent.DeleteAgent(id)
}

// GetAgent retrieves an agent by ID.
func (s *agentManagerService) GetAgent(id string) (*entity.Agent, error) {
	return s.findAgent.FindAgentByID(id)
}

// ListAgents retrieves all agents.
func (s *agentManagerService) ListAgents() ([]entity.Agent, error) {
	return s.findAgent.FindAllAgents()
}

// BuildSystemPrompt constructs a system prompt from the agent's configuration.
// Uses XML tags for structured sections following Anthropic's prompting best practices.
func (s *agentManagerService) BuildSystemPrompt(agentID string) (string, error) {
	agent, err := s.findAgent.FindAgentByID(agentID)
	if err != nil {
		return "", fmt.Errorf("failed to find agent: %w", err)
	}
	if agent == nil {
		return "", fmt.Errorf("agent not found: %s", agentID)
	}

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

	return sb.String(), nil
}
