import { useState, useEffect } from "react";
import type { Repo, Task, CreateSessionRequest, SessionType, Config } from "../types";
import * as api from "../api";
import { ClaudeSessionPicker, CLAUDE_UUID_RE } from "./ChangeSessionIdModal";
import {
  ModalShell,
  ModalTitle,
  Field,
  ModalInput,
  ModalSelect,
  Toggle,
  SectionRow,
  RowLabel,
  AdvLabel,
  AdvDivider,
  ModalCancel,
  ModalSubmit,
} from "./ModalShell";

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

  // Conversation: start fresh, or adopt an existing claude CLI conversation.
  const [convMode, setConvMode] = useState<"new" | "resume">("new");
  const [selectedClaudeId, setSelectedClaudeId] = useState("");
  const [pastedClaudeId, setPastedClaudeId] = useState("");

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

  // A pasted valid UUID takes precedence over the list selection.
  const pastedClaude = pastedClaudeId.trim();
  const claudeSessionId =
    sessionType === "claude" && convMode === "resume"
      ? CLAUDE_UUID_RE.test(pastedClaude)
        ? pastedClaude.toLowerCase()
        : selectedClaudeId
      : "";
  const adopting = claudeSessionId !== "";

  function buildRequest(): CreateSessionRequest {
    return {
      name: name.trim().toLowerCase(),
      description: description.trim().toLowerCase(),
      repoId,
      taskId,
      sessionType,
      useWorktree: adopting ? false : useWorktree,
      skipPermissions: sessionType === "claude" ? skipPermissions : false,
      autoPull,
      pullBranch,
      branchNamePattern,
      model: sessionType === "claude" ? model : "",
      extraCliArgs: sessionType === "claude" ? extraCliArgs : "",
      ...(adopting ? { claudeSessionId } : {}),
    };
  }

  function resolveBranchName(): string {
    const sanitizedName = name.trim().toLowerCase().replace(/\s+/g, "-");
    return branchNamePattern.replace("{session}", sanitizedName);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !repoId || !taskId) return;
    if (sessionType === "claude" && convMode === "resume" && !adopting) return;

    // If worktree enabled and not already confirmed, check if branch exists.
    // Adoption forces worktree off, so the check is irrelevant then.
    if (useWorktree && !adopting && !branchExistsWarning) {
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

  const tabs: { key: SessionType; label: string }[] = [{ key: "claude", label: "claude session" }];

  const canSubmit =
    !!name.trim() && !!repoId && !!taskId && !checking && !(sessionType === "claude" && convMode === "resume" && !adopting);

  if (!configLoaded) {
    return (
      <ModalShell width={540} onClose={onCancel}>
        <div style={{ padding: "26px", display: "flex", justifyContent: "center" }}>
          <span className="mono" style={{ color: "var(--fg-3)", fontSize: 12 }}>loading…</span>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell width={540} onClose={onCancel}>
      {/* title */}
      <div style={{ padding: "20px 26px 0" }}>
        <ModalTitle>new_session</ModalTitle>
      </div>

      {/* tabs — claude session */}
      <div style={{ display: "flex", gap: 4, padding: "14px 22px 0", borderBottom: "1px solid var(--border-2)" }}>
        {tabs.map((tab) => {
          const on = sessionType === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSessionType(tab.key)}
              style={{
                padding: "8px 14px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: on ? "var(--accent)" : "var(--fg-3)",
                fontWeight: on ? 600 : 400,
                borderBottom: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                marginBottom: -1,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* scrollable body — wrapped in a form so submit/Enter works */}
      <form
        onSubmit={handleSubmit}
        className="scroll"
        style={{ flex: 1, overflowY: "auto", padding: "18px 26px 20px", display: "flex", flexDirection: "column", gap: 16 }}
      >
        <Field label="repo">
          <ModalSelect
            value={repoId}
            onChange={(v) => { setRepoId(v); setTaskId(""); setSelectedClaudeId(""); }}
            options={repos.map((r) => ({ value: r.id, label: `${r.name} (${r.path})` }))}
            placeholder="select a repo"
          />
        </Field>

        <Field label="task">
          <ModalSelect
            value={taskId}
            onChange={setTaskId}
            options={tasks.map((t) => ({ value: t.id, label: `# ${t.tag}  ${t.name}` }))}
            placeholder="select a task"
          />
        </Field>

        <Field label="name">
          <ModalInput
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setBranchExistsWarning(false); }}
            placeholder={sessionType === "claude" ? "implement fix" : "deploy setup"}
          />
        </Field>

        <Field label="description">
          <ModalInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="what is this session for?"
          />
        </Field>

        {/* conversation — new vs adopt an existing claude session */}
        {sessionType === "claude" && (
          <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 13 }}>
            <AdvLabel>conversation</AdvLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {([
                { key: "new", label: "new conversation" },
                { key: "resume", label: "resume an existing session" },
              ] as const).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setConvMode(opt.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <span className="mono" style={{ color: "var(--accent)", fontSize: 11 }}>
                    {convMode === opt.key ? "(x)" : "( )"}
                  </span>
                  <span
                    className="mono"
                    style={{ color: convMode === opt.key ? "var(--accent)" : "var(--fg)", fontSize: 11 }}
                  >
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
            {convMode === "resume" && (
              <ClaudeSessionPicker
                directory={selectedRepo?.path ?? ""}
                selectedId={selectedClaudeId}
                onSelect={setSelectedClaudeId}
                pastedId={pastedClaudeId}
                onPaste={setPastedClaudeId}
              />
            )}
          </div>
        )}

        {/* advanced options toggle */}
        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          <span className="mono" style={{ color: "var(--accent)", fontSize: 10 }}>{advancedOpen ? "v" : ">"}</span>
          <span className="mono" style={{ color: "var(--accent)", fontSize: 10 }}>advanced options</span>
        </button>

        {advancedOpen && (
          <>
            <AdvDivider />
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <AdvLabel>session</AdvLabel>
              <SectionRow>
                <RowLabel
                  title="use worktree"
                  sub={adopting ? "unavailable when adopting — resumes in the original directory" : "create isolated git worktree"}
                />
                <Toggle checked={adopting ? false : useWorktree} onChange={setUseWorktree} disabled={adopting} />
              </SectionRow>
              {sessionType === "claude" && (
                <SectionRow>
                  <RowLabel title="skip permissions" sub="pass --dangerously-skip-permissions" />
                  <Toggle checked={skipPermissions} onChange={setSkipPermissions} />
                </SectionRow>
              )}
            </div>

            <AdvDivider />
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <AdvLabel>git</AdvLabel>
              <SectionRow>
                <RowLabel title="auto pull" sub="pull before starting session" />
                <Toggle checked={autoPull} onChange={setAutoPull} />
              </SectionRow>
              <SectionRow>
                <RowLabel title="pull branch" sub="branch to pull from remote" />
                <ModalInput value={pullBranch} onChange={(e) => setPullBranch(e.target.value)} style={{ width: 150, height: 32 }} />
              </SectionRow>
            </div>

            <AdvDivider />
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <AdvLabel>branch</AdvLabel>
              <SectionRow>
                <RowLabel title="branch pattern" sub="template using {session} placeholder" />
                <ModalInput
                  value={branchNamePattern}
                  onChange={(e) => { setBranchNamePattern(e.target.value); setBranchExistsWarning(false); }}
                  style={{ width: 180, height: 32 }}
                />
              </SectionRow>
            </div>

            {sessionType === "claude" && (
              <>
                <AdvDivider />
                <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                  <AdvLabel>claude cli</AdvLabel>
                  <SectionRow>
                    <RowLabel title="model" sub="override default model" />
                    <div style={{ width: 200 }}>
                      <ModalSelect
                        value={model}
                        onChange={setModel}
                        options={MODEL_OPTIONS.map((m) => ({ value: m, label: m }))}
                      />
                    </div>
                  </SectionRow>
                  <SectionRow>
                    <RowLabel title="extra cli args" sub="additional flags for this session" />
                    <ModalInput
                      value={extraCliArgs}
                      onChange={(e) => setExtraCliArgs(e.target.value)}
                      placeholder="--verbose"
                      style={{ width: 180, height: 32 }}
                    />
                  </SectionRow>
                </div>
              </>
            )}
          </>
        )}

        {/* branch exists warning */}
        {branchExistsWarning && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 11,
              padding: 13,
              borderRadius: 9,
              background: "color-mix(in srgb, var(--warn) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--warn) 45%, transparent)",
            }}
          >
            <span className="mono" style={{ color: "var(--warn)", fontSize: 11.5 }}>
              branch "{resolveBranchName()}" already exists
            </span>
            <span className="mono" style={{ color: "var(--fg-3)", fontSize: 10.5, lineHeight: 1.5 }}>
              you can change the session name to create a new branch, or use the existing branch as is.
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setBranchExistsWarning(false)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--fg-3)",
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  cursor: "pointer",
                }}
              >
                change name
              </button>
              <button
                type="button"
                onClick={() => { setBranchExistsWarning(false); onSubmit(buildRequest()); }}
                style={{
                  padding: "5px 12px",
                  borderRadius: 7,
                  border: "none",
                  background: "var(--warn)",
                  color: "var(--bg)",
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                use existing branch
              </button>
            </div>
          </div>
        )}

        {/* actions */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14 }}>
          <ModalCancel onClick={onCancel} />
          <ModalSubmit type="submit" disabled={!canSubmit}>
            {checking ? "checking…" : "create"}
          </ModalSubmit>
        </div>
      </form>
    </ModalShell>
  );
}
