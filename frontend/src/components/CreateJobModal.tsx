import { useState } from "react";
import type { Job, JobType, CreateJobRequest, UpdateJobRequest, ScheduleType, Agent, SchemaField, JobInputSpec, JobOutputSpec } from "../types";
import * as api from "../api";
import { SchemaFieldEditor } from "./SchemaFieldEditor";
import {
  ModalShell,
  Field,
  ModalInput,
  ModalTextarea,
  ModalSelect,
  Toggle,
  ModalCancel,
  ModalSubmit,
} from "./ModalShell";

const MODEL_OPTIONS = ["cli default", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];
const INTERPRETER_OPTIONS = ["/bin/bash", "/bin/sh", "/bin/zsh", "python3"];
const SCHEDULE_UNIT_OPTIONS = ["minutes", "hours", "days"];

const SPEC_TYPES = ["string", "number", "boolean", "object", "array"] as const;
type SpecType = (typeof SPEC_TYPES)[number];

// The editor stores rows with loosely-typed `type`/`source` (raw <select> values);
// the API contract is strict. Coerce + drop blank-key rows on submit (issue #50).
function coerceType(t: string): SpecType {
  return (SPEC_TYPES as readonly string[]).includes(t) ? (t as SpecType) : "string";
}

function toInputSpecs(rows: SchemaField[]): JobInputSpec[] {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => ({ key: r.key.trim(), type: coerceType(r.type), required: !!r.required }));
}

function toOutputSpecs(rows: SchemaField[]): JobOutputSpec[] {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => ({
      key: r.key.trim(),
      type: coerceType(r.type),
      source: r.source === "produced" ? "produced" : "passthrough",
    }));
}

type TabKey = "general" | "schedule" | "session" | "script" | "contract";

interface Props {
  jobs: Job[];
  agents: Agent[];
  editJob?: Job;
  onSubmit: (req: CreateJobRequest | UpdateJobRequest) => void;
  onCancel: () => void;
}

function buildDefaultForm(): CreateJobRequest {
  return {
    name: "",
    description: "",
    type: "claude",
    workingDirectory: "",
    scheduleEnabled: false,
    scheduleType: "recurring",
    cronExpression: "",
    scheduleInterval: 60,
    timeoutSeconds: 300,
    prompt: "",
    allowBypass: true,
    autonomousMode: true,
    maxRetries: 0,
    model: "claude-sonnet-4-6",
    overrideRepoCommand: "",
    claudeCommand: "",
    agentId: "",
    successPrompt: "",
    failurePrompt: "",
    metadataPrompt: "",
    triagePrompt: "",
    interpreter: "/bin/bash",
    scriptContent: "",
    envVariables: {},
    onSuccess: [],
    onFailure: [],
  };
}

function jobToForm(job: Job): CreateJobRequest {
  return {
    name: job.name,
    description: job.description,
    type: job.type,
    workingDirectory: job.workingDirectory,
    scheduleEnabled: job.scheduleEnabled,
    scheduleType: job.scheduleType,
    cronExpression: job.cronExpression,
    scheduleInterval: job.scheduleInterval,
    timeoutSeconds: job.timeoutSeconds,
    prompt: job.prompt,
    allowBypass: job.allowBypass,
    autonomousMode: job.autonomousMode,
    maxRetries: job.maxRetries,
    model: job.model,
    overrideRepoCommand: job.overrideRepoCommand,
    claudeCommand: job.claudeCommand,
    agentId: job.agentId ?? "",
    successPrompt: job.successPrompt,
    failurePrompt: job.failurePrompt,
    metadataPrompt: job.metadataPrompt,
    triagePrompt: job.triagePrompt ?? "",
    interpreter: job.interpreter,
    scriptContent: job.scriptContent,
    envVariables: job.envVariables ?? {},
    onSuccess: job.onSuccess ?? [],
    onFailure: job.onFailure ?? [],
  };
}

const sectionLabel: React.CSSProperties = { color: "var(--fg-4)", fontSize: 10, fontFamily: "var(--mono)" };
const rowLabel: React.CSSProperties = { color: "var(--fg)", fontSize: 12, fontFamily: "var(--mono)" };

