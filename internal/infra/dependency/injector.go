// Package dependency contains the dependency injection wiring using lazy initialization.
package dependency

import (
	"database/sql"

	appAdapter "quant/internal/application/adapter"
	"quant/internal/application/service"
	intAdapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/controller"
	"quant/internal/integration/persistence"
	"quant/internal/integration/process"
	"quant/internal/integration/worktree"
)

// Injector holds singleton instances and provides lazy initialization.
type Injector struct {
	db *sql.DB

	repoPersistence    intAdapter.RepoPersistence
	taskPersistence    intAdapter.TaskPersistence
	actionPersistence  intAdapter.ActionPersistence
	sessionPersistence intAdapter.SessionPersistence
	processManager     intAdapter.ProcessManager
	worktreeManager    intAdapter.WorktreeManager
	repoManager        appAdapter.RepoManager
	taskManager        appAdapter.TaskManager
	actionLogger       appAdapter.ActionLogger
	sessionManager     appAdapter.SessionManager
	repoController     intAdapter.RepoController
	taskController     intAdapter.TaskController
	actionController   intAdapter.ActionController
	sessionController  intAdapter.SessionController
}

// NewInjector creates a new dependency injector with the given database connection.
func NewInjector(db *sql.DB) *Injector {
	return &Injector{
		db: db,
	}
}

// RepoPersistence returns the singleton RepoPersistence instance.
func (i *Injector) RepoPersistence() intAdapter.RepoPersistence {
	if i.repoPersistence == nil {
		i.repoPersistence = persistence.NewRepoPersistence(i.db)
	}
	return i.repoPersistence
}

// TaskPersistence returns the singleton TaskPersistence instance.
func (i *Injector) TaskPersistence() intAdapter.TaskPersistence {
	if i.taskPersistence == nil {
		i.taskPersistence = persistence.NewTaskPersistence(i.db)
	}
	return i.taskPersistence
}

// ActionPersistence returns the singleton ActionPersistence instance.
func (i *Injector) ActionPersistence() intAdapter.ActionPersistence {
	if i.actionPersistence == nil {
		i.actionPersistence = persistence.NewActionPersistence(i.db)
	}
	return i.actionPersistence
}

// SessionPersistence returns the singleton SessionPersistence instance.
func (i *Injector) SessionPersistence() intAdapter.SessionPersistence {
	if i.sessionPersistence == nil {
		i.sessionPersistence = persistence.NewSessionPersistence(i.db)
	}
	return i.sessionPersistence
}

// ProcessManager returns the singleton ProcessManager instance.
func (i *Injector) ProcessManager() intAdapter.ProcessManager {
	if i.processManager == nil {
		i.processManager = process.NewProcessManager()
	}
	return i.processManager
}

// WorktreeManager returns the singleton WorktreeManager instance.
func (i *Injector) WorktreeManager() intAdapter.WorktreeManager {
	if i.worktreeManager == nil {
		i.worktreeManager = worktree.NewWorktreeManager()
	}
	return i.worktreeManager
}

// RepoManager returns the singleton RepoManager service instance.
func (i *Injector) RepoManager() appAdapter.RepoManager {
	if i.repoManager == nil {
		rp := i.RepoPersistence()
		i.repoManager = service.NewRepoManagerService(
			rp, // FindRepo
			rp, // SaveRepo
			rp, // DeleteRepo
		)
	}
	return i.repoManager
}

// TaskManager returns the singleton TaskManager service instance.
func (i *Injector) TaskManager() appAdapter.TaskManager {
	if i.taskManager == nil {
		tp := i.TaskPersistence()
		sp := i.SessionPersistence()
		i.taskManager = service.NewTaskManagerService(
			tp,                  // FindTask
			tp,                  // SaveTask
			tp,                  // DeleteTask
			i.RepoPersistence(), // FindRepo
			sp,                  // FindSession
			sp,                  // DeleteSession
		)
	}
	return i.taskManager
}

// ActionLogger returns the singleton ActionLogger service instance.
func (i *Injector) ActionLogger() appAdapter.ActionLogger {
	if i.actionLogger == nil {
		ap := i.ActionPersistence()
		i.actionLogger = service.NewActionLoggerService(
			ap, // FindAction
			ap, // SaveAction
		)
	}
	return i.actionLogger
}

// SessionManager returns the singleton SessionManager service instance.
func (i *Injector) SessionManager() appAdapter.SessionManager {
	if i.sessionManager == nil {
		sp := i.SessionPersistence()
		i.sessionManager = service.NewSessionManagerService(
			sp, // FindSession
			sp, // SaveSession
			sp, // DeleteSession
			sp, // UpdateSession
			i.ProcessManager(),
			i.RepoPersistence(), // FindRepo
			i.WorktreeManager(), // ManageWorktree
		)
	}
	return i.sessionManager
}

// RepoController returns the singleton RepoController instance.
func (i *Injector) RepoController() intAdapter.RepoController {
	if i.repoController == nil {
		i.repoController = controller.NewRepoController(i.RepoManager())
	}
	return i.repoController
}

// TaskController returns the singleton TaskController instance.
func (i *Injector) TaskController() intAdapter.TaskController {
	if i.taskController == nil {
		i.taskController = controller.NewTaskController(i.TaskManager())
	}
	return i.taskController
}

// ActionController returns the singleton ActionController instance.
func (i *Injector) ActionController() intAdapter.ActionController {
	if i.actionController == nil {
		i.actionController = controller.NewActionController(i.ActionLogger())
	}
	return i.actionController
}

// SessionController returns the singleton SessionController instance.
func (i *Injector) SessionController() intAdapter.SessionController {
	if i.sessionController == nil {
		i.sessionController = controller.NewSessionController(i.SessionManager())
	}
	return i.sessionController
}
