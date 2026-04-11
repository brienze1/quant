// Package dependency contains the dependency injection wiring using lazy initialization.
package dependency

import (
	"database/sql"

	appAdapter "quant/internal/application/adapter"
	"quant/internal/application/service"
	intAdapter "quant/internal/integration/adapter"
	"quant/internal/integration/entrypoint/controller"
	"quant/internal/integration/keybindings"
	"quant/internal/integration/loginitem"
	"quant/internal/integration/notification"
	"quant/internal/integration/persistence"
	"quant/internal/integration/process"
	"quant/internal/integration/worktree"
)

// Injector holds singleton instances and provides lazy initialization.
type Injector struct {
	db            *sql.DB
	changelogData []byte

	agentPersistence     intAdapter.AgentPersistence
	agentManager         appAdapter.AgentManager
	agentController      intAdapter.AgentController
	jobPersistence       intAdapter.JobPersistence
	jobManager           appAdapter.JobManager
	jobController        intAdapter.JobController
	jobScheduler         appAdapter.JobScheduler
	repoPersistence      intAdapter.RepoPersistence
	taskPersistence      intAdapter.TaskPersistence
	actionPersistence    intAdapter.ActionPersistence
	sessionPersistence   intAdapter.SessionPersistence
	processManager       intAdapter.ProcessManager
	worktreeManager      intAdapter.WorktreeManager
	repoManager          appAdapter.RepoManager
	taskManager          appAdapter.TaskManager
	actionLogger         appAdapter.ActionLogger
	sessionManager       appAdapter.SessionManager
	configPersistence    intAdapter.ConfigPersistence
	databaseManager      intAdapter.DatabaseManager
	configManager        appAdapter.ConfigManager
	repoController       intAdapter.RepoController
	taskController       intAdapter.TaskController
	actionController     intAdapter.ActionController
	sessionController    intAdapter.SessionController
	configController     intAdapter.ConfigController
	changelogController  intAdapter.ChangelogController
	workspacePersistence intAdapter.WorkspacePersistence
	workspaceManager     appAdapter.WorkspaceManager
	workspaceController  intAdapter.WorkspaceController
	jobGroupPersistence  intAdapter.JobGroupPersistence
	jobGroupManager      appAdapter.JobGroupManager
	jobGroupController   intAdapter.JobGroupController
}

