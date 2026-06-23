import { useCallback, useEffect, useRef, useState } from "react";
import type { Config, Repo, Shortcut, RemoteStatus } from "../types";
import * as api from "../api";
import type { VoiceConfig } from "../types";
import { ThemeSettings } from "./ThemeSettings";
import { KeybindingsTab } from "./KeybindingsTab";
import { getOS, isMac, type OS } from "../os";
import { Icon, type IconName } from "./Icon";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

type SettingsTab = "general" | "git" | "sessions" | "storage" | "terminal" | "claude" | "voice" | "remote" | "themes" | "keybindings";

const NAV_ITEMS: { key: SettingsTab; label: string; icon: IconName }[] = [
  { key: "general", label: "general", icon: "settings" },
  { key: "keybindings", label: "keybindings", icon: "keyboard" },
  { key: "themes", label: "themes", icon: "palette" },
  { key: "git", label: "git & branches", icon: "branch" },
  { key: "sessions", label: "sessions", icon: "terminal" },
  { key: "storage", label: "storage & data", icon: "hardDrive" },
  { key: "terminal", label: "terminal", icon: "monitor" },
  { key: "claude", label: "claude cli", icon: "sparkles" },
  { key: "voice", label: "voice", icon: "mic" },
  { key: "remote", label: "remote access", icon: "globe" },
];

