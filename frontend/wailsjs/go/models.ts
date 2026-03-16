export namespace dto {
	
	export class ActionResponse {
	    id: string;
	    sessionId: string;
	    type: string;
	    content: string;
	    timestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new ActionResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.type = source["type"];
	        this.content = source["content"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class ConfigResponse {
	    startOnLogin: boolean;
	    notifications: boolean;
	    autoUpdate: boolean;
	    autoPull: boolean;
	    defaultPullBranch: string;
	    branchNamePattern: string;
	    deleteBranchOnDone: boolean;
	    branchOverrides: Record<string, string>;
	    useWorktreeDefault: boolean;
	    skipPermissions: boolean;
	    maxConcurrentSessions: number;
	    autoResumeOnStart: boolean;
	    autoStopIdle: boolean;
	    idleTimeoutMinutes: number;
	    dataDirectory: string;
	    worktreeDirectory: string;
	    logDirectory: string;
	    fontFamily: string;
	    fontSize: number;
	    lineHeight: number;
	    cursorStyle: string;
	    cursorBlink: boolean;
	    scrollbackLines: number;
	    newLineKey: string;
	    cliBinaryPath: string;
	    extraCliArgs: string;
	    defaultModel: string;
	    envVariables: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new ConfigResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startOnLogin = source["startOnLogin"];
	        this.notifications = source["notifications"];
	        this.autoUpdate = source["autoUpdate"];
	        this.autoPull = source["autoPull"];
	        this.defaultPullBranch = source["defaultPullBranch"];
	        this.branchNamePattern = source["branchNamePattern"];
	        this.deleteBranchOnDone = source["deleteBranchOnDone"];
	        this.branchOverrides = source["branchOverrides"];
	        this.useWorktreeDefault = source["useWorktreeDefault"];
	        this.skipPermissions = source["skipPermissions"];
	        this.maxConcurrentSessions = source["maxConcurrentSessions"];
	        this.autoResumeOnStart = source["autoResumeOnStart"];
	        this.autoStopIdle = source["autoStopIdle"];
	        this.idleTimeoutMinutes = source["idleTimeoutMinutes"];
	        this.dataDirectory = source["dataDirectory"];
	        this.worktreeDirectory = source["worktreeDirectory"];
	        this.logDirectory = source["logDirectory"];
	        this.fontFamily = source["fontFamily"];
	        this.fontSize = source["fontSize"];
	        this.lineHeight = source["lineHeight"];
	        this.cursorStyle = source["cursorStyle"];
	        this.cursorBlink = source["cursorBlink"];
	        this.scrollbackLines = source["scrollbackLines"];
	        this.newLineKey = source["newLineKey"];
	        this.cliBinaryPath = source["cliBinaryPath"];
	        this.extraCliArgs = source["extraCliArgs"];
	        this.defaultModel = source["defaultModel"];
	        this.envVariables = source["envVariables"];
	    }
	}
	export class CreateRepoRequest {
	    name: string;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateRepoRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	    }
	}
	export class CreateSessionRequest {
	    name: string;
	    description: string;
	    repoId: string;
	    taskId: string;
	    sessionType: string;
	    useWorktree: boolean;
	    skipPermissions: boolean;
	    autoPull: boolean;
	    pullBranch: string;
	    branchNamePattern: string;
	    model: string;
	    extraCliArgs: string;
	    directoryOverride: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateSessionRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.repoId = source["repoId"];
	        this.taskId = source["taskId"];
	        this.sessionType = source["sessionType"];
	        this.useWorktree = source["useWorktree"];
	        this.skipPermissions = source["skipPermissions"];
	        this.autoPull = source["autoPull"];
	        this.pullBranch = source["pullBranch"];
	        this.branchNamePattern = source["branchNamePattern"];
	        this.model = source["model"];
	        this.extraCliArgs = source["extraCliArgs"];
	        this.directoryOverride = source["directoryOverride"];
	    }
	}
	export class CreateTaskRequest {
	    repoId: string;
	    tag: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateTaskRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.repoId = source["repoId"];
	        this.tag = source["tag"];
	        this.name = source["name"];
	    }
	}
	export class RepoResponse {
	    id: string;
	    name: string;
	    path: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new RepoResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class SaveConfigRequest {
	    startOnLogin: boolean;
	    notifications: boolean;
	    autoUpdate: boolean;
	    autoPull: boolean;
	    defaultPullBranch: string;
	    branchNamePattern: string;
	    deleteBranchOnDone: boolean;
	    branchOverrides: Record<string, string>;
	    useWorktreeDefault: boolean;
	    skipPermissions: boolean;
	    maxConcurrentSessions: number;
	    autoResumeOnStart: boolean;
	    autoStopIdle: boolean;
	    idleTimeoutMinutes: number;
	    dataDirectory: string;
	    worktreeDirectory: string;
	    logDirectory: string;
	    fontFamily: string;
	    fontSize: number;
	    lineHeight: number;
	    cursorStyle: string;
	    cursorBlink: boolean;
	    scrollbackLines: number;
	    newLineKey: string;
	    cliBinaryPath: string;
	    extraCliArgs: string;
	    defaultModel: string;
	    envVariables: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new SaveConfigRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startOnLogin = source["startOnLogin"];
	        this.notifications = source["notifications"];
	        this.autoUpdate = source["autoUpdate"];
	        this.autoPull = source["autoPull"];
	        this.defaultPullBranch = source["defaultPullBranch"];
	        this.branchNamePattern = source["branchNamePattern"];
	        this.deleteBranchOnDone = source["deleteBranchOnDone"];
	        this.branchOverrides = source["branchOverrides"];
	        this.useWorktreeDefault = source["useWorktreeDefault"];
	        this.skipPermissions = source["skipPermissions"];
	        this.maxConcurrentSessions = source["maxConcurrentSessions"];
	        this.autoResumeOnStart = source["autoResumeOnStart"];
	        this.autoStopIdle = source["autoStopIdle"];
	        this.idleTimeoutMinutes = source["idleTimeoutMinutes"];
	        this.dataDirectory = source["dataDirectory"];
	        this.worktreeDirectory = source["worktreeDirectory"];
	        this.logDirectory = source["logDirectory"];
	        this.fontFamily = source["fontFamily"];
	        this.fontSize = source["fontSize"];
	        this.lineHeight = source["lineHeight"];
	        this.cursorStyle = source["cursorStyle"];
	        this.cursorBlink = source["cursorBlink"];
	        this.scrollbackLines = source["scrollbackLines"];
	        this.newLineKey = source["newLineKey"];
	        this.cliBinaryPath = source["cliBinaryPath"];
	        this.extraCliArgs = source["extraCliArgs"];
	        this.defaultModel = source["defaultModel"];
	        this.envVariables = source["envVariables"];
	    }
	}
	export class SessionResponse {
	    id: string;
	    name: string;
	    description: string;
	    sessionType: string;
	    status: string;
	    directory: string;
	    worktreePath: string;
	    branchName: string;
	    claudeConvId: string;
	    pid: number;
	    repoId: string;
	    taskId: string;
	    createdAt: string;
	    updatedAt: string;
	    lastActiveAt: string;
	    archivedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new SessionResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.sessionType = source["sessionType"];
	        this.status = source["status"];
	        this.directory = source["directory"];
	        this.worktreePath = source["worktreePath"];
	        this.branchName = source["branchName"];
	        this.claudeConvId = source["claudeConvId"];
	        this.pid = source["pid"];
	        this.repoId = source["repoId"];
	        this.taskId = source["taskId"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.lastActiveAt = source["lastActiveAt"];
	        this.archivedAt = source["archivedAt"];
	    }
	}
	export class TaskResponse {
	    id: string;
	    repoId: string;
	    tag: string;
	    name: string;
	    createdAt: string;
	    updatedAt: string;
	    archivedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new TaskResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.repoId = source["repoId"];
	        this.tag = source["tag"];
	        this.name = source["name"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.archivedAt = source["archivedAt"];
	    }
	}

}

