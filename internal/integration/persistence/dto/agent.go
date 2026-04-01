// Package dto contains persistence data transfer objects for SQLite row mapping.
package dto

import (
	"encoding/json"
	"time"

	"quant/internal/domain/entity"
)

// AgentRow represents an agent row in the SQLite database.
type AgentRow struct {
	ID             string
	Name           string
	Color          string
	Role           string
	Goal           string
	Model          string
	AutonomousMode int
	McpServers     string // JSON
	EnvVariables   string // JSON
	Boundaries     string // JSON
	Skills         string // JSON
	CreatedAt      string
	UpdatedAt      string
}

// ToEntity converts an AgentRow to a domain entity.
func (r AgentRow) ToEntity() entity.Agent {
	createdAt, _ := time.Parse(time.RFC3339, r.CreatedAt)
	updatedAt, _ := time.Parse(time.RFC3339, r.UpdatedAt)

	mcpServers := make(map[string]bool)
	if r.McpServers != "" {
		_ = json.Unmarshal([]byte(r.McpServers), &mcpServers)
	}

	envVars := make(map[string]string)
	if r.EnvVariables != "" {
		_ = json.Unmarshal([]byte(r.EnvVariables), &envVars)
	}

	var boundaries []string
	if r.Boundaries != "" {
		_ = json.Unmarshal([]byte(r.Boundaries), &boundaries)
	}

	skills := make(map[string]bool)
	if r.Skills != "" {
		_ = json.Unmarshal([]byte(r.Skills), &skills)
	}

	return entity.Agent{
		ID:             r.ID,
		Name:           r.Name,
		Color:          r.Color,
		Role:           r.Role,
		Goal:           r.Goal,
		Model:          r.Model,
		AutonomousMode: r.AutonomousMode == 1,
		McpServers:     mcpServers,
		EnvVariables:   envVars,
		Boundaries:     boundaries,
		Skills:         skills,
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
	}
}

// AgentRowFromEntity converts a domain entity to an AgentRow.
func AgentRowFromEntity(agent entity.Agent) AgentRow {
	autonomousMode := 0
	if agent.AutonomousMode {
		autonomousMode = 1
	}

	mcpJSON, _ := json.Marshal(agent.McpServers)
	if agent.McpServers == nil {
		mcpJSON = []byte("{}")
	}

	envJSON, _ := json.Marshal(agent.EnvVariables)
	if agent.EnvVariables == nil {
		envJSON = []byte("{}")
	}

	boundJSON, _ := json.Marshal(agent.Boundaries)
	if agent.Boundaries == nil {
		boundJSON = []byte("[]")
	}

	skillsJSON, _ := json.Marshal(agent.Skills)
	if agent.Skills == nil {
		skillsJSON = []byte("{}")
	}

	return AgentRow{
		ID:             agent.ID,
		Name:           agent.Name,
		Color:          agent.Color,
		Role:           agent.Role,
		Goal:           agent.Goal,
		Model:          agent.Model,
		AutonomousMode: autonomousMode,
		McpServers:     string(mcpJSON),
		EnvVariables:   string(envJSON),
		Boundaries:     string(boundJSON),
		Skills:         string(skillsJSON),
		CreatedAt:      agent.CreatedAt.Format(time.RFC3339),
		UpdatedAt:      agent.UpdatedAt.Format(time.RFC3339),
	}
}
