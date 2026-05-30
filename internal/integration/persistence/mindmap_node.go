// Package persistence contains SQLite implementations of persistence interfaces.
package persistence

import (
	"database/sql"
	"fmt"

	"quant/internal/domain/entity"
	"quant/internal/integration/adapter"
	pdto "quant/internal/integration/persistence/dto"
)

// mindmapPersistence implements the adapter.MindmapPersistence interface using SQLite.
type mindmapPersistence struct {
	db *sql.DB
}

// NewMindmapPersistence creates a new SQLite mindmap persistence implementation.
func NewMindmapPersistence(db *sql.DB) adapter.MindmapPersistence {
	return &mindmapPersistence{db: db}
}

const mindmapNodeColumns = `id, scope_type, scope_id, board, parent_id, kind, label, text, status, note, color, progress, sort_order, created_at, updated_at`

func scanMindmapNodeRow(scanner interface{ Scan(...any) error }) (pdto.MindmapNodeRow, error) {
	var row pdto.MindmapNodeRow
	err := scanner.Scan(
		&row.ID, &row.ScopeType, &row.ScopeID, &row.Board, &row.ParentID, &row.Kind, &row.Label, &row.Text,
		&row.Status, &row.Note, &row.Color, &row.Progress, &row.SortOrder, &row.CreatedAt, &row.UpdatedAt,
	)
	return row, err
}

// FindMindmapNodesByScope retrieves all mindmap nodes for a scope/board ordered for stable rendering.
func (p *mindmapPersistence) FindMindmapNodesByScope(scopeType, scopeID, board string) ([]entity.MindmapNode, error) {
	query := `SELECT ` + mindmapNodeColumns + ` FROM mindmap_nodes WHERE scope_type = ? AND scope_id = ? AND board = ? ORDER BY sort_order ASC, created_at ASC`
	rows, err := p.db.Query(query, scopeType, scopeID, board)
	if err != nil {
		return nil, fmt.Errorf("failed to find mindmap nodes: %w", err)
	}
	defer rows.Close()

	var nodes []entity.MindmapNode
	for rows.Next() {
		row, err := scanMindmapNodeRow(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan mindmap node row: %w", err)
		}
		nodes = append(nodes, row.ToEntity())
	}
	return nodes, rows.Err()
}

// FindMindmapNodeByID retrieves a single mindmap node by its scope, board and ID.
func (p *mindmapPersistence) FindMindmapNodeByID(scopeType, scopeID, board, id string) (*entity.MindmapNode, error) {
	query := `SELECT ` + mindmapNodeColumns + ` FROM mindmap_nodes WHERE scope_type = ? AND scope_id = ? AND board = ? AND id = ?`
	row, err := scanMindmapNodeRow(p.db.QueryRow(query, scopeType, scopeID, board, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to find mindmap node by id: %w", err)
	}

	node := row.ToEntity()
	return &node, nil
}

// SaveMindmapNode upserts a mindmap node.
func (p *mindmapPersistence) SaveMindmapNode(node entity.MindmapNode) error {
	row := pdto.MindmapNodeRowFromEntity(node)

	_, err := p.db.Exec(
		`INSERT OR REPLACE INTO mindmap_nodes (`+mindmapNodeColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		row.ID, row.ScopeType, row.ScopeID, row.Board, row.ParentID, row.Kind, row.Label, row.Text,
		row.Status, row.Note, row.Color, row.Progress, row.SortOrder, row.CreatedAt, row.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save mindmap node: %w", err)
	}
	return nil
}

// DeleteMindmapNode removes a single mindmap node by scope, board and ID.
func (p *mindmapPersistence) DeleteMindmapNode(scopeType, scopeID, board, id string) error {
	_, err := p.db.Exec(
		`DELETE FROM mindmap_nodes WHERE scope_type = ? AND scope_id = ? AND board = ? AND id = ?`,
		scopeType, scopeID, board, id,
	)
	if err != nil {
		return fmt.Errorf("failed to delete mindmap node: %w", err)
	}
	return nil
}

// DeleteMindmapSubtree removes a node and all of its descendants within a scope/board.
func (p *mindmapPersistence) DeleteMindmapSubtree(scopeType, scopeID, board, id string) error {
	nodes, err := p.FindMindmapNodesByScope(scopeType, scopeID, board)
	if err != nil {
		return fmt.Errorf("failed to load mindmap nodes: %w", err)
	}

	// Build child adjacency.
	children := make(map[string][]string, len(nodes))
	for _, n := range nodes {
		children[n.ParentID] = append(children[n.ParentID], n.ID)
	}

	// Collect the id plus all descendants.
	toDelete := []string{id}
	queue := []string{id}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, child := range children[current] {
			toDelete = append(toDelete, child)
			queue = append(queue, child)
		}
	}

	for _, nodeID := range toDelete {
		if err := p.DeleteMindmapNode(scopeType, scopeID, board, nodeID); err != nil {
			return err
		}
	}
	return nil
}

// ClearMindmap removes all mindmap nodes for a scope/board.
func (p *mindmapPersistence) ClearMindmap(scopeType, scopeID, board string) error {
	_, err := p.db.Exec(
		`DELETE FROM mindmap_nodes WHERE scope_type = ? AND scope_id = ? AND board = ?`,
		scopeType, scopeID, board,
	)
	if err != nil {
		return fmt.Errorf("failed to clear mindmap: %w", err)
	}
	return nil
}

