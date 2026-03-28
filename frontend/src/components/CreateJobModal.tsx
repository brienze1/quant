import { useState, useRef, useEffect } from "react";
import type { Job, JobType, CreateJobRequest, UpdateJobRequest, ScheduleType } from "../types";
import * as api from "../api";

const MODEL_OPTIONS = ["cli default", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];
const INTERPRETER_OPTIONS = ["/bin/bash", "/bin/sh", "/bin/zsh", "python3"];
const SCHEDULE_UNIT_OPTIONS = ["minutes", "hours", "days"];

type TabKey = "general" | "schedule" | "session" | "script";

interface Props {
  jobs: Job[];
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
    allowBypass: false,
    autonomousMode: false,
    maxRetries: 0,
    model: "claude-sonnet-4-6",
    overrideRepoCommand: "",
    claudeCommand: "",
    successPrompt: "",
    failurePrompt: "",
    metadataPrompt: "",
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
    successPrompt: job.successPrompt,
    failurePrompt: job.failurePrompt,
    metadataPrompt: job.metadataPrompt,
    interpreter: job.interpreter,
    scriptContent: job.scriptContent,
    envVariables: job.envVariables ?? {},
    onSuccess: job.onSuccess ?? [],
    onFailure: job.onFailure ?? [],
  };
}

