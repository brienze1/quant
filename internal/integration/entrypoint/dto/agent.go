// Package dto contains data transfer objects for the entrypoint layer.
package dto

import (
	"quant/internal/domain/entity"
)

// CreateAgentRequest represents the request payload for creating a new agent.
type CreateAgentRequest struct {
	Name           string            `json:"name"`
	Color          string            `json:"color"`
	Role           string            `json:"role"`
	Goal           string            `json:"goal"`
	Model          string            `json:"model"`
	AutonomousMode bool              `json:"autonomousMode"`
	McpServers     map[string]bool   `json:"mcpServers"`
	EnvVariables   map[string]string `json:"envVariables"`
	Boundaries     []string          `json:"boundaries"`
	Skills         map[string]bool   `json:"skills"`
}

// UpdateAgentRequest represents the request payload for updating an existing agent.
type UpdateAgentRequest struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Color          string            `json:"color"`
	Role           string            `json:"role"`
	Goal           string            `json:"goal"`
	Model          string            `json:"model"`
	AutonomousMode bool              `json:"autonomousMode"`
	McpServers     map[string]bool   `json:"mcpServers"`
	EnvVariables   map[string]string `json:"envVariables"`
	Boundaries     []string          `json:"boundaries"`
	Skills         map[string]bool   `json:"skills"`
}

// AgentResponse represents the response payload for agent data.
type AgentResponse struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Color          string            `json:"color"`
	Role           string            `json:"role"`
	Goal           string            `json:"goal"`
	Model          string            `json:"model"`
	AutonomousMode bool              `json:"autonomousMode"`
	McpServers     map[string]bool   `json:"mcpServers"`
	EnvVariables   map[string]string `json:"envVariables"`
	Boundaries     []string          `json:"boundaries"`
	Skills         map[string]bool   `json:"skills"`
	CreatedAt      string            `json:"createdAt"`
	UpdatedAt      string            `json:"updatedAt"`
}

// SkillInfo represents metadata about an available Claude skill.
type SkillInfo struct {
	Name     string `json:"name"`
	FilePath string `json:"filePath"`
}

// AgentResponseFromEntity converts a domain entity to an AgentResponse DTO.
func AgentResponseFromEntity(agent entity.Agent) AgentResponse {
	return AgentResponse{
		ID:             agent.ID,
		Name:           agent.Name,
		Color:          agent.Color,
		Role:           agent.Role,
		Goal:           agent.Goal,
		Model:          agent.Model,
		AutonomousMode: agent.AutonomousMode,
		McpServers:     agent.McpServers,
		EnvVariables:   agent.EnvVariables,
		Boundaries:     agent.Boundaries,
		Skills:         agent.Skills,
		CreatedAt:      agent.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:      agent.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

// AgentResponseFromEntityPtr converts a domain entity pointer to an AgentResponse DTO pointer.
func AgentResponseFromEntityPtr(agent *entity.Agent) *AgentResponse {
	if agent == nil {
		return nil
	}
	response := AgentResponseFromEntity(*agent)
	return &response
}

// AgentResponseListFromEntities converts a slice of domain entities to a slice of AgentResponse DTOs.
func AgentResponseListFromEntities(agents []entity.Agent) []AgentResponse {
	responses := make([]AgentResponse, len(agents))
	for i, agent := range agents {
		responses[i] = AgentResponseFromEntity(agent)
	}
	return responses
}