// NewInjector creates a new dependency injector with the given database connection.
func NewInjector(db *sql.DB, changelogData []byte) *Injector {
	return &Injector{
		db:            db,
		changelogData: changelogData,
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
// On first creation it loads the saved config so CliBinaryPath and CommandOverrides
// are applied immediately, before any session is started.
func (i *Injector) ProcessManager() intAdapter.ProcessManager {
	if i.processManager == nil {
		pm := process.NewProcessManager()
		// Apply CLI binary config from persisted settings so the correct command is
		// used from the very first session, not just after the user opens Settings.
		if cfg, err := i.ConfigPersistence().LoadConfig(); err == nil && cfg != nil {
			pm.UpdateCliBinaryConfig(cfg.CliBinaryPath, cfg.CommandOverrides)
		}
		i.processManager = pm
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
			rp, // UpdateRepo
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
			tp,                  // UpdateTask
			i.RepoPersistence(), // FindRepo
			sp,                  // FindSession
			sp,                  // UpdateSession
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

// ConfigPersistence returns the singleton ConfigPersistence instance.
func (i *Injector) ConfigPersistence() intAdapter.ConfigPersistence {
	if i.configPersistence == nil {
		i.configPersistence = persistence.NewConfigPersistence()
	}
	return i.configPersistence
}

// DatabaseManager returns the singleton DatabaseManager instance.
func (i *Injector) DatabaseManager() intAdapter.DatabaseManager {
	if i.databaseManager == nil {
		i.databaseManager = persistence.NewDatabaseManager(i.db)
	}
	return i.databaseManager
}

// ConfigManager returns the singleton ConfigManager service instance.
func (i *Injector) ConfigManager() appAdapter.ConfigManager {
	if i.configManager == nil {
		cp := i.ConfigPersistence()
		dm := i.DatabaseManager()
		i.configManager = service.NewConfigManagerService(
			cp,                        // LoadConfig
			cp,                        // SaveConfig
			dm,                        // ResetDatabase
			dm,                        // ClearSessionLogs
			dm,                        // GetDatabasePath
			loginitem.NewManager(),    // SetLoginItem
			notification.NewManager(), // SendNotification
			keybindings.NewManager(),  // SetNewLineKey
			i.ProcessManager(),        // UpdateCliBinaryConfig
		)
	}
	return i.configManager
}

// ConfigController returns the singleton ConfigController instance.
func (i *Injector) ConfigController() intAdapter.ConfigController {
	if i.configController == nil {
		i.configController = controller.NewConfigController(i.ConfigManager())
	}
	return i.configController
}

// AgentPersistence returns the singleton AgentPersistence instance.
func (i *Injector) AgentPersistence() intAdapter.AgentPersistence {
	if i.agentPersistence == nil {
		i.agentPersistence = persistence.NewAgentPersistence(i.db)
	}
	return i.agentPersistence
}

// AgentManager returns the singleton AgentManager service instance.
func (i *Injector) AgentManager() appAdapter.AgentManager {
	if i.agentManager == nil {
		ap := i.AgentPersistence()
		i.agentManager = service.NewAgentManagerService(
			ap, // FindAgent
			ap, // SaveAgent
			ap, // UpdateAgent
			ap, // DeleteAgent
		)
	}
	return i.agentManager
}

// AgentController returns the singleton AgentController instance.
func (i *Injector) AgentController() intAdapter.AgentController {
	if i.agentController == nil {
		i.agentController = controller.NewAgentController(i.AgentManager(), i.WorkspaceManager())
	}
	return i.agentController
}

// WorkspacePersistence returns the singleton WorkspacePersistence instance.
func (i *Injector) WorkspacePersistence() intAdapter.WorkspacePersistence {
	if i.workspacePersistence == nil {
		i.workspacePersistence = persistence.NewWorkspacePersistence(i.db)
	}
	return i.workspacePersistence
}

// WorkspaceManager returns the singleton WorkspaceManager service instance.
func (i *Injector) WorkspaceManager() appAdapter.WorkspaceManager {
	if i.workspaceManager == nil {
		wp := i.WorkspacePersistence()
		i.workspaceManager = service.NewWorkspaceManagerService(
			wp,                 // FindWorkspace
			wp,                 // SaveWorkspace
			wp,                 // UpdateWorkspace
			wp,                 // DeleteWorkspace
			i.ConfigManager(),  // ConfigManager
		)
	}
	return i.workspaceManager
}

// WorkspaceController returns the singleton WorkspaceController instance.
func (i *Injector) WorkspaceController() intAdapter.WorkspaceController {
	if i.workspaceController == nil {
		i.workspaceController = controller.NewWorkspaceController(i.WorkspaceManager())
	}
	return i.workspaceController
}

// JobPersistence returns the singleton JobPersistence instance.
func (i *Injector) JobPersistence() intAdapter.JobPersistence {
	if i.jobPersistence == nil {
		i.jobPersistence = persistence.NewJobPersistence(i.db)
	}
	return i.jobPersistence
}

// JobManager returns the singleton JobManager service instance.
func (i *Injector) JobManager() appAdapter.JobManager {
	if i.jobManager == nil {
		jp := i.JobPersistence()
		ap := i.AgentPersistence()
		i.jobManager = service.NewJobManagerService(
			jp, // FindJob
			jp, // SaveJob
			jp, // UpdateJob
			jp, // DeleteJob
			jp, // FindJobTrigger
			jp, // SaveJobTrigger
			jp, // FindJobRun
			jp, // SaveJobRun
			ap, // FindAgent (for system prompt building)
		)
	}
	return i.jobManager
}

// JobScheduler returns the singleton JobScheduler instance.
func (i *Injector) JobScheduler() appAdapter.JobScheduler {
	if i.jobScheduler == nil {
		jp := i.JobPersistence()
		i.jobScheduler = service.NewJobScheduler(
			jp,             // FindJob (for FindScheduledJobs)
			i.JobManager(), // JobManager (for RunJob)
			jp,             // UpdateJob (for disabling one-time schedules)
		)
	}
	return i.jobScheduler
}

// JobController returns the singleton JobController instance.
func (i *Injector) JobController() intAdapter.JobController {
	if i.jobController == nil {
		i.jobController = controller.NewJobController(i.JobManager())
	}
	return i.jobController
}

// JobGroupPersistence returns the singleton JobGroupPersistence instance.
func (i *Injector) JobGroupPersistence() intAdapter.JobGroupPersistence {
	if i.jobGroupPersistence == nil {
		i.jobGroupPersistence = persistence.NewJobGroupPersistence(i.db)
	}
	return i.jobGroupPersistence
}

// JobGroupManager returns the singleton JobGroupManager service instance.
func (i *Injector) JobGroupManager() appAdapter.JobGroupManager {
	if i.jobGroupManager == nil {
		gp := i.JobGroupPersistence()
		i.jobGroupManager = service.NewJobGroupManagerService(
			gp, // FindJobGroup
			gp, // SaveJobGroup
			gp, // UpdateJobGroup
			gp, // DeleteJobGroup
		)
	}
	return i.jobGroupManager
}

// JobGroupController returns the singleton JobGroupController instance.
func (i *Injector) JobGroupController() intAdapter.JobGroupController {
	if i.jobGroupController == nil {
		i.jobGroupController = controller.NewJobGroupController(i.JobGroupManager())
	}
	return i.jobGroupController
}

// ChangelogController returns the singleton ChangelogController instance.
func (i *Injector) ChangelogController() intAdapter.ChangelogController {
	if i.changelogController == nil {
		i.changelogController = controller.NewChangelogController(i.changelogData)
	}
	return i.changelogController
}
