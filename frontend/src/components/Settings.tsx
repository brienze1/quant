import { useCallback, useEffect, useRef, useState } from "react";
import type { Config, Repo } from "../types";
import * as api from "../api";

type SettingsTab = "general" | "git" | "sessions" | "storage" | "terminal" | "claude";

const NAV_ITEMS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "general", label: "general", icon: "settings" },
  { key: "git", label: "git & branches", icon: "git-branch" },
  { key: "sessions", label: "sessions", icon: "terminal" },
  { key: "storage", label: "storage & data", icon: "hard-drive" },
  { key: "terminal", label: "terminal", icon: "monitor" },
  { key: "claude", label: "claude cli", icon: "bot" },
];

const FONT_OPTIONS = ["JetBrains Mono", "Fira Code", "Source Code Pro", "Cascadia Code", "Menlo", "Monaco", "Consolas"];
const CURSOR_OPTIONS = ["block", "underline", "bar"];
const MODEL_OPTIONS = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

interface Props {
  repos: Repo[];
  onBack: () => void;
}

const font = "'JetBrains Mono', monospace";

export function Settings({ repos, onBack }: Props) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await api.getConfig();
      setConfig(cfg);
    } catch (err) {
      console.error("failed to load config:", err);
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  async function save(updated: Config) {
    setConfig(updated);
    setSaving(true);
    try {
      await api.saveConfig(updated);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof Config>(key: K, value: Config[K]) {
    if (!config) return;
    save({ ...config, [key]: value });
  }

  if (!config) {
    return (
      <div className="flex h-screen w-screen items-center justify-center" style={{ backgroundColor: "#0A0A0A", fontFamily: font }}>
        <span style={{ color: "#6B7280", fontSize: 12 }}>loading settings...</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen" style={{ backgroundColor: "#0A0A0A", fontFamily: font }}>
      {/* Settings Sidebar */}
      <div
        className="flex flex-col h-full"
        style={{ width: 240, borderRight: "1px solid #2a2a2a", backgroundColor: "#0A0A0A" }}
      >
        {/* Header */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 text-left transition-colors"
          style={{ height: 48, borderBottom: "1px solid #2a2a2a" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1F1F1F")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span style={{ color: "#FAFAFA", fontSize: 14, fontWeight: 700 }}>settings</span>
        </button>

        {/* Nav Items */}
        <div className="flex flex-col gap-0.5 py-3">
          {NAV_ITEMS.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className="flex items-center gap-2 px-5 text-left transition-colors"
                style={{
                  height: 32,
                  backgroundColor: active ? "#1F1F1F" : "transparent",
                  color: active ? "#FAFAFA" : "#6B7280",
                  fontSize: 12,
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.backgroundColor = "#1F1F1F";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span style={{ color: active ? "#10B981" : "#6B7280", fontSize: 14 }}>
                  {navIcon(item.icon)}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Content Header */}
        <div
          className="flex items-center px-8 shrink-0"
          style={{ height: 48, borderBottom: "1px solid #2a2a2a" }}
        >
          <span style={{ color: "#FAFAFA", fontSize: 16, fontWeight: 700 }}>
            {NAV_ITEMS.find((n) => n.key === tab)?.label}
          </span>
          {saving && (
            <span className="ml-3" style={{ color: "#10B981", fontSize: 10 }}>saving...</span>
          )}
        </div>

        {/* Error bar */}
        {error && (
          <div
            className="flex items-center justify-between px-8 py-2 text-xs shrink-0"
            style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#EF4444", borderBottom: "1px solid #2a2a2a" }}
          >
            <span>// error: {error}</span>
            <button onClick={() => setError(null)} style={{ color: "#EF4444" }}>[x]</button>
          </div>
        )}

        {/* Scroll Content */}
        <div className="flex-1 overflow-y-auto p-8" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {tab === "general" && <GeneralTab config={config} update={update} />}
          {tab === "git" && <GitTab config={config} update={update} repos={repos} />}
          {tab === "sessions" && <SessionsTab config={config} update={update} />}
          {tab === "storage" && <StorageTab config={config} update={update} onError={setError} onReload={loadConfig} />}
          {tab === "terminal" && <TerminalTab config={config} update={update} />}
          {tab === "claude" && <ClaudeTab config={config} update={update} />}
        </div>
      </div>
    </div>
  );
}

// --- Tab Components ---

function GeneralTab({ config, update }: TabProps) {
  return (
    <Section title="application" description="general application behavior and defaults">
      <SettingRow
        label="start on login"
        description="automatically launch quant when you log in"
        right={<Toggle checked={config.startOnLogin} onChange={(v) => update("startOnLogin", v)} />}
      />
      <SettingRow
        label="notifications"
        description="show system notifications when sessions complete or error"
        right={<Toggle checked={config.notifications} onChange={(v) => update("notifications", v)} />}
      />
    </Section>
  );
}

function GitTab({ config, update, repos }: TabProps & { repos: Repo[] }) {
  const [newRepo, setNewRepo] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const repoDropdownRef = useRef<HTMLDivElement>(null);

  function addOverride() {
    if (!newRepo.trim() || !newBranch.trim()) return;
    const updated = { ...config.branchOverrides, [newRepo.trim()]: newBranch.trim() };
    update("branchOverrides", updated);
    setNewRepo("");
    setNewBranch("");
  }

  function removeOverride(repo: string) {
    const updated = { ...config.branchOverrides };
    delete updated[repo];
    update("branchOverrides", updated);
  }

  return (
    <>
      <Section title="git & branches" description="configure default git behavior for new sessions">
        <SettingRow
          label="auto pull on session start"
          description="pull latest changes before starting a new session"
          right={<Toggle checked={config.autoPull} onChange={(v) => update("autoPull", v)} />}
        />
        <SettingRow
          label="default pull branch"
          description="branch to pull from when starting sessions (fallback: main)"
          right={
            <TextInput
              value={config.defaultPullBranch}
              onChange={(v) => update("defaultPullBranch", v)}
              width={200}
            />
          }
        />
      </Section>

      <Section title="branch naming" description="how worktree branches are named">
        <SettingRow
          label="branch name pattern"
          description="template for worktree branch names. use {session} as placeholder"
          right={
            <TextInput
              value={config.branchNamePattern}
              onChange={(v) => update("branchNamePattern", v)}
              width={280}
            />
          }
        />
      </Section>

      <Section title="per-repo overrides" description="override pull branch for specific repositories">
        <div style={{ border: "1px solid #2a2a2a" }}>
          {/* Table Header */}
          <div className="flex" style={{ backgroundColor: "#1F1F1F", height: 32, borderBottom: "1px solid #2a2a2a" }}>
            <div className="flex-1 flex items-center px-3" style={{ color: "#6B7280", fontSize: 10, fontWeight: 700 }}>
              repository
            </div>
            <div className="flex-1 flex items-center px-3" style={{ color: "#6B7280", fontSize: 10, fontWeight: 700 }}>
              pull branch
            </div>
            <div className="flex items-center justify-center" style={{ width: 80, color: "#6B7280", fontSize: 10 }} />
          </div>
          {/* Rows */}
          {Object.entries(config.branchOverrides).map(([repo, branch]) => (
            <div
              key={repo}
              className="flex"
              style={{ height: 36, borderBottom: "1px solid #2a2a2a" }}
            >
              <div className="flex-1 flex items-center px-3" style={{ color: "#FAFAFA", fontSize: 11 }}>
                {repo}
              </div>
              <div className="flex-1 flex items-center px-3" style={{ color: "#10B981", fontSize: 11 }}>
                {branch}
              </div>
              <div className="flex items-center justify-center" style={{ width: 80 }}>
                <button
                  onClick={() => removeOverride(repo)}
                  style={{ color: "#EF4444", fontSize: 11, fontWeight: 700 }}
                >
                  x
                </button>
              </div>
            </div>
          ))}
        </div>
        {/* Add override row */}
        <div className="flex items-center gap-2 mt-3">
          <div ref={repoDropdownRef} style={{ position: "relative", width: 200 }}>
            <button
              onClick={() => setRepoDropdownOpen((prev) => !prev)}
              style={{
                width: 200,
                height: 32,
                backgroundColor: "#0F0F0F",
                border: `1px solid ${repoDropdownOpen ? "#10B981" : "#2a2a2a"}`,
                color: newRepo ? "#FAFAFA" : "#4B5563",
                fontSize: 12,
                fontFamily: font,
                padding: "0 12px",
                textAlign: "left",
                cursor: "pointer",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M0 2l4 4 4-4' fill='none' stroke='%236B7280' stroke-width='1.5'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 12px center",
              }}
            >
              {newRepo || "select repo"}
            </button>
            {repoDropdownOpen && (
              <DropdownMenu
                anchorRef={repoDropdownRef}
                onClose={() => setRepoDropdownOpen(false)}
                items={repos
                  .filter((r) => !(r.name in config.branchOverrides))
                  .map((r) => ({
                    label: r.name,
                    onClick: () => {
                      setNewRepo(r.name);
                      setRepoDropdownOpen(false);
                    },
                  }))}
              />
            )}
          </div>
          <TextInput value={newBranch} onChange={setNewBranch} width={160} placeholder="branch" />
          <button
            onClick={addOverride}
            style={{ color: "#10B981", fontSize: 11 }}
          >
            + add override
          </button>
        </div>
      </Section>
    </>
  );
}

function SessionsTab({ config, update }: TabProps) {
  return (
    <>
      <Section title="sessions" description="default settings applied to new sessions">
        <SettingRow
          label="use worktree by default"
          description="create isolated git worktree for each new session"
          right={<Toggle checked={config.useWorktreeDefault} onChange={(v) => update("useWorktreeDefault", v)} />}
        />
        <SettingRow
          label="skip permissions by default"
          description="pass --dangerously-skip-permissions to claude cli"
          right={<Toggle checked={config.skipPermissions} onChange={(v) => update("skipPermissions", v)} />}
        />
        <SettingRow
          label="max concurrent sessions"
          description="limit the number of sessions running simultaneously"
          right={
            <NumberInput
              value={config.maxConcurrentSessions}
              onChange={(v) => update("maxConcurrentSessions", v)}
              min={1}
              max={50}
              width={80}
            />
          }
        />
      </Section>

      <Section title="lifecycle" description="control session startup and shutdown behavior">
        <SettingRow
          label="auto-resume on app start"
          description="resume previously running sessions when quant launches"
          right={<Toggle checked={config.autoResumeOnStart} onChange={(v) => update("autoResumeOnStart", v)} />}
        />
        <SettingRow
          label="auto-stop idle sessions"
          description="automatically stop sessions after a period of inactivity"
          right={<Toggle checked={config.autoStopIdle} onChange={(v) => update("autoStopIdle", v)} />}
        />
        <SettingRow
          label="idle timeout (minutes)"
          description="minutes of inactivity before a session is stopped"
          right={
            <NumberInput
              value={config.idleTimeoutMinutes}
              onChange={(v) => update("idleTimeoutMinutes", v)}
              min={1}
              max={1440}
              width={80}
              disabled={!config.autoStopIdle}
            />
          }
        />
      </Section>
    </>
  );
}

function StorageTab({ config, update, onError, onReload }: TabProps & { onError: (msg: string) => void; onReload: () => void }) {
  async function handleBrowse(key: "dataDirectory" | "worktreeDirectory" | "logDirectory") {
    try {
      const path = await api.browseConfigDirectory();
      if (path) update(key, path);
    } catch (err) {
      onError(String(err));
    }
  }

  async function handleClearLogs() {
    if (!window.confirm("delete all terminal output log files from disk?")) return;
    try {
      await api.clearSessionLogs();
    } catch (err) {
      onError(String(err));
    }
  }

  async function handleResetDb() {
    if (!window.confirm("delete all repos, tasks, sessions, and actions from database? this cannot be undone.")) return;
    try {
      await api.resetDatabase();
      onReload();
    } catch (err) {
      onError(String(err));
    }
  }

  const homeDir = config.dataDirectory.replace(/^~/, "");

  return (
    <>
      <Section title="storage & data" description="where quant stores its files and data">
        <SettingRow
          label="data directory"
          description="root directory for database, logs, and worktrees"
          right={
            <div className="flex items-center gap-2">
              <TextInput value={config.dataDirectory} onChange={(v) => update("dataDirectory", v)} width={240} />
              <BrowseButton onClick={() => handleBrowse("dataDirectory")} />
            </div>
          }
        />
        <SettingRow
          label="worktree directory"
          description="where git worktrees are created for isolated sessions"
          right={
            <div className="flex items-center gap-2">
              <TextInput value={config.worktreeDirectory} onChange={(v) => update("worktreeDirectory", v)} width={240} />
              <BrowseButton onClick={() => handleBrowse("worktreeDirectory")} />
            </div>
          }
        />
        <SettingRow
          label="session logs directory"
          description="where terminal output logs are stored"
          right={
            <div className="flex items-center gap-2">
              <TextInput value={config.logDirectory} onChange={(v) => update("logDirectory", v)} width={240} />
              <BrowseButton onClick={() => handleBrowse("logDirectory")} />
            </div>
          }
        />
      </Section>

      <Section title="database" description="sqlite database information">
        <SettingRow
          label="database path"
          description="sqlite database file location (read-only)"
          right={
            <div
              className="flex items-center px-3"
              style={{
                backgroundColor: "#0F0F0F",
                border: "1px solid #2a2a2a",
                height: 32,
                width: 280,
                opacity: 0.5,
                color: "#6B7280",
                fontSize: 12,
              }}
            >
              {homeDir ? `~${homeDir}/quant.db` : "~/.quant/quant.db"}
            </div>
          }
        />
      </Section>

      <DangerSection>
        <SettingRow
          label="clear session logs"
          description="delete all terminal output log files from disk"
          right={<DangerButton label="x clear logs" onClick={handleClearLogs} />}
        />
        <SettingRow
          label="reset database"
          description="delete all repos, tasks, sessions, and actions from database"
          right={<DangerButton label="x reset db" onClick={handleResetDb} />}
        />
      </DangerSection>
    </>
  );
}

function TerminalTab({ config, update }: TabProps) {
  return (
    <>
      <Section title="font" description="terminal text rendering settings">
        <SettingRow
          label="font family"
          description="monospace font used in the terminal emulator"
          right={
            <SelectInput
              value={config.fontFamily}
              options={FONT_OPTIONS}
              onChange={(v) => update("fontFamily", v)}
              width={280}
            />
          }
        />
        <SettingRow
          label="font size"
          description="terminal text size in pixels"
          right={
            <NumberInput
              value={config.fontSize}
              onChange={(v) => update("fontSize", v)}
              min={8}
              max={32}
              width={80}
            />
          }
        />
        <SettingRow
          label="line height"
          description="multiplier for spacing between terminal lines"
          right={
            <FloatInput
              value={config.lineHeight}
              onChange={(v) => update("lineHeight", v)}
              width={80}
            />
          }
        />
      </Section>

      <Section title="cursor" description="terminal cursor appearance">
        <SettingRow
          label="cursor style"
          description="shape of the terminal cursor"
          right={
            <SelectInput
              value={config.cursorStyle}
              options={CURSOR_OPTIONS}
              onChange={(v) => update("cursorStyle", v)}
              width={200}
            />
          }
        />
        <SettingRow
          label="cursor blink"
          description="enable blinking animation on the cursor"
          right={<Toggle checked={config.cursorBlink} onChange={(v) => update("cursorBlink", v)} />}
        />
      </Section>

      <Section title="scrollback" description="terminal history buffer">
        <SettingRow
          label="scrollback lines"
          description="number of lines kept in terminal scroll history"
          right={
            <NumberInput
              value={config.scrollbackLines}
              onChange={(v) => update("scrollbackLines", v)}
              min={100}
              max={100000}
              width={120}
            />
          }
        />
      </Section>
    </>
  );
}

function ClaudeTab({ config, update }: TabProps) {
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  function addEnv() {
    if (!newKey.trim()) return;
    const updated = { ...config.envVariables, [newKey.trim()]: newVal.trim() };
    update("envVariables", updated);
    setNewKey("");
    setNewVal("");
  }

  function removeEnv(key: string) {
    const updated = { ...config.envVariables };
    delete updated[key];
    update("envVariables", updated);
  }

  return (
    <>
      <Section title="claude cli" description="configure the claude code cli binary and arguments">
        <SettingRow
          label="cli binary path"
          description="path to the claude code cli executable"
          right={
            <TextInput
              value={config.cliBinaryPath}
              onChange={(v) => update("cliBinaryPath", v)}
              width={280}
            />
          }
        />
        <SettingRow
          label="extra cli arguments"
          description="additional flags passed to every claude session"
          right={
            <TextInput
              value={config.extraCliArgs}
              onChange={(v) => update("extraCliArgs", v)}
              width={280}
              placeholder="--verbose"
            />
          }
        />
        <SettingRow
          label="default model"
          description="model to use for new sessions (uses cli default if empty)"
          right={
            <SelectInput
              value={config.defaultModel}
              options={MODEL_OPTIONS}
              onChange={(v) => update("defaultModel", v)}
              width={280}
            />
          }
        />
      </Section>

      <Section title="environment" description="environment variables passed to claude sessions">
        <div style={{ border: "1px solid #2a2a2a" }}>
          {/* Table Header */}
          <div className="flex" style={{ backgroundColor: "#1F1F1F", height: 32, borderBottom: "1px solid #2a2a2a" }}>
            <div className="flex-1 flex items-center px-3" style={{ color: "#6B7280", fontSize: 10, fontWeight: 700 }}>
              variable
            </div>
            <div className="flex-1 flex items-center px-3" style={{ color: "#6B7280", fontSize: 10, fontWeight: 700 }}>
              value
            </div>
            <div className="flex items-center justify-center" style={{ width: 80, color: "#6B7280", fontSize: 10 }} />
          </div>
          {/* Rows */}
          {Object.entries(config.envVariables).map(([key, val]) => (
            <div key={key} className="flex" style={{ height: 36, borderBottom: "1px solid #2a2a2a" }}>
              <div className="flex-1 flex items-center px-3" style={{ color: "#FAFAFA", fontSize: 11 }}>
                {key}
              </div>
              <div className="flex-1 flex items-center px-3" style={{ color: "#10B981", fontSize: 11 }}>
                {val}
              </div>
              <div className="flex items-center justify-center" style={{ width: 80 }}>
                <button
                  onClick={() => removeEnv(key)}
                  style={{ color: "#EF4444", fontSize: 11, fontWeight: 700 }}
                >
                  x
                </button>
              </div>
            </div>
          ))}
        </div>
        {/* Add env row */}
        <div className="flex items-center gap-2 mt-3">
          <TextInput value={newKey} onChange={setNewKey} width={200} placeholder="VARIABLE_NAME" />
          <TextInput value={newVal} onChange={setNewVal} width={200} placeholder="value" />
          <button onClick={addEnv} style={{ color: "#10B981", fontSize: 11 }}>
            + add variable
          </button>
        </div>
      </Section>
    </>
  );
}

// --- Shared Types ---

interface TabProps {
  config: Config;
  update: <K extends keyof Config>(key: K, value: Config[K]) => void;
}

// --- Reusable UI Components ---

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      <span style={{ color: "#10B981", fontSize: 12, fontWeight: 700 }}>{title}</span>
      <span style={{ color: "#4B5563", fontSize: 11 }}>// {description}</span>
      <div style={{ height: 1, backgroundColor: "#2a2a2a" }} />
      {children}
    </div>
  );
}

function DangerSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      <span style={{ color: "#EF4444", fontSize: 12, fontWeight: 700 }}>danger zone</span>
      <span style={{ color: "#4B5563", fontSize: 11 }}>// destructive actions — use with caution</span>
      <div style={{ height: 1, backgroundColor: "rgba(239,68,68,0.2)" }} />
      {children}
    </div>
  );
}

function SettingRow({ label, description, right }: { label: string; description: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span style={{ color: "#FAFAFA", fontSize: 12 }}>{label}</span>
        <span style={{ color: "#4B5563", fontSize: 10 }}>{description}</span>
      </div>
      {right}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2"
    >
      {checked ? (
        <div
          className="flex items-center justify-center"
          style={{
            width: 14,
            height: 14,
            borderRadius: 2,
            backgroundColor: "#10B981",
          }}
        >
          <span style={{ color: "#0A0A0A", fontSize: 9, fontWeight: 700 }}>x</span>
        </div>
      ) : (
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 2,
            border: "1px solid #6B7280",
          }}
        />
      )}
      <span style={{ color: checked ? "#10B981" : "#6B7280", fontSize: 11 }}>
        {checked ? "enabled" : "disabled"}
      </span>
    </button>
  );
}

function TextInput({
  value,
  onChange,
  width,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  width: number;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local); }}
      onKeyDown={(e) => { if (e.key === "Enter") onChange(local); }}
      placeholder={placeholder}
      className="px-3 focus:outline-none"
      style={{
        width,
        height: 32,
        backgroundColor: "#0F0F0F",
        border: "1px solid #2a2a2a",
        color: "#FAFAFA",
        fontSize: 12,
        fontFamily: font,
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
      onBlurCapture={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
    />
  );
}

function NumberInput({
  value,
  onChange,
  width,
  min,
  max,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  width: number;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);

  function commit() {
    const n = parseInt(local, 10);
    if (isNaN(n)) {
      setLocal(String(value));
      return;
    }
    const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
    onChange(clamped);
    setLocal(String(clamped));
  }

  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      disabled={disabled}
      className="px-3 focus:outline-none"
      style={{
        width,
        height: 32,
        backgroundColor: "#0F0F0F",
        border: "1px solid #2a2a2a",
        color: disabled ? "#4B5563" : "#FAFAFA",
        fontSize: 12,
        fontFamily: font,
        opacity: disabled ? 0.5 : 1,
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
      onBlurCapture={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
    />
  );
}

function FloatInput({
  value,
  onChange,
  width,
}: {
  value: number;
  onChange: (v: number) => void;
  width: number;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);

  function commit() {
    const n = parseFloat(local);
    if (isNaN(n)) {
      setLocal(String(value));
      return;
    }
    const clamped = Math.max(0.5, Math.min(3.0, n));
    onChange(clamped);
    setLocal(String(clamped));
  }

  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
      className="px-3 focus:outline-none"
      style={{
        width,
        height: 32,
        backgroundColor: "#0F0F0F",
        border: "1px solid #2a2a2a",
        color: "#FAFAFA",
        fontSize: 12,
        fontFamily: font,
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "#10B981")}
      onBlurCapture={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
    />
  );
}

function SelectInput({
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
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width,
        height: 32,
        backgroundColor: "#0F0F0F",
        border: "1px solid #2a2a2a",
        color: "#FAFAFA",
        fontSize: 12,
        fontFamily: font,
        padding: "0 12px",
        appearance: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M0 2l4 4 4-4' fill='none' stroke='%236B7280' stroke-width='1.5'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
      }}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

function BrowseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center shrink-0 transition-colors"
      style={{
        width: 72,
        height: 32,
        backgroundColor: "#0A0A0A",
        border: "1px solid #2a2a2a",
        color: "#6B7280",
        fontSize: 11,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#10B981";
        e.currentTarget.style.color = "#10B981";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#2a2a2a";
        e.currentTarget.style.color = "#6B7280";
      }}
    >
      browse
    </button>
  );
}

function DropdownMenu({
  anchorRef,
  onClose,
  items,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  items: { label: string; onClick: () => void }[];
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose, anchorRef]);

  return (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        top: 36,
        left: 0,
        zIndex: 50,
        backgroundColor: "#0A0A0A",
        border: "1px solid #2a2a2a",
        minWidth: 180,
        width: "100%",
      }}
    >
      {items.length === 0 && (
        <div
          className="px-3 py-2"
          style={{ color: "#4B5563", fontSize: 11, fontFamily: font }}
        >
          no repos available
        </div>
      )}
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.onClick}
          className="w-full flex items-center text-left transition-colors"
          style={{
            height: 28,
            padding: "0 12px",
            gap: 8,
            fontFamily: font,
            fontSize: 11,
            color: "#D1D5DB",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1F1F1F")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <span style={{ color: "#10B981", flexShrink: 0 }}>~</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function DangerButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center px-4"
      style={{
        height: 32,
        borderRadius: 2,
        backgroundColor: "#EF4444",
        color: "#FAFAFA",
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}

// SVG nav icons
function navIcon(name: string): React.ReactNode {
  const props = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case "git-branch":
      return (
        <svg {...props}>
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...props}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    case "hard-drive":
      return (
        <svg {...props}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      );
    case "monitor":
      return (
        <svg {...props}>
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      );
    case "bot":
      return (
        <svg {...props}>
          <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
          <circle cx="9" cy="13" r="1.5" fill="currentColor" />
          <circle cx="15" cy="13" r="1.5" fill="currentColor" />
        </svg>
      );
    default:
      return "*";
  }
}
