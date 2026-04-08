import { useState, useRef, useEffect } from "react";
import type { Agent, CreateAgentRequest, UpdateAgentRequest, SkillInfo } from "../types";
import * as api from "../api";

const MODEL_OPTIONS = ["claude-sonnet-4-20250514", "claude-opus-4-6", "claude-haiku-4-5-20251001", "cli default"];
const COLOR_SWATCHES = ["#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#3B82F6", "#EC4899"];

type TabKey = "personality" | "access" | "boundaries" | "skills";

interface Props {
  agent?: Agent;
  workspaceId: string;
  onSubmit: (req: CreateAgentRequest | UpdateAgentRequest) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onCancel: () => void;
}

function buildDefaultForm(): CreateAgentRequest {
  return {
    name: "",
    color: "#10B981",
    role: "",
    goal: "",
    model: "claude-sonnet-4-20250514",
    autonomousMode: true,
    mcpServers: {},
    envVariables: {},
    boundaries: [],
    skills: {},
  };
}

function agentToForm(agent: Agent): CreateAgentRequest {
  return {
    name: agent.name,
    color: agent.color,
    role: agent.role,
    goal: agent.goal,
    model: agent.model,
    autonomousMode: agent.autonomousMode,
    mcpServers: agent.mcpServers ?? {},
    envVariables: agent.envVariables ?? {},
    boundaries: agent.boundaries ?? [],
    skills: agent.skills ?? {},
  };
}

// --- Inline SVG icons ---