export function CreateJobModal({ jobs, editJob, onSubmit, onCancel }: Props) {
  const isEdit = !!editJob;
  const [form, setForm] = useState<CreateJobRequest>(
    editJob ? jobToForm(editJob) : buildDefaultForm()
  );
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [scheduleUnit, setScheduleUnit] = useState("minutes");

  // Trigger dropdowns
  const [successDropdownOpen, setSuccessDropdownOpen] = useState(false);
  const [failureDropdownOpen, setFailureDropdownOpen] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);

  // Env variable inputs
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (successRef.current && !successRef.current.contains(e.target as Node)) {
        setSuccessDropdownOpen(false);
      }
      if (failureRef.current && !failureRef.current.contains(e.target as Node)) {
        setFailureDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function update<K extends keyof CreateJobRequest>(key: K, value: CreateJobRequest[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    // Convert schedule interval based on unit
    const intervalSeconds =
      scheduleUnit === "hours"
        ? form.scheduleInterval * 60
        : scheduleUnit === "days"
          ? form.scheduleInterval * 1440
          : form.scheduleInterval;
    const req: CreateJobRequest = { ...form, scheduleInterval: intervalSeconds };
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
  ];

  const availableJobsForSuccess = jobs.filter(
    (j) => !form.onSuccess.includes(j.id) && j.id !== editJob?.id
  );
  const availableJobsForFailure = jobs.filter(
    (j) => !form.onFailure.includes(j.id) && j.id !== editJob?.id
  );

  const triggeredByRefs = editJob?.triggeredBy ?? [];

  const inputStyle: React.CSSProperties = {
    backgroundColor: "#0A0A0A",
    border: "1px solid #2a2a2a",
    color: "#FAFAFA",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    height: 36,
  };

  const labelStyle: React.CSSProperties = {
    color: "#6B7280",
    fontSize: 10,
    fontFamily: "'JetBrains Mono', monospace",
    display: "block",
    marginBottom: 4,
    textTransform: "lowercase" as const,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-col"
        style={{
          width: 520,
          maxHeight: "90vh",
          backgroundColor: "#0A0A0A",
          border: "1px solid #2a2a2a",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {/* header */}
        <div className="px-8 pt-8 shrink-0">
          <h2 style={{ color: "#FAFAFA", fontSize: 14, fontWeight: 700 }}>
            <span style={{ color: "#10B981" }}>{">"}</span>{" "}
            {isEdit ? "edit_job" : "new_job"}
          </h2>
        </div>

        {/* tab bar */}
        <div
          className="flex px-8 mt-4 shrink-0"
          style={{ borderBottom: "1px solid #2a2a2a" }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="px-4 py-2 text-[11px] lowercase transition-colors"
              style={{
                color: activeTab === tab.key ? "#10B981" : "#6B7280",
                fontWeight: activeTab === tab.key ? 500 : "normal",
                borderBottom:
                  activeTab === tab.key
                    ? "2px solid #10B981"
                    : "2px solid transparent",
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: -1,
                background: "none",
                border: "none",
                borderBottomWidth: 2,
                borderBottomStyle: "solid",
                borderBottomColor: activeTab === tab.key ? "#10B981" : "transparent",
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* form body */}
        <div className="px-8 pt-4 pb-8 flex flex-col gap-4 overflow-y-auto">
          {/* TAB: General */}
          {activeTab === "general" && (
            <>
              {/* type toggle */}
              <div>
                <span style={labelStyle}>type</span>
                <div className="flex" style={{ gap: 0 }}>
                  {(["claude", "bash"] as JobType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        update("type", t);
                      }}
                      style={{
                        flex: 1,
                        height: 36,
                        fontSize: 11,
                        fontFamily: "'JetBrains Mono', monospace",
                        cursor: "pointer",
                        border:
                          form.type === t
                            ? "1px solid #10B981"
                            : "1px solid #2a2a2a",
                        backgroundColor:
                          form.type === t ? "#10B981" : "transparent",
                        color: form.type === t ? "#0A0A0A" : "#6B7280",
                        fontWeight: form.type === t ? 600 : 400,
                      }}
                    >
                      {t === "claude" ? "claude session" : "bash script"}
                    </button>
                  ))}
                </div>
              </div>

              {/* name */}
              <div>
                <span style={labelStyle}>name</span>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="my-job"
                  className="w-full px-3 focus:outline-none"
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                />
              </div>

              {/* description */}
              <div>
                <span style={labelStyle}>description</span>
                <input
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                  placeholder="what does this job do?"
                  className="w-full px-3 focus:outline-none"
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                />
              </div>

              {/* working directory */}
              <div>
                <span style={labelStyle}>working directory</span>
                <div className="flex" style={{ gap: 8 }}>
                  <input
                    value={form.workingDirectory}
                    onChange={(e) => update("workingDirectory", e.target.value)}
                    placeholder="/path/to/project"
                    className="flex-1 px-3 focus:outline-none"
                    style={inputStyle}
                    onFocus={(e) =>
                      (e.currentTarget.style.borderColor = "#10B981")
                    }
                    onBlur={(e) =>
                      (e.currentTarget.style.borderColor = "#2a2a2a")
                    }
                  />
                  <button
                    type="button"
                    onClick={handleBrowseDirectory}
                    style={{
                      width: 36,
                      height: 36,
                      backgroundColor: "#141414",
                      border: "1px solid #2a2a2a",
                      color: "#6B7280",
                      fontSize: 14,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    ...
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TAB: Schedule */}
          {activeTab === "schedule" && (
            <>
              {/* enable schedule toggle */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col" style={{ gap: 2 }}>
                  <span
                    style={{
                      color: "#FAFAFA",
                      fontSize: 11,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    enable schedule
                  </span>
                </div>
                <ToggleSwitch
                  checked={form.scheduleEnabled}
                  onChange={(v) => update("scheduleEnabled", v)}
                />
              </div>

              {form.scheduleEnabled && (
                <>
                  {/* schedule type toggle */}
                  <div>
                    <span style={labelStyle}>type</span>
                    <div className="flex" style={{ gap: 0 }}>
                      {(["recurring", "one_time"] as ScheduleType[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => update("scheduleType", t)}
                          style={{
                            flex: 1,
                            height: 36,
                            fontSize: 11,
                            fontFamily: "'JetBrains Mono', monospace",
                            cursor: "pointer",
                            border:
                              form.scheduleType === t
                                ? "1px solid #10B981"
                                : "1px solid #2a2a2a",
                            backgroundColor:
                              form.scheduleType === t ? "#10B981" : "transparent",
                            color:
                              form.scheduleType === t ? "#0A0A0A" : "#6B7280",
                            fontWeight: form.scheduleType === t ? 600 : 400,
                          }}
                        >
                          {t === "recurring" ? "recurring" : "one-time"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* run every */}
                  {form.scheduleType === "recurring" && (
                    <div>
                      <span style={labelStyle}>run every</span>
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <input
                          type="number"
                          min={1}
                          value={form.scheduleInterval}
                          onChange={(e) =>
                            update(
                              "scheduleInterval",
                              parseInt(e.target.value) || 1
                            )
                          }
                          className="px-3 focus:outline-none"
                          style={{ ...inputStyle, width: 60 }}
                          onFocus={(e) =>
                            (e.currentTarget.style.borderColor = "#10B981")
                          }
                          onBlur={(e) =>
                            (e.currentTarget.style.borderColor = "#2a2a2a")
                          }
                        />
                        <MiniSelect
                          value={scheduleUnit}
                          options={SCHEDULE_UNIT_OPTIONS}
                          onChange={setScheduleUnit}
                          width={100}
                        />
                      </div>
                    </div>
                  )}

                  {/* cron expression */}
                  <div>
                    <span style={labelStyle}>cron expression</span>
                    <input
                      value={form.cronExpression}
                      onChange={(e) => update("cronExpression", e.target.value)}
                      placeholder="*/5 * * * *"
                      className="w-full px-3 focus:outline-none"
                      style={inputStyle}
                      onFocus={(e) =>
                        (e.currentTarget.style.borderColor = "#10B981")
                      }
                      onBlur={(e) =>
                        (e.currentTarget.style.borderColor = "#2a2a2a")
                      }
                    />
                  </div>

                  {/* timeout */}
                  <div>
                    <span style={labelStyle}>timeout (seconds)</span>
                    <input
                      type="number"
                      min={0}
                      value={form.timeoutSeconds}
                      onChange={(e) =>
                        update("timeoutSeconds", parseInt(e.target.value) || 0)
                      }
                      className="w-full px-3 focus:outline-none"
                      style={inputStyle}
                      onFocus={(e) =>
                        (e.currentTarget.style.borderColor = "#10B981")
                      }
                      onBlur={(e) =>
                        (e.currentTarget.style.borderColor = "#2a2a2a")
                      }
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* TAB: Session (claude) */}
          {activeTab === "session" && form.type === "claude" && (
            <>
              {/* allow bypass */}
              <div className="flex items-center justify-between">
                <span
                  style={{
                    color: "#FAFAFA",
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  allow bypass
                </span>
                <ToggleSwitch
                  checked={form.allowBypass}
                  onChange={(v) => update("allowBypass", v)}
                />
              </div>

              {/* autonomous mode */}
              <div className="flex items-center justify-between">
                <span
                  style={{
                    color: "#FAFAFA",
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  autonomous mode
                </span>
                <ToggleSwitch
                  checked={form.autonomousMode}
                  onChange={(v) => update("autonomousMode", v)}
                />
              </div>

              {/* max retries */}
              <div className="flex items-center justify-between">
                <span
                  style={{
                    color: "#FAFAFA",
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  max retries
                </span>
                <input
                  type="number"
                  min={0}
                  value={form.maxRetries}
                  onChange={(e) =>
                    update("maxRetries", parseInt(e.target.value) || 0)
                  }
                  className="px-3 focus:outline-none text-right"
                  style={{ ...inputStyle, width: 140 }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "#10B981")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "#2a2a2a")
                  }
                />
              </div>

              {/* model */}
              <div className="flex items-center justify-between">
                <span
                  style={{
                    color: "#FAFAFA",
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  model
                </span>
                <MiniSelect
                  value={form.model || "cli default"}
                  options={MODEL_OPTIONS}
                  onChange={(v) => update("model", v)}
                  width={140}
                />
              </div>

              {/* override repo command */}
              <div className="flex items-center justify-between">
                <span
                  style={{
                    color: "#FAFAFA",
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  override repo command
                </span>
                <ToggleSwitch
                  checked={!!form.overrideRepoCommand}
                  onChange={(v) =>
                    update("overrideRepoCommand", v ? "claude" : "")
                  }
                />
              </div>

              {/* claude command */}
              <div className="flex items-center justify-between">
                <span
                  style={{
                    color: "#FAFAFA",
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  claude command
                </span>
                <input
                  value={form.claudeCommand}
                  onChange={(e) => update("claudeCommand", e.target.value)}
                  placeholder="claude"
                  className="px-3 focus:outline-none"
                  style={{ ...inputStyle, width: 140 }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "#10B981")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "#2a2a2a")
                  }
                />
              </div>

              {/* prompts group */}
              <div style={{ borderTop: "1px solid #2a2a2a", paddingTop: 12, marginTop: 4, display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ color: "#4B5563", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
                  # prompts
                </span>

                <div>
                  <span style={labelStyle}>task prompt</span>
                  <textarea
                    value={form.prompt}
                    onChange={(e) => update("prompt", e.target.value)}
                    placeholder="describe what the job should do..."
                    style={{ ...inputStyle, width: "100%", height: 120, resize: "vertical", padding: "8px 12px", boxSizing: "border-box" as const }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                  />
                </div>

                <div>
                  <span style={labelStyle}>success criteria <span style={{ color: "#4B5563" }}>(optional, max 300 chars)</span></span>
                  <textarea
                    placeholder="e.g. PRs were reviewed and feedback was posted successfully"
                    maxLength={300}
                    value={form.successPrompt}
                    onChange={(e) => update("successPrompt", e.target.value)}
                    style={{ ...inputStyle, width: "100%", height: 56, resize: "none", padding: "8px 12px", boxSizing: "border-box" as const }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                  />
                </div>

                <div>
                  <span style={labelStyle}>failure criteria <span style={{ color: "#4B5563" }}>(optional, max 300 chars)</span></span>
                  <textarea
                    placeholder="e.g. no PRs found to review, or API errors occurred"
                    maxLength={300}
                    value={form.failurePrompt}
                    onChange={(e) => update("failurePrompt", e.target.value)}
                    style={{ ...inputStyle, width: "100%", height: 56, resize: "none", padding: "8px 12px", boxSizing: "border-box" as const }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                  />
                </div>

                <div>
                  <span style={labelStyle}>metadata to extract <span style={{ color: "#4B5563" }}>(optional)</span></span>
                  <textarea
                    placeholder="e.g. extract PR URLs, review counts, and error details to pass to triggered jobs"
                    maxLength={500}
                    value={form.metadataPrompt}
                    onChange={(e) => update("metadataPrompt", e.target.value)}
                    style={{ ...inputStyle, width: "100%", height: 56, resize: "none", padding: "8px 12px", boxSizing: "border-box" as const }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                  />
                </div>
              </div>
            </>
          )}

          {/* TAB: Script (bash) */}
          {activeTab === "script" && form.type === "bash" && (
            <>
              {/* interpreter */}
              <div>
                <span style={labelStyle}>interpreter</span>
                <MiniSelect
                  value={form.interpreter || "/bin/bash"}
                  options={INTERPRETER_OPTIONS}
                  onChange={(v) => update("interpreter", v)}
                  width={200}
                />
              </div>

              {/* script content */}
              <div>
                <span style={labelStyle}>script</span>
                <textarea
                  value={form.scriptContent}
                  onChange={(e) => update("scriptContent", e.target.value)}
                  placeholder="#!/bin/bash&#10;echo 'hello world'"
                  className="w-full px-3 py-2 focus:outline-none"
                  style={{
                    ...inputStyle,
                    height: 140,
                    resize: "vertical",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.borderColor = "#10B981")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.borderColor = "#2a2a2a")
                  }
                />
              </div>

              {/* environment variables */}
              <div>
                <span style={labelStyle}>environment variables</span>
                <div
                  style={{
                    border: "1px solid #2a2a2a",
                    backgroundColor: "#0A0A0A",
                    maxHeight: 120,
                    overflowY: "auto",
                  }}
                >
                  {Object.entries(form.envVariables).map(([key, val]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between px-3"
                      style={{
                        height: 28,
                        borderBottom: "1px solid #1F1F1F",
                      }}
                    >
                      <span
                        style={{
                          color: "#FAFAFA",
                          fontSize: 11,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {key}={val}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = { ...form.envVariables };
                          delete next[key];
                          update("envVariables", next);
                        }}
                        style={{
                          color: "#6B7280",
                          fontSize: 12,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        x
                      </button>
                    </div>
                  ))}
                  {Object.keys(form.envVariables).length === 0 && (
                    <div
                      className="px-3 py-2"
                      style={{
                        color: "#4B5563",
                        fontSize: 10,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      // no variables
                    </div>
                  )}
                </div>
                <div className="flex items-center mt-2" style={{ gap: 4 }}>
                  <input
                    value={newEnvKey}
                    onChange={(e) => setNewEnvKey(e.target.value)}
                    placeholder="KEY"
                    className="px-2 focus:outline-none"
                    style={{
                      ...inputStyle,
                      width: 100,
                      height: 28,
                      fontSize: 10,
                    }}
                    onFocus={(e) =>
                      (e.currentTarget.style.borderColor = "#10B981")
                    }
                    onBlur={(e) =>
                      (e.currentTarget.style.borderColor = "#2a2a2a")
                    }
                  />
                  <span style={{ color: "#6B7280", fontSize: 10 }}>=</span>
                  <input
                    value={newEnvValue}
                    onChange={(e) => setNewEnvValue(e.target.value)}
                    placeholder="VALUE"
                    className="flex-1 px-2 focus:outline-none"
                    style={{
                      ...inputStyle,
                      height: 28,
                      fontSize: 10,
                    }}
                    onFocus={(e) =>
                      (e.currentTarget.style.borderColor = "#10B981")
                    }
                    onBlur={(e) =>
                      (e.currentTarget.style.borderColor = "#2a2a2a")
                    }
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newEnvKey.trim()) {
                        update("envVariables", {
                          ...form.envVariables,
                          [newEnvKey.trim()]: newEnvValue,
                        });
                        setNewEnvKey("");
                        setNewEnvValue("");
                      }
                    }}
                    style={{
                      fontSize: 10,
                      color: "#10B981",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "'JetBrains Mono', monospace",
                      padding: "4px 8px",
                    }}
                  >
                    + add
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* bottom actions */}
        <div
          className="flex items-center justify-end gap-3 px-8 pb-8 shrink-0"
        >
          <button
            type="button"
            onClick={onCancel}
            className="px-4 text-xs lowercase transition-colors"
            style={{
              color: "#6B7280",
              background: "none",
              border: "none",
              cursor: "pointer",
              height: 36,
              fontFamily: "'JetBrains Mono', monospace",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
          >
            cancel
          </button>
          <button
            type="submit"
            disabled={!form.name.trim()}
            className="text-xs lowercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              width: 80,
              height: 36,
              backgroundColor: "#10B981",
              color: "#0A0A0A",
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {isEdit ? "$ save" : "$ create"}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Sub-components ---

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        backgroundColor: checked ? "#10B981" : "#2a2a2a",
        border: "none",
        cursor: "pointer",
        position: "relative",
        transition: "background-color 150ms",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: "#FAFAFA",
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          transition: "left 150ms",
        }}
      />
    </button>
  );
}

function MiniSelect({
  value,
  options,
  onChange,
  width,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  width: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", width }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width,
          height: 36,
          backgroundColor: "#0A0A0A",
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
            top: 40,
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
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
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
                if (opt !== value)
                  e.currentTarget.style.backgroundColor = "#1F1F1F";
              }}
              onMouseLeave={(e) => {
                if (opt !== value)
                  e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span style={{ color: "#10B981", flexShrink: 0 }}>~</span>
              <span>{opt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TriggerList({
  items,
  jobs,
  onRemove,
  readOnly,
}: {
  items: string[];
  jobs: Job[];
  onRemove: (id: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid #2a2a2a",
        backgroundColor: "#0A0A0A",
        maxHeight: 100,
        overflowY: "auto",
      }}
    >
      {items.length === 0 && (
        <div
          className="px-3 py-2"
          style={{
            color: "#4B5563",
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          // none
        </div>
      )}
      {items.map((id) => {
        const job = jobs.find((j) => j.id === id);
        return (
          <div
            key={id}
            className="flex items-center justify-between px-3"
            style={{
              height: 28,
              borderBottom: "1px solid #1F1F1F",
            }}
          >
            <span
              style={{
                color: "#FAFAFA",
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {job?.name ?? id}
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => onRemove(id)}
                style={{
                  color: "#6B7280",
                  fontSize: 12,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                x
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function JobDropdown({
  availableJobs,
  onSelect,
}: {
  availableJobs: Job[];
  onSelect: (id: string) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 24,
        left: 0,
        zIndex: 50,
        backgroundColor: "#0A0A0A",
        border: "1px solid #2a2a2a",
        width: 200,
        maxHeight: 120,
        overflowY: "auto",
      }}
    >
      {availableJobs.length === 0 && (
        <div
          className="px-3 py-2"
          style={{
            color: "#4B5563",
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          // no jobs available
        </div>
      )}
      {availableJobs.map((job) => (
        <button
          key={job.id}
          type="button"
          onClick={() => onSelect(job.id)}
          className="w-full text-left px-3 py-1.5 transition-colors"
          style={{
            color: "#FAFAFA",
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.backgroundColor = "#1F1F1F")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.backgroundColor = "transparent")
          }
        >
          {job.name}
        </button>
      ))}
    </div>
  );
}
