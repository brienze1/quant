// Package db contains database connection and migration logic.
package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

// NewSQLiteConnection creates and returns a new SQLite database connection.
// The database file is stored in the user's home directory under .quant/.
func NewSQLiteConnection() (*sql.DB, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}

	dbDir := filepath.Join(homeDir, ".quant")
	err = os.MkdirAll(dbDir, 0755)
	if err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	dbPath := filepath.Join(dbDir, "quant.db")

	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	err = db.Ping()
	if err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	err = runMigrations(db)
	if err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	return db, nil
}

// runMigrations creates the required database tables if they do not exist.
func runMigrations(db *sql.DB) error {
	reposTable := `
	CREATE TABLE IF NOT EXISTS repos (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		path TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`

	_, err := db.Exec(reposTable)
	if err != nil {
		return fmt.Errorf("failed to create repos table: %w", err)
	}

	tasksTable := `
	CREATE TABLE IF NOT EXISTS tasks (
		id TEXT PRIMARY KEY,
		repo_id TEXT NOT NULL,
		tag TEXT NOT NULL DEFAULT '',
		name TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		FOREIGN KEY (repo_id) REFERENCES repos(id)
	);`

	_, err = db.Exec(tasksTable)
	if err != nil {
		return fmt.Errorf("failed to create tasks table: %w", err)
	}

	sessionsTable := `
	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT,
		status TEXT NOT NULL DEFAULT 'idle',
		directory TEXT NOT NULL,
		worktree_path TEXT,
		branch_name TEXT,
		claude_conv_id TEXT,
		pid INTEGER NOT NULL DEFAULT 0,
		repo_id TEXT,
		task_id TEXT,
		skip_permissions INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		last_active_at TEXT NOT NULL,
		FOREIGN KEY (repo_id) REFERENCES repos(id),
		FOREIGN KEY (task_id) REFERENCES tasks(id)
	);`

	_, err = db.Exec(sessionsTable)
	if err != nil {
		return fmt.Errorf("failed to create sessions table: %w", err)
	}

	actionsTable := `
	CREATE TABLE IF NOT EXISTS actions (
		id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		type TEXT NOT NULL,
		content TEXT NOT NULL DEFAULT '',
		timestamp TEXT NOT NULL,
		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);`

	_, err = db.Exec(actionsTable)
	if err != nil {
		return fmt.Errorf("failed to create actions table: %w", err)
	}

	// Add repo_id and task_id columns to existing sessions table (idempotent).
	alterStatements := []string{
		`ALTER TABLE sessions ADD COLUMN repo_id TEXT REFERENCES repos(id)`,
		`ALTER TABLE sessions ADD COLUMN task_id TEXT REFERENCES tasks(id)`,
		`ALTER TABLE sessions ADD COLUMN skip_permissions INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE sessions ADD COLUMN archived_at TEXT`,
		`ALTER TABLE tasks ADD COLUMN archived_at TEXT`,
	}
	for _, stmt := range alterStatements {
		// Ignore errors from ALTER TABLE since the column may already exist.
		_, _ = db.Exec(stmt)
	}

	return nil
}