function IconX({ size = 16, color = "var(--q-fg-secondary)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconPlus({ size = 14, color = "var(--q-error)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconLock({ size = 12, color = "var(--q-fg-secondary)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <rect x="2" y="5" width="8" height="6" rx="1" stroke={color} strokeWidth="1.2" />
      <path d="M4 5V3.5a2 2 0 014 0V5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash({ size = 14, color = "var(--q-error)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 4h9M5 4V2.5h4V4M3.5 4l.5 8h6l.5-8" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// --- Sub-components ---

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 32,
        height: 16,
        borderRadius: 8,
        backgroundColor: checked ? "var(--q-accent)" : "var(--q-border)",
        border: "none",
        cursor: "pointer",
        position: "relative",
        transition: "background-color 150ms",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: checked ? "var(--q-fg)" : "var(--q-fg-secondary)",
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
          backgroundColor: "var(--q-bg)",
          border: `1px solid ${open ? "var(--q-accent)" : "var(--q-border)"}`,
          color: "var(--q-fg)",
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
            backgroundColor: "var(--q-bg)",
            border: "1px solid var(--q-border)",
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
                color: opt === value ? "var(--q-accent)" : "var(--q-fg-dimmed)",
                backgroundColor: opt === value ? "var(--q-bg-hover)" : "transparent",
                border: "none",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (opt !== value) e.currentTarget.style.backgroundColor = "var(--q-bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (opt !== value) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span style={{ color: "var(--q-accent)", flexShrink: 0 }}>~</span>
              <span>{opt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Main component ---

export function CreateAgentModal({ agent, workspaceId, onSubmit, onDelete, onCancel }: Props) {
  const isEdit = !!agent;
  const [form, setForm] = useState<CreateAgentRequest>(
    agent ? agentToForm(agent) : buildDefaultForm()
  );
  const [activeTab, setActiveTab] = useState<TabKey>("personality");
  const [saving, setSaving] = useState(false);

  // Access tab state
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");
  const [envValueVisible, setEnvValueVisible] = useState<Record<string, boolean>>({});

  // Skills tab state
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);

  useEffect(() => {
    api.listAvailableMcpServers(workspaceId).then((servers) => {
      setMcpServers(servers ?? []);
    }).catch(() => {});

    api.listAvailableSkills(workspaceId).then((skills) => {
      setAvailableSkills(skills ?? []);
    }).catch(() => {});
  }, [workspaceId]);

  function update<K extends keyof CreateAgentRequest>(key: K, value: CreateAgentRequest[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (isEdit && agent) {
        await onSubmit({ ...form, id: agent.id } as UpdateAgentRequest);
      } else {
        await onSubmit(form);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete || !agent) return;
    setSaving(true);
    try {
      await onDelete(agent.id);
    } finally {
      setSaving(false);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "personality", label: "personality" },
    { key: "access", label: "access" },
    { key: "boundaries", label: "boundaries" },
    { key: "skills", label: "skills" },
  ];

  const inputStyle: React.CSSProperties = {
    backgroundColor: "var(--q-bg)",
    border: "1px solid var(--q-border)",
    color: "var(--q-fg)",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    padding: "0 12px",
    height: 36,
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    color: "var(--q-fg-secondary)",
    fontSize: 10,
    fontFamily: "'JetBrains Mono', monospace",
    display: "block",
    marginBottom: 4,
    textTransform: "lowercase",
  };

  const enabledSkillsCount = Object.values(form.skills).filter(Boolean).length;
  const totalSkillsCount = availableSkills.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--q-modal-backdrop)" }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-col"
        style={{
          width: 720,
          maxHeight: "90vh",
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {/* header - 56px */}
        <div
          className="flex items-center justify-between px-8 shrink-0"
          style={{ height: 56 }}
        >
          <div className="flex items-center" style={{ gap: 10 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: "var(--q-accent)",
              }}
            />
            <h2 style={{ color: "var(--q-fg)", fontSize: 14, fontWeight: 700, margin: 0 }}>
              <span style={{ color: "var(--q-accent)" }}>{">"}</span>{" "}
              {isEdit ? `edit_agent: ${agent!.name}` : "new_agent"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => (e.currentTarget.querySelector("svg path") as SVGPathElement | null)?.setAttribute("stroke", "var(--q-fg)")}
            onMouseLeave={(e) => (e.currentTarget.querySelector("svg path") as SVGPathElement | null)?.setAttribute("stroke", "var(--q-fg-secondary)")}
          >
            <IconX size={16} color="var(--q-fg-secondary)" />
          </button>
        </div>

        {/* tab bar - 36px */}
        <div
          className="flex px-8 shrink-0"
          style={{ height: 36, borderBottom: "1px solid var(--q-border)" }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "0 16px",
                fontSize: 11,
                color: activeTab === tab.key ? "var(--q-accent)" : "var(--q-fg-secondary)",
                fontWeight: activeTab === tab.key ? 500 : 400,
                fontFamily: "'JetBrains Mono', monospace",
                background: "none",
                border: "none",
                borderBottom: activeTab === tab.key ? "2px solid var(--q-accent)" : "2px solid transparent",
                marginBottom: -1,
                cursor: "pointer",
                textTransform: "lowercase",
                height: "100%",
                display: "flex",
                alignItems: "center",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* body - scrollable */}
        <div className="px-8 pt-4 pb-6 flex flex-col gap-4 overflow-y-auto" style={{ flex: 1 }}>
          {/* TAB: Personality */}
          {activeTab === "personality" && (
            <>
              {/* Identity section */}
              <div className="flex items-start" style={{ gap: 16 }}>
                {/* Avatar preview */}
                <div
                  style={{
                    width: 64,
                    height: 64,
                    backgroundColor: form.color || "var(--q-accent)",
                    borderRadius: 4,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    fontWeight: 700,
                    color: "var(--q-bg)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {form.name ? form.name[0].toUpperCase() : "?"}
                </div>

                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Name */}
                  <div>
                    <span style={labelStyle}>name</span>
                    <input
                      autoFocus
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      placeholder="agent-name"
                      style={inputStyle}
                      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
                      onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
                    />
                  </div>

                  {/* Color picker */}
                  <div>
                    <span style={labelStyle}>color</span>
                    <div className="flex items-center" style={{ gap: 6 }}>
                      {COLOR_SWATCHES.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => update("color", c)}
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 4,
                            backgroundColor: c,
                            border: form.color === c ? "2px solid var(--q-fg)" : "2px solid transparent",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Role */}
              <div>
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <span style={{ ...labelStyle, marginBottom: 0 }}>role</span>
                  <span style={{ color: "var(--q-fg-secondary)", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                    {form.role.length} / 500
                  </span>
                </div>
                <textarea
                  value={form.role}
                  onChange={(e) => update("role", e.target.value)}
                  maxLength={500}
                  placeholder="describe the agent's role..."
                  style={{
                    ...inputStyle,
                    height: 72,
                    resize: "none",
                    padding: "8px 12px",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
                />
              </div>

              {/* Goal */}
              <div>
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <span style={{ ...labelStyle, marginBottom: 0 }}>goal</span>
                  <span style={{ color: "var(--q-fg-secondary)", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                    {form.goal.length} / 500
                  </span>
                </div>
                <textarea
                  value={form.goal}
                  onChange={(e) => update("goal", e.target.value)}
                  maxLength={500}
                  placeholder="what should this agent accomplish?"
                  style={{
                    ...inputStyle,
                    height: 72,
                    resize: "none",
                    padding: "8px 12px",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
                />
              </div>

              {/* Model */}
              <div>
                <span style={labelStyle}>model</span>
                <MiniSelect
                  value={form.model || "cli default"}
                  options={MODEL_OPTIONS}
                  onChange={(v) => update("model", v)}
                  width={300}
                />
              </div>
            </>
          )}

          {/* TAB: Access */}
          {activeTab === "access" && (
            <>
              {/* Autonomous mode toggle */}
              <div className="flex items-center justify-between">
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: "var(--q-fg)", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                    autonomous mode
                  </span>
                  <span style={{ color: "var(--q-fg-secondary)", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                    allow agent to run without manual approval for each action
                  </span>
                </div>
                <ToggleSwitch
                  checked={form.autonomousMode}
                  onChange={(v) => update("autonomousMode", v)}
                />
              </div>

              {/* MCP Servers */}
              <div style={{ borderTop: "1px solid var(--q-border)", paddingTop: 12, marginTop: 4 }}>
                <span style={{ color: "var(--q-fg-muted)", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
                  # mcp servers
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 8 }}>
                  {mcpServers.length === 0 && (
                    <div style={{ color: "var(--q-fg-muted)", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", padding: "8px 0" }}>
                      // no mcp servers available
                    </div>
                  )}
                  {mcpServers.map((server) => (
                    <div
                      key={server}
                      className="flex items-center justify-between"
                      style={{
                        height: 36,
                        borderBottom: "1px solid var(--q-bg-hover)",
                      }}
                    >
                      <span style={{ color: "var(--q-fg)", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                        {server}
                      </span>
                      <ToggleSwitch
                        checked={!!form.mcpServers[server]}
                        onChange={(v) => {
                          update("mcpServers", { ...form.mcpServers, [server]: v });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Environment Variables */}
              <div style={{ borderTop: "1px solid var(--q-border)", paddingTop: 12, marginTop: 4 }}>
                <span style={{ color: "var(--q-fg-muted)", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
                  # environment variables
                </span>
                <div
                  style={{
                    border: "1px solid var(--q-border)",
                    backgroundColor: "var(--q-bg)",
                    maxHeight: 160,
                    overflowY: "auto",
                    marginTop: 8,
                  }}
                >
                  {Object.entries(form.envVariables).map(([key, val]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between px-3"
                      style={{ height: 32, borderBottom: "1px solid var(--q-bg-hover)" }}
                    >
                      <div className="flex items-center" style={{ gap: 8, flex: 1, minWidth: 0 }}>
                        <span style={{ color: "var(--q-accent)", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                          {key}
                        </span>
                        <span style={{ color: "var(--q-fg-secondary)", fontSize: 11 }}>=</span>
                        <span style={{ color: "var(--q-fg)", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {envValueVisible[key] ? val : "********"}
                        </span>
                      </div>
                      <div className="flex items-center" style={{ gap: 4, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => setEnvValueVisible((prev) => ({ ...prev, [key]: !prev[key] }))}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", alignItems: "center" }}
                        >
                          <IconLock size={12} color={envValueVisible[key] ? "var(--q-accent)" : "var(--q-fg-secondary)"} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...form.envVariables };
                            delete next[key];
                            update("envVariables", next);
                          }}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", alignItems: "center" }}
                        >
                          <IconX size={12} color="var(--q-fg-secondary)" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {Object.keys(form.envVariables).length === 0 && (
                    <div style={{ color: "var(--q-fg-muted)", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", padding: "8px 12px" }}>
                      // no variables
                    </div>
                  )}
                </div>
                <div className="flex items-center" style={{ gap: 4, marginTop: 8 }}>
                  <input
                    value={newEnvKey}
                    onChange={(e) => setNewEnvKey(e.target.value)}
                    placeholder="KEY"
                    style={{ ...inputStyle, width: 120, height: 28, fontSize: 10 }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
                  />
                  <span style={{ color: "var(--q-fg-secondary)", fontSize: 10 }}>=</span>
                  <input
                    value={newEnvValue}
                    onChange={(e) => setNewEnvValue(e.target.value)}
                    placeholder="VALUE"
                    style={{ ...inputStyle, flex: 1, width: "auto", height: 28, fontSize: 10 }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newEnvKey.trim()) {
                        update("envVariables", { ...form.envVariables, [newEnvKey.trim()]: newEnvValue });
                        setNewEnvKey("");
                        setNewEnvValue("");
                      }
                    }}
                    style={{
                      fontSize: 10,
                      color: "var(--q-accent)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "'JetBrains Mono', monospace",
                      padding: "4px 8px",
                      flexShrink: 0,
                    }}
                  >
                    + add
                  </button>
                </div>
              </div>
            </>
          )}

          {/* TAB: Boundaries */}
          {activeTab === "boundaries" && (
            <>
              <div>
                <span style={{ color: "var(--q-fg-muted)", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
                  # anti-prompt rules
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  {form.boundaries.map((rule, i) => (
                    <div key={i} className="flex items-center" style={{ gap: 8 }}>
                      <input
                        value={rule}
                        onChange={(e) => {
                          const next = [...form.boundaries];
                          next[i] = e.target.value;
                          update("boundaries", next);
                        }}
                        placeholder="do not..."
                        style={inputStyle}
                        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = form.boundaries.filter((_, j) => j !== i);
                          update("boundaries", next);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <IconX size={14} color="var(--q-error)" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => update("boundaries", [...form.boundaries, ""])}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    height: 36,
                    backgroundColor: "transparent",
                    border: "1px dashed var(--q-error)",
                    color: "var(--q-error)",
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <IconPlus size={12} color="var(--q-error)" />
                  add rule
                </button>
              </div>
            </>
          )}

          {/* TAB: Skills */}
          {activeTab === "skills" && (
            <>
              <div className="flex items-center justify-between">
                <span style={{ color: "var(--q-fg)", fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                  available skills
                </span>
                <span style={{ color: "var(--q-fg-secondary)", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                  {enabledSkillsCount} of {totalSkillsCount} enabled
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {availableSkills.length === 0 && (
                  <div style={{ color: "var(--q-fg-muted)", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", padding: "8px 0" }}>
                    // no skills available
                  </div>
                )}
                {availableSkills.map((skill) => (
                  <div
                    key={skill.name}
                    className="flex items-center justify-between"
                    style={{
                      height: 44,
                      borderBottom: "1px solid var(--q-bg-hover)",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, overflow: "hidden" }}>
                      <span style={{ color: "var(--q-fg)", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                        {skill.name}
                      </span>
                      <span style={{ color: "var(--q-fg-secondary)", fontSize: 9, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {skill.filePath}
                      </span>
                    </div>
                    <ToggleSwitch
                      checked={!!form.skills[skill.name]}
                      onChange={(v) => {
                        update("skills", { ...form.skills, [skill.name]: v });
                      }}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* footer - 64px */}
        <div
          className="flex items-center px-8 shrink-0"
          style={{
            height: 64,
            borderTop: "1px solid var(--q-border)",
            justifyContent: "space-between",
          }}
        >
          {/* left side: delete button (edit mode only) */}
          <div>
            {isEdit && onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                style={{
                  height: 36,
                  padding: "0 16px",
                  backgroundColor: "transparent",
                  border: "1px solid var(--q-error)",
                  color: "var(--q-error)",
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: saving ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: saving ? 0.4 : 1,
                }}
              >
                <IconTrash size={12} color="var(--q-error)" />
                delete
              </button>
            )}
          </div>

          {/* right side: cancel + save */}
          <div className="flex items-center" style={{ gap: 12 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                height: 36,
                padding: "0 16px",
                color: "var(--q-fg-secondary)",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={!form.name.trim() || saving}
              style={{
                height: 36,
                padding: "0 20px",
                backgroundColor: "var(--q-accent)",
                color: "var(--q-bg)",
                fontWeight: 500,
                border: "none",
                cursor: !form.name.trim() || saving ? "not-allowed" : "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                opacity: !form.name.trim() || saving ? 0.4 : 1,
              }}
            >
              {isEdit ? "$ save" : "$ create"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
