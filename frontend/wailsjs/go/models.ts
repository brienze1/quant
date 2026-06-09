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
	export class AgentResponse {
	    id: string;
	    name: string;
	    color: string;
	    role: string;
	    goal: string;
	    model: string;
	    autonomousMode: boolean;
	    mcpServers: Record<string, boolean>;
	    envVariables: Record<string, string>;
	    boundaries: string[];
	    skills: Record<string, boolean>;
	    workspaceId: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new AgentResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.role = source["role"];
	        this.goal = source["goal"];
	        this.model = source["model"];
	        this.autonomousMode = source["autonomousMode"];
	        this.mcpServers = source["mcpServers"];
	        this.envVariables = source["envVariables"];
	        this.boundaries = source["boundaries"];
	        this.skills = source["skills"];
	        this.workspaceId = source["workspaceId"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class VoiceConfigDTO {
	    enabled: boolean;
	    provider: string;
	    baseUrl: string;
	    sttBaseUrl: string;
	    ttsBaseUrl: string;
	    apiKey?: string;
	    hasApiKey: boolean;
	    sttModel: string;
	    ttsModel: string;
	    voice: string;
	    speed: number;
	    pauseMs: number;
	    instructions: string;
	
	    static createFrom(source: any = {}) {
	        return new VoiceConfigDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.provider = source["provider"];
	        this.baseUrl = source["baseUrl"];
	        this.sttBaseUrl = source["sttBaseUrl"];
	        this.ttsBaseUrl = source["ttsBaseUrl"];
	        this.apiKey = source["apiKey"];
	        this.hasApiKey = source["hasApiKey"];
	        this.sttModel = source["sttModel"];
	        this.ttsModel = source["ttsModel"];
	        this.voice = source["voice"];
	        this.speed = source["speed"];
	        this.pauseMs = source["pauseMs"];
	        this.instructions = source["instructions"];
	    }
	}
	export class ShortcutDTO {
	    name: string;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new ShortcutDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.command = source["command"];
	    }
	}
	export class ConfigResponse {
	    startOnLogin: boolean;
	    notifications: boolean;
	    autoUpdate: boolean;
	    shortcuts: ShortcutDTO[];
	    autoPull: boolean;
	    defaultPullBranch: string;
	    branchNamePattern: string;
	    deleteBranchOnDone: boolean;
	    branchOverrides: Record<string, string>;
	    commitMessagePrefix: string;
	    useWorktreeDefault: boolean;
	    skipPermissions: boolean;
	    maxConcurrentSessions: number;
	    autoResumeOnStart: boolean;
	    autoStopIdle: boolean;
	    idleTimeoutMinutes: number;
	    activeSessionId: string;
	    openSessionIds: string[];
	    voicePaneOpen: boolean;
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
	    assistantModel: string;
	    envVariables: Record<string, string>;
	    commandOverrides: Record<string, string>;
	    basePersona: string;
	    defaultBasePersona: string;
	    remoteAccessEnabled: boolean;
	    remoteAccessPort: number;
	    remoteAccessPasscode: string;
	    voice: VoiceConfigDTO;

	    static createFrom(source: any = {}) {
	        return new ConfigResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startOnLogin = source["startOnLogin"];
	        this.notifications = source["notifications"];
	        this.autoUpdate = source["autoUpdate"];
	        this.shortcuts = this.convertValues(source["shortcuts"], ShortcutDTO);
	        this.autoPull = source["autoPull"];
	        this.defaultPullBranch = source["defaultPullBranch"];
	        this.branchNamePattern = source["branchNamePattern"];
	        this.deleteBranchOnDone = source["deleteBranchOnDone"];
	        this.branchOverrides = source["branchOverrides"];
	        this.commitMessagePrefix = source["commitMessagePrefix"];
	        this.useWorktreeDefault = source["useWorktreeDefault"];
	        this.skipPermissions = source["skipPermissions"];
	        this.maxConcurrentSessions = source["maxConcurrentSessions"];
	        this.autoResumeOnStart = source["autoResumeOnStart"];
	        this.autoStopIdle = source["autoStopIdle"];
	        this.idleTimeoutMinutes = source["idleTimeoutMinutes"];
	        this.activeSessionId = source["activeSessionId"];
	        this.openSessionIds = source["openSessionIds"];
	        this.voicePaneOpen = source["voicePaneOpen"];
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
	        this.assistantModel = source["assistantModel"];
	        this.envVariables = source["envVariables"];
	        this.commandOverrides = source["commandOverrides"];
	        this.basePersona = source["basePersona"];
	        this.defaultBasePersona = source["defaultBasePersona"];
	        this.remoteAccessEnabled = source["remoteAccessEnabled"];
	        this.remoteAccessPort = source["remoteAccessPort"];
	        this.remoteAccessPasscode = source["remoteAccessPasscode"];
	        this.voice = this.convertValues(source["voice"], VoiceConfigDTO);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CreateAgentRequest {
	    name: string;
	    color: string;
	    role: string;
	    goal: string;
	    model: string;
	    autonomousMode: boolean;
	    mcpServers: Record<string, boolean>;
	    envVariables: Record<string, string>;
	    boundaries: string[];
	    skills: Record<string, boolean>;
	    workspaceId: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateAgentRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.color = source["color"];
	        this.role = source["role"];
	        this.goal = source["goal"];
	        this.model = source["model"];
	        this.autonomousMode = source["autonomousMode"];
	        this.mcpServers = source["mcpServers"];
	        this.envVariables = source["envVariables"];
	        this.boundaries = source["boundaries"];
	        this.skills = source["skills"];
	        this.workspaceId = source["workspaceId"];
	    }
	}
	export class CreateJobGroupRequest {
	    name: string;
	    jobIds: string[];
	    workspaceId: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateJobGroupRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.jobIds = source["jobIds"];
	        this.workspaceId = source["workspaceId"];
	    }
	}
	export class CreateJobRequest {
	    name: string;
	    description: string;
	    type: string;
	    workingDirectory: string;
	    scheduleEnabled: boolean;
	    scheduleType: string;
	    cronExpression: string;
	    scheduleInterval: number;
	    timeoutSeconds: number;
	    prompt: string;
	    allowBypass: boolean;
	    autonomousMode: boolean;
	    maxRetries: number;
	    model: string;
	    overrideRepoCommand: string;
	    claudeCommand: string;
	    agentId: string;
	    successPrompt: string;
	    failurePrompt: string;
	    metadataPrompt: string;
	    triagePrompt: string;
	    interpreter: string;
	    scriptContent: string;
	    envVariables: Record<string, string>;
	    inputs: entity.JobInputSpec[];
	    outputs: entity.JobOutputSpec[];
	    onSuccess: string[];
	    onFailure: string[];
	    workspaceId: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateJobRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.type = source["type"];
	        this.workingDirectory = source["workingDirectory"];
	        this.scheduleEnabled = source["scheduleEnabled"];
	        this.scheduleType = source["scheduleType"];
	        this.cronExpression = source["cronExpression"];
	        this.scheduleInterval = source["scheduleInterval"];
	        this.timeoutSeconds = source["timeoutSeconds"];
	        this.prompt = source["prompt"];
	        this.allowBypass = source["allowBypass"];
	        this.autonomousMode = source["autonomousMode"];
	        this.maxRetries = source["maxRetries"];
	        this.model = source["model"];
	        this.overrideRepoCommand = source["overrideRepoCommand"];
	        this.claudeCommand = source["claudeCommand"];
	        this.agentId = source["agentId"];
	        this.successPrompt = source["successPrompt"];
	        this.failurePrompt = source["failurePrompt"];
	        this.metadataPrompt = source["metadataPrompt"];
	        this.triagePrompt = source["triagePrompt"];
	        this.interpreter = source["interpreter"];
	        this.scriptContent = source["scriptContent"];
	        this.envVariables = source["envVariables"];
	        this.inputs = this.convertValues(source["inputs"], entity.JobInputSpec);
	        this.outputs = this.convertValues(source["outputs"], entity.JobOutputSpec);
	        this.onSuccess = source["onSuccess"];
	        this.onFailure = source["onFailure"];
	        this.workspaceId = source["workspaceId"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CreateRepoRequest {
	    name: string;
	    path: string;
	    workspaceId: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateRepoRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.workspaceId = source["workspaceId"];
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
	    workspaceId: string;
	
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
	        this.workspaceId = source["workspaceId"];
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
	export class CreateWorkspaceRequest {
	    name: string;
	    claudeConfigPath: string;
	    mcpConfigPath: string;
	
	    static createFrom(source: any = {}) {
	        return new CreateWorkspaceRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.claudeConfigPath = source["claudeConfigPath"];
	        this.mcpConfigPath = source["mcpConfigPath"];
	    }
	}
	export class DiffFileResponse {
	    path: string;
	    status: string;
	    oldPath: string;
	
	    static createFrom(source: any = {}) {
	        return new DiffFileResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.status = source["status"];
	        this.oldPath = source["oldPath"];
	    }
	}
	export class JobGroupResponse {
	    id: string;
	    name: string;
	    jobIds: string[];
	    workspaceId: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new JobGroupResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.jobIds = source["jobIds"];
	        this.workspaceId = source["workspaceId"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class TriggerRef {
	    jobId: string;
	    triggerOn: string;
	
	    static createFrom(source: any = {}) {
	        return new TriggerRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jobId = source["jobId"];
	        this.triggerOn = source["triggerOn"];
	    }
	}
	export class JobResponse {
	    id: string;
	    name: string;
	    description: string;
	    type: string;
	    workingDirectory: string;
	    scheduleEnabled: boolean;
	    scheduleType: string;
	    cronExpression: string;
	    scheduleInterval: number;
	    timeoutSeconds: number;
	    prompt: string;
	    allowBypass: boolean;
	    autonomousMode: boolean;
	    maxRetries: number;
	    model: string;
	    overrideRepoCommand: string;
	    claudeCommand: string;
	    agentId: string;
	    successPrompt: string;
	    failurePrompt: string;
	    metadataPrompt: string;
	    triagePrompt: string;
	    interpreter: string;
	    scriptContent: string;
	    envVariables: Record<string, string>;
	    inputs: entity.JobInputSpec[];
	    outputs: entity.JobOutputSpec[];
	    workspaceId: string;
	    createdAt: string;
	    updatedAt: string;
	    onSuccess: string[];
	    onFailure: string[];
	    triggeredBy: TriggerRef[];
	
	    static createFrom(source: any = {}) {
	        return new JobResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.type = source["type"];
	        this.workingDirectory = source["workingDirectory"];
	        this.scheduleEnabled = source["scheduleEnabled"];
	        this.scheduleType = source["scheduleType"];
	        this.cronExpression = source["cronExpression"];
	        this.scheduleInterval = source["scheduleInterval"];
	        this.timeoutSeconds = source["timeoutSeconds"];
	        this.prompt = source["prompt"];
	        this.allowBypass = source["allowBypass"];
	        this.autonomousMode = source["autonomousMode"];
	        this.maxRetries = source["maxRetries"];
	        this.model = source["model"];
	        this.overrideRepoCommand = source["overrideRepoCommand"];
	        this.claudeCommand = source["claudeCommand"];
	        this.agentId = source["agentId"];
	        this.successPrompt = source["successPrompt"];
	        this.failurePrompt = source["failurePrompt"];
	        this.metadataPrompt = source["metadataPrompt"];
	        this.triagePrompt = source["triagePrompt"];
	        this.interpreter = source["interpreter"];
	        this.scriptContent = source["scriptContent"];
	        this.envVariables = source["envVariables"];
	        this.inputs = this.convertValues(source["inputs"], entity.JobInputSpec);
	        this.outputs = this.convertValues(source["outputs"], entity.JobOutputSpec);
	        this.workspaceId = source["workspaceId"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.onSuccess = source["onSuccess"];
	        this.onFailure = source["onFailure"];
	        this.triggeredBy = this.convertValues(source["triggeredBy"], TriggerRef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class JobRunResponse {
	    id: string;
	    jobId: string;
	    status: string;
	    triggeredBy: string;
	    correlationId: string;
	    sessionId: string;
	    modelUsed: string;
	    durationMs: number;
	    tokensUsed: number;
	    result: string;
	    errorMessage: string;
	    injectedContext: string;
	    metadata: Record<string, any>;
	    validationError: string;
	    startedAt: string;
	    finishedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new JobRunResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.jobId = source["jobId"];
	        this.status = source["status"];
	        this.triggeredBy = source["triggeredBy"];
	        this.correlationId = source["correlationId"];
	        this.sessionId = source["sessionId"];
	        this.modelUsed = source["modelUsed"];
	        this.durationMs = source["durationMs"];
	        this.tokensUsed = source["tokensUsed"];
	        this.result = source["result"];
	        this.errorMessage = source["errorMessage"];
	        this.injectedContext = source["injectedContext"];
	        this.metadata = source["metadata"];
	        this.validationError = source["validationError"];
	        this.startedAt = source["startedAt"];
	        this.finishedAt = source["finishedAt"];
	    }
	}
	export class MindmapNodeRequest {
	    id: string;
	    parentId: string;
	    kind: string;
	    label: string;
	    text: string;
	    status: string;
	    note: string;
	    color: string;
	    progress: number;
	    board: string;
	
	    static createFrom(source: any = {}) {
	        return new MindmapNodeRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.parentId = source["parentId"];
	        this.kind = source["kind"];
	        this.label = source["label"];
	        this.text = source["text"];
	        this.status = source["status"];
	        this.note = source["note"];
	        this.color = source["color"];
	        this.progress = source["progress"];
	        this.board = source["board"];
	    }
	}
	export class MindmapNodeResponse {
	    id: string;
	    parentId: string;
	    kind: string;
	    label: string;
	    text: string;
	    status: string;
	    note: string;
	    color: string;
	    progress: number;
	    board: string;
	
	    static createFrom(source: any = {}) {
	        return new MindmapNodeResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.parentId = source["parentId"];
	        this.kind = source["kind"];
	        this.label = source["label"];
	        this.text = source["text"];
	        this.status = source["status"];
	        this.note = source["note"];
	        this.color = source["color"];
	        this.progress = source["progress"];
	        this.board = source["board"];
	    }
	}
	export class PathValidationResult {
	    claudeConfigValid: boolean;
	    claudeConfigError: string;
	    mcpConfigValid: boolean;
	    mcpConfigError: string;
	
	    static createFrom(source: any = {}) {
	        return new PathValidationResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.claudeConfigValid = source["claudeConfigValid"];
	        this.claudeConfigError = source["claudeConfigError"];
	        this.mcpConfigValid = source["mcpConfigValid"];
	        this.mcpConfigError = source["mcpConfigError"];
	    }
	}
	export class RepoResponse {
	    id: string;
	    name: string;
	    path: string;
	    workspaceId: string;
	    createdAt: string;
	    updatedAt: string;
	    closedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new RepoResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.workspaceId = source["workspaceId"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.closedAt = source["closedAt"];
	    }
	}
	export class SaveConfigRequest {
	    startOnLogin: boolean;
	    notifications: boolean;
	    autoUpdate: boolean;
	    shortcuts: ShortcutDTO[];
	    autoPull: boolean;
	    defaultPullBranch: string;
	    branchNamePattern: string;
	    deleteBranchOnDone: boolean;
	    branchOverrides: Record<string, string>;
	    commitMessagePrefix: string;
	    useWorktreeDefault: boolean;
	    skipPermissions: boolean;
	    maxConcurrentSessions: number;
	    autoResumeOnStart: boolean;
	    autoStopIdle: boolean;
	    idleTimeoutMinutes: number;
	    activeSessionId: string;
	    openSessionIds: string[];
	    voicePaneOpen: boolean;
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
	    assistantModel: string;
	    envVariables: Record<string, string>;
	    commandOverrides: Record<string, string>;
	    basePersona: string;
	    remoteAccessEnabled: boolean;
	    remoteAccessPort: number;
	    remoteAccessPasscode: string;
	    voice: VoiceConfigDTO;

	    static createFrom(source: any = {}) {
	        return new SaveConfigRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startOnLogin = source["startOnLogin"];
	        this.notifications = source["notifications"];
	        this.autoUpdate = source["autoUpdate"];
	        this.shortcuts = this.convertValues(source["shortcuts"], ShortcutDTO);
	        this.autoPull = source["autoPull"];
	        this.defaultPullBranch = source["defaultPullBranch"];
	        this.branchNamePattern = source["branchNamePattern"];
	        this.deleteBranchOnDone = source["deleteBranchOnDone"];
	        this.branchOverrides = source["branchOverrides"];
	        this.commitMessagePrefix = source["commitMessagePrefix"];
	        this.useWorktreeDefault = source["useWorktreeDefault"];
	        this.skipPermissions = source["skipPermissions"];
	        this.maxConcurrentSessions = source["maxConcurrentSessions"];
	        this.autoResumeOnStart = source["autoResumeOnStart"];
	        this.autoStopIdle = source["autoStopIdle"];
	        this.idleTimeoutMinutes = source["idleTimeoutMinutes"];
	        this.activeSessionId = source["activeSessionId"];
	        this.openSessionIds = source["openSessionIds"];
	        this.voicePaneOpen = source["voicePaneOpen"];
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
	        this.assistantModel = source["assistantModel"];
	        this.envVariables = source["envVariables"];
	        this.commandOverrides = source["commandOverrides"];
	        this.basePersona = source["basePersona"];
	        this.remoteAccessEnabled = source["remoteAccessEnabled"];
	        this.remoteAccessPort = source["remoteAccessPort"];
	        this.remoteAccessPasscode = source["remoteAccessPasscode"];
	        this.voice = this.convertValues(source["voice"], VoiceConfigDTO);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
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
	    workspaceId: string;
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
	        this.workspaceId = source["workspaceId"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.lastActiveAt = source["lastActiveAt"];
	        this.archivedAt = source["archivedAt"];
	    }
	}
	
	export class SkillInfo {
	    name: string;
	    filePath: string;
	
	    static createFrom(source: any = {}) {
	        return new SkillInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.filePath = source["filePath"];
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
	
	export class UpdateAgentRequest {
	    id: string;
	    name: string;
	    color: string;
	    role: string;
	    goal: string;
	    model: string;
	    autonomousMode: boolean;
	    mcpServers: Record<string, boolean>;
	    envVariables: Record<string, string>;
	    boundaries: string[];
	    skills: Record<string, boolean>;
	    workspaceId: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateAgentRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.role = source["role"];
	        this.goal = source["goal"];
	        this.model = source["model"];
	        this.autonomousMode = source["autonomousMode"];
	        this.mcpServers = source["mcpServers"];
	        this.envVariables = source["envVariables"];
	        this.boundaries = source["boundaries"];
	        this.skills = source["skills"];
	        this.workspaceId = source["workspaceId"];
	    }
	}
	export class UpdateJobGroupRequest {
	    id: string;
	    name: string;
	    jobIds: string[];
	    workspaceId: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateJobGroupRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.jobIds = source["jobIds"];
	        this.workspaceId = source["workspaceId"];
	    }
	}
	export class UpdateJobRequest {
	    id: string;
	    name: string;
	    description: string;
	    type: string;
	    workingDirectory: string;
	    scheduleEnabled: boolean;
	    scheduleType: string;
	    cronExpression: string;
	    scheduleInterval: number;
	    timeoutSeconds: number;
	    prompt: string;
	    allowBypass: boolean;
	    autonomousMode: boolean;
	    maxRetries: number;
	    model: string;
	    overrideRepoCommand: string;
	    claudeCommand: string;
	    agentId: string;
	    successPrompt: string;
	    failurePrompt: string;
	    metadataPrompt: string;
	    triagePrompt: string;
	    interpreter: string;
	    scriptContent: string;
	    envVariables: Record<string, string>;
	    inputs: entity.JobInputSpec[];
	    outputs: entity.JobOutputSpec[];
	    onSuccess: string[];
	    onFailure: string[];
	    workspaceId: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateJobRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.type = source["type"];
	        this.workingDirectory = source["workingDirectory"];
	        this.scheduleEnabled = source["scheduleEnabled"];
	        this.scheduleType = source["scheduleType"];
	        this.cronExpression = source["cronExpression"];
	        this.scheduleInterval = source["scheduleInterval"];
	        this.timeoutSeconds = source["timeoutSeconds"];
	        this.prompt = source["prompt"];
	        this.allowBypass = source["allowBypass"];
	        this.autonomousMode = source["autonomousMode"];
	        this.maxRetries = source["maxRetries"];
	        this.model = source["model"];
	        this.overrideRepoCommand = source["overrideRepoCommand"];
	        this.claudeCommand = source["claudeCommand"];
	        this.agentId = source["agentId"];
	        this.successPrompt = source["successPrompt"];
	        this.failurePrompt = source["failurePrompt"];
	        this.metadataPrompt = source["metadataPrompt"];
	        this.triagePrompt = source["triagePrompt"];
	        this.interpreter = source["interpreter"];
	        this.scriptContent = source["scriptContent"];
	        this.envVariables = source["envVariables"];
	        this.inputs = this.convertValues(source["inputs"], entity.JobInputSpec);
	        this.outputs = this.convertValues(source["outputs"], entity.JobOutputSpec);
	        this.onSuccess = source["onSuccess"];
	        this.onFailure = source["onFailure"];
	        this.workspaceId = source["workspaceId"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class UpdateWorkspaceRequest {
	    id: string;
	    name: string;
	    claudeConfigPath: string;
	    mcpConfigPath: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateWorkspaceRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.claudeConfigPath = source["claudeConfigPath"];
	        this.mcpConfigPath = source["mcpConfigPath"];
	    }
	}
	
	export class WorkspaceResponse {
	    id: string;
	    name: string;
	    claudeConfigPath: string;
	    mcpConfigPath: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.claudeConfigPath = source["claudeConfigPath"];
	        this.mcpConfigPath = source["mcpConfigPath"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}

}

export namespace entity {
	
	export class ChangelogEntry {
	    version: string;
	    date: string;
	    changes: Record<string, Array<string>>;
	
	    static createFrom(source: any = {}) {
	        return new ChangelogEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.date = source["date"];
	        this.changes = source["changes"];
	    }
	}
	export class Changelog {
	    entries: ChangelogEntry[];
	
	    static createFrom(source: any = {}) {
	        return new Changelog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = this.convertValues(source["entries"], ChangelogEntry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class JobInputSpec {
	    key: string;
	    type: string;
	    required: boolean;
	
	    static createFrom(source: any = {}) {
	        return new JobInputSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.type = source["type"];
	        this.required = source["required"];
	    }
	}
	export class JobOutputSpec {
	    key: string;
	    type: string;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new JobOutputSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.type = source["type"];
	        this.source = source["source"];
	    }
	}

}

export namespace remote {
	
	export class Status {
	    enabled: boolean;
	    url: string;
	    passcode: string;
	    port: number;
	    clients: number;
	    cloudflaredInstalled: boolean;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.url = source["url"];
	        this.passcode = source["passcode"];
	        this.port = source["port"];
	        this.clients = source["clients"];
	        this.cloudflaredInstalled = source["cloudflaredInstalled"];
	        this.error = source["error"];
	    }
	}

}

export namespace voice {
	
	export class PingResult {
	    ok: boolean;
	    detail: string;
	
	    static createFrom(source: any = {}) {
	        return new PingResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.detail = source["detail"];
	    }
	}
	export class SpeechResult {
	    audioB64: string;
	    contentType: string;
	
	    static createFrom(source: any = {}) {
	        return new SpeechResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.audioB64 = source["audioB64"];
	        this.contentType = source["contentType"];
	    }
	}

}

