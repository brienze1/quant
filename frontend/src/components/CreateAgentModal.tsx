import { useState, useRef, useEffect } from "react";
import type { Agent, CreateAgentRequest, UpdateAgentRequest, SkillInfo } from "../types";
import * as api from "../api";

const MODEL_OPTIONS = ["claude-sonnet-4-20250514", "claude-opus-4-6", "claude-haiku-4-5-20251001", "cli default"];
const COLOR_SWATCHES = ["#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#3B82F6", "#EC4899"];

type TabKey = "personality" | "access" | "boundaries" | "skills";

interface Props {
  agent?: Agent;
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

function IconX({ size = 16, color = "#6B7280" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconPlus({ size = 14, color = "#EF4444" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconLock({ size = 12, color = "#6B7280" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <rect x="2" y="5" width="8" height="6" rx="1" stroke={color} strokeWidth="1.2" />
      <path d="M4 5V3.5a2 2 0 014 0V5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash({ size = 14, color = "#EF4444" }: { size?: number; color?: string }) {
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
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: checked ? "#FAFAFA" : "#6B7280",
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
  );
}

// --- Main component ---

export function CreateAgentModal({ agent, onSubmit, onDelete, onCancel }: Props) {
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
    api.listAvailableMcpServers().then((servers) => {
      setMcpServers(servers ?? []);
    }).catch(() => {});

    api.listAvailableSkills().then((skills) => {
      setAvailableSkills(skills ?? []);
    }).catch(() => {});
  }, []);

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
    backgroundColor: "#0A0A0A",
    border: "1px solid #2a2a2a",
    color: "#FAFAFA",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    padding: "0 12px",
    height: 36,
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    color: "#6B7280",
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
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-col"
        style={{
          width: 720,
          maxHeight: "90vh",
          backgroundColor: "#0A0A0A",
          border: "1px solid #2a2a2a",
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
                backgroundColor: "#10B981",
              }}
            />
            <h2 style={{ color: "#FAFAFA", fontSize: 14, fontWeight: 700, margin: 0 }}>
              <span style={{ color: "#10B981" }}>{">"}</span>{" "}
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
            onMouseEnter={(e) => (e.currentTarget.querySelector("svg path") as SVGPathElement | null)?.setAttribute("stroke", "#FAFAFA")}
            onMouseLeave={(e) => (e.currentTarget.querySelector("svg path") as SVGPathElement | null)?.setAttribute("stroke", "#6B7280")}
          >
            <IconX size={16} color="#6B7280" />
          </button>
        </div>

        {/* tab bar - 36px */}
        <div
          className="flex px-8 shrink-0"
          style={{ height: 36, borderBottom: "1px solid #2a2a2a" }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "0 16px",
                fontSize: 11,
                color: activeTab === tab.key ? "#10B981" : "#6B7280",
                fontWeight: activeTab === tab.key ? 500 : 400,
                fontFamily: "'JetBrains Mono', monospace",
                background: "none",
                border: "none",
                borderBottom: activeTab === tab.key ? "2px solid #10B981" : "2px solid transparent",
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
                    backgroundColor: form.color || "#10B981",
                    borderRadius: 4,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    fontWeight: 700,
                    color: "#0A0A0A",
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
                      onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                      onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
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
                            border: form.color === c ? "2px solid #FAFAFA" : "2px solid transparent",
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
                  <span style={{ color: "#6B7280", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
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
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                />
              </div>

              {/* Goal */}
              <div>
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <span style={{ ...labelStyle, marginBottom: 0 }}>goal</span>
                  <span style={{ color: "#6B7280", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
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
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
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
                  <span style={{ color: "#FAFAFA", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                    autonomous mode
                  </span>
                  <span style={{ color: "#6B7280", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                    allow agent to run without manual approval for each action
                  </span>
                </div>
                <ToggleSwitch
                  checked={form.autonomousMode}
                  onChange={(v) => update("autonomousMode", v)}
                />
              </div>

              {/* MCP Servers */}
              <div style={{ borderTop: "1px solid #2a2a2a", paddingTop: 12, marginTop: 4 }}>
                <span style={{ color: "#4B5563", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
                  # mcp servers
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 8 }}>
                  {mcpServers.length === 0 && (
                    <div style={{ color: "#4B5563", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", padding: "8px 0" }}>
                      // no mcp servers available
                    </div>
                  )}
                  {mcpServers.map((server) => (
                    <div
                      key={server}
                      className="flex items-center justify-between"
                      style={{
                        height: 36,
                        borderBottom: "1px solid #1F1F1F",
                      }}
                    >
                      <span style={{ color: "#FAFAFA", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
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
              <div style={{ borderTop: "1px solid #2a2a2a", paddingTop: 12, marginTop: 4 }}>
                <span style={{ color: "#4B5563", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
                  # environment variables
                </span>
                <div
                  style={{
                    border: "1px solid #2a2a2a",
                    backgroundColor: "#0A0A0A",
                    maxHeight: 160,
                    overflowY: "auto",
                    marginTop: 8,
                  }}
                >
                  {Object.entries(form.envVariables).map(([key, val]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between px-3"
                      style={{ height: 32, borderBottom: "1px solid #1F1F1F" }}
                    >
                      <div className="flex items-center" style={{ gap: 8, flex: 1, minWidth: 0 }}>
                        <span style={{ color: "#10B981", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                          {key}
                        </span>
                        <span style={{ color: "#6B7280", fontSize: 11 }}>=</span>
                        <span style={{ color: "#FAFAFA", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {envValueVisible[key] ? val : "********"}
                        </span>
                      </div>
                      <div className="flex items-center" style={{ gap: 4, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => setEnvValueVisible((prev) => ({ ...prev, [key]: !prev[key] }))}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", alignItems: "center" }}
                        >
                          <IconLock size={12} color={envValueVisible[key] ? "#10B981" : "#6B7280"} />
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
                          <IconX size={12} color="#6B7280" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {Object.keys(form.envVariables).length === 0 && (
                    <div style={{ color: "#4B5563", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", padding: "8px 12px" }}>
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
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                  />
                  <span style={{ color: "#6B7280", fontSize: 10 }}>=</span>
                  <input
                    value={newEnvValue}
                    onChange={(e) => setNewEnvValue(e.target.value)}
                    placeholder="VALUE"
                    style={{ ...inputStyle, flex: 1, width: "auto", height: 28, fontSize: 10 }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
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
                      color: "#10B981",
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
                <span style={{ color: "#4B5563", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
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
                        onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
                        onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
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
                        <IconX size={14} color="#EF4444" />
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
                    border: "1px dashed #EF4444",
                    color: "#EF4444",
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <IconPlus size={12} color="#EF4444" />
                  add rule
                </button>
              </div>
            </>
          )}

          {/* TAB: Skills */}
          {activeTab === "skills" && (
            <>
              <div className="flex items-center justify-between">
                <span style={{ color: "#FAFAFA", fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                  available skills
                </span>
                <span style={{ color: "#6B7280", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                  {enabledSkillsCount} of {totalSkillsCount} enabled
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {availableSkills.length === 0 && (
                  <div style={{ color: "#4B5563", fontSize: 10, fontFamily: "'JetBrains Mono', monospace", padding: "8px 0" }}>
                    // no skills available
                  </div>
                )}
                {availableSkills.map((skill) => (
                  <div
                    key={skill.name}
                    className="flex items-center justify-between"
                    style={{
                      height: 44,
                      borderBottom: "1px solid #1F1F1F",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, overflow: "hidden" }}>
                      <span style={{ color: "#FAFAFA", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                        {skill.name}
                      </span>
                      <span style={{ color: "#6B7280", fontSize: 9, fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
            borderTop: "1px solid #2a2a2a",
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
                  border: "1px solid #EF4444",
                  color: "#EF4444",
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  cursor: saving ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: saving ? 0.4 : 1,
                }}
              >
                <IconTrash size={12} color="#EF4444" />
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
                color: "#6B7280",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FAFAFA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6B7280")}
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={!form.name.trim() || saving}
              style={{
                height: 36,
                padding: "0 20px",
                backgroundColor: "#10B981",
                color: "#0A0A0A",
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
