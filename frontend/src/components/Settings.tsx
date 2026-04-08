import { useCallback, useEffect, useRef, useState } from "react";
import type { Config, Repo, Shortcut } from "../types";
import * as api from "../api";
import { ThemeSettings } from "./ThemeSettings";

type SettingsTab = "general" | "git" | "sessions" | "storage" | "terminal" | "claude" | "quanti" | "themes";

const NAV_ITEMS: { key: SettingsTab; label: string; icon: string }[] = [
  { key: "general", label: "general", icon: "settings" },
  { key: "themes", label: "themes", icon: "palette" },
  { key: "git", label: "git & branches", icon: "git-branch" },
  { key: "sessions", label: "sessions", icon: "terminal" },
  { key: "storage", label: "storage & data", icon: "hard-drive" },
  { key: "terminal", label: "terminal", icon: "monitor" },
  { key: "claude", label: "claude cli", icon: "bot" },
  { key: "quanti", label: "quanti", icon: "message-square" },
];

const FONT_OPTIONS = ["JetBrains Mono", "Fira Code", "Source Code Pro", "Cascadia Code", "Menlo", "Monaco", "Consolas"];
const CURSOR_OPTIONS = ["block", "underline", "bar"];
const MODEL_OPTIONS = ["cli default", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

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
      <div className="flex h-screen w-screen items-center justify-center" style={{ backgroundColor: "var(--q-bg)", fontFamily: font }}>
        <span style={{ color: "var(--q-fg-secondary)", fontSize: 12 }}>loading settings...</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen" style={{ backgroundColor: "var(--q-bg)", fontFamily: font }}>
      {/* Settings Sidebar */}
      <div
        className="flex flex-col h-full"
        style={{ width: 240, borderRight: "1px solid var(--q-border)", backgroundColor: "var(--q-bg)" }}
      >
        {/* Header */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 text-left transition-colors"
          style={{ height: 48, borderBottom: "1px solid var(--q-border)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--q-bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--q-fg-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span style={{ color: "var(--q-fg)", fontSize: 14, fontWeight: 700 }}>settings</span>
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
                  backgroundColor: active ? "var(--q-bg-hover)" : "transparent",
                  color: active ? "var(--q-fg)" : "var(--q-fg-secondary)",
                  fontSize: 12,
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.backgroundColor = "var(--q-bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span style={{ color: active ? "var(--q-accent)" : "var(--q-fg-secondary)", fontSize: 14 }}>
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
          style={{ height: 48, borderBottom: "1px solid var(--q-border)" }}
        >
          <span style={{ color: "var(--q-fg)", fontSize: 16, fontWeight: 700 }}>
            {NAV_ITEMS.find((n) => n.key === tab)?.label}
          </span>
          {saving && (
            <span className="ml-3" style={{ color: "var(--q-accent)", fontSize: 10 }}>saving...</span>
          )}
        </div>

        {/* Error bar */}
        {error && (
          <div
            className="flex items-center justify-between px-8 py-2 text-xs shrink-0"
            style={{ backgroundColor: "var(--q-error-bg)", color: "var(--q-error)", borderBottom: "1px solid var(--q-border)" }}
          >
            <span>// error: {error}</span>
            <button onClick={() => setError(null)} style={{ color: "var(--q-error)" }}>[x]</button>
          </div>
        )}

        {/* Scroll Content */}
        <div className="flex-1 overflow-y-auto p-8" style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {tab === "general" && <GeneralTab config={config} update={update} />}
          {tab === "themes" && <ThemeSettings />}
          {tab === "git" && <GitTab config={config} update={update} repos={repos} />}
          {tab === "sessions" && <SessionsTab config={config} update={update} />}
          {tab === "storage" && <StorageTab config={config} update={update} onError={setError} onReload={loadConfig} />}
          {tab === "terminal" && <TerminalTab config={config} update={update} />}
          {tab === "claude" && <ClaudeTab config={config} update={update} />}
          {tab === "quanti" && <QuantiTab config={config} update={update} />}
        </div>
      </div>
    </div>
  );
}

// --- Tab Components ---

function GeneralTab({ config, update }: TabProps) {
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");

  const shortcuts: Shortcut[] = config.shortcuts ?? [];

  function addShortcut() {
    if (!newName.trim() || !newCommand.trim()) return;
    update("shortcuts", [...shortcuts, { name: newName.trim(), command: newCommand.trim() }]);
    setNewName("");
    setNewCommand("");
  }

  function removeShortcut(index: number) {
    update("shortcuts", shortcuts.filter((_, i) => i !== index));
  }

  return (
    <>
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
        <SettingRow
          label="auto update"
          description="check for updates and upgrade quant automatically on startup"
          right={<Toggle checked={config.autoUpdate} onChange={(v) => update("autoUpdate", v)} />}
        />
      </Section>

      <Section title="left click shortcuts" description="commands executed when left-clicking a session (runs in session folder)">
        {shortcuts.map((sc, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex flex-col" style={{ gap: 2 }}>
              <span style={{ color: "var(--q-fg)", fontSize: 12 }}>{sc.name}</span>
              <span style={{ color: "var(--q-accent)", fontSize: 10 }}>{sc.command}</span>
            </div>
            <button
              onClick={() => removeShortcut(i)}
              style={{ color: "var(--q-error)", fontSize: 11, fontFamily: font }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              x
            </button>
          </div>
        ))}
        <div className="flex gap-2" style={{ marginTop: shortcuts.length > 0 ? 4 : 0 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="name"
            onKeyDown={(e) => e.key === "Enter" && addShortcut()}
            style={{
              flex: 1,
              backgroundColor: "var(--q-bg-hover)",
              border: "1px solid var(--q-border)",
              color: "var(--q-fg)",
              fontSize: 11,
              fontFamily: font,
              padding: "4px 8px",
              outline: "none",
            }}
          />
          <input
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            placeholder="command"
            onKeyDown={(e) => e.key === "Enter" && addShortcut()}
            style={{
              flex: 2,
              backgroundColor: "var(--q-bg-hover)",
              border: "1px solid var(--q-border)",
              color: "var(--q-accent)",
              fontSize: 11,
              fontFamily: font,
              padding: "4px 8px",
              outline: "none",
            }}
          />
          <button
            onClick={addShortcut}
            style={{
              color: "var(--q-fg-muted)",
              fontSize: 11,
              fontFamily: font,
              border: "1px dashed var(--q-border)",
              padding: "4px 10px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-muted)")}
          >
            + add
          </button>
        </div>
      </Section>
    </>
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

      <Section title="commit message" description="prefix applied to all commit messages from the right-click git commit action">
        <SettingRow
          label="commit message prefix"
          description="prefix template. use {session} as a placeholder for the session name"
          right={
            <TextInput
              value={config.commitMessagePrefix}
              onChange={(v) => update("commitMessagePrefix", v)}
              width={280}
              placeholder="e.g. feature/{session} - "
            />
          }
        />
      </Section>

      <Section title="per-repo overrides" description="override pull branch for specific repositories">
        <div style={{ border: "1px solid var(--q-border)" }}>
          {/* Table Header */}
          <div className="flex" style={{ backgroundColor: "var(--q-bg-hover)", height: 32, borderBottom: "1px solid var(--q-border)" }}>
            <div className="flex-1 flex items-center px-3" style={{ color: "var(--q-fg-secondary)", fontSize: 10, fontWeight: 700 }}>
              repository
            </div>
            <div className="flex-1 flex items-center px-3" style={{ color: "var(--q-fg-secondary)", fontSize: 10, fontWeight: 700 }}>
              pull branch
            </div>
            <div className="flex items-center justify-center" style={{ width: 80, color: "var(--q-fg-secondary)", fontSize: 10 }} />
          </div>
          {/* Rows */}
          {Object.entries(config.branchOverrides).map(([repo, branch]) => (
            <div
              key={repo}
              className="flex"
              style={{ height: 36, borderBottom: "1px solid var(--q-border)" }}
            >
              <div className="flex-1 flex items-center px-3" style={{ color: "var(--q-fg)", fontSize: 11 }}>
                {repo}
              </div>
              <div className="flex-1 flex items-center px-3" style={{ color: "var(--q-accent)", fontSize: 11 }}>
                {branch}
              </div>
              <div className="flex items-center justify-center" style={{ width: 80 }}>
                <button
                  onClick={() => removeOverride(repo)}
                  style={{ color: "var(--q-error)", fontSize: 11, fontWeight: 700 }}
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
                backgroundColor: "var(--q-bg-input)",
                border: `1px solid ${repoDropdownOpen ? "var(--q-accent)" : "var(--q-border)"}`,
                color: newRepo ? "var(--q-fg)" : "var(--q-fg-muted)",
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
            style={{ color: "var(--q-accent)", fontSize: 11 }}
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
      </Section>

    </>
  );
}

function StorageTab({ config, update, onError, onReload }: TabProps & { onError: (msg: string) => void; onReload: () => void }) {
  const [showRestartModal, setShowRestartModal] = useState(false);
  const initialPathsRef = useRef({
    dataDirectory: config.dataDirectory,
    worktreeDirectory: config.worktreeDirectory,
    logDirectory: config.logDirectory,
  });

  function updateWithRestartCheck<K extends "dataDirectory" | "worktreeDirectory" | "logDirectory">(key: K, value: string) {
    update(key, value);
    if (value !== initialPathsRef.current[key]) {
      setShowRestartModal(true);
    }
  }

  async function handleBrowse(key: "dataDirectory" | "worktreeDirectory" | "logDirectory") {
    try {
      const path = await api.browseConfigDirectory();
      if (path) updateWithRestartCheck(key, path);
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
              <TextInput value={config.dataDirectory} onChange={(v) => updateWithRestartCheck("dataDirectory", v)} width={240} />
              <BrowseButton onClick={() => handleBrowse("dataDirectory")} />
            </div>
          }
        />
        <SettingRow
          label="worktree directory"
          description="where git worktrees are created for isolated sessions"
          right={
            <div className="flex items-center gap-2">
              <TextInput value={config.worktreeDirectory} onChange={(v) => updateWithRestartCheck("worktreeDirectory", v)} width={240} />
              <BrowseButton onClick={() => handleBrowse("worktreeDirectory")} />
            </div>
          }
        />
        <SettingRow
          label="session logs directory"
          description="where terminal output logs are stored"
          right={
            <div className="flex items-center gap-2">
              <TextInput value={config.logDirectory} onChange={(v) => updateWithRestartCheck("logDirectory", v)} width={240} />
              <BrowseButton onClick={() => handleBrowse("logDirectory")} />
            </div>
          }
        />
        <SettingRow
          label="database path"
          description="sqlite database file location (read-only)"
          right={
            <div
              className="flex items-center px-3"
              style={{
                backgroundColor: "var(--q-bg-input)",
                border: "1px solid var(--q-border)",
                height: 32,
                width: 280,
                opacity: 0.5,
                color: "var(--q-fg-secondary)",
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

      {showRestartModal && (
        <RestartModal onClose={() => setShowRestartModal(false)} />
      )}
    </>
  );
}

function RestartModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--q-modal-backdrop)" }}>
      <div
        className="flex flex-col gap-6 p-8"
        style={{
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
          maxWidth: 400,
        }}
      >
        <div className="flex flex-col gap-2">
          <span style={{ color: "var(--q-warning)", fontSize: 12, fontWeight: 700 }}>~ restart required</span>
          <span style={{ color: "var(--q-fg-secondary)", fontSize: 11 }}>
            storage paths have changed. please restart quant for the changes to take effect.
          </span>
        </div>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs transition-colors"
            style={{
              backgroundColor: "var(--q-warning)",
              color: "var(--q-bg)",
              fontWeight: 500,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            ok, got it
          </button>
        </div>
      </div>
    </div>
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
  const [newPath, setNewPath] = useState("");
  const [newCommand, setNewCommand] = useState("");

  const commandOverrides = config.commandOverrides ?? {};

  function addCommandOverride() {
    if (!newPath.trim() || !newCommand.trim()) return;
    const updated = { ...commandOverrides, [newPath.trim()]: newCommand.trim() };
    update("commandOverrides", updated);
    setNewPath("");
    setNewCommand("");
  }

  function removeCommandOverride(path: string) {
    const updated = { ...commandOverrides };
    delete updated[path];
    update("commandOverrides", updated);
  }

  return (
    <>
      <Section title="claude cli" description="configure the claude code cli binary and arguments">
        <SettingRow
          label="claude command"
          description="command used to launch the claude code cli"
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

      <Section title="per-path command overrides" description="use a different claude command for sessions whose path contains the given substring">
        <div style={{ border: "1px solid var(--q-border)" }}>
          {/* Table Header */}
          <div className="flex" style={{ backgroundColor: "var(--q-bg-hover)", height: 32, borderBottom: "1px solid var(--q-border)" }}>
            <div className="flex-1 flex items-center px-3" style={{ color: "var(--q-fg-secondary)", fontSize: 10, fontWeight: 700 }}>
              path contains
            </div>
            <div className="flex-1 flex items-center px-3" style={{ color: "var(--q-fg-secondary)", fontSize: 10, fontWeight: 700 }}>
              command
            </div>
            <div className="flex items-center justify-center" style={{ width: 80, color: "var(--q-fg-secondary)", fontSize: 10 }} />
          </div>
          {/* Rows */}
          {Object.entries(commandOverrides).map(([path, cmd]) => (
            <div
              key={path}
              className="flex"
              style={{ height: 36, borderBottom: "1px solid var(--q-border)" }}
            >
              <div className="flex-1 flex items-center px-3" style={{ color: "var(--q-fg)", fontSize: 11 }}>
                {path}
              </div>
              <div className="flex-1 flex items-center px-3" style={{ color: "var(--q-accent)", fontSize: 11 }}>
                {cmd}
              </div>
              <div className="flex items-center justify-center" style={{ width: 80 }}>
                <button
                  onClick={() => removeCommandOverride(path)}
                  style={{ color: "var(--q-error)", fontSize: 11, fontWeight: 700 }}
                >
                  x
                </button>
              </div>
            </div>
          ))}
        </div>
        {/* Add override row */}
        <div className="flex items-center gap-2 mt-3">
          <TextInput value={newPath} onChange={setNewPath} width={200} placeholder="e.g. /work/projects/" />
          <TextInput value={newCommand} onChange={setNewCommand} width={160} placeholder="e.g. claude-bl" />
          <button
            onClick={addCommandOverride}
            style={{ color: "var(--q-accent)", fontSize: 11 }}
          >
            + add override
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
      <span style={{ color: "var(--q-accent)", fontSize: 12, fontWeight: 700 }}>{title}</span>
      <span style={{ color: "var(--q-fg-muted)", fontSize: 11 }}>// {description}</span>
      <div style={{ height: 1, backgroundColor: "var(--q-border)" }} />
      {children}
    </div>
  );
}

function DangerSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      <span style={{ color: "var(--q-error)", fontSize: 12, fontWeight: 700 }}>danger zone</span>
      <span style={{ color: "var(--q-fg-muted)", fontSize: 11 }}>// destructive actions — use with caution</span>
      <div style={{ height: 1, backgroundColor: "var(--q-error-bg)" }} />
      {children}
    </div>
  );
}

function SettingRow({ label, description, right }: { label: string; description: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span style={{ color: "var(--q-fg)", fontSize: 12 }}>{label}</span>
        <span style={{ color: "var(--q-fg-muted)", fontSize: 10 }}>{description}</span>
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
            backgroundColor: "var(--q-accent)",
          }}
        >
          <span style={{ color: "var(--q-bg)", fontSize: 9, fontWeight: 700 }}>x</span>
        </div>
      ) : (
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 2,
            border: "1px solid var(--q-fg-secondary)",
          }}
        />
      )}
      <span style={{ color: checked ? "var(--q-accent)" : "var(--q-fg-secondary)", fontSize: 11 }}>
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
        backgroundColor: "var(--q-bg-input)",
        border: "1px solid var(--q-border)",
        color: "var(--q-fg)",
        fontSize: 12,
        fontFamily: font,
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
      onBlurCapture={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
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
        backgroundColor: "var(--q-bg-input)",
        border: "1px solid var(--q-border)",
        color: disabled ? "var(--q-fg-muted)" : "var(--q-fg)",
        fontSize: 12,
        fontFamily: font,
        opacity: disabled ? 0.5 : 1,
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
      onBlurCapture={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
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
        backgroundColor: "var(--q-bg-input)",
        border: "1px solid var(--q-border)",
        color: "var(--q-fg)",
        fontSize: 12,
        fontFamily: font,
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--q-accent)")}
      onBlurCapture={(e) => (e.currentTarget.style.borderColor = "var(--q-border)")}
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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", width }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width,
          height: 32,
          backgroundColor: "var(--q-bg-input)",
          border: `1px solid ${open ? "var(--q-accent)" : "var(--q-border)"}`,
          color: "var(--q-fg)",
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
        {value}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: 36,
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
              onClick={() => { onChange(opt); setOpen(false); }}
              className="w-full flex items-center text-left transition-colors"
              style={{
                height: 28,
                padding: "0 12px",
                gap: 8,
                fontFamily: font,
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

function BrowseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center shrink-0 transition-colors"
      style={{
        width: 72,
        height: 32,
        backgroundColor: "var(--q-bg)",
        border: "1px solid var(--q-border)",
        color: "var(--q-fg-secondary)",
        fontSize: 11,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--q-accent)";
        e.currentTarget.style.color = "var(--q-accent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--q-border)";
        e.currentTarget.style.color = "var(--q-fg-secondary)";
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
        backgroundColor: "var(--q-bg)",
        border: "1px solid var(--q-border)",
        minWidth: 180,
        width: "100%",
      }}
    >
      {items.length === 0 && (
        <div
          className="px-3 py-2"
          style={{ color: "var(--q-fg-muted)", fontSize: 11, fontFamily: font }}
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
            color: "var(--q-fg-dimmed)",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--q-bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <span style={{ color: "var(--q-accent)", flexShrink: 0 }}>~</span>
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
        backgroundColor: "var(--q-error)",
        color: "var(--q-fg)",
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
    case "palette":
      return (
        <svg {...props}>
          <circle cx="13.5" cy="6.5" r="2.5" />
          <circle cx="17.5" cy="10.5" r="2.5" />
          <circle cx="8.5" cy="7.5" r="2.5" />
          <circle cx="6.5" cy="12.5" r="2.5" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.04-.24-.3-.39-.65-.39-1.04 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.17-4.49-8.92-10-8.92z" />
        </svg>
      );
    case "message-square":
      return (
        <svg {...props}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    default:
      return "*";
  }
}

// --- Quanti Tab ---

const QUANTI_FILES = [
  { name: "CLAUDE.md", label: "soul / personality", description: "Quanti's identity, personality, memory protocol and role definition" },
  { name: "short_term.md", label: "short-term memory", description: "Current session notes — cleared and consolidated on each startup" },
  { name: "medium_term.md", label: "medium-term memory", description: "Multi-session patterns and user preferences" },
  { name: "long_term.md", label: "long-term memory", description: "Core stable knowledge about you and your setup" },
];

function QuantiTab({ config, update }: TabProps) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function openFile(name: string) {
    setActiveFile(name);
    setLoading(true);
    setFileContent("");
    setSaved(false);
    try {
      const content = await api.getQuantiFile(name);
      setFileContent(content ?? "");
    } catch (err) {
      console.error("failed to read file:", err);
    } finally {
      setLoading(false);
    }
  }

  async function saveFile() {
    if (!activeFile) return;
    setSaving(true);
    try {
      await api.saveQuantiFile(activeFile, fileContent);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("failed to save file:", err);
    } finally {
      setSaving(false);
    }
  }

  const activeFileMeta = QUANTI_FILES.find(f => f.name === activeFile);

  return (
    <>
      <Section title="model" description="model used for the Quanti chat panel">
        <SettingRow
          label="model"
          description="faster models respond quicker; smarter models handle complex pipelines better"
          right={
            <SelectInput
              value={config.assistantModel || "claude-sonnet-4-6"}
              options={MODEL_OPTIONS}
              onChange={(v) => update("assistantModel", v)}
              width={280}
            />
          }
        />
      </Section>

      <Section title="files" description="view and edit Quanti's personality and memory — changes take effect on the next Quanti session">
        <div style={{ display: "flex", gap: 0, border: "1px solid var(--q-border)" }}>
          {/* File list sidebar */}
          <div style={{ width: 200, borderRight: "1px solid var(--q-border)", flexShrink: 0 }}>
            {QUANTI_FILES.map((f) => (
              <button
                key={f.name}
                onClick={() => openFile(f.name)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px 14px",
                  textAlign: "left",
                  background: activeFile === f.name ? "var(--q-bg-surface)" : "none",
                  border: "none",
                  borderBottom: "1px solid var(--q-bg-hover)",
                  cursor: "pointer",
                  fontFamily: font,
                }}
              >
                <div style={{ fontSize: 11, color: activeFile === f.name ? "var(--q-fg)" : "var(--q-fg-tertiary)", fontWeight: activeFile === f.name ? 600 : 400 }}>
                  {f.label}
                </div>
                <div style={{ fontSize: 9, color: "var(--q-fg-muted)", marginTop: 2 }}>{f.name}</div>
              </button>
            ))}
          </div>

          {/* Editor area */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 360 }}>
            {!activeFile ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--q-fg-muted)", fontSize: 11, fontFamily: font }}>
                select a file to view and edit
              </div>
            ) : loading ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--q-fg-muted)", fontSize: 11, fontFamily: font }}>
                loading…
              </div>
            ) : (
              <>
                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--q-bg-hover)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "var(--q-fg-secondary)", fontFamily: font, flex: 1 }}>{activeFileMeta?.description}</span>
                  <button
                    onClick={saveFile}
                    disabled={saving}
                    style={{
                      padding: "4px 12px",
                      backgroundColor: saved ? "#065F46" : "var(--q-accent)",
                      border: "none",
                      borderRadius: 4,
                      color: "var(--q-bg)",
                      fontSize: 10,
                      fontFamily: font,
                      cursor: saving ? "default" : "pointer",
                      transition: "background-color 0.2s",
                    }}
                  >
                    {saved ? "saved ✓" : saving ? "saving…" : "save"}
                  </button>
                </div>
                <textarea
                  value={fileContent}
                  onChange={(e) => { setFileContent(e.target.value); setSaved(false); }}
                  style={{
                    flex: 1,
                    resize: "none",
                    backgroundColor: "var(--q-bg)",
                    border: "none",
                    color: "var(--q-fg-dimmed)",
                    fontFamily: font,
                    fontSize: 11,
                    lineHeight: 1.6,
                    padding: "12px",
                    outline: "none",
                  }}
                  spellCheck={false}
                />
              </>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
