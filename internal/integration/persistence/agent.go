// Package persistence contains SQLite implementations of persistence interfaces.
package persistence

import (
	"database/sql"
	"fmt"

	"quant/internal/domain/entity"
	"quant/internal/integration/adapter"
	pdto "quant/internal/integration/persistence/dto"
)

// agentPersistence implements the adapter.AgentPersistence interface using SQLite.
type agentPersistence struct {
	db *sql.DB
}

// NewAgentPersistence creates a new SQLite agent persistence implementation.
func NewAgentPersistence(db *sql.DB) adapter.AgentPersistence {
	return &agentPersistence{db: db}
}

const agentColumns = `id, name, color, role, goal, model, autonomous_mode,
		mcp_servers, env_variables, boundaries, skills, created_at, updated_at`

func scanAgentRow(scanner interface{ Scan(...any) error }) (pdto.AgentRow, error) {
	var row pdto.AgentRow
	err := scanner.Scan(
		&row.ID, &row.Name, &row.Color, &row.Role, &row.Goal, &row.Model,
		&row.AutonomousMode, &row.McpServers, &row.EnvVariables,
		&row.Boundaries, &row.Skills, &row.CreatedAt, &row.UpdatedAt,
	)
	return row, err
}

// FindAgentByID retrieves an agent by its ID.
func (p *agentPersistence) FindAgentByID(id string) (*entity.Agent, error) {
	query := `SELECT ` + agentColumns + ` FROM agents WHERE id = ?`

	row, err := scanAgentRow(p.db.QueryRow(query, id))

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find agent by id: %w", err)
	}

	agent := row.ToEntity()
	return &agent, nil
}

// FindAllAgents retrieves all agents.
func (p *agentPersistence) FindAllAgents() ([]entity.Agent, error) {
	query := `SELECT ` + agentColumns + ` FROM agents ORDER BY created_at DESC`

	rows, err := p.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to find all agents: %w", err)
	}
	defer rows.Close()

	var agents []entity.Agent
	for rows.Next() {
		row, err := scanAgentRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan agent row: %w", err)
		}
		agents = append(agents, row.ToEntity())
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating agent rows: %w", err)
	}

	return agents, nil
}

// SaveAgent persists a new agent to the database.
func (p *agentPersistence) SaveAgent(agent entity.Agent) error {
	row := pdto.AgentRowFromEntity(agent)

	query := `INSERT INTO agents (id, name, color, role, goal, model, autonomous_mode,
		mcp_servers, env_variables, boundaries, skills, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := p.db.Exec(query,
		row.ID, row.Name, row.Color, row.Role, row.Goal, row.Model,
		row.AutonomousMode, row.McpServers, row.EnvVariables,
		row.Boundaries, row.Skills, row.CreatedAt, row.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save agent: %w", err)
	}

	return nil
}

// UpdateAgent updates all fields of an agent.
func (p *agentPersistence) UpdateAgent(agent entity.Agent) error {
	row := pdto.AgentRowFromEntity(agent)

	query := `UPDATE agents SET name = ?, color = ?, role = ?, goal = ?, model = ?,
		autonomous_mode = ?, mcp_servers = ?, env_variables = ?, boundaries = ?,
		skills = ?, updated_at = ? WHERE id = ?`

	result, err := p.db.Exec(query,
		row.Name, row.Color, row.Role, row.Goal, row.Model,
		row.AutonomousMode, row.McpServers, row.EnvVariables, row.Boundaries,
		row.Skills, row.UpdatedAt, row.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update agent: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("agent not found: %s", agent.ID)
	}

	return nil
}

// DeleteAgent removes an agent by its ID.
func (p *agentPersistence) DeleteAgent(id string) error {
	// Clear agent_id from any jobs referencing this agent
	_, _ = p.db.Exec(`UPDATE jobs SET agent_id = NULL WHERE agent_id = ?`, id)

	query := `DELETE FROM agents WHERE id = ?`

	result, err := p.db.Exec(query, id)
	if err != nil {
		return fmt.Errorf("failed to delete agent: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check affected rows: %w", err)
	}

	if affected == 0 {
		return fmt.Errorf("agent not found: %s", id)
	}

	return nil
}
