package adapter

import (
	"context"

	"quant/internal/integration/entrypoint/dto"
)

// AgentController defines the interface for the agent entrypoint controller.
// This interface is what the Wails app binds to.
type AgentController interface {
	OnStartup(ctx context.Context)
	OnShutdown(ctx context.Context)
	CreateAgent(request dto.CreateAgentRequest) (*dto.AgentResponse, error)
	UpdateAgent(request dto.UpdateAgentRequest) (*dto.AgentResponse, error)
	DeleteAgent(id string) error
	GetAgent(id string) (*dto.AgentResponse, error)
	ListAgents() ([]dto.AgentResponse, error)
	ListAvailableSkills(workspaceID string) ([]dto.SkillInfo, error)
	ListAvailableMcpServers(workspaceID string) ([]string, error)
}