const FONT_OPTIONS = ["JetBrains Mono", "Fira Code", "Source Code Pro", "Cascadia Code", "Menlo", "Monaco", "Consolas"];
const CURSOR_OPTIONS = ["block", "underline", "bar"];
const MODEL_OPTIONS = ["cli default", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

interface Props {
  repos: Repo[];
  onBack: () => void;
}

const font = "var(--mono)";

// True when the app is served over the remote tunnel (browser), not the Wails
// desktop webview. The remote-access controls are desktop-only.
const isRemote = typeof window !== "undefined" && (window as { __quantRemote?: boolean }).__quantRemote === true;
const VISIBLE_NAV_ITEMS = NAV_ITEMS.filter((n) => !(isRemote && n.key === "remote"));

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
      <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <span style={{ color: "var(--fg-3)", fontSize: 12 }}>loading settings...</span>
      </div>
    );
  }

  const activeLabel = NAV_ITEMS.find((n) => n.key === tab)?.label;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", background: "var(--bg)" }}>
      {/* Drop the trailing divider on the last row of every settings panel so it
          sits flush against the panel's rounded bottom edge (spec `last` prop). */}
      <style>{`.q-settings-panel > *:last-child { border-bottom: none !important; }`}</style>
      {/* Nav */}
      <div
        style={{
          width: 248,
          flex: "none",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--border)",
          background: "var(--panel)",
        }}
      >
        {/* Header — this overlay covers the window's title bar, so on macOS pad
            the left so the inset traffic-light buttons don't overlap "settings".
            The strip is also a window-drag region (back button opts out). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 56,
            padding: isMac() ? "0 16px 0 80px" : "0 16px",
            borderBottom: "1px solid var(--border-2)",
            ["--wails-draggable" as string]: "drag",
          } as React.CSSProperties}
        >
          <span style={{ ["--wails-draggable" as string]: "no-drag" } as React.CSSProperties}>
            <IconButton name="arrowLeft" size={16} label="Back" onClick={onBack} />
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--fg)" }}>settings</span>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
          {VISIBLE_NAV_ITEMS.map((item) => (
            <NavItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              active={tab === item.key}
              onClick={() => setTab(item.key)}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Sticky header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            height: 56,
            padding: "0 32px",
            borderBottom: "1px solid var(--border-2)",
            position: "sticky",
            top: 0,
            background: "var(--bg)",
            zIndex: 1,
          }}
        >
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--fg)" }}>{activeLabel}</span>
          {saving && <span className="mono" style={{ color: "var(--accent)", fontSize: 10 }}>saving…</span>}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" icon="x" onClick={onBack}>close</Button>
        </div>

        {/* Error bar */}
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 32px",
              fontSize: 12,
              background: "color-mix(in srgb, var(--danger) 12%, transparent)",
              color: "var(--danger)",
              borderBottom: "1px solid var(--border-2)",
            }}
          >
            <span className="mono">// error: {error}</span>
            <button onClick={() => setError(null)} style={{ color: "var(--danger)", background: "none", border: "none", cursor: "pointer" }}>[x]</button>
          </div>
        )}

        {/* Scroll content */}
        <div style={{ maxWidth: 880, padding: "28px 32px 60px" }}>
          {tab === "general" && <GeneralTab config={config} update={update} />}
          {tab === "keybindings" && <KeybindingsTab />}
          {tab === "themes" && <ThemeSettings />}
          {tab === "git" && <GitTab config={config} update={update} repos={repos} />}
          {tab === "sessions" && <SessionsTab config={config} update={update} />}
          {tab === "storage" && <StorageTab config={config} update={update} onError={setError} onReload={loadConfig} />}
          {tab === "terminal" && <TerminalTab config={config} update={update} />}
          {tab === "claude" && <ClaudeTab config={config} update={update} />}
          {tab === "voice" && <VoiceTab config={config} update={update} />}
          {tab === "remote" && <RemoteTab />}
        </div>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: IconName; label: string; active: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 12px",
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--sans)",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        background: active ? "var(--accent-soft)" : hover ? "var(--hover)" : "transparent",
        color: active ? "var(--accent)" : "var(--fg-2)",
      }}
    >
      <Icon name={icon} size={15} color={active ? "var(--accent)" : "var(--fg-3)"} />
      {label}
    </button>
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
          <SettingRow
            key={i}
            label={sc.name}
            description={sc.command}
            right={
              <button
                onClick={() => removeShortcut(i)}
                style={{ color: "var(--danger)", fontSize: 12, fontFamily: "var(--mono)", background: "none", border: "none", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                x
              </button>
            }
          />
        ))}
        <div style={{ display: "flex", gap: 8, padding: 14 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="name"
            onKeyDown={(e) => e.key === "Enter" && addShortcut()}
            spellCheck={false}
            className="mono"
            style={{
              width: 180,
              height: 32,
              padding: "0 10px",
              borderRadius: 8,
              boxSizing: "border-box",
              background: "var(--panel-3)",
              border: "1px solid var(--border-2)",
              color: "var(--fg)",
              fontSize: 12,
              outline: "none",
            }}
          />
          <input
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            placeholder="command"
            onKeyDown={(e) => e.key === "Enter" && addShortcut()}
            spellCheck={false}
            className="mono"
            style={{
              flex: 1,
              minWidth: 0,
              height: 32,
              padding: "0 10px",
              borderRadius: 8,
              boxSizing: "border-box",
              background: "var(--panel-3)",
              border: "1px solid var(--border-2)",
              color: "var(--accent)",
              fontSize: 12,
              outline: "none",
            }}
          />
          <button
            onClick={addShortcut}
            style={{
              color: "var(--fg-3)",
              fontSize: 11,
              fontFamily: "var(--mono)",
              border: "1px dashed var(--border)",
              borderRadius: 8,
              padding: "0 12px",
              background: "none",
              cursor: "pointer",
              flex: "none",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--fg-3)")}
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
        <div style={{ padding: 14 }}>
          <OverrideTableShell colA="repository" colB="pull branch" entries={Object.entries(config.branchOverrides)} onRemove={removeOverride} />
          {/* Add override row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <div ref={repoDropdownRef} style={{ position: "relative", width: 200 }}>
              <button
                onClick={() => setRepoDropdownOpen((prev) => !prev)}
                className="mono"
                style={{
                  width: 200,
                  height: 32,
                  borderRadius: 8,
                  boxSizing: "border-box",
                  background: "var(--panel-3)",
                  border: `1px solid ${repoDropdownOpen ? "var(--accent)" : "var(--border-2)"}`,
                  color: newRepo ? "var(--fg)" : "var(--fg-4)",
                  fontSize: 12,
                  padding: "0 10px",
                  textAlign: "left",
                  cursor: "pointer",
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
              style={{ color: "var(--accent)", fontSize: 11, fontFamily: "var(--mono)", background: "none", border: "none", cursor: "pointer", padding: "4px 6px" }}
            >
              + add override
            </button>
          </div>
        </div>
      </Section>
    </>
  );
}

// OverrideTableShell renders the read-only key/value table used by the git
// per-repo and claude per-path override sections (new design tokens).
function OverrideTableShell({
  colA,
  colB,
  entries,
  onRemove,
}: {
  colA: string;
  colB: string;
  entries: [string, string][];
  onRemove: (key: string) => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border-2)", borderRadius: 9, overflow: "hidden" }}>
      <div style={{ display: "flex", height: 32, background: "var(--panel-3)", borderBottom: "1px solid var(--border-2)" }}>
        <div className="mono" style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 10, fontWeight: 700, color: "var(--fg-3)" }}>{colA}</div>
        <div className="mono" style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 10, fontWeight: 700, color: "var(--fg-3)" }}>{colB}</div>
        <div style={{ width: 60 }} />
      </div>
      {entries.length === 0 && (
        <div className="mono" style={{ padding: "10px 12px", fontSize: 11, color: "var(--fg-4)" }}>// none configured</div>
      )}
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "flex", height: 36, borderBottom: "1px solid var(--border-2)" }}>
          <div className="mono" style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 11, color: "var(--fg)" }}>{k}</div>
          <div className="mono" style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 11, color: "var(--accent)" }}>{v}</div>
          <div style={{ width: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <button onClick={() => onRemove(k)} style={{ color: "var(--danger)", fontSize: 12, fontWeight: 700, background: "none", border: "none", cursor: "pointer" }}>x</button>
          </div>
        </div>
      ))}
    </div>
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
              className="mono"
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
                background: "var(--panel-3)",
                border: "1px solid var(--border-2)",
                borderRadius: 8,
                boxSizing: "border-box",
                height: 32,
                width: 280,
                opacity: 0.6,
                color: "var(--fg-3)",
                fontSize: 11.5,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--scrim)" }}>
      <div
        className="flex flex-col gap-6"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "var(--shadow-pop)",
          padding: 28,
          maxWidth: 400,
        }}
      >
        <div className="flex flex-col gap-2">
          <span style={{ color: "var(--warn)", fontSize: 12, fontWeight: 700 }}>~ restart required</span>
          <span style={{ color: "var(--fg-2)", fontSize: 11.5, lineHeight: 1.5 }}>
            storage paths have changed. please restart quant for the changes to take effect.
          </span>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={onClose}>ok, got it</Button>
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

      <Section
        title="agent persona"
        description="the base system prompt appended to every session quant spawns — it tells the agent it is quant, what quant is, and how to use the live mindmap + quant tools. Layered on top of each project's own context. Leave empty to use the built-in default."
      >
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea
            value={config.basePersona ?? ""}
            onChange={(e) => update("basePersona", e.target.value)}
            placeholder={config.defaultBasePersona || "Leave empty to use the built-in Quant persona…"}
            spellCheck={false}
            className="mono"
            style={{
              width: "100%",
              minHeight: 150,
              resize: "vertical",
              boxSizing: "border-box",
              padding: 10,
              borderRadius: 9,
              outline: "none",
              background: "var(--panel-3)",
              border: "1px solid var(--border-2)",
              color: "var(--fg)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-2)")}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <button
              onClick={() => update("basePersona", config.defaultBasePersona ?? "")}
              disabled={!config.defaultBasePersona}
              style={{ color: "var(--accent)", fontSize: 11, fontFamily: "var(--mono)", background: "none", border: "none", cursor: "pointer", opacity: config.defaultBasePersona ? 1 : 0.4 }}
            >
              load default to edit
            </button>
            <button
              onClick={() => update("basePersona", "")}
              disabled={!(config.basePersona ?? "").trim()}
              style={{ color: "var(--fg-4)", fontSize: 11, fontFamily: "var(--mono)", background: "none", border: "none", cursor: "pointer", opacity: (config.basePersona ?? "").trim() ? 1 : 0.4 }}
            >
              reset to default
            </button>
            <span style={{ color: "var(--fg-4)", fontSize: 10, fontFamily: "var(--mono)" }}>
              {(config.basePersona ?? "").trim() ? "using your custom persona" : "using built-in default"}
            </span>
          </div>
        </div>
      </Section>

      <Section title="per-path command overrides" description="use a different claude command for sessions whose path contains the given substring">
        <div style={{ padding: 14 }}>
          <OverrideTableShell colA="path contains" colB="command" entries={Object.entries(commandOverrides)} onRemove={removeCommandOverride} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <TextInput value={newPath} onChange={setNewPath} width={200} placeholder="e.g. /work/projects/" />
            <TextInput value={newCommand} onChange={setNewCommand} width={160} placeholder="e.g. claude-bl" />
            <button
              onClick={addCommandOverride}
              style={{ color: "var(--accent)", fontSize: 11, fontFamily: "var(--mono)", background: "none", border: "none", cursor: "pointer", padding: "4px 6px" }}
            >
              + add override
            </button>
          </div>
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

// --- Remote Access Tab ---

const CLOUDFLARED_GUIDE = "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

function RemoteTab() {
  // Remote access is controlled from the desktop app only — its controller is
  // deliberately not reachable over the tunnel. Show a friendly note instead of
  // calling it (which would fail with "unknown controller").
  if (isRemote) {
    return (
      <Section title="remote access" description="manage remote access from the quant desktop app">
        <p style={{ color: "var(--fg-2)", fontSize: 12 }}>
          you are connected remotely. enabling, disabling, and the passcode are managed from the
          desktop app for security.
        </p>
      </Section>
    );
  }
  return <RemoteTabControls />;
}

function RemoteTabControls() {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getRemoteAccessStatus());
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // Load once, then poll so the public URL (which arrives a moment after the
  // tunnel starts) and the connected-client count stay current.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  async function run(fn: () => Promise<RemoteStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fn());
    } catch (err) {
      setError(String(err));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const enabled = status?.enabled ?? false;
  const installed = status?.cloudflaredInstalled ?? true;

  return (
    <>
      <Section
        title="remote access"
        description="expose this quant in a browser via a Cloudflare quick tunnel, guarded by a passcode. anyone with the URL and passcode can drive your sessions — treat the passcode like a password."
      >
        {!installed && (
          <div
            className="flex flex-col"
            style={{ gap: 8, padding: 12, border: "1px solid var(--border)", backgroundColor: "var(--panel-3)", fontSize: 11, color: "var(--fg-2)" }}
          >
            <span style={{ color: "var(--fg)" }}>cloudflared is required and was not found.</span>
            <span>install it, then re-check:</span>
            <CodeLine text="brew install cloudflared" />
            <CodeLine text="winget install --id Cloudflare.cloudflared" />
            <a href={CLOUDFLARED_GUIDE} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              installation guide →
            </a>
            <div>
              <SmallButton label="re-check" onClick={() => run(() => api.getRemoteAccessStatus())} disabled={busy} />
            </div>
          </div>
        )}

        <SettingRow
          label="enable remote access"
          description={installed ? "start the local server and a public Cloudflare tunnel" : "install cloudflared first"}
          right={
            <Toggle
              checked={enabled}
              onChange={(v) => run(() => (v ? api.enableRemoteAccess() : api.disableRemoteAccess()))}
            />
          }
        />

        {enabled && (
          <>
            <SettingRow
              label="public url"
              description="open this anywhere; it changes each time you re-enable"
              right={
                status?.url ? (
                  <div className="flex items-center gap-2">
                    <a href={status.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: 12 }}>
                      {status.url}
                    </a>
                    <CopyButton text={status.url} />
                  </div>
                ) : (
                  <span style={{ color: "var(--fg-4)", fontSize: 12 }}>starting tunnel…</span>
                )
              }
            />
            <SettingRow
              label="passcode"
              description="required to unlock the remote session"
              right={
                <div className="flex items-center gap-2">
                  <span style={{ fontFamily: font, fontSize: 13, letterSpacing: 2, color: "var(--fg)" }}>
                    {status?.passcode || "—"}
                  </span>
                  <CopyButton text={status?.passcode || ""} />
                  <SmallButton label="regenerate" onClick={() => run(() => api.regenerateRemotePasscode())} disabled={busy} />
                </div>
              }
            />
            <SettingRow
              label="connected clients"
              description="active browser sessions"
              right={<span style={{ color: "var(--fg)", fontSize: 12 }}>{status?.clients ?? 0}</span>}
            />
          </>
        )}

        {status?.error && enabled && (
          <span style={{ color: "var(--danger)", fontSize: 11 }}>{status.error}</span>
        )}
        {error && <span style={{ color: "var(--danger)", fontSize: 11 }}>{error}</span>}
      </Section>
    </>
  );
}

function CodeLine({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-between" style={{ gap: 8, padding: "6px 9px", background: "var(--panel-3)", border: "1px solid var(--border-2)", borderRadius: 7 }}>
      <code className="mono" style={{ fontSize: 11, color: "var(--fg-2)" }}>{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

function SmallButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mono"
      style={{
        height: 32,
        padding: "0 12px",
        borderRadius: 8,
        fontSize: 11,
        color: disabled ? "var(--fg-4)" : "var(--fg-3)",
        border: "1px solid var(--border)",
        background: "transparent",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function copyText(text: string) {
  if (text && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <SmallButton
      label={copied ? "✓ copied" : "copy"}
      onClick={() => {
        copyText(text);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}

// --- Reusable UI Components ---

function Section({ title, description, children, danger }: { title: string; description: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <div style={{ marginBottom: 30 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: danger ? "var(--danger)" : "var(--accent)", letterSpacing: "0.01em" }}>{title}</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--fg-4)", lineHeight: 1.5 }}>// {description}</span>
      </div>
      <div
        className="q-settings-panel"
        style={{
          background: "var(--panel)",
          border: `1px solid ${danger ? "color-mix(in srgb, var(--danger) 35%, var(--border))" : "var(--border)"}`,
          borderRadius: 13,
          overflow: "hidden",
          boxShadow: "var(--shadow-panel)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function DangerSection({ children }: { children: React.ReactNode }) {
  return (
    <Section title="danger zone" description="destructive actions — use with caution" danger>
      {children}
    </Section>
  );
}

function SettingRow({ label, description, right }: { label: string; description: string; right: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 16px", borderBottom: "1px solid var(--border-2)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)", letterSpacing: "-0.01em" }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2, lineHeight: 1.4 }}>{description}</div>
      </div>
      <div style={{ flex: "none" }}>{right}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", background: "none", border: "none", padding: 0 }}
    >
      <span
        style={{
          width: 17,
          height: 17,
          borderRadius: 5,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: checked ? "var(--accent)" : "transparent",
          border: `1.5px solid ${checked ? "var(--accent)" : "var(--border)"}`,
        }}
      >
        {checked && <Icon name="check" size={11} color="var(--on-accent)" stroke={3} />}
      </span>
      <span style={{ fontSize: 11.5, color: checked ? "var(--accent)" : "var(--fg-3)", minWidth: 50, textAlign: "left" }}>
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
      spellCheck={false}
      className="mono"
      style={{
        width,
        height: 32,
        padding: "0 10px",
        borderRadius: 8,
        boxSizing: "border-box",
        outline: "none",
        background: "var(--panel-3)",
        border: "1px solid var(--border-2)",
        color: "var(--fg)",
        fontSize: 12,
        fontFamily: "var(--mono)",
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
      onBlurCapture={(e) => (e.currentTarget.style.borderColor = "var(--border-2)")}
    />
  );
}

// ComboInput is a pick-or-type field: a themed text input bound to a <datalist>
// so the user keeps free typing while discovered/curated options show in the
// dropdown. Styled identically to TextInput (same --* tokens) so it blends in.
function ComboInput({
  value,
  onChange,
  width,
  placeholder,
  options,
  listId,
}: {
  value: string;
  onChange: (v: string) => void;
  width: number;
  placeholder?: string;
  options: string[];
  listId: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <>
      <input
        value={local}
        list={listId}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if (local !== value) onChange(local); }}
        onKeyDown={(e) => { if (e.key === "Enter") onChange(local); }}
        placeholder={placeholder}
        spellCheck={false}
        className="mono"
        style={{
          width,
          height: 32,
          padding: "0 10px",
          borderRadius: 8,
          boxSizing: "border-box",
          outline: "none",
          background: "var(--panel-3)",
          border: "1px solid var(--border-2)",
          color: "var(--fg)",
          fontSize: 12,
          fontFamily: "var(--mono)",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
        onBlurCapture={(e) => (e.currentTarget.style.borderColor = "var(--border-2)")}
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
    </>
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
      className="mono"
      style={{
        width,
        height: 32,
        padding: "0 10px",
        borderRadius: 8,
        boxSizing: "border-box",
        outline: "none",
        background: "var(--panel-3)",
        border: "1px solid var(--border-2)",
        color: disabled ? "var(--fg-4)" : "var(--fg)",
        fontSize: 12,
        fontFamily: "var(--mono)",
        opacity: disabled ? 0.5 : 1,
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
      onBlurCapture={(e) => (e.currentTarget.style.borderColor = "var(--border-2)")}
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
      className="mono"
      style={{
        width,
        height: 32,
        padding: "0 10px",
        borderRadius: 8,
        boxSizing: "border-box",
        outline: "none",
        background: "var(--panel-3)",
        border: "1px solid var(--border-2)",
        color: "var(--fg)",
        fontSize: 12,
        fontFamily: "var(--mono)",
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
      onBlurCapture={(e) => (e.currentTarget.style.borderColor = "var(--border-2)")}
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
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: "var(--fg)",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "6px 9px",
        cursor: "pointer",
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
      style={{
        height: 32,
        padding: "0 14px",
        flex: "none",
        borderRadius: 8,
        cursor: "pointer",
        background: "var(--panel-2)",
        border: "1px solid var(--border)",
        color: "var(--fg-3)",
        fontFamily: "var(--mono)",
        fontSize: 11,
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
        top: 38,
        left: 0,
        zIndex: 50,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        boxShadow: "var(--shadow-pop)",
        minWidth: 180,
        width: "100%",
        overflow: "hidden",
        padding: 4,
      }}
    >
      {items.length === 0 && (
        <div className="mono" style={{ padding: "6px 10px", color: "var(--fg-4)", fontSize: 11 }}>
          no repos available
        </div>
      )}
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.onClick}
          className="mono"
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            textAlign: "left",
            height: 28,
            padding: "0 8px",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--fg-2)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{ color: "var(--accent)", flexShrink: 0 }}>~</span>
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
      style={{
        height: 32,
        padding: "0 14px",
        borderRadius: 8,
        cursor: "pointer",
        border: "none",
        background: "var(--danger)",
        color: "#fff",
        fontFamily: "var(--mono)",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}


// --- Voice Tab ---

// Sensible defaults for a fresh config: local-first. New users land on the
// self-hosted whisper.cpp (:2022) + Kokoro-FastAPI (:8880) engines — private,
// zero-cost, no api key. These also guard against an older persisted config that
// predates the voice sub-object.
const VOICE_DEFAULTS: VoiceConfig = {
  enabled: false,
  provider: "local",
  baseUrl: "",
  sttBaseUrl: "http://localhost:2022",
  ttsBaseUrl: "http://localhost:8880",
  sttModel: "",
  ttsModel: "",
  voice: "am_onyx",
  speed: 1.2,
  pauseMs: 3000,
  instructions: "",
  hasApiKey: false,
};

// Curated fallbacks shown in the pick-or-type fields when the server can't be
// probed (down, or cloud). Server-discovered options are merged ahead of these,
// de-duplicated, so the dropdowns are never empty.
const FALLBACK_VOICES = [
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore",
  "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam",
  "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx",
  "am_puck", "am_santa", "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
  "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
];
const FALLBACK_STT_MODELS = ["whisper-1"];
const FALLBACK_TTS_MODELS = ["kokoro", "tts-1", "tts-1-hd"];

// mergeOptions puts server-discovered values first, then curated fallbacks,
// de-duplicated while preserving order.
function mergeOptions(server: string[], fallback: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...server, ...fallback]) {
    const t = v.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// Real, sensible help targets: link official install guides — never auto-download.
// LOCAL-ONLY: no cloud/OpenAI links in the main flow.
const WHISPER_HELP = "https://github.com/ggml-org/whisper.cpp"; // OpenAI-compatible local Whisper (whisper.cpp, STT on :2022)
const WHISPER_RELEASES = "https://github.com/ggml-org/whisper.cpp/releases"; // prebuilt windows binaries
const KOKORO_HELP = "https://github.com/remsky/Kokoro-FastAPI"; // OpenAI-compatible local Kokoro TTS (am_onyx voice)
const DOCKER_DESKTOP = "https://www.docker.com/products/docker-desktop/"; // mac/windows
const DOCKER_ENGINE = "https://docs.docker.com/engine/install/"; // linux
const UV_INSTALL = "https://docs.astral.sh/uv/getting-started/installation/"; // uv package manager (native Kokoro)

// Install method for the Kokoro card: the bundled bash start scripts (native, no
// Docker) vs the prebuilt Docker image.
type InstallMethod = "native" | "docker";

// Per-OS whisper.cpp install + run commands. whisper.cpp serves OpenAI-compatible
// STT on :2022 and MUST be launched with --inference-path "/v1/audio/transcriptions".
const WHISPER_RUN_CMD =
  './build/bin/whisper-server -m models/ggml-small.en.bin --host 127.0.0.1 --port 2022 --inference-path "/v1/audio/transcriptions"';
const WHISPER_RUN_CMD_WIN =
  'whisper-server.exe -m models\\ggml-small.en.bin --host 127.0.0.1 --port 2022 --inference-path "/v1/audio/transcriptions"';

const WHISPER_STEPS: Record<OS, { note?: string; link?: { label: string; href: string }; cmd: string }[]> = {
  macos: [
    { cmd: "brew install cmake" },
    { cmd: "git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp" },
    { cmd: "cmake -B build && cmake --build build -j --config Release" },
    { cmd: "sh ./models/download-ggml-model.sh small.en" },
    { note: "start the server (keep it running):", cmd: WHISPER_RUN_CMD },
  ],
  windows: [
    {
      note: "Download the prebuilt whisper-bin-x64.zip from the releases page and unzip it:",
      link: { label: "whisper.cpp releases →", href: WHISPER_RELEASES },
      cmd: "",
    },
    { note: "download a model, then start the server (keep it running):", cmd: WHISPER_RUN_CMD_WIN },
  ],
  linux: [
    { cmd: "sudo apt install build-essential cmake git" },
    { cmd: "git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp" },
    { cmd: "cmake -B build && cmake --build build -j" },
    { cmd: "sh ./models/download-ggml-model.sh small.en" },
    { note: "start the server (keep it running):", cmd: WHISPER_RUN_CMD },
  ],
};

// Kokoro-FastAPI runs in Docker on :8880. The durable variant (below) is shown by
// default since it adds --restart unless-stopped so the container survives reboot.

// Native (no-Docker) Kokoro-FastAPI: clone the repo, then run the bundled bash
// start script for the platform. The start scripts use `uv` to install deps,
// auto-download the model (docker/scripts/download_model.py), and launch
// `uvicorn api.src.main:app --port 8880` — so uv is the only prerequisite.
// Script names verified against the live repo (start-gpu_mac.sh / start-cpu.sh /
// start-gpu.sh). The bash scripts don't run on Windows → Docker stays default there.
const KOKORO_CLONE_CMD =
  "git clone https://github.com/remsky/Kokoro-FastAPI.git && cd Kokoro-FastAPI";
const KOKORO_NATIVE_SCRIPT: Record<OS, { cmd: string; note: string }> = {
  // Apple Silicon uses the Metal/MPS script; Intel/CPU macs use start-cpu.sh.
  macos: { cmd: "./start-gpu_mac.sh", note: "on an Intel / CPU-only mac, use ./start-cpu.sh instead" },
  // Linux NVIDIA GPU; CPU-only Linux uses start-cpu.sh.
  linux: { cmd: "./start-gpu.sh", note: "no NVIDIA GPU? use ./start-cpu.sh instead" },
  // Windows can't run the bash scripts — Docker is the default method there.
  windows: { cmd: "./start-cpu.sh", note: "the bash start scripts need WSL/Git-Bash on Windows — Docker is simpler" },
};

// Durable Kokoro Docker run: --restart unless-stopped brings the container back
// after a reboot (once Docker itself starts), so the TTS server survives a login.
const KOKORO_RUN_CMD_DURABLE =
  "docker run -d --restart unless-stopped --name kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest";

// --- Auto-start on login (optional) ---
// Per-OS SETUP SCRIPTS that keep a local STT/TTS server alive across reboots. The
// headline approach is a copy-paste script the user pastes into a terminal: it
// writes AND registers the auto-start service for them (no hand-editing a plist /
// unit / scheduled task). Each script starts with a couple of clearly-commented,
// easy-to-edit variables (install dir + the run command/binary + port) and then
// does the work end-to-end, idempotently:
//   • macOS  — writes ~/Library/LaunchAgents/<label>.plist, then launchctl
//     unload (ignore errors) + launchctl load -w. Mirrors how voice-mode keeps
//     whisper/kokoro alive: RunAtLoad + KeepAlive under a per-user LaunchAgent.
//   • Linux  — writes ~/.config/systemd/user/<name>.service, then daemon-reload +
//     enable --now, plus loginctl enable-linger so it runs without an active login.
//   • Windows— Register-ScheduledTask at logon (PowerShell .ps1-style block).
// The raw plist/unit is kept as a small "or do it manually" sub-detail.
type AutoStartBlock =
  | { kind: "note"; text: string }
  | { kind: "muted"; text: string }
  | { kind: "code"; text: string } // one-line copyable command (break-all wrap)
  | { kind: "script"; text: string } // multi-line copyable script (newline-preserving)
  | { kind: "link"; label: string; href: string };

// macOS setup script: detects the live server listening on `port`, reproduces
// its exact command + working directory into a LaunchAgent plist, then does an
// idempotent unload/load. Zero user-editable variables. `label` is
// reverse-DNS-ish, e.g. com.local.whisper. `port` is baked per card.
function macAutoStartScript(opts: {
  label: string;
  port: number;
}): AutoStartBlock[] {
  const { label, port } = opts;
  return [
    {
      kind: "script",
      text: `#!/bin/bash
set -e
PORT=${port}; LABEL=${label}
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$PID" ]; then
  echo "Nothing is listening on :$PORT — start the server (and Test connection) first, then paste this again."
  exit 1
fi
CMD=$(ps -o command= -p "$PID")
CWD=$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$CWD" && exec $CMD</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$CWD</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
PLIST_EOF

# take over from the manually-started instance so launchd's copy can bind the port
kill "$PID" 2>/dev/null || true
for i in $(seq 1 20); do
  lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1 || break
  sleep 0.3
done

# (re)register — unload first so re-running is safe, then load + run now
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "✅ $LABEL installed — it will auto-start at login. Check: launchctl list | grep com.local"`,
    },
    { kind: "muted", text: `This detects the server already running on port ${port}, writes ~/Library/LaunchAgents/${label}.plist (RunAtLoad + KeepAlive) reproducing its exact command + working directory, then stops the manually-started copy and hands the server to launchd so it takes over cleanly (auto-starts at login and keeps running now).` },
  ];
}

// macOS setup script for Kokoro specifically. Kokoro isn't launched as a bare
// uvicorn — it runs through a wrapper start script (start-gpu_mac.sh on Apple
// Silicon, start-cpu.sh otherwise) that exports the env it needs (PYTHONPATH,
// MODEL_DIR, VOICES_DIR, DEVICE_TYPE, …) and invokes uvicorn via `uv`. So we must
// register launchd to run THAT start script (with uv on PATH), not the leaf
// uvicorn command — the bare command exits immediately under launchd. We detect
// the working directory from the live server on `port` and pick the right script
// from the CPU/GPU arch. `label` is reverse-DNS-ish, e.g. com.local.kokoro.
function macKokoroAutoStartScript(opts: {
  label: string;
  port: number;
}): AutoStartBlock[] {
  const { label, port } = opts;
  return [
    {
      kind: "script",
      text: `#!/bin/bash
set -e
PORT=${port}; LABEL=${label}
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$PID" ]; then
  echo "Nothing is listening on :$PORT — start Kokoro (and Test connection) first, then paste this again."
  exit 1
fi
CWD=$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
UVDIR=$(dirname "$(command -v uv 2>/dev/null || echo /opt/homebrew/bin/uv)")
SCRIPT=$([ "$(uname -m)" = "arm64" ] && echo ./start-gpu_mac.sh || echo ./start-cpu.sh)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$CWD" && export PATH="$UVDIR:\\$PATH" && exec $SCRIPT</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$CWD</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
PLIST_EOF

# take over from the manually-started instance so launchd's copy can bind the port
kill "$PID" 2>/dev/null || true
for i in $(seq 1 20); do
  lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1 || break
  sleep 0.3
done

# (re)register — unload first so re-running is safe, then load + run now
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "✅ $LABEL installed — Kokoro auto-starts at login (first start warms up in ~10-20s)."`,
    },
    { kind: "muted", text: `This detects Kokoro already running on port ${port}, then writes ~/Library/LaunchAgents/${label}.plist (RunAtLoad + KeepAlive) that runs Kokoro's start script (start-gpu_mac.sh on Apple Silicon, start-cpu.sh otherwise) with uv on PATH — so the required env (PYTHONPATH, MODEL_DIR, VOICES_DIR, DEVICE_TYPE, …) is set, unlike the bare uvicorn command which would exit under launchd. It then stops the manually-started copy and hands the server to launchd so it takes over cleanly. First start warms up in ~10-20s.` },
  ];
}

// Linux setup script: detects the live server listening on `port`, reproduces
// its exact command + working directory into a systemd --user unit, then
// daemon-reload + enable --now + enable-linger (idempotent). Zero user-editable
// variables; `port` is baked per card.
function linuxAutoStartScript(opts: {
  name: string;
  port: number;
}): AutoStartBlock[] {
  const { name, port } = opts;
  return [
    {
      kind: "script",
      text: `#!/bin/bash
set -e
PORT=${port}; NAME=${name}
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$PID" ]; then
  PID=$(ss -lptnH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\\K[0-9]+' | head -1)
fi
if [ -z "$PID" ]; then
  echo "Nothing is listening on :$PORT — start the server (and Test connection) first, then paste this again."
  exit 1
fi
CMD=$(tr '\\0' ' ' < /proc/$PID/cmdline | sed 's/ *$//')
CWD=$(readlink /proc/$PID/cwd)
UNIT="$HOME/.config/systemd/user/$NAME.service"
mkdir -p "$HOME/.config/systemd/user"

cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=$NAME (local voice engine)

[Service]
ExecStart=/bin/bash -lc 'cd "$CWD" && exec $CMD'
WorkingDirectory=$CWD
Restart=always

[Install]
WantedBy=default.target
UNIT_EOF

# take over from the manually-started instance so systemd's copy can bind the port
kill "$PID" 2>/dev/null || true
for i in $(seq 1 20); do
  lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1 || ss -lntH "sport = :$PORT" 2>/dev/null | grep -q . || break
  sleep 0.3
done

systemctl --user daemon-reload
systemctl --user enable --now "$NAME"
sudo loginctl enable-linger "$USER"   # so it runs without an active login session
echo "✅ $NAME installed — it will auto-start at login. Check: systemctl --user status $NAME"`,
    },
    { kind: "muted", text: `This detects the server already running on port ${port}, writes ~/.config/systemd/user/${name}.service reproducing its exact command + working directory, then stops the manually-started copy and hands the server to systemd so it takes over cleanly (auto-starts at login and keeps running now).` },
  ];
}

// Linux setup script for Kokoro specifically. Like macOS, Kokoro must be launched
// via its wrapper start script (which exports PYTHONPATH/MODEL_DIR/VOICES_DIR/
// DEVICE_TYPE/… and runs uvicorn through `uv`), not the bare uvicorn command —
// the leaf command exits immediately under systemd. We detect the working
// directory from the live server on `port`, put uv on PATH, and run the start
// script. `port` is baked per card.
function linuxKokoroAutoStartScript(opts: {
  name: string;
  port: number;
}): AutoStartBlock[] {
  const { name, port } = opts;
  return [
    {
      kind: "script",
      text: `#!/bin/bash
set -e
PORT=${port}; NAME=${name}
PID=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -z "$PID" ]; then
  PID=$(ss -lptnH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\\K[0-9]+' | head -1)
fi
if [ -z "$PID" ]; then
  echo "Nothing is listening on :$PORT — start Kokoro (and Test connection) first, then paste this again."
  exit 1
fi
CWD=$(readlink /proc/$PID/cwd)
UVDIR=$(dirname "$(command -v uv 2>/dev/null || echo "$HOME/.local/bin/uv")")
SCRIPT=./start-cpu.sh   # use ./start-gpu.sh if you have an NVIDIA GPU
UNIT="$HOME/.config/systemd/user/$NAME.service"
mkdir -p "$HOME/.config/systemd/user"

cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=$NAME (local voice engine)

[Service]
ExecStart=/bin/bash -lc 'cd "$CWD" && export PATH="$UVDIR:\\$PATH" && exec $SCRIPT'
WorkingDirectory=$CWD
Restart=always

[Install]
WantedBy=default.target
UNIT_EOF

# take over from the manually-started instance so systemd's copy can bind the port
kill "$PID" 2>/dev/null || true
for i in $(seq 1 20); do
  lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1 || ss -lntH "sport = :$PORT" 2>/dev/null | grep -q . || break
  sleep 0.3
done

systemctl --user daemon-reload
systemctl --user enable --now "$NAME"
sudo loginctl enable-linger "$USER"   # so it runs without an active login session
echo "✅ $NAME installed — Kokoro auto-starts at login (first start warms up in ~10-20s)."`,
    },
    { kind: "muted", text: `This detects Kokoro already running on port ${port}, then writes ~/.config/systemd/user/${name}.service that runs Kokoro's start script (./start-cpu.sh, or ./start-gpu.sh for an NVIDIA GPU) with uv on PATH — so the required env (PYTHONPATH, MODEL_DIR, VOICES_DIR, DEVICE_TYPE, …) is set, unlike the bare uvicorn command which would exit under systemd. It then stops the manually-started copy and hands the server to systemd so it takes over cleanly. First start warms up in ~10-20s.` },
  ];
}

// Windows setup script: a PowerShell block that detects the live server
// listening on `port`, reproduces its exact executable + arguments + working
// directory into a Scheduled Task with an at-logon trigger (idempotent —
// unregisters an existing task of the same name first). Zero user-editable
// variables; `port` is baked per card.
function windowsAutoStartScript(opts: {
  taskName: string;
  port: number;
}): AutoStartBlock[] {
  const { taskName, port } = opts;
  return [
    {
      kind: "script",
      text: `# Paste this into PowerShell
$Port = ${port}
$c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $c) {
  Write-Host "Nothing is listening on :$Port - start the server (and Test connection) first, then paste this again."
  exit 1
}
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
$exe = $p.ExecutablePath
$dir = if ($exe) { Split-Path -Parent $exe } else { (Get-Location).Path }
if ($exe) {
  # strip the leading exe path from the full command line to recover the arguments
  $cmd = $p.CommandLine
  $quoted = '"' + $exe + '"'
  if ($cmd.StartsWith($quoted)) { $argline = $cmd.Substring($quoted.Length).Trim() }
  elseif ($cmd.StartsWith($exe)) { $argline = $cmd.Substring($exe.Length).Trim() }
  else { $argline = "" }
  if ($argline) {
    $action = New-ScheduledTaskAction -Execute $exe -Argument $argline -WorkingDirectory $dir
  } else {
    $action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $dir
  }
} else {
  # no resolvable exe path: re-run the full command line via cmd /c
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c $($p.CommandLine)" -WorkingDirectory $dir
}
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# take over from the manually-started instance so the managed copy can bind the port
Stop-Process -Id $($c.OwningProcess) -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
# unregister first so re-running is safe
Unregister-ScheduledTask -TaskName "${taskName}" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "${taskName}" -Action $action -Trigger $trigger -Settings $settings
Start-ScheduledTask -TaskName "${taskName}"
Write-Host "OK ${taskName} installed - it will auto-start at login. Check: Get-ScheduledTask -TaskName '${taskName}'"`,
    },
    { kind: "muted", text: `This detects the server already running on port ${port}, registers a "${taskName}" Scheduled Task (at-logon trigger) reproducing its exact executable + arguments + working directory, then stops the manually-started copy and hands the server to Task Scheduler so it takes over cleanly (auto-starts at login and keeps running now).` },
  ];
}

// Concrete setup scripts for each engine. Each script self-detects the live
// server on its known port (Whisper 2022, Kokoro 8880) and reproduces its exact
// command + working directory — no user-editable variables.
const WHISPER_AUTOSTART: Record<OS, AutoStartBlock[]> = {
  macos: macAutoStartScript({ label: "com.local.whisper", port: 2022 }),
  linux: linuxAutoStartScript({ name: "whisper", port: 2022 }),
  windows: windowsAutoStartScript({ taskName: "Whisper STT", port: 2022 }),
};

// Kokoro is launched via a wrapper start script (start-gpu_mac.sh / start-cpu.sh /
// start-gpu.sh) that exports the env it needs and runs uvicorn through `uv`, so
// macOS + Linux use the Kokoro-specific builders that register that start script
// (the bare uvicorn command exits under launchd/systemd). Windows uses the Docker
// --restart note instead (see KOKORO_DOCKER_BLOCKS), so the generic Scheduled
// Task entry here is only a fallback.
const KOKORO_AUTOSTART: Record<OS, AutoStartBlock[]> = {
  macos: macKokoroAutoStartScript({ label: "com.local.kokoro", port: 8880 }),
  linux: linuxKokoroAutoStartScript({ name: "kokoro", port: 8880 }),
  windows: windowsAutoStartScript({ taskName: "Kokoro TTS", port: 8880 }),
};

// For the Docker method, durability is just the --restart flag — no plist/systemd
// needed. Same guidance on every OS (once Docker starts on boot, the container
// comes back).
const KOKORO_DOCKER_BLOCKS: AutoStartBlock[] = [
  {
    kind: "note",
    text: "With Docker, no LaunchAgent/systemd unit is needed — the --restart unless-stopped flag restarts the container after a reboot (once Docker starts). Use this run command instead of the plain one:",
  },
  { kind: "code", text: KOKORO_RUN_CMD_DURABLE },
  {
    kind: "muted",
    text: "make sure Docker Desktop / the Docker service is itself set to start on login (Docker Desktop → Settings → General → Start on login).",
  },
];

// pingStateColor maps a connection-test state to its themed color: ok → green,
// fail → error, anything else (untested/pending) → muted neutral. Shared by the
// StatusChip pill and the inline ping detail line so they stay consistent.
function pingStateColor(state: "untested" | "pending" | "ok" | "fail"): string {
  return state === "ok" ? "var(--ok)" : state === "fail" ? "var(--danger)" : "var(--fg-4)";
}

// StatusChip renders a small "LABEL ●" pill whose dot + label color reflect a
// ping state. Themed with --* tokens only.
function StatusChip({ label, state }: { label: string; state: "untested" | "ok" | "fail" }) {
  const color = pingStateColor(state);
  const text = state === "ok" ? "connected" : state === "fail" ? "not reachable" : "untested";
  const borderC = state === "ok" ? "var(--accent-line)" : state === "fail" ? "color-mix(in srgb, var(--danger) 45%, var(--border))" : "var(--border-2)";
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 6,
        fontSize: 10.5,
        border: `1px solid ${borderC}`,
        background: "var(--panel-3)",
        color,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      <span style={{ color: "var(--fg-2)" }}>{label}</span> · {text}
    </span>
  );
}

// Segmented is a generic segmented control (a row of mutually-exclusive tabs).
// Used for the install-card OS tabs (3-way) and the Kokoro install-method picker
// (2-way). Themed with --* tokens only.
function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "inline-flex", padding: 2, gap: 2, borderRadius: 9, background: "var(--panel-3)", border: "1px solid var(--border-2)", width: "fit-content" }}>
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            style={{
              padding: "4px 10px",
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: 500,
              fontFamily: "var(--sans)",
              color: active ? "var(--fg)" : "var(--fg-3)",
              background: active ? "var(--panel)" : "transparent",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,.18), inset 0 1px 0 var(--top-hi)" : "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

const OS_SEGMENTS: { key: OS; label: string }[] = [
  { key: "macos", label: "macOS" },
  { key: "windows", label: "Windows" },
  { key: "linux", label: "Linux" },
];

const METHOD_SEGMENTS: { key: InstallMethod; label: string }[] = [
  { key: "native", label: "Native (no Docker)" },
  { key: "docker", label: "Docker" },
];

// CommandLine renders one monospace copy-paste command with a copy button.
function CommandLine({ cmd }: { cmd: string }) {
  return (
    <div
      className="flex items-center gap-2"
      style={{
        padding: "6px 9px",
        background: "var(--panel-3)",
        border: "1px solid var(--border-2)",
        borderRadius: 7,
      }}
    >
      <code
        className="mono"
        style={{
          flex: 1,
          fontSize: 10.5,
          color: "var(--fg-2)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {cmd}
      </code>
      <CopyButton text={cmd} />
    </div>
  );
}

// ScriptBlock renders a multi-line, copy-paste setup script with a copy button.
// Unlike CommandLine it preserves newlines and does NOT break-all (so indentation
// and line structure stay readable). Themed with --* tokens only.
function ScriptBlock({ text }: { text: string }) {
  return (
    <div
      className="flex flex-col"
      style={{
        background: "var(--panel-3)",
        border: "1px solid var(--border-2)",
        borderRadius: 7,
      }}
    >
      <div className="flex justify-end" style={{ padding: "6px 8px 0 8px" }}>
        <CopyButton text={text} />
      </div>
      <pre
        className="mono"
        style={{
          margin: 0,
          padding: "4px 8px 8px 8px",
          fontSize: 10.5,
          color: "var(--fg-2)",
          whiteSpace: "pre",
          overflowX: "auto",
          lineHeight: 1.5,
        }}
      >
        {text}
      </pre>
    </div>
  );
}

// InstallCard wraps an OS switch + a list of steps (note / link / command) inside
// a themed surface. Used for both the Whisper and Kokoro setup blocks.
function InstallCard({
  os,
  onOs,
  children,
}: {
  os: OS;
  onOs: (v: OS) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col"
      style={{
        gap: 10,
        padding: 12,
        border: "1px solid var(--border-2)",
        borderRadius: 9,
        background: "var(--panel-2)",
      }}
    >
      <Segmented items={OS_SEGMENTS} value={os} onChange={onOs} />
      {children}
    </div>
  );
}

// AutoStartSection is the collapsible "Auto-start on login (optional)" block shown
// inside each install card. Collapsed by default so it doesn't bury the primary
// install steps. Renders the per-OS template blocks (notes + copyable code +
// links) for the currently-selected OS. Themed with --* tokens only.
function AutoStartSection({
  os,
  blocks,
  extra,
}: {
  os: OS;
  // Either a flat list (same on every OS) or a per-OS record.
  blocks: AutoStartBlock[] | Record<OS, AutoStartBlock[]>;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const osBlocks = Array.isArray(blocks) ? blocks : blocks[os];
  const hasScript = osBlocks.some((b) => b.kind === "script");
  return (
    <div
      className="flex flex-col"
      style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-left"
        style={{ color: "var(--fg-2)", fontSize: 11, cursor: "pointer", background: "transparent" }}
      >
        {open ? "▾" : "▸"} Auto-start on login (optional)
      </button>
      {open && (
        <div className="flex flex-col" style={{ gap: 8 }}>
          <span style={{ fontSize: 10.5, color: "var(--fg-4)", lineHeight: 1.45 }}>
            {hasScript ? (
              <>
                Without this, the server stops when you reboot. <b>Set it up automatically — paste
                this into a terminal (make sure the server is running first):</b> the script detects
                the running server, then writes and registers the auto-start service for you. Nothing
                to edit.
              </>
            ) : (
              "Without this, the server stops when you reboot."
            )}
          </span>
          {extra}
          {osBlocks.map((b, i) => {
            if (b.kind === "script") return <ScriptBlock key={i} text={b.text} />;
            if (b.kind === "code") return <CommandLine key={i} cmd={b.text} />;
            if (b.kind === "link")
              return (
                <a
                  key={i}
                  href={b.href}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 10.5, color: "var(--accent)" }}
                >
                  {b.label}
                </a>
              );
            return (
              <span
                key={i}
                style={{
                  fontSize: 10.5,
                  color: b.kind === "muted" ? "var(--fg-4)" : "var(--fg-2)",
                  lineHeight: 1.45,
                }}
              >
                {b.text}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VoiceTab({ config, update }: TabProps) {
  // Hydrate from config, falling back to defaults so the tab renders sensibly
  // for a brand-new / legacy config without a voice sub-object. Voice is
  // local-only now, so the provider is pinned to "local" — this normalizes any
  // legacy "auto"/"cloud" value to local on the next save.
  const voice: VoiceConfig = { ...VOICE_DEFAULTS, ...(config.voice ?? {}), provider: "local" };

  // The DTO masks the stored key: config.voice.apiKey is never populated from
  // Go-side; config.voice.hasApiKey reports whether one is saved. We keep the
  // typed-but-unsaved key in local state and only send it on commit. An empty
  // submit preserves the stored key (handled Go-side in SaveConfig).
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  const [testState, setTestState] = useState<"idle" | "playing" | "ok" | "error">("idle");
  const [testMsg, setTestMsg] = useState<string>("");

  // Install-card OS tab, seeded from the detected platform.
  const [whisperOs, setWhisperOs] = useState<OS>(() => getOS());
  const [kokoroOs, setKokoroOs] = useState<OS>(() => getOS());
  // Kokoro install method: default to the native bash scripts on macOS/Linux
  // (they can run them) and Docker on Windows (the start scripts are bash).
  const [kokoroMethod, setKokoroMethod] = useState<InstallMethod>(() =>
    getOS() === "windows" ? "docker" : "native",
  );

  // Advanced (cloud/escape-hatch) section is collapsed by default in the
  // local-first flow.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Per-engine connection-probe state, driving the status chips + inline detail
  // lines. "untested" until a ping runs.
  const [sttPing, setSttPing] = useState<{ state: "untested" | "pending" | "ok" | "fail"; detail: string }>({
    state: "untested",
    detail: "",
  });
  const [ttsPing, setTtsPing] = useState<{ state: "untested" | "pending" | "ok" | "fail"; detail: string }>({
    state: "untested",
    detail: "",
  });

  const pingStt = useCallback(async () => {
    setSttPing({ state: "pending", detail: "testing…" });
    const r = await api.pingVoiceEndpoint("stt");
    setSttPing({ state: r.ok ? "ok" : "fail", detail: r.detail });
  }, []);
  const pingTts = useCallback(async () => {
    setTtsPing({ state: "pending", detail: "testing…" });
    const r = await api.pingVoiceEndpoint("tts");
    setTtsPing({ state: r.ok ? "ok" : "fail", detail: r.detail });
  }, []);

  // Best-effort: probe both engines once on mount to seed the chips.
  useEffect(() => {
    void pingStt();
    void pingTts();
  }, [pingStt, pingTts]);

  // Discovered options from the configured server, merged with curated fallbacks
  // for the pick-or-type fields. probeState tracks the last detection result so a
  // small hint can reflect whether the server was reachable.
  const [discoveredVoices, setDiscoveredVoices] = useState<string[]>([]);
  const [discoveredStt, setDiscoveredStt] = useState<string[]>([]);
  const [discoveredTts, setDiscoveredTts] = useState<string[]>([]);
  const [probeState, setProbeState] = useState<"idle" | "probing" | "ok" | "fail">("idle");

  // Probe the configured server for available voices/models. Soft-fails: api.*
  // resolve to [] on error, so on a down/cloud server we simply keep the curated
  // fallbacks and mark the hint as "not reachable".
  const detect = useCallback(async () => {
    setProbeState("probing");
    const [voices, stt, tts] = await Promise.all([
      api.listVoices(),
      api.listModels("stt"),
      api.listModels("tts"),
    ]);
    setDiscoveredVoices(voices);
    setDiscoveredStt(stt);
    setDiscoveredTts(tts);
    const any = voices.length + stt.length + tts.length > 0;
    setProbeState(any ? "ok" : "fail");
  }, []);

  // Probe once when the Voice tab mounts.
  useEffect(() => {
    void detect();
  }, [detect]);

  const voiceOptions = mergeOptions(discoveredVoices, FALLBACK_VOICES);
  const sttOptions = mergeOptions(discoveredStt, FALLBACK_STT_MODELS);
  const ttsOptions = mergeOptions(discoveredTts, FALLBACK_TTS_MODELS);

  function updateVoice<K extends keyof VoiceConfig>(key: K, value: VoiceConfig[K]) {
    update("voice", { ...voice, [key]: value });
  }

  // probeHint renders the tiny themed status line under the discovery fields:
  // count of server-found items (green) or a muted "showing common options".
  function probeHint(count: number) {
    let text: string;
    let color: string;
    if (probeState === "probing") {
      text = "detecting…";
      color = "var(--fg-2)";
    } else if (probeState === "ok" && count > 0) {
      text = `${count} found on your server`;
      color = "var(--ok)";
    } else {
      text = "server not reachable — showing common options";
      color = "var(--fg-4)";
    }
    return (
      <span style={{ fontSize: 10, color, marginTop: 4, display: "block" }}>{text}</span>
    );
  }

  // Surface "not configured" inline. Local needs both STT + TTS URLs (no key
  // required). Cloud/auto needs either a saved key or some configured URL.
  const hasSttUrl = !!(voice.sttBaseUrl?.trim() || voice.baseUrl?.trim());
  const hasTtsUrl = !!(voice.ttsBaseUrl?.trim() || voice.baseUrl?.trim());
  const notConfigured =
    voice.enabled &&
    (voice.provider === "local"
      ? !hasSttUrl || !hasTtsUrl
      : !voice.hasApiKey && !hasSttUrl && !hasTtsUrl);

  function commitApiKey() {
    // Only send when the user actually typed something; an empty field leaves
    // the stored key untouched (Go-side preserves it on an empty incoming key).
    if (apiKeyDraft.length === 0) return;
    update("voice", { ...voice, apiKey: apiKeyDraft, hasApiKey: true });
    setApiKeyDraft("");
  }

  async function testVoice() {
    setTestState("playing");
    setTestMsg("synthesizing…");
    try {
      const res = await api.synthesize("Voice is working.", voice.voice || "", voice.speed || 0);
      const audio = new Audio(`data:${res.contentType || "audio/mpeg"};base64,${res.audioB64}`);
      audio.onended = () => { setTestState("ok"); setTestMsg("played ✓"); };
      audio.onerror = () => { setTestState("error"); setTestMsg("playback failed"); };
      await audio.play();
      setTestState("ok");
      setTestMsg("playing ✓");
    } catch (err) {
      setTestState("error");
      setTestMsg(String(err instanceof Error ? err.message : err));
    }
  }

  // pingDetailLine renders the small green/red inline detail under a Test button.
  function pingDetailLine(p: { state: "untested" | "pending" | "ok" | "fail"; detail: string }) {
    if (p.state === "untested") return null;
    const color = pingStateColor(p.state);
    return <span style={{ fontSize: 10, color, marginTop: 4, display: "block" }}>{p.detail}</span>;
  }

  return (
    <>
      <Section
        title="voice"
        description="talk to a session hands-free; it talks back. STT/TTS run as local self-hosted engines through a Go proxy — private, zero-cost, no api key."
      >
        <SettingRow
          label="enable voice"
          description="turn on the voice pane toggle in the session header"
          right={<Toggle checked={voice.enabled} onChange={(v) => updateVoice("enabled", v)} />}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px 13px", flexWrap: "wrap" }}>
          <StatusChip label="STT" state={sttPing.state === "pending" ? "untested" : sttPing.state} />
          <StatusChip label="TTS" state={ttsPing.state === "pending" ? "untested" : ttsPing.state} />
        </div>
        {notConfigured && (
          <div
            style={{
              margin: "0 16px 14px",
              padding: "8px 10px",
              border: "1px solid color-mix(in srgb, var(--warn) 45%, var(--border))",
              borderRadius: 8,
              background: "var(--panel-3)",
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            <span style={{ color: "var(--warn)", fontWeight: 700 }}>voice not configured — </span>
            <span style={{ color: "var(--fg-2)" }}>
              set up the two engines below (Whisper for speech-to-text, Kokoro for text-to-speech), then hit Test connection on each.
            </span>
          </div>
        )}
      </Section>

      <Section
        title="voice persona"
        description="optional — add your own instructions for how quant should behave when talking (role, tone, what to focus on). Appended to the built-in voice behavior."
      >
        <div style={{ padding: 14 }}>
          <textarea
            value={voice.instructions}
            onChange={(e) => updateVoice("instructions", e.target.value)}
            placeholder="e.g. You are a concise pair-programming buddy. Be casual, keep replies under ~15 seconds, and always confirm before running commands."
            spellCheck={false}
            className="mono"
            style={{
              width: "100%",
              minHeight: 90,
              resize: "vertical",
              boxSizing: "border-box",
              padding: 10,
              borderRadius: 9,
              background: "var(--panel-3)",
              border: "1px solid var(--border-2)",
              color: "var(--fg)",
              fontSize: 12,
              lineHeight: 1.5,
              outline: "none",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-2)")}
          />
        </div>
      </Section>

      <Section
        title="speech-to-text (Whisper)"
        description="whisper.cpp runs a local OpenAI-compatible STT server on port 2022 — no api key, fully private"
      >
        <div style={{ padding: 14 }}>
        <InstallCard os={whisperOs} onOs={setWhisperOs}>
          {WHISPER_STEPS[whisperOs].map((step, i) => (
            <div key={i} className="flex flex-col" style={{ gap: 4 }}>
              {step.note && (
                <span style={{ fontSize: 10.5, color: "var(--fg-2)" }}>{step.note}</span>
              )}
              {step.cmd && <CommandLine cmd={step.cmd} />}
              {step.link && (
                <a
                  href={step.link.href}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 10.5, color: "var(--accent)" }}
                >
                  {step.link.label}
                </a>
              )}
            </div>
          ))}
          <a
            href={WHISPER_HELP}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 10.5, color: "var(--accent)" }}
          >
            whisper.cpp docs →
          </a>
          <AutoStartSection os={whisperOs} blocks={WHISPER_AUTOSTART} />
        </InstallCard>
        </div>

        <SettingRow
          label="STT (Whisper) URL"
          description="speech-to-text endpoint · default http://localhost:2022"
          right={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div className="flex items-center gap-2">
                <TextInput
                  value={voice.sttBaseUrl}
                  onChange={(v) => updateVoice("sttBaseUrl", v)}
                  width={240}
                  placeholder="http://localhost:2022"
                />
                <SmallButton
                  label={sttPing.state === "pending" ? "…" : "test connection"}
                  onClick={() => void pingStt()}
                  disabled={sttPing.state === "pending"}
                />
              </div>
              {pingDetailLine(sttPing)}
            </div>
          }
        />
        <SettingRow
          label="stt model"
          description="speech-to-text model (transcription) · pick from your server or type your own"
          right={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div className="flex items-center gap-2">
                <ComboInput
                  value={voice.sttModel}
                  onChange={(v) => updateVoice("sttModel", v)}
                  width={200}
                  placeholder="whisper-1"
                  options={sttOptions}
                  listId="voice-stt-models"
                />
                <SmallButton
                  label={probeState === "probing" ? "…" : "↻ detect"}
                  onClick={() => void detect()}
                  disabled={probeState === "probing"}
                />
              </div>
              {probeHint(discoveredStt.length)}
            </div>
          }
        />
      </Section>

      <Section
        title="text-to-speech (Kokoro)"
        description="kokoro-fastapi runs a local OpenAI-compatible TTS server on port 8880 — no api key"
      >
        <div style={{ padding: 14 }}>
        <InstallCard os={kokoroOs} onOs={setKokoroOs}>
          <Segmented items={METHOD_SEGMENTS} value={kokoroMethod} onChange={setKokoroMethod} />
          {kokoroMethod === "native" ? (
            <>
              <span style={{ fontSize: 10.5, color: "var(--fg-2)" }}>
                Needs the{" "}
                <a href={UV_INSTALL} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  uv package manager →
                </a>{" "}
                (the start script installs deps + auto-downloads the model). Clone the repo:
              </span>
              <CommandLine cmd={KOKORO_CLONE_CMD} />
              <span style={{ fontSize: 10.5, color: "var(--fg-2)" }}>
                then start the TTS server (keep it running):
              </span>
              <CommandLine cmd={KOKORO_NATIVE_SCRIPT[kokoroOs].cmd} />
              <span style={{ fontSize: 10.5, color: "var(--fg-4)" }}>
                {KOKORO_NATIVE_SCRIPT[kokoroOs].note}
              </span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 10.5, color: "var(--fg-2)" }}>
                Docker is required.{" "}
                {kokoroOs === "linux" ? (
                  <a href={DOCKER_ENGINE} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                    install Docker Engine →
                  </a>
                ) : (
                  <a href={DOCKER_DESKTOP} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                    install Docker Desktop →
                  </a>
                )}
              </span>
              <span style={{ fontSize: 10.5, color: "var(--fg-2)" }}>
                then start the TTS server (the <code style={{ fontFamily: font }}>--restart</code> flag brings it back after reboot):
              </span>
              <CommandLine cmd={KOKORO_RUN_CMD_DURABLE} />
            </>
          )}
          <a href={KOKORO_HELP} target="_blank" rel="noreferrer" style={{ fontSize: 10.5, color: "var(--accent)" }}>
            kokoro-fastapi docs →
          </a>
          {kokoroMethod === "docker" ? (
            <AutoStartSection os={kokoroOs} blocks={KOKORO_DOCKER_BLOCKS} />
          ) : (
            <AutoStartSection os={kokoroOs} blocks={KOKORO_AUTOSTART} />
          )}
        </InstallCard>
        </div>

        <SettingRow
          label="TTS (Kokoro) URL"
          description="text-to-speech endpoint · default http://localhost:8880"
          right={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div className="flex items-center gap-2">
                <TextInput
                  value={voice.ttsBaseUrl}
                  onChange={(v) => updateVoice("ttsBaseUrl", v)}
                  width={240}
                  placeholder="http://localhost:8880"
                />
                <SmallButton
                  label={ttsPing.state === "pending" ? "…" : "test connection"}
                  onClick={() => void pingTts()}
                  disabled={ttsPing.state === "pending"}
                />
              </div>
              {pingDetailLine(ttsPing)}
            </div>
          }
        />
        <SettingRow
          label="tts model"
          description="text-to-speech model (synthesis) · pick from your server or type your own"
          right={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <ComboInput
                value={voice.ttsModel}
                onChange={(v) => updateVoice("ttsModel", v)}
                width={200}
                placeholder="kokoro"
                options={ttsOptions}
                listId="voice-tts-models"
              />
              {probeHint(discoveredTts.length)}
            </div>
          }
        />
        <SettingRow
          label="voice"
          description="the spoken voice name (default am_onyx) · pick from your server or type your own"
          right={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <ComboInput
                value={voice.voice}
                onChange={(v) => updateVoice("voice", v)}
                width={200}
                placeholder="am_onyx"
                options={voiceOptions}
                listId="voice-voices"
              />
              {probeHint(discoveredVoices.length)}
            </div>
          }
        />
        <SettingRow
          label="speed"
          description="playback rate, 0.5–2.0 (default 1.2)"
          right={
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={voice.speed}
                onChange={(e) => updateVoice("speed", parseFloat(e.target.value))}
                style={{ width: 160, accentColor: "var(--accent)" }}
              />
              <span style={{ color: "var(--fg)", fontSize: 12, width: 32 }}>{voice.speed.toFixed(1)}x</span>
            </div>
          }
        />
        <SettingRow
          label="pause before reply"
          description="how long you can pause mid-sentence before quant replies — raise it if you get cut off while thinking (default 3.0s)"
          right={
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={500}
                max={6000}
                step={250}
                value={voice.pauseMs}
                onChange={(e) => updateVoice("pauseMs", parseInt(e.target.value, 10))}
                style={{ width: 160, accentColor: "var(--accent)" }}
              />
              <span style={{ color: "var(--fg)", fontSize: 12, width: 32 }}>{(voice.pauseMs / 1000).toFixed(1)}s</span>
            </div>
          }
        />
        <SettingRow
          label="test voice"
          description="speaks “Voice is working.” using the current voice + speed"
          right={
            <div className="flex items-center gap-3">
              <SmallButton
                label={testState === "playing" ? "…" : "test voice"}
                onClick={testVoice}
                disabled={testState === "playing"}
              />
              {testMsg && (
                <span
                  style={{
                    fontSize: 11,
                    color:
                      testState === "error"
                        ? "var(--danger)"
                        : testState === "ok"
                        ? "var(--ok)"
                        : "var(--fg-2)",
                  }}
                >
                  {testMsg}
                </span>
              )}
            </div>
          }
        />
      </Section>

      <Section
        title="advanced — optional overrides"
        description="escape hatches — most users never need these"
      >
        <button
          onClick={() => setAdvancedOpen((o) => !o)}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", color: "var(--fg-2)", fontSize: 11.5, cursor: "pointer", background: "transparent", border: "none", textAlign: "left", padding: "13px 16px", borderBottom: advancedOpen ? "1px solid var(--border-2)" : "none" }}
        >
          <Icon name={advancedOpen ? "chevronDown" : "chevronRight"} size={13} color="var(--fg-3)" />
          {advancedOpen ? "hide advanced settings" : "show advanced settings"}
        </button>
        {advancedOpen && (
          <>
            <SettingRow
              label="base url (legacy)"
              description="optional — a single shared URL used for BOTH STT and TTS when the per-engine URLs above are blank. Leave empty if you set the two URLs above."
              right={
                <TextInput
                  value={voice.baseUrl}
                  onChange={(v) => updateVoice("baseUrl", v)}
                  width={280}
                  placeholder="(none)"
                />
              }
            />
            <SettingRow
              label="api key"
              description={
                voice.hasApiKey
                  ? "a key is saved — type to replace it, or leave blank to keep it"
                  : "optional — only needed if your local server requires an auth token (most don't)."
              }
              right={
                <input
                  type="password"
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  onBlur={commitApiKey}
                  onKeyDown={(e) => { if (e.key === "Enter") commitApiKey(); }}
                  placeholder={voice.hasApiKey ? "•••• saved" : "(none)"}
                  className="mono"
                  style={{
                    width: 280,
                    height: 32,
                    padding: "0 10px",
                    borderRadius: 8,
                    boxSizing: "border-box",
                    outline: "none",
                    background: "var(--panel-3)",
                    border: "1px solid var(--border-2)",
                    color: "var(--fg)",
                    fontSize: 12,
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                  onBlurCapture={(e) => (e.currentTarget.style.borderColor = "var(--border-2)")}
                />
              }
            />
          </>
        )}
      </Section>
    </>
  );
}
