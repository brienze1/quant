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
	    useWorktree: boolean;
	    skipPermissions: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CreateSessionRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.repoId = source["repoId"];
	        this.taskId = source["taskId"];
	        this.useWorktree = source["useWorktree"];
	        this.skipPermissions = source["skipPermissions"];
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
	export class SessionResponse {
	    id: string;
	    name: string;
	    description: string;
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

