// Package persistence contains persistence implementations.
package persistence

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	"quant/internal/integration/adapter"
)

// databaseManager implements the adapter.DatabaseManager interface.
type databaseManager struct {
	db     *sql.DB
	dbPath string
	logDir string
}

// NewDatabaseManager creates a new database manager implementation.
// Returns the adapter.DatabaseManager interface, not the concrete type.
func NewDatabaseManager(db *sql.DB) adapter.DatabaseManager {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}

	return &databaseManager{
		db:     db,
		dbPath: filepath.Join(homeDir, ".quant", "quant.db"),
		logDir: filepath.Join(homeDir, ".quant", "sessions"),
	}
}

// ResetDatabase truncates all database tables by deleting all rows.
func (m *databaseManager) ResetDatabase() error {
	tables := []string{"actions", "sessions", "tasks", "repos"}

	for _, table := range tables {
		_, err := m.db.Exec(fmt.Sprintf("DELETE FROM %s", table))
		if err != nil {
			return fmt.Errorf("failed to truncate table %s: %w", table, err)
		}
	}

	return nil
}

// ClearSessionLogs removes all files from the session log directory.
func (m *databaseManager) ClearSessionLogs() error {
	entries, err := os.ReadDir(m.logDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to read log directory: %w", err)
	}

	for _, entry := range entries {
		path := filepath.Join(m.logDir, entry.Name())
		err = os.RemoveAll(path)
		if err != nil {
			return fmt.Errorf("failed to remove log entry %s: %w", entry.Name(), err)
		}
	}

	return nil
}

// GetDatabasePath returns the file path to the SQLite database.
func (m *databaseManager) GetDatabasePath() string {
	return m.dbPath
}