export function CreateJobModal({ jobs, agents, editJob, onSubmit, onCancel }: Props) {
  const isEdit = !!editJob;
  const [form, setForm] = useState<CreateJobRequest>(
    editJob ? jobToForm(editJob) : buildDefaultForm()
  );
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [scheduleUnit, setScheduleUnit] = useState("minutes");

  // issue #50: typed metadata contract rows (loose-typed for the editor).
  const [inputs, setInputs] = useState<SchemaField[]>(editJob?.inputs ?? []);
  const [outputs, setOutputs] = useState<SchemaField[]>(editJob?.outputs ?? []);

  // Env variable inputs
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");

  function update<K extends keyof CreateJobRequest>(key: K, value: CreateJobRequest[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    if (!form.name.trim()) return;
    // Convert schedule interval based on unit
    const intervalSeconds =
      scheduleUnit === "hours"
        ? form.scheduleInterval * 60
        : scheduleUnit === "days"
          ? form.scheduleInterval * 1440
          : form.scheduleInterval;
    const req: CreateJobRequest = {
      ...form,
      scheduleInterval: intervalSeconds,
      inputs: toInputSpecs(inputs),
      outputs: toOutputSpecs(outputs),
    };
    if (isEdit && editJob) {
      onSubmit({ ...req, id: editJob.id } as UpdateJobRequest);
    } else {
      onSubmit(req);
    }
  }

  async function handleBrowseDirectory() {
    try {
      const selected = await api.browseDirectory();
      if (selected) update("workingDirectory", selected);
    } catch {
      // ignore
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "general", label: "general" },
    { key: "schedule", label: "schedule" },
    { key: form.type === "claude" ? "session" : "script", label: form.type === "claude" ? "session" : "script" },
    { key: "contract", label: "contract" },
  ];

  const canSave = !!form.name.trim();

  return (
    <ModalShell width={540} onClose={onCancel}>
      {/* header */}
      <div style={{ padding: "20px 26px 0" }}>
        <h2 className="mono" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--fg)" }}>
          <span style={{ color: "var(--accent)" }}>&gt;</span> {isEdit ? "edit_job" : "new_job"}
        </h2>
      </div>

      {/* tab bar */}
      <div style={{ display: "flex", gap: 4, padding: "14px 22px 0", borderBottom: "1px solid var(--border-2)" }}>
        {tabs.map((tab) => {
          const on = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
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

      {/* body */}
      <div className="scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 26px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* TAB: General */}
        {activeTab === "general" && (
          <>
            <Field label="type">
              <div style={{ display: "flex", borderRadius: 9, overflow: "hidden", border: "1px solid var(--border-2)" }}>
                {(["claude", "bash"] as JobType[]).map((t, i) => {
                  const on = form.type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => update("type", t)}
                      style={{
                        flex: 1,
                        height: 38,
                        cursor: "pointer",
                        border: "none",
                        borderLeft: i ? "1px solid var(--border-2)" : "none",
                        fontFamily: "var(--mono)",
                        fontSize: 11.5,
                        fontWeight: on ? 600 : 400,
                        background: on ? "var(--accent)" : "transparent",
                        color: on ? "var(--on-accent)" : "var(--fg-3)",
                      }}
                    >
                      {t === "claude" ? "claude session" : "bash script"}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="name">
              <ModalInput autoFocus value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="my-job" />
            </Field>

            <Field label="description">
              <ModalInput value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="what does this job do?" />
            </Field>

            <Field label="working directory">
              <div style={{ display: "flex", gap: 8 }}>
                <ModalInput value={form.workingDirectory} onChange={(e) => update("workingDirectory", e.target.value)} placeholder="/path/to/project" style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={handleBrowseDirectory}
                  title="Browse…"
                  style={{ width: 38, height: 38, flex: "none", borderRadius: 9, cursor: "pointer", background: "var(--panel-3)", border: "1px solid var(--border-2)", color: "var(--fg-3)", fontFamily: "var(--mono)" }}
                >
                  …
                </button>
              </div>
            </Field>
          </>
        )}

        {/* TAB: Schedule */}
        {activeTab === "schedule" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="mono" style={{ fontSize: 12.5, color: "var(--fg)" }}>enable schedule</span>
              <Toggle checked={form.scheduleEnabled} onChange={(v) => update("scheduleEnabled", v)} />
            </div>

            {form.scheduleEnabled && (
              <>
                <Field label="type">
                  <div style={{ display: "flex", borderRadius: 9, overflow: "hidden", border: "1px solid var(--border-2)" }}>
                    {(["recurring", "one_time"] as ScheduleType[]).map((t, i) => {
                      const on = form.scheduleType === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => update("scheduleType", t)}
                          style={{
                            flex: 1,
                            height: 38,
                            cursor: "pointer",
                            border: "none",
                            borderLeft: i ? "1px solid var(--border-2)" : "none",
                            fontFamily: "var(--mono)",
                            fontSize: 11.5,
                            fontWeight: on ? 600 : 400,
                            background: on ? "var(--accent)" : "transparent",
                            color: on ? "var(--on-accent)" : "var(--fg-3)",
                          }}
                        >
                          {t === "recurring" ? "recurring" : "one-time"}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                {form.scheduleType === "recurring" && (
                  <Field label="run every">
                    <div style={{ display: "flex", gap: 8 }}>
                      <ModalInput
                        type="number"
                        min={1}
                        value={form.scheduleInterval}
                        onChange={(e) => update("scheduleInterval", parseInt(e.target.value) || 1)}
                        style={{ width: 80 }}
                      />
                      <ModalSelect
                        value={scheduleUnit}
                        onChange={setScheduleUnit}
                        options={SCHEDULE_UNIT_OPTIONS.map((u) => ({ value: u, label: u }))}
                        width={130}
                      />
                    </div>
                  </Field>
                )}

                <Field label="cron expression">
                  <ModalInput value={form.cronExpression} onChange={(e) => update("cronExpression", e.target.value)} placeholder="*/5 * * * *" />
                </Field>

                <Field label="timeout (seconds)">
                  <ModalInput
                    type="number"
                    min={0}
                    value={form.timeoutSeconds}
                    onChange={(e) => update("timeoutSeconds", parseInt(e.target.value) || 0)}
                  />
                </Field>
              </>
            )}
          </>
        )}

        {/* TAB: Session (claude) */}
        {activeTab === "session" && form.type === "claude" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={rowLabel}>max retries</span>
              <ModalInput
                type="number"
                min={0}
                value={form.maxRetries}
                onChange={(e) => update("maxRetries", parseInt(e.target.value) || 0)}
                style={{ width: 150, height: 32, textAlign: "right" }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={rowLabel}>model</span>
              <ModalSelect
                value={form.model || "cli default"}
                onChange={(v) => update("model", v)}
                options={MODEL_OPTIONS.map((m) => ({ value: m, label: m }))}
                width={210}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={rowLabel}>agent</span>
              <ModalSelect
                value={form.agentId || "none"}
                onChange={(v) => update("agentId", v === "none" ? "" : v)}
                options={[{ value: "none", label: "none" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
                width={210}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={rowLabel}>override repo command</span>
              <Toggle checked={!!form.overrideRepoCommand} onChange={(v) => update("overrideRepoCommand", v ? "claude" : "")} />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={rowLabel}>claude command</span>
              <ModalInput
                value={form.claudeCommand}
                onChange={(e) => update("claudeCommand", e.target.value)}
                placeholder="claude"
                style={{ width: 150, height: 32 }}
              />
            </div>

            <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
              <span style={sectionLabel}># prompts</span>

              <Field label="task prompt">
                <ModalTextarea
                  value={form.prompt}
                  onChange={(e) => update("prompt", e.target.value)}
                  placeholder="describe what the job should do…"
                  style={{ height: 110 }}
                />
              </Field>

              <Field label="success criteria" hint="optional, max 300 chars">
                <ModalTextarea
                  placeholder="e.g. PRs were reviewed and feedback was posted successfully"
                  maxLength={300}
                  value={form.successPrompt}
                  onChange={(e) => update("successPrompt", e.target.value)}
                  style={{ height: 56 }}
                />
              </Field>

              <Field label="failure criteria" hint="optional, max 300 chars">
                <ModalTextarea
                  placeholder="e.g. no PRs found to review, or API errors occurred"
                  maxLength={300}
                  value={form.failurePrompt}
                  onChange={(e) => update("failurePrompt", e.target.value)}
                  style={{ height: 56 }}
                />
              </Field>

              <Field label="metadata to extract" hint="optional">
                <ModalTextarea
                  placeholder="e.g. extract PR URLs, review counts, and error details to pass to triggered jobs"
                  maxLength={500}
                  value={form.metadataPrompt}
                  onChange={(e) => update("metadataPrompt", e.target.value)}
                  style={{ height: 56 }}
                />
              </Field>

              <Field label="triage prompt" hint="optional, max 500 chars">
                <span className="mono" style={{ display: "block", color: "var(--fg-4)", fontSize: 10, marginBottom: 4 }}>
                  when set, jobs can enter 'waiting' state for human intervention
                </span>
                <ModalTextarea
                  placeholder="e.g. the task requires design decisions, missing permissions, or ambiguous requirements that need human input"
                  maxLength={500}
                  value={form.triagePrompt}
                  onChange={(e) => update("triagePrompt", e.target.value)}
                  style={{ height: 56 }}
                />
              </Field>
            </div>
          </>
        )}

        {/* TAB: Script (bash) */}
        {activeTab === "script" && form.type === "bash" && (
          <>
            <Field label="interpreter">
              <ModalSelect
                value={form.interpreter || "/bin/bash"}
                onChange={(v) => update("interpreter", v)}
                options={INTERPRETER_OPTIONS.map((o) => ({ value: o, label: o }))}
                width={210}
              />
            </Field>

            <Field label="script">
              <ModalTextarea
                value={form.scriptContent}
                onChange={(e) => update("scriptContent", e.target.value)}
                placeholder={"#!/bin/bash\necho 'hello world'"}
                style={{ height: 150 }}
              />
            </Field>

            <Field label="environment variables">
              <div className="scroll" style={{ border: "1px solid var(--border-2)", borderRadius: 8, maxHeight: 120, overflowY: "auto" }}>
                {Object.entries(form.envVariables).map(([key, val]) => (
                  <div
                    key={key}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", height: 30, borderBottom: "1px solid var(--border-2)" }}
                  >
                    <span className="mono" style={{ color: "var(--fg)", fontSize: 11 }}>{key}={val}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...form.envVariables };
                        delete next[key];
                        update("envVariables", next);
                      }}
                      style={{ color: "var(--fg-3)", fontSize: 12, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--mono)" }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {Object.keys(form.envVariables).length === 0 && (
                  <div className="mono" style={{ color: "var(--fg-4)", fontSize: 10.5, padding: "8px 12px" }}>// no variables</div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                <ModalInput value={newEnvKey} onChange={(e) => setNewEnvKey(e.target.value)} placeholder="KEY" style={{ width: 130, height: 30, fontSize: 11 }} />
                <span style={{ color: "var(--fg-3)", fontSize: 11 }}>=</span>
                <ModalInput value={newEnvValue} onChange={(e) => setNewEnvValue(e.target.value)} placeholder="VALUE" style={{ flex: 1, height: 30, fontSize: 11 }} />
                <button
                  type="button"
                  onClick={() => {
                    if (newEnvKey.trim()) {
                      update("envVariables", { ...form.envVariables, [newEnvKey.trim()]: newEnvValue });
                      setNewEnvKey("");
                      setNewEnvValue("");
                    }
                  }}
                  style={{ flex: "none", fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: "4px 8px" }}
                >
                  + add
                </button>
              </div>
            </Field>
          </>
        )}

        {/* TAB: Contract (issue #50 typed metadata) */}
        {activeTab === "contract" && (
          <>
            <span style={sectionLabel}># inputs — keys consumed from upstream metadata (required ones gate the run)</span>
            <SchemaFieldEditor kind="input" fields={inputs} onChange={setInputs} />

            <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 14 }}>
              <span style={{ ...sectionLabel, display: "block", marginBottom: 8 }}># outputs — keys this job produces or forwards (passthrough)</span>
              <SchemaFieldEditor kind="output" fields={outputs} onChange={setOutputs} />
            </div>
          </>
        )}
      </div>

      {/* bottom actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14, padding: "0 26px 22px" }}>
        <ModalCancel onClick={onCancel} />
        <ModalSubmit disabled={!canSave} onClick={handleSubmit}>
          {isEdit ? "$ save" : "$ create"}
        </ModalSubmit>
      </div>
    </ModalShell>
  );
}
