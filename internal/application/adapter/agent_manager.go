// Package adapter contains interfaces that application services implement.
package adapter

import "quant/internal/domain/entity"

// AgentManager defines the service interface for agent management operations.
type AgentManager interface {
	CreateAgent(agent entity.Agent) (*entity.Agent, error)
	UpdateAgent(agent entity.Agent) (*entity.Agent, error)
	DeleteAgent(id string) error
	GetAgent(id string) (*entity.Agent, error)
	ListAgents() ([]entity.Agent, error)
	BuildSystemPrompt(agentID string) (string, error)
}
