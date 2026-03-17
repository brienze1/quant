import { useState, useRef, useEffect } from "react";
import type { Repo, Task, CreateSessionRequest, SessionType, Config } from "../types";
import * as api from "../api";

const MODEL_OPTIONS = ["cli default", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

interface Props {
  repos: Repo[];
  tasksByRepo: Record<string, Task[]>;
  defaultRepoId?: string;
  defaultTaskId?: string;
  onSubmit: (req: CreateSessionRequest) => void;
  onCancel: () => void;
}

export function NewSessionModal({
  repos,
  tasksByRepo,
  defaultRepoId,
  defaultTaskId,
  onSubmit,
  onCancel,
}: Props) {
  const [sessionType, setSessionType] = useState<SessionType>("claude");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repoId, setRepoId] = useState(defaultRepoId ?? repos[0]?.id ?? "");
  const [taskId, setTaskId] = useState(defaultTaskId ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Advanced options — initialized from config defaults
  const [useWorktree, setUseWorktree] = useState(false);
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [autoPull, setAutoPull] = useState(true);
  const [pullBranch, setPullBranch] = useState("main");
  const [branchNamePattern, setBranchNamePattern] = useState("quant/{session}");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [extraCliArgs, setExtraCliArgs] = useState("");

  // Load config defaults on mount
  useEffect(() => {
    api.getConfig().then((cfg: Config) => {
      setUseWorktree(cfg.useWorktreeDefault);
      setSkipPermissions(cfg.skipPermissions);
      setAutoPull(cfg.autoPull);
      setPullBranch(cfg.defaultPullBranch);
      setBranchNamePattern(cfg.branchNamePattern);
      setModel(cfg.defaultModel);
      setExtraCliArgs(cfg.extraCliArgs);
      setConfigLoaded(true);
    }).catch(() => {
      setConfigLoaded(true);
    });
  }, []);

  const [branchExistsWarning, setBranchExistsWarning] = useState(false);
  const [checking, setChecking] = useState(false);

  const tasks = tasksByRepo[repoId] ?? [];
  const selectedRepo = repos.find((r) => r.id === repoId);
  const selectedTask = tasks.find((t) => t.id === taskId);

  function buildRequest(): CreateSessionRequest {
    return {
      name: name.trim().toLowerCase(),
      description: description.trim().toLowerCase(),
      repoId,
      taskId,
      sessionType,
      useWorktree,
      skipPermissions: sessionType === "claude" ? skipPermissions : false,
      autoPull,
      pullBranch,
      branchNamePattern,
      model: sessionType === "claude" ? model : "",
      extraCliArgs: sessionType === "claude" ? extraCliArgs : "",
    };
  }

  function resolveBranchName(): string {
    const sanitizedName = name.trim().toLowerCase().replace(/\s+/g, "-");
    return branchNamePattern.replace("{session}", sanitizedName);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !repoId || !taskId) return;

    // If worktree enabled and not already confirmed, check if branch exists.
    if (useWorktree && !branchExistsWarning) {
      setChecking(true);
      try {
        const exists = await api.checkBranchExists(repoId, resolveBranchName());
        if (exists) {
          setBranchExistsWarning(true);
          setChecking(false);
          return;
        }
      } catch {
        // If check fails, proceed with creation (backend will handle errors).
      }
      setChecking(false);
    }

    setBranchExistsWarning(false);
    onSubmit(buildRequest());
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: "#0A0A0A",
    border: "1px solid #2a2a2a",
    color: "#FAFAFA",
    fontFamily: "'JetBrains Mono', monospace",
  };

  const tabs: { key: SessionType; label: string }[] = [
    { key: "claude", label: "claude session" },
  ];

  if (!configLoaded) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
        <span style={{ color: "#6B7280", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>loading...</span>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md max-h-[90vh] flex flex-col"
        style={{
          backgroundColor: "#0A0A0A",
          border: "1px solid #2a2a2a",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {/* title */}
        <div className="px-8 pt-8 shrink-0">
          <h2 className="text-sm font-bold lowercase" style={{ color: "#FAFAFA" }}>
            <span style={{ color: "#10B981" }}>{">"}</span> new_session
          </h2>
        </div>

        {/* tabs */}
        <div
          className="flex px-8 mt-4 shrink-0"
          style={{ borderBottom: "1px solid #2a2a2a" }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSessionType(tab.key)}
              className="px-4 py-2 text-[11px] lowercase transition-colors"
              style={{
                color: sessionType === tab.key ? "#10B981" : "#6B7280",
                fontWeight: sessionType === tab.key ? 500 : "normal",
                borderBottom: sessionType === tab.key ? "2px solid #10B981" : "2px solid transparent",
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* form body — scrollable */}
        <div className="px-8 pt-4 pb-8 flex flex-col gap-4 overflow-y-auto">
          {/* repo dropdown */}
          <div>
            <span className="text-[10px] lowercase block mb-1" style={{ color: "#6B7280" }}>repo</span>
            <CustomSelect
              value={repoId}
              onChange={(v) => { setRepoId(v); setTaskId(""); }}
              options={repos.map((r) => ({ value: r.id, label: `${r.name} (${r.path})` }))}
              placeholder="select a repo"
              displayValue={selectedRepo ? `${selectedRepo.name} (${selectedRepo.path})` : ""}
            />
          </div>

          {/* task dropdown */}
          <div>
            <span className="text-[10px] lowercase block mb-1" style={{ color: "#6B7280" }}>task</span>
            <CustomSelect
              value={taskId}
              onChange={setTaskId}
              options={tasks.map((t) => ({ value: t.id, label: `# ${t.tag}  ${t.name}` }))}
              placeholder="select a task"
              displayValue={selectedTask ? `# ${selectedTask.tag}  ${selectedTask.name}` : ""}
            />
          </div>

          {/* name */}
          <label className="block">
            <span className="text-[10px] lowercase" style={{ color: "#6B7280" }}>name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setBranchExistsWarning(false); }}
              placeholder={sessionType === "claude" ? "implement fix" : "deploy setup"}
              className="mt-1 block w-full px-3 py-2 text-xs focus:outline-none"
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
            />
          </label>

          {/* description */}
          <label className="block">
            <span className="text-[10px] lowercase" style={{ color: "#6B7280" }}>description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="what is this session for?"
              className="mt-1 block w-full px-3 py-2 text-xs focus:outline-none"
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
            />
          </label>

          {/* advanced options toggle */}
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-2"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <span style={{ color: "#10B981", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
              {advancedOpen ? "v" : ">"}
            </span>
            <span style={{ color: "#10B981", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
              advanced options
            </span>
          </button>

          {/* advanced options content */}
          {advancedOpen && (
            <>
              <div style={{ height: 1, backgroundColor: "#2a2a2a" }} />

              {/* session section */}
              <div className="flex flex-col gap-3">
                <span style={{ color: "#10B981", fontSize: 10, fontWeight: 700 }}>session</span>
                <AdvancedToggle label="use worktree" description="create isolated git worktree" checked={useWorktree} onChange={setUseWorktree} />
                {sessionType === "claude" && (
                  <AdvancedToggle label="skip permissions" description="pass --dangerously-skip-permissions" checked={skipPermissions} onChange={setSkipPermissions} />
                )}
              </div>

              <div style={{ height: 1, backgroundColor: "#1F1F1F" }} />

              {/* git section */}
              <div className="flex flex-col gap-3">
                <span style={{ color: "#10B981", fontSize: 10, fontWeight: 700 }}>git</span>
                <AdvancedToggle label="auto pull" description="pull before starting session" checked={autoPull} onChange={setAutoPull} />
                <AdvancedInput label="pull branch" description="branch to pull from remote" value={pullBranch} onChange={setPullBranch} />
              </div>

              <div style={{ height: 1, backgroundColor: "#1F1F1F" }} />

              {/* branch section */}
              <div className="flex flex-col gap-3">
                <span style={{ color: "#10B981", fontSize: 10, fontWeight: 700 }}>branch</span>
                <AdvancedInput label="branch pattern" description="template using {session} placeholder" value={branchNamePattern} onChange={(v) => { setBranchNamePattern(v); setBranchExistsWarning(false); }} />
              </div>

              {/* claude cli section — only for claude sessions */}
              {sessionType === "claude" && (
                <>
                  <div style={{ height: 1, backgroundColor: "#1F1F1F" }} />
                  <div className="flex flex-col gap-3">
                    <span style={{ color: "#10B981", fontSize: 10, fontWeight: 700 }}>claude cli</span>
                    <AdvancedSelect label="model" description="override default model" value={model} options={MODEL_OPTIONS} onChange={setModel} />
                    <AdvancedInput label="extra cli args" description="additional flags for this session" value={extraCliArgs} onChange={setExtraCliArgs} placeholder="--verbose" />
                  </div>
                </>
              )}
            </>
          )}

          {/* branch exists warning */}
          {branchExistsWarning && (
            <div
              className="flex flex-col gap-3 p-3"
              style={{
                backgroundColor: "#1A1A0A",
                border: "1px solid #92400E",
              }}
            >
              <span style={{ color: "#F59E0B", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                branch "{resolveBranchName()}" already exists
              </span>
              <span style={{ color: "#6B7280", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                you can change the session name to create a new branch, or use the existing branch as is.
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setBranchExistsWarning(false)}
                  className="px-3 py-1.5 text-[10px] lowercase transition-colors"
                  style={{ color: "#6B7280", border: "1px solid #2a2a2a" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
                >
                  change name
                </button>
                <button
                  type="button"
                  onClick={() => { setBranchExistsWarning(false); onSubmit(buildRequest()); }}
                  className="px-3 py-1.5 text-[10px] lowercase transition-colors"
                  style={{
                    backgroundColor: "#F59E0B",
                    color: "#0A0A0A",
                    fontWeight: 500,
                  }}
                >
                  use existing branch
                </button>
              </div>
            </div>
          )}

          {/* actions */}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs lowercase transition-colors"
              style={{ color: "#6B7280" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !repoId || !taskId || checking}
              className="px-4 py-2 text-xs lowercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                backgroundColor: "#10B981",
                color: "#0A0A0A",
                fontWeight: 500,
              }}
            >
              {checking ? "checking..." : "create"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// --- Advanced option row components ---

function AdvancedToggle({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span style={{ color: "#FAFAFA", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
        <span style={{ color: "#4B5563", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>{description}</span>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="flex items-center justify-center"
        style={{
          width: 14,
          height: 14,
          backgroundColor: "#0A0A0A",
          border: `1px solid ${checked ? "#10B981" : "#2a2a2a"}`,
        }}
      >
        {checked && <span style={{ color: "#10B981", fontSize: 10, lineHeight: 1 }}>x</span>}
      </button>
    </div>
  );
}

function AdvancedInput({ label, description, value, onChange, placeholder }: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span style={{ color: "#FAFAFA", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
        <span style={{ color: "#4B5563", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>{description}</span>
      </div>
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onChange(local); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onChange(local); } }}
        placeholder={placeholder}
        className="px-3 focus:outline-none"
        style={{
          width: 140,
          height: 32,
          backgroundColor: "#0F0F0F",
          border: "1px solid #2a2a2a",
          color: "#FAFAFA",
          fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
        onBlurCapture={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
      />
    </div>
  );
}

function AdvancedSelect({ label, description, value, options, onChange }: {
  label: string;
  description: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span style={{ color: "#FAFAFA", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
        <span style={{ color: "#4B5563", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>{description}</span>
      </div>
      <div ref={wrapRef} style={{ position: "relative", width: 160 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            width: 160,
            height: 32,
            backgroundColor: "#0F0F0F",
            border: `1px solid ${open ? "#10B981" : "#2a2a2a"}`,
            color: "#FAFAFA",
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            padding: "0 12px",
            textAlign: "left",
            cursor: "pointer",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M0 2l4 4 4-4' fill='none' stroke='%236B7280' stroke-width='1.5'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 12px center",
          }}
        >
          {value}
        </button>
        {open && (
          <div
            style={{
              position: "absolute",
              top: 36,
              left: 0,
              zIndex: 50,
              backgroundColor: "#0A0A0A",
              border: "1px solid #2a2a2a",
              width: "100%",
            }}
          >
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className="w-full flex items-center text-left transition-colors"
                style={{
                  height: 28,
                  padding: "0 12px",
                  gap: 8,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  color: opt === value ? "#10B981" : "#D1D5DB",
                  backgroundColor: opt === value ? "#1F1F1F" : "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  if (opt !== value) e.currentTarget.style.backgroundColor = "#1F1F1F";
                }}
                onMouseLeave={(e) => {
                  if (opt !== value) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span style={{ color: "#10B981", flexShrink: 0 }}>~</span>
                <span>{opt}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Custom dropdown matching the Pencil design
function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  displayValue,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  displayValue: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-left"
        style={{
          backgroundColor: "#0A0A0A",
          border: `1px solid ${open ? "#10B981" : "#2a2a2a"}`,
          color: value ? "#FAFAFA" : "#4B5563",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <span className="overflow-hidden whitespace-nowrap" style={{ textOverflow: "ellipsis" }}>
          {displayValue || placeholder}
        </span>
        <span style={{ color: "#6B7280", fontSize: 10 }}>v</span>
      </button>
      {open && (
        <div
          className="absolute z-10 w-full mt-1 max-h-40 overflow-y-auto"
          style={{
            backgroundColor: "#0A0A0A",
            border: "1px solid #2a2a2a",
          }}
        >
          {options.length === 0 && (
            <div
              className="px-3 py-2 text-xs"
              style={{ color: "#4B5563", fontFamily: "'JetBrains Mono', monospace" }}
            >
              // none available
            </div>
          )}
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs transition-colors"
              style={{
                color: opt.value === value ? "#10B981" : "#FAFAFA",
                backgroundColor: opt.value === value ? "#1F1F1F" : "transparent",
                fontFamily: "'JetBrains Mono', monospace",
              }}
              onMouseEnter={(e) => {
                if (opt.value !== value) e.currentTarget.style.backgroundColor = "#1F1F1F";
              }}
              onMouseLeave={(e) => {
                if (opt.value !== value) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