// DistinctBoards returns the distinct board names for a scope, ordered alphabetically.
func (p *mindmapPersistence) DistinctBoards(scopeType, scopeID string) ([]string, error) {
	rows, err := p.db.Query(
		`SELECT DISTINCT board FROM mindmap_nodes WHERE scope_type = ? AND scope_id = ? ORDER BY board`,
		scopeType, scopeID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list mindmap boards: %w", err)
	}
	defer rows.Close()

	var boards []string
	for rows.Next() {
		var board string
		if err := rows.Scan(&board); err != nil {
			return nil, fmt.Errorf("failed to scan mindmap board: %w", err)
		}
		boards = append(boards, board)
	}
	return boards, rows.Err()
}

// MoveBoard moves every node of a board from one scope to another, renaming the
// board on collision so node ids never clash with the target PK. Returns the final board name.
func (p *mindmapPersistence) MoveBoard(scopeType, fromScopeID, board, toScopeID string) (string, error) {
	if fromScopeID == toScopeID {
		return "", fmt.Errorf("cannot move mindmap board to the same session")
	}
	if board == "" {
		board = "default"
	}

	// The collision check and the move must be atomic so concurrent session
	// writes can't race between the COUNT and the UPDATE.
	tx, err := p.db.Begin()
	if err != nil {
		return "", fmt.Errorf("failed to begin mindmap board move: %w", err)
	}
	defer tx.Rollback()

	// Compute a collision-free target board name against the target scope.
	const maxCollisionAttempts = 1000
	finalBoard := board
	for attempt := 0; ; attempt++ {
		if attempt > maxCollisionAttempts {
			return "", fmt.Errorf("failed to find a free mindmap board name after %d attempts", maxCollisionAttempts)
		}
		var count int
		if err := tx.QueryRow(
			`SELECT COUNT(*) FROM mindmap_nodes WHERE scope_type = ? AND scope_id = ? AND board = ?`,
			scopeType, toScopeID, finalBoard,
		).Scan(&count); err != nil {
			return "", fmt.Errorf("failed to check mindmap board collision: %w", err)
		}
		if count == 0 {
			break
		}
		switch attempt {
		case 0:
			finalBoard = board + " (moved)"
		default:
			finalBoard = fmt.Sprintf("%s (moved %d)", board, attempt+1)
		}
	}

	result, err := tx.Exec(
		`UPDATE mindmap_nodes SET scope_id = ?, board = ? WHERE scope_type = ? AND scope_id = ? AND board = ?`,
		toScopeID, finalBoard, scopeType, fromScopeID, board,
	)
	if err != nil {
		return "", fmt.Errorf("failed to move mindmap board: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return "", fmt.Errorf("failed to read moved mindmap board rows: %w", err)
	}
	if affected == 0 {
		return "", fmt.Errorf("mindmap board not found: %s", board)
	}

	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("failed to commit mindmap board move: %w", err)
	}

	return finalBoard, nil
}

// RenameBoard renames a board within the same scope, renaming on collision so
// node ids never clash with an existing board's PK. Returns the final board name.
func (p *mindmapPersistence) RenameBoard(scopeType, scopeID, oldName, newName string) (string, error) {
	if oldName == "" {
		oldName = "default"
	}
	if newName == "" {
		newName = "default"
	}
	if oldName == newName {
		return newName, nil
	}

	// The collision check and the rename must be atomic so concurrent writes
	// can't race between the COUNT and the UPDATE.
	tx, err := p.db.Begin()
	if err != nil {
		return "", fmt.Errorf("failed to begin mindmap board rename: %w", err)
	}
	defer tx.Rollback()

	// Compute a collision-free target board name against this scope.
	const maxCollisionAttempts = 1000
	finalBoard := newName
	for attempt := 0; ; attempt++ {
		if attempt > maxCollisionAttempts {
			return "", fmt.Errorf("failed to find a free mindmap board name after %d attempts", maxCollisionAttempts)
		}
		var count int
		if err := tx.QueryRow(
			`SELECT COUNT(*) FROM mindmap_nodes WHERE scope_type = ? AND scope_id = ? AND board = ?`,
			scopeType, scopeID, finalBoard,
		).Scan(&count); err != nil {
			return "", fmt.Errorf("failed to check mindmap board collision: %w", err)
		}
		if count == 0 {
			break
		}
		finalBoard = fmt.Sprintf("%s (%d)", newName, attempt+2)
	}

	result, err := tx.Exec(
		`UPDATE mindmap_nodes SET board = ? WHERE scope_type = ? AND scope_id = ? AND board = ?`,
		finalBoard, scopeType, scopeID, oldName,
	)
	if err != nil {
		return "", fmt.Errorf("failed to rename mindmap board: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return "", fmt.Errorf("failed to read renamed mindmap board rows: %w", err)
	}
	if affected == 0 {
		// An empty board (shown in the UI but with no persisted nodes yet) is
		// indistinguishable from a missing one. Renaming it is harmless — there
		// is nothing to update and the UI tracks the name locally — so treat it
		// as a benign no-op and return the requested name.
		if err := tx.Commit(); err != nil {
			return "", fmt.Errorf("failed to commit mindmap board rename: %w", err)
		}
		return newName, nil
	}

	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("failed to commit mindmap board rename: %w", err)
	}

	return finalBoard, nil
}
