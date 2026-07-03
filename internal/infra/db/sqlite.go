// Package db contains database connection and migration logic.
package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"

	"quant/internal/infra/paths"
)

// NewSQLiteConnection creates and returns a new SQLite database connection.
// The database file is stored under the quant home directory (honors
// QUANT_HOME so tests / isolated instances can redirect off ~/.quant).
func NewSQLiteConnection() (*sql.DB, error) {
	dbDir := paths.QuantHome()
	err := os.MkdirAll(dbDir, 0755)
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
		model TEXT,
		extra_cli_args TEXT,
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

	jobsTable := `
	CREATE TABLE IF NOT EXISTS jobs (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		type TEXT NOT NULL,
		working_directory TEXT NOT NULL DEFAULT '',
		schedule_enabled INTEGER NOT NULL DEFAULT 0,
		schedule_type TEXT NOT NULL DEFAULT '',
		cron_expression TEXT NOT NULL DEFAULT '',
		schedule_interval INTEGER NOT NULL DEFAULT 0,
		schedule_start_time TEXT,
		timeout_seconds INTEGER NOT NULL DEFAULT 0,
		prompt TEXT NOT NULL DEFAULT '',
		allow_bypass INTEGER NOT NULL DEFAULT 0,
		autonomous_mode INTEGER NOT NULL DEFAULT 0,
		max_retries INTEGER NOT NULL DEFAULT 0,
		model TEXT NOT NULL DEFAULT '',
		override_repo_command TEXT NOT NULL DEFAULT '',
		claude_command TEXT NOT NULL DEFAULT '',
		interpreter TEXT NOT NULL DEFAULT '/bin/bash',
		script_content TEXT NOT NULL DEFAULT '',
		env_variables TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`

	_, err = db.Exec(jobsTable)
	if err != nil {
		return fmt.Errorf("failed to create jobs table: %w", err)
	}

	jobTriggersTable := `
	CREATE TABLE IF NOT EXISTS job_triggers (
		id TEXT PRIMARY KEY,
		source_job_id TEXT NOT NULL,
		target_job_id TEXT NOT NULL,
		trigger_on TEXT NOT NULL,
		FOREIGN KEY (source_job_id) REFERENCES jobs(id) ON DELETE CASCADE,
		FOREIGN KEY (target_job_id) REFERENCES jobs(id) ON DELETE CASCADE
	);`

	_, err = db.Exec(jobTriggersTable)
	if err != nil {
		return fmt.Errorf("failed to create job_triggers table: %w", err)
	}

	jobRunsTable := `
	CREATE TABLE IF NOT EXISTS job_runs (
		id TEXT PRIMARY KEY,
		job_id TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		triggered_by TEXT,
		session_id TEXT,
		correlation_id TEXT NOT NULL DEFAULT '',
		duration_ms INTEGER NOT NULL DEFAULT 0,
		tokens_used INTEGER NOT NULL DEFAULT 0,
		result TEXT NOT NULL DEFAULT '',
		error_message TEXT NOT NULL DEFAULT '',
		started_at TEXT NOT NULL,
		finished_at TEXT,
		FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
		FOREIGN KEY (session_id) REFERENCES sessions(id)
	);`

	_, err = db.Exec(jobRunsTable)
	if err != nil {
		return fmt.Errorf("failed to create job_runs table: %w", err)
	}

	agentsTable := `
	CREATE TABLE IF NOT EXISTS agents (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		color TEXT NOT NULL DEFAULT '#10B981',
		role TEXT NOT NULL DEFAULT '',
		goal TEXT NOT NULL DEFAULT '',
		model TEXT NOT NULL DEFAULT '',
		autonomous_mode INTEGER NOT NULL DEFAULT 1,
		mcp_servers TEXT NOT NULL DEFAULT '{}',
		env_variables TEXT NOT NULL DEFAULT '{}',
		boundaries TEXT NOT NULL DEFAULT '[]',
		skills TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`

	_, err = db.Exec(agentsTable)
	if err != nil {
		return fmt.Errorf("failed to create agents table: %w", err)
	}

	workspacesTable := `
	CREATE TABLE IF NOT EXISTS workspaces (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`

	_, err = db.Exec(workspacesTable)
	if err != nil {
		return fmt.Errorf("failed to create workspaces table: %w", err)
	}

	jobGroupsTable := `
	CREATE TABLE IF NOT EXISTS job_groups (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		workspace_id TEXT DEFAULT 'default',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`

	_, err = db.Exec(jobGroupsTable)
	if err != nil {
		return fmt.Errorf("failed to create job_groups table: %w", err)
	}

	jobGroupMembersTable := `
	CREATE TABLE IF NOT EXISTS job_group_members (
		id TEXT PRIMARY KEY,
		job_group_id TEXT NOT NULL,
		job_id TEXT NOT NULL,
		FOREIGN KEY (job_group_id) REFERENCES job_groups(id) ON DELETE CASCADE,
		FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
	);`

	_, err = db.Exec(jobGroupMembersTable)
	if err != nil {
		return fmt.Errorf("failed to create job_group_members table: %w", err)
	}

	mindmapNodesTable := `
	CREATE TABLE IF NOT EXISTS mindmap_nodes (
		id TEXT NOT NULL,
		scope_type TEXT NOT NULL,
		scope_id TEXT NOT NULL,
		board TEXT NOT NULL DEFAULT 'default',
		parent_id TEXT DEFAULT '',
		kind TEXT NOT NULL DEFAULT 'node',
		label TEXT NOT NULL DEFAULT '',
		text TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'planned',
		note TEXT NOT NULL DEFAULT '',
		color TEXT NOT NULL DEFAULT '',
		progress INTEGER DEFAULT -1,
		sort_order INTEGER DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (scope_type, scope_id, board, id)
	);`

	_, err = db.Exec(mindmapNodesTable)
	if err != nil {
		return fmt.Errorf("failed to create mindmap_nodes table: %w", err)
	}

	// Migrate existing mindmap_nodes tables that predate the board dimension.
	// SQLite cannot ALTER a primary key, so rebuild the table when the board
	// column is absent, preserving existing rows under the 'default' board.
	if err := migrateMindmapNodesBoard(db); err != nil {
		// Keep startup resilient: log and continue.
		fmt.Printf("warning: mindmap_nodes board migration failed: %v\n", err)
	}

	// Add the per-node color column when absent. color is not part of the PK so a
	// plain ADD COLUMN is correct (no table rebuild). Runs after the board
	// migration so the rebuilt table is in place before we inspect it.
	if err := migrateMindmapNodesColor(db); err != nil {
		// Keep startup resilient: log and continue.
		fmt.Printf("warning: mindmap_nodes color migration failed: %v\n", err)
	}

	crewAssignmentsTable := `
	CREATE TABLE IF NOT EXISTS crew_assignments (
		worker_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
		supervisor_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		created_at TEXT NOT NULL
	);`

	_, err = db.Exec(crewAssignmentsTable)
	if err != nil {
		return fmt.Errorf("failed to create crew_assignments table: %w", err)
	}

	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_crew_assignments_supervisor ON crew_assignments(supervisor_session_id);`)
	if err != nil {
		return fmt.Errorf("failed to create crew_assignments supervisor index: %w", err)
	}

	// from_session_id deliberately has NO foreign key: a worker's reports must
	// survive the worker session being deleted.
	crewEnvelopesTable := `
	CREATE TABLE IF NOT EXISTS crew_envelopes (
		id TEXT PRIMARY KEY,
		from_session_id TEXT NOT NULL,
		to_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		type TEXT NOT NULL,
		summary TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'queued',
		created_at TEXT NOT NULL,
		delivered_at TEXT
	);`

	_, err = db.Exec(crewEnvelopesTable)
	if err != nil {
		return fmt.Errorf("failed to create crew_envelopes table: %w", err)
	}

	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_crew_envelopes_to_status ON crew_envelopes(to_session_id, status);`)
	if err != nil {
		return fmt.Errorf("failed to create crew_envelopes recipient index: %w", err)
	}

	crewWatchdogsTable := `
	CREATE TABLE IF NOT EXISTS crew_watchdogs (
		id TEXT PRIMARY KEY,
		worker_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
		supervisor_session_id TEXT NOT NULL,
		expected_by TEXT NOT NULL,
		fired INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL
	);`

	_, err = db.Exec(crewWatchdogsTable)
	if err != nil {
		return fmt.Errorf("failed to create crew_watchdogs table: %w", err)
	}

	crewDeliveryLocksTable := `
	CREATE TABLE IF NOT EXISTS crew_delivery_locks (
		supervisor_session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
		locked INTEGER NOT NULL DEFAULT 0,
		updated_at TEXT NOT NULL
	);`

	_, err = db.Exec(crewDeliveryLocksTable)
	if err != nil {
		return fmt.Errorf("failed to create crew_delivery_locks table: %w", err)
	}

	// Ensure the "Default" workspace always exists.
	var defaultCount int
	_ = db.QueryRow(`SELECT COUNT(*) FROM workspaces WHERE name = 'Default'`).Scan(&defaultCount)
	if defaultCount == 0 {
		now := "2024-01-01T00:00:00Z"
		_, _ = db.Exec(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('default', 'Default', ?, ?)`, now, now)
	}

	// Idempotent ALTER TABLE statements for schema evolution.
	alterStatements := []string{
		`ALTER TABLE jobs ADD COLUMN last_run_at TEXT`,
		`ALTER TABLE sessions ADD COLUMN repo_id TEXT REFERENCES repos(id)`,
		`ALTER TABLE sessions ADD COLUMN task_id TEXT REFERENCES tasks(id)`,
		`ALTER TABLE sessions ADD COLUMN skip_permissions INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE sessions ADD COLUMN archived_at TEXT`,
		`ALTER TABLE tasks ADD COLUMN archived_at TEXT`,
		`ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'claude'`,
		`ALTER TABLE sessions ADD COLUMN model TEXT`,
		`ALTER TABLE sessions ADD COLUMN extra_cli_args TEXT`,
		`ALTER TABLE repos ADD COLUMN closed_at TEXT`,
		`ALTER TABLE jobs ADD COLUMN success_prompt TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE jobs ADD COLUMN failure_prompt TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE jobs ADD COLUMN metadata_prompt TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE job_runs ADD COLUMN model_used TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE jobs ADD COLUMN agent_id TEXT REFERENCES agents(id)`,
		`ALTER TABLE sessions ADD COLUMN workspace_id TEXT DEFAULT 'default'`,
		`ALTER TABLE sessions ADD COLUMN no_flicker INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE jobs ADD COLUMN workspace_id TEXT DEFAULT 'default'`,
		`ALTER TABLE agents ADD COLUMN workspace_id TEXT DEFAULT 'default'`,
		`ALTER TABLE repos ADD COLUMN workspace_id TEXT DEFAULT 'default'`,
		`ALTER TABLE workspaces ADD COLUMN claude_config_path TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE workspaces ADD COLUMN mcp_config_path TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE jobs ADD COLUMN triage_prompt TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE job_runs ADD COLUMN correlation_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE job_runs ADD COLUMN injected_context TEXT NOT NULL DEFAULT ''`,
		// --- issue #50: typed metadata pipeline ---
		// jobs.inputs/outputs hold the declared JobInputSpec/JobOutputSpec
		// arrays (JSON-encoded). job_runs.metadata holds the produced outputs
		// after sentinel extraction + passthrough enforcement and is what
		// downstream triggered jobs receive as inbound. validation_error
		// records a pre-run input gate or output validation failure for the UI.
		// We deliberately ride on upstream's correlation_id + injected_context
		// — no separate correlation_metadata/inbound_metadata columns.
		`ALTER TABLE jobs     ADD COLUMN inputs            TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE jobs     ADD COLUMN outputs           TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE job_runs ADD COLUMN metadata          TEXT NOT NULL DEFAULT '{}'`,
		`ALTER TABLE job_runs ADD COLUMN validation_error  TEXT NOT NULL DEFAULT ''`,
	}
	for _, stmt := range alterStatements {
		// Ignore errors from ALTER TABLE since the column may already exist.
		_, _ = db.Exec(stmt)
	}

	return nil
}

// migrateMindmapNodesBoard upgrades a pre-board mindmap_nodes table to include
// the board column in its primary key, without losing data. It is a no-op when
// the board column already exists (fresh installs, or already-migrated DBs).
func migrateMindmapNodesBoard(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(mindmap_nodes)`)
	if err != nil {
		return fmt.Errorf("failed to read mindmap_nodes table info: %w", err)
	}
	defer rows.Close()

	hasTable := false
	hasBoard := false
	for rows.Next() {
		var (
			cid     int
			name    string
			typ     string
			notNull int
			dflt    sql.NullString
			pk      int
		)
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			return fmt.Errorf("failed to scan mindmap_nodes column info: %w", err)
		}
		hasTable = true
		if name == "board" {
			hasBoard = true
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate mindmap_nodes column info: %w", err)
	}

	// Nothing to do: either the table doesn't exist yet (CREATE handled it with
	// the new schema) or it already has the board column.
	if !hasTable || hasBoard {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin mindmap_nodes migration tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	stmts := []string{
		`CREATE TABLE mindmap_nodes_new (
			id TEXT NOT NULL,
			scope_type TEXT NOT NULL,
			scope_id TEXT NOT NULL,
			board TEXT NOT NULL DEFAULT 'default',
			parent_id TEXT DEFAULT '',
			kind TEXT NOT NULL DEFAULT 'node',
			label TEXT NOT NULL DEFAULT '',
			text TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'planned',
			note TEXT NOT NULL DEFAULT '',
			color TEXT NOT NULL DEFAULT '',
			progress INTEGER DEFAULT -1,
			sort_order INTEGER DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_type, scope_id, board, id)
		)`,
		`INSERT INTO mindmap_nodes_new (id, scope_type, scope_id, board, parent_id, kind, label, text, status, note, color, progress, sort_order, created_at, updated_at)
			SELECT id, scope_type, scope_id, 'default', parent_id, kind, label, text, status, note, '', progress, sort_order, created_at, updated_at FROM mindmap_nodes`,
		`DROP TABLE mindmap_nodes`,
		`ALTER TABLE mindmap_nodes_new RENAME TO mindmap_nodes`,
	}
	for _, stmt := range stmts {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("failed to rebuild mindmap_nodes for board migration: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit mindmap_nodes migration: %w", err)
	}
	return nil
}

// migrateMindmapNodesColor adds the per-node color column when it is absent. It
// is a no-op when the column already exists (fresh installs, or already-migrated
// DBs). color is not part of the primary key, so a plain ADD COLUMN suffices.
func migrateMindmapNodesColor(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(mindmap_nodes)`)
	if err != nil {
		return fmt.Errorf("failed to read mindmap_nodes table info: %w", err)
	}
	defer rows.Close()

	hasTable := false
	hasColor := false
	for rows.Next() {
		var (
			cid     int
			name    string
			typ     string
			notNull int
			dflt    sql.NullString
			pk      int
		)
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			return fmt.Errorf("failed to scan mindmap_nodes column info: %w", err)
		}
		hasTable = true
		if name == "color" {
			hasColor = true
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate mindmap_nodes column info: %w", err)
	}

	// Nothing to do: either the table doesn't exist yet (CREATE handled it with
	// the new schema) or it already has the color column.
	if !hasTable || hasColor {
		return nil
	}

	if _, err := db.Exec(`ALTER TABLE mindmap_nodes ADD COLUMN color TEXT NOT NULL DEFAULT ''`); err != nil {
		return fmt.Errorf("failed to add mindmap_nodes color column: %w", err)
	}
	return nil
}
