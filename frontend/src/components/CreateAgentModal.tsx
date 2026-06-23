import { useState, useEffect } from "react";
import type { Agent, CreateAgentRequest, UpdateAgentRequest, SkillInfo } from "../types";
import * as api from "../api";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
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

const sectionLabel: React.CSSProperties = { color: "var(--fg-4)", fontSize: 10, fontFamily: "var(--mono)" };

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

  async function handleSubmit() {
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

  const enabledSkillsCount = Object.values(form.skills).filter(Boolean).length;
  const totalSkillsCount = availableSkills.length;
  const canSave = !!form.name.trim() && !saving;

  return (
    <ModalShell width={640} onClose={onCancel}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 26px 0" }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: form.color || "var(--accent)" }} />
        <h2 className="mono" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--fg)" }}>
          <span style={{ color: "var(--accent)" }}>&gt;</span> {isEdit ? `edit_agent: ${agent!.name}` : "new_agent"}
        </h2>
      </div>

      {/* tabs */}
      <div style={{ display: "flex", gap: 4, padding: "14px 22px 0", borderBottom: "1px solid var(--border-2)" }}>
        {tabs.map((tb) => {
          const on = activeTab === tb.key;
          return (
            <button
              key={tb.key}
              type="button"
              onClick={() => setActiveTab(tb.key)}
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
              {tb.label}
            </button>
          );
        })}
      </div>

      {/* body */}
      <div className="scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 26px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
        {activeTab === "personality" && (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  flex: "none",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: form.color || "var(--accent)",
                  color: "#0a0c0b",
                  fontFamily: "var(--mono)",
                  fontSize: 26,
                  fontWeight: 700,
                }}
              >
                {form.name ? form.name[0].toUpperCase() : "?"}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                <Field label="name">
                  <ModalInput
                    autoFocus
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    placeholder="agent-name"
                  />
                </Field>
                <Field label="color">
                  <div style={{ display: "flex", gap: 6 }}>
                    {COLOR_SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => update("color", c)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 5,
                          background: c,
                          cursor: "pointer",
                          padding: 0,
                          border: form.color === c ? "2px solid var(--fg)" : "2px solid transparent",
                        }}
                      />
                    ))}
                  </div>
                </Field>
              </div>
            </div>
            <Field label={`role · ${form.role.length}/500`}>
              <ModalTextarea
                value={form.role}
                onChange={(e) => update("role", e.target.value)}
                maxLength={500}
                placeholder="describe the agent's role…"
                style={{ height: 72 }}
              />
            </Field>
            <Field label={`goal · ${form.goal.length}/500`}>
              <ModalTextarea
                value={form.goal}
                onChange={(e) => update("goal", e.target.value)}
                maxLength={500}
                placeholder="what should this agent accomplish?"
                style={{ height: 72 }}
              />
            </Field>
            <Field label="model">
              <ModalSelect
                value={form.model || "cli default"}
                onChange={(v) => update("model", v)}
                options={MODEL_OPTIONS.map((m) => ({ value: m, label: m }))}
                width={300}
              />
            </Field>
          </>
        )}

        {activeTab === "access" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>autonomous mode</span>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                  allow agent to run without manual approval for each action
                </span>
              </div>
              <Toggle checked={form.autonomousMode} onChange={(v) => update("autonomousMode", v)} />
            </div>

            <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 14 }}>
              <span style={sectionLabel}># mcp servers</span>
              <div style={{ marginTop: 8 }}>
                {mcpServers.length === 0 && (
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", padding: "8px 0" }}>// no mcp servers available</div>
                )}
                {mcpServers.map((server) => (
                  <div
                    key={server}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 38, borderBottom: "1px solid var(--border-2)" }}
                  >
                    <span className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>{server}</span>
                    <Toggle
                      checked={!!form.mcpServers[server]}
                      onChange={(v) => update("mcpServers", { ...form.mcpServers, [server]: v })}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 14 }}>
              <span style={sectionLabel}># environment variables</span>
              <div className="scroll" style={{ border: "1px solid var(--border-2)", borderRadius: 8, marginTop: 8, maxHeight: 160, overflowY: "auto" }}>
                {Object.keys(form.envVariables).length === 0 && (
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", padding: "8px 12px" }}>// no variables</div>
                )}
                {Object.entries(form.envVariables).map(([key, val]) => (
                  <div
                    key={key}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: 32, padding: "0 12px", borderBottom: "1px solid var(--border-2)" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--accent)", flex: "none" }}>{key}</span>
                      <span style={{ color: "var(--fg-3)", fontSize: 11 }}>=</span>
                      <span className="mono" style={{ fontSize: 11, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {envValueVisible[key] ? val : "••••••••"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 2, flex: "none" }}>
                      <IconButton
                        name={envValueVisible[key] ? "eye" : "lock"}
                        size={12}
                        label="Reveal"
                        onClick={() => setEnvValueVisible((prev) => ({ ...prev, [key]: !prev[key] }))}
                      />
                      <IconButton
                        name="x"
                        size={12}
                        label="Remove"
                        onClick={() => {
                          const next = { ...form.envVariables };
                          delete next[key];
                          update("envVariables", next);
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                <ModalInput
                  value={newEnvKey}
                  onChange={(e) => setNewEnvKey(e.target.value)}
                  placeholder="KEY"
                  style={{ width: 130, height: 30, fontSize: 11 }}
                />
                <span style={{ color: "var(--fg-3)", fontSize: 11 }}>=</span>
                <ModalInput
                  value={newEnvValue}
                  onChange={(e) => setNewEnvValue(e.target.value)}
                  placeholder="VALUE"
                  style={{ flex: 1, height: 30, fontSize: 11 }}
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
                  style={{ flex: "none", fontFamily: "var(--mono)", fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: "4px 8px" }}
                >
                  + add
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === "boundaries" && (
          <div>
            <span style={sectionLabel}># anti-prompt rules</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {form.boundaries.length === 0 && (
                <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>// no rules</div>
              )}
              {form.boundaries.map((rule, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ModalInput
                    value={rule}
                    onChange={(e) => {
                      const next = [...form.boundaries];
                      next[i] = e.target.value;
                      update("boundaries", next);
                    }}
                    placeholder="do not…"
                    style={{ flex: 1 }}
                  />
                  <IconButton
                    name="x"
                    size={14}
                    label="Remove"
                    onClick={() => update("boundaries", form.boundaries.filter((_, j) => j !== i))}
                  />
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
                background: "transparent",
                border: "1px dashed var(--danger)",
                borderRadius: 8,
                color: "var(--danger)",
                fontFamily: "var(--mono)",
                fontSize: 11,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Icon name="plus" size={12} /> add rule
            </button>
          </div>
        )}

        {activeTab === "skills" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)" }}>available skills</span>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                {enabledSkillsCount} of {totalSkillsCount} enabled
              </span>
            </div>
            <div>
              {availableSkills.length === 0 && (
                <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", padding: "8px 0" }}>// no skills available</div>
              )}
              {availableSkills.map((skill) => (
                <div
                  key={skill.name}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 44, borderBottom: "1px solid var(--border-2)" }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, overflow: "hidden" }}>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fg)" }}>{skill.name}</span>
                    <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {skill.filePath}
                    </span>
                  </div>
                  <Toggle
                    checked={!!form.skills[skill.name]}
                    onChange={(v) => update("skills", { ...form.skills, [skill.name]: v })}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px 22px" }}>
        <div>
          {isEdit && onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              style={{
                height: 38,
                padding: "0 14px",
                borderRadius: 9,
                background: "transparent",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.4 : 1,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name="trash" size={12} /> delete
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ModalCancel onClick={onCancel} />
          <ModalSubmit disabled={!canSave} onClick={handleSubmit}>
            {isEdit ? "$ save" : "$ create"}
          </ModalSubmit>
        </div>
      </div>
    </ModalShell>
  );
}
