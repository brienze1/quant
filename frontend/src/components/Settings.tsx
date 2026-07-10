import { useCallback, useEffect, useRef, useState } from "react";
import type { Config, Repo, Shortcut, RemoteStatus, UpdateInfo } from "../types";
import * as api from "../api";
import type { VoiceConfig, VoiceRuntimeStatus, VoiceRuntimeEvent } from "../types";
import { ThemeSettings } from "./ThemeSettings";
import { KeybindingsTab } from "./KeybindingsTab";
import { isMac } from "../os";
import { Icon, type IconName } from "./Icon";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { useIsMobile } from "../mobile/useIsMobile";

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
  const isMobile = useIsMobile();
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
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", background: "var(--bg)", ...(isMobile ? ({ flexDirection: "column" } as React.CSSProperties) : {}) }}>
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
          ...(isMobile
            ? ({ width: "100%", borderRight: "none", borderBottom: "1px solid var(--border)" } as React.CSSProperties)
            : {}),
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
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 10,
            ...(isMobile
              ? ({
                  flex: "none",
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  height: 52,
                  padding: "6px 10px",
                  overflowY: "hidden",
                  overflowX: "auto",
                  whiteSpace: "nowrap",
                } as React.CSSProperties)
              : {}),
          }}
        >
          {VISIBLE_NAV_ITEMS.map((item) => (
            <NavItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              active={tab === item.key}
              mobile={isMobile}
              onClick={() => setTab(item.key)}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", ...(isMobile ? ({ minHeight: 0 } as React.CSSProperties) : {}) }}>
        {/* Sticky header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            height: 56,
            padding: isMobile ? "0 16px" : "0 32px",
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
        <div style={{ maxWidth: 880, padding: "28px 32px 60px", ...(isMobile ? ({ maxWidth: "none", width: "100%", boxSizing: "border-box", padding: "16px 14px 60px" } as React.CSSProperties) : {}) }}>
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

function NavItem({ icon, label, active, onClick, mobile }: { icon: IconName; label: string; active: boolean; onClick: () => void; mobile?: boolean }) {
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
        ...(mobile ? ({ width: "auto", flex: "none", gap: 7, whiteSpace: "nowrap" } as React.CSSProperties) : {}),
      }}
    >
      <Icon name={icon} size={15} color={active ? "var(--accent)" : "var(--fg-3)"} />
      {label}
    </button>
  );
}

// --- Tab Components ---

type UpdateState = "idle" | "checking" | "uptodate" | "available" | "updating" | "updated" | "error";

// UpdateChecker drives the manual update flow: check GitHub for a newer release,
// upgrade via Homebrew on demand, then offer a restart to apply it.
function UpdateChecker() {
  const [state, setState] = useState<UpdateState>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [message, setMessage] = useState("");

  const check = useCallback(async () => {
    setState("checking");
    setMessage("");
    try {
      const result = await api.checkForUpdate();
      setInfo(result);
      setState(result.updateAvailable ? "available" : "uptodate");
    } catch (err) {
      setMessage(String(err));
      setState("error");
    }
  }, []);

  const doUpdate = useCallback(async () => {
    setState("updating");
    setMessage("");
    try {
      await api.performUpdate();
      setState("updated");
    } catch (err) {
      setMessage(String(err));
      setState("error");
    }
  }, []);

  const restart = useCallback(async () => {
    try {
      await api.restartApp();
    } catch (err) {
      setMessage(String(err));
      setState("error");
    }
  }, []);

  let description: string;
  switch (state) {
    case "checking":
      description = "checking for updates…";
      break;
    case "uptodate":
      description = `you're on the latest version (${info?.currentVersion ?? ""})`;
      break;
    case "available":
      description = `version ${info?.latestVersion} is available — you're on ${info?.currentVersion}`;
      break;
    case "updating":
      description = "updating via homebrew — this can take a few minutes, don't quit quant";
      break;
    case "updated":
      description = "update installed — restart quant to apply the new version";
      break;
    case "error":
      description = `error: ${message || "something went wrong"}`;
      break;
    default:
      description = "check whether a newer version of quant is available";
  }

  let right: React.ReactNode;
  switch (state) {
    case "available":
      right = <Button variant="primary" size="sm" onClick={doUpdate}>update now</Button>;
      break;
    case "updating":
      right = <SmallButton label="updating…" onClick={() => {}} disabled />;
      break;
    case "updated":
      right = <Button variant="primary" size="sm" onClick={restart}>restart now</Button>;
      break;
    case "checking":
      right = <SmallButton label="checking…" onClick={() => {}} disabled />;
      break;
    default:
      right = <SmallButton label="check now" onClick={check} />;
  }

  return <SettingRow label="software updates" description={description} right={right} />;
}

function GeneralTab({ config, update }: TabProps) {
  const isMobile = useIsMobile();
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
        <UpdateChecker />
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
        <div style={{ display: "flex", gap: 8, padding: 14, ...(isMobile ? ({ flexDirection: "column", alignItems: "stretch" } as React.CSSProperties) : {}) }}>
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
              ...(isMobile ? ({ width: "100%", maxWidth: "100%", fontSize: 16 } as React.CSSProperties) : {}),
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
              ...(isMobile ? ({ width: "100%", maxWidth: "100%", fontSize: 16 } as React.CSSProperties) : {}),
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
  const isMobile = useIsMobile();
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, ...(isMobile ? ({ flexDirection: "column", alignItems: "stretch" } as React.CSSProperties) : {}) }}>
            <div ref={repoDropdownRef} style={{ position: "relative", width: 200, ...(isMobile ? ({ width: "100%" } as React.CSSProperties) : {}) }}>
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
                  ...(isMobile ? ({ width: "100%", maxWidth: "100%", fontSize: 16 } as React.CSSProperties) : {}),
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
  const isMobile = useIsMobile();
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
        <div key={k} style={{ display: "flex", height: 36, borderBottom: "1px solid var(--border-2)", ...(isMobile ? ({ flexDirection: "column", height: "auto", alignItems: "stretch", padding: "8px 0" } as React.CSSProperties) : {}) }}>
          <div className="mono" style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 11, color: "var(--fg)", wordBreak: "break-all", ...(isMobile ? ({ flex: "none", width: "100%", boxSizing: "border-box", minHeight: 26 } as React.CSSProperties) : {}) }}>{k}</div>
          <div className="mono" style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 12px", fontSize: 11, color: "var(--accent)", wordBreak: "break-all", ...(isMobile ? ({ flex: "none", width: "100%", boxSizing: "border-box", minHeight: 26 } as React.CSSProperties) : {}) }}>{v}</div>
          <div style={{ width: 60, display: "flex", alignItems: "center", justifyContent: "center", ...(isMobile ? ({ width: "100%", justifyContent: "flex-start", padding: "0 12px" } as React.CSSProperties) : {}) }}>
            <button onClick={() => onRemove(k)} style={{ color: "var(--danger)", fontSize: 12, fontWeight: 700, background: "none", border: "none", cursor: "pointer" }}>{isMobile ? "x remove" : "x"}</button>
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
  const isMobile = useIsMobile();
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
              ...(isMobile ? ({ fontSize: 16 } as React.CSSProperties) : {}),
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, ...(isMobile ? ({ flexDirection: "column", alignItems: "stretch" } as React.CSSProperties) : {}) }}>
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

// DownloadButton is the prominent accent-filled CTA used by the one-click voice
// install flow (contrast with the muted, outlined SmallButton).
function DownloadButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mono"
      style={{
        height: 34,
        padding: "0 16px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--accent-fg, #fff)",
        border: "1px solid var(--accent)",
        background: "var(--accent)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
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
  const isMobile = useIsMobile();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 16px", borderBottom: "1px solid var(--border-2)", ...(isMobile ? ({ flexDirection: "column", alignItems: "stretch", gap: 10 } as React.CSSProperties) : {}) }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)", letterSpacing: "-0.01em" }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2, lineHeight: 1.4 }}>{description}</div>
      </div>
      <div style={{ flex: "none", ...(isMobile ? ({ width: "100%" } as React.CSSProperties) : {}) }}>{right}</div>
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
  const isMobile = useIsMobile();
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
        ...(isMobile ? ({ width: "100%", maxWidth: "100%", fontSize: 16 } as React.CSSProperties) : {}),
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
  const isMobile = useIsMobile();
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
          ...(isMobile ? ({ width: "100%", maxWidth: "100%", fontSize: 16 } as React.CSSProperties) : {}),
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
  const isMobile = useIsMobile();
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
        ...(isMobile ? ({ width: "100%", maxWidth: "100%", fontSize: 16 } as React.CSSProperties) : {}),
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
  const isMobile = useIsMobile();
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
        ...(isMobile ? ({ width: "100%", maxWidth: "100%", fontSize: 16 } as React.CSSProperties) : {}),
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
  const isMobile = useIsMobile();
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
        ...(isMobile ? ({ width: "100%", maxWidth: "100%", boxSizing: "border-box", fontSize: 16 } as React.CSSProperties) : {}),
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

// Sensible defaults for a fresh config. Voice runs on the embedded local
// runtime, so there is nothing to point at or install by hand — one click
// downloads the speech models. These also guard against an older persisted
// config that predates the voice sub-object.
const VOICE_DEFAULTS: VoiceConfig = {
  enabled: false,
  provider: "local",
  language: "en",
  voice: "af_heart",
  speed: 1.2,
  langVoices: {
    en: { voice: "af_heart", speed: 1.2 },
    "pt-br": { voice: "pf_dora", speed: 1.2 },
  },
  pauseMs: 3000,
  instructions: "",
  muteSoundCues: false,
};

// Curated fallback speaker names (the bundled Kokoro voice model's English
// speakers) shown in the voice picker when the runtime can't be probed (not
// installed yet). Runtime-discovered voices are merged ahead of these,
// de-duplicated, so the dropdown is never empty.
const FALLBACK_VOICES = [
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore",
  "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam",
  "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx",
  "am_puck", "am_santa", "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
  "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
];

// Curated fallback speakers for Brazilian Portuguese (the Kokoro model's pt-br
// speakers). Shown ahead of the English list when the pt-br language is selected.
const PT_FALLBACK_VOICES = ["pf_dora", "pm_alex", "pm_santa"];

// Per-language default voice, used to seed a language's config the first time
// it's edited (pt-br → pf_dora, en → af_heart).
const VOICE_LANG_DEFAULTS: Record<VoiceConfig["language"], string> = {
  en: "af_heart",
  "pt-br": "pf_dora",
};
const DEFAULT_SPEED = 1.2;

// mergeOptions puts runtime-discovered values first, then curated fallbacks,
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

// SegmentedControl is a compact two-or-more-option pill selector (used by the
// voice language toggle). Styled with the same tokens as the neighboring
// controls; the active option is filled with the accent.
function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="mono"
      style={{
        display: "inline-flex",
        padding: 2,
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--panel-2)",
        gap: 2,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => { if (!active) onChange(opt.value); }}
            style={{
              height: 28,
              padding: "0 12px",
              borderRadius: 6,
              fontSize: 11,
              border: "none",
              cursor: active ? "default" : "pointer",
              color: active ? "var(--accent-fg, #fff)" : "var(--fg-3)",
              background: active ? "var(--accent)" : "transparent",
              fontWeight: active ? 600 : 400,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// pingStateColor maps the readiness-probe state to its themed color: ok →
// green, fail → error, anything else (untested/pending) → muted neutral.
// Shared by the StatusChip pill so states stay consistent.
function pingStateColor(state: "untested" | "pending" | "ok" | "fail"): string {
  return state === "ok" ? "var(--ok)" : state === "fail" ? "var(--danger)" : "var(--fg-4)";
}

// StatusChip renders the single "voice · ready / not installed" pill whose dot
// + label color reflect the readiness probe. Themed with --* tokens only.
function StatusChip({ label, state }: { label: string; state: "untested" | "ok" | "fail" }) {
  const color = pingStateColor(state);
  const text = state === "ok" ? "ready" : state === "fail" ? "not installed" : "checking…";
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

// formatBytes renders a model size as a compact human-readable string.
function formatBytes(n: number): string {
  if (!n || n <= 0) return "";
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function VoiceTab({ config, update }: TabProps) {
  const isMobile = useIsMobile();
  // Hydrate from config, falling back to defaults so the tab renders sensibly
  // for a brand-new / legacy config without a voice sub-object. Voice is
  // local-only, so the provider is pinned to "local" — this normalizes any
  // legacy value on the next save.
  const voice: VoiceConfig = { ...VOICE_DEFAULTS, ...(config.voice ?? {}), provider: "local" };

  const [testState, setTestState] = useState<"idle" | "playing" | "ok" | "error">("idle");
  const [testMsg, setTestMsg] = useState<string>("");

  // Single readiness probe driving the "voice · ready / not installed" chip.
  // The op argument is ignored backend-side; one ping covers the whole runtime.
  const [ready, setReady] = useState<{ state: "untested" | "pending" | "ok" | "fail"; detail: string }>({
    state: "untested",
    detail: "",
  });
  const pingReadiness = useCallback(async () => {
    setReady({ state: "pending", detail: "checking…" });
    const r = await api.pingVoiceEndpoint("stt");
    setReady({ state: r.ok ? "ok" : "fail", detail: r.detail });
  }, []);

  // Microphone permission: queried on mount where the Permissions API supports
  // it, and requestable explicitly so the OS prompt happens here in Settings
  // instead of surprising the user mid-session.
  const [micState, setMicState] = useState<"unknown" | "prompt" | "granted" | "denied">("unknown");
  const [micMsg, setMicMsg] = useState<string>("");
  useEffect(() => {
    let status: PermissionStatus | null = null;
    void (async () => {
      try {
        status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        setMicState(status.state);
        status.onchange = () => { if (status) setMicState(status.state); };
      } catch {
        /* Permissions API can't report the mic here (older WebKit) — leave "unknown". */
      }
    })();
    return () => { if (status) status.onchange = null; };
  }, []);
  async function requestMic() {
    setMicMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicState("granted");
      setMicMsg("access granted ✓");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setMicState("denied");
        setMicMsg("denied — allow quant under System Settings → Privacy & Security → Microphone, then try again");
      } else if (name === "NotFoundError") {
        setMicMsg("no microphone found");
      } else {
        setMicMsg(String(err instanceof Error ? err.message : err));
      }
    }
  }

  // Voices discovered from the installed runtime (the Kokoro model's speaker
  // names), merged ahead of the curated fallbacks in the picker. Soft-fails to
  // [] when the runtime isn't installed, so the fallback list is used.
  const [discoveredVoices, setDiscoveredVoices] = useState<string[]>([]);
  // Discover only the SELECTED language's voices so the picker is
  // language-appropriate (English speakers for "en", pt-br speakers for "pt-br").
  const loadVoices = useCallback(async () => {
    setDiscoveredVoices(await api.listVoices(voice.language));
  }, [voice.language]);

  // Best-effort: discover voices once on mount.
  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  // Re-probe readiness whenever the selected language changes (and on mount).
  // The backend ping reflects the SELECTED language, so switching to pt-br while
  // its STT model is missing flips the chip to "not installed", and back.
  useEffect(() => {
    void pingReadiness();
  }, [pingReadiness, voice.language]);

  // --- Managed voice runtime (one-click download) ---
  // runtime = the install/model snapshot from Go; progress = the latest
  // streamed voice:runtime event during an install (null when idle).
  const [runtime, setRuntime] = useState<VoiceRuntimeStatus | null>(null);
  const [progress, setProgress] = useState<VoiceRuntimeEvent | null>(null);

  const refreshRuntime = useCallback(async () => {
    try {
      setRuntime(await api.voiceRuntimeStatus());
    } catch {
      /* controller not bound (e.g. old backend) — leave runtime null */
    }
  }, []);

  useEffect(() => {
    void refreshRuntime();
    // Stream install/lifecycle events; refresh the snapshot (and re-probe
    // readiness + voices) whenever a phase settles.
    const off = api.onVoiceRuntimeEvent((ev) => {
      setProgress(ev);
      if (ev.phase === "ready" || ev.phase === "error" || ev.phase === "idle" || ev.phase === "external" || ev.phase === "down") {
        void refreshRuntime();
        void pingReadiness();
        void loadVoices();
      }
      if (ev.phase === "ready") {
        setProgress(null);
        // The runtime is up — enable voice so the pane toggle appears.
        if (!voice.enabled) updateVoice("enabled", true);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshRuntime, pingReadiness, loadVoices]);

  async function installRuntime() {
    setProgress({ phase: "download", message: "starting…", done: 0, total: 0 });
    try {
      setRuntime(await api.installVoiceRuntime());
    } catch (err) {
      setProgress({ phase: "error", error: String(err instanceof Error ? err.message : err) });
    }
  }

  async function uninstallRuntime() {
    try {
      setRuntime(await api.uninstallVoiceRuntime());
      setProgress(null);
      // Models are gone — flip voice off so the toggle matches reality.
      if (voice.enabled) updateVoice("enabled", false);
      void pingReadiness();
    } catch {
      /* ignore */
    }
  }

  // Voice picker options are language-aware: the selected language's curated
  // speakers come first (merged ahead of runtime-discovered names), so pt-br
  // shows pf_dora/pm_* first and en shows the af_/am_/... list.
  const langFallback = voice.language === "pt-br" ? PT_FALLBACK_VOICES : FALLBACK_VOICES;
  const voiceOptions = mergeOptions(discoveredVoices, langFallback);

  // The voice + speed being edited belong to the SELECTED language. Read them
  // from the per-language store (falling back to that language's defaults) so
  // English and Português each keep their own configuration.
  const langCfg = voice.langVoices?.[voice.language];
  const curVoice = langCfg?.voice || VOICE_LANG_DEFAULTS[voice.language];
  const curSpeed = langCfg?.speed || DEFAULT_SPEED;

  function updateVoice<K extends keyof VoiceConfig>(key: K, value: VoiceConfig[K]) {
    update("voice", { ...voice, [key]: value });
  }

  // Write the selected language's voice/speed into its per-language slot, keeping
  // the top-level Voice/Speed mirrored to the current language for backward compat.
  function setLangVoice(patch: Partial<{ voice: string; speed: number }>) {
    const next = { voice: curVoice, speed: curSpeed, ...patch };
    const nextLangVoices = { ...(voice.langVoices ?? {}), [voice.language]: next };
    update("voice", { ...voice, langVoices: nextLangVoices, voice: next.voice, speed: next.speed });
  }

  // Switch which language is being configured (also the default a session's
  // voice pane opens with). The top-level Voice/Speed mirror snaps to the new
  // language's stored values; each language keeps its own config.
  function changeLanguage(lang: VoiceConfig["language"]) {
    if (lang === voice.language) return;
    const lc = voice.langVoices?.[lang];
    update("voice", {
      ...voice,
      language: lang,
      voice: lc?.voice || VOICE_LANG_DEFAULTS[lang],
      speed: lc?.speed || DEFAULT_SPEED,
    });
  }

  // On-demand PT speech-to-text model: the multilingual Whisper entry in the
  // runtime snapshot. Present when its `installed` flag is set.
  const ptSttModel = (runtime?.models ?? []).find((m) => /multilingual/i.test(m.name));
  const ptSttInstalled = !!ptSttModel?.installed;

  async function installLanguage() {
    setProgress({ phase: "download", message: "starting…", done: 0, total: 0 });
    try {
      setRuntime(await api.installVoiceLanguage("pt-br"));
    } catch (err) {
      setProgress({ phase: "error", error: String(err instanceof Error ? err.message : err) });
    }
  }

  async function testVoice() {
    setTestState("playing");
    setTestMsg("synthesizing…");
    try {
      const phrase = voice.language === "pt-br" ? "A voz está funcionando." : "Voice is working.";
      const res = await api.synthesize(phrase, curVoice || "", curSpeed || 0, voice.language);
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

  // Derived install state for the "voice models" section.
  const activeProgress =
    progress != null &&
    progress.phase !== "ready" &&
    progress.phase !== "error" &&
    progress.phase !== "idle";
  const installing = !!runtime?.installing || activeProgress;
  const installed = !!runtime?.installed;

  function phaseLabel(ev: VoiceRuntimeEvent | null): string {
    if (!ev) return "working…";
    const name = ev.engine ? ` ${ev.engine}` : " voice models";
    switch (ev.phase) {
      case "download": {
        if (ev.total && ev.total > 0) {
          const pct = Math.min(100, Math.round((ev.done ?? 0) / ev.total * 100));
          return `downloading${name} · ${pct}%`;
        }
        return `downloading${name}…`;
      }
      case "verify":
        return `verifying${name}…`;
      case "extract":
        return `installing${name}…`;
      default:
        return ev.message || "working…";
    }
  }
  const progressPct =
    progress?.phase === "download" && progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.done ?? 0) / progress.total * 100))
      : null;

  return (
    <>
      <Section
        title="voice"
        description="talk to a session hands-free; it talks back. speech recognition and speech synthesis run entirely on your machine — private, zero-cost, no api key."
      >
        <SettingRow
          label="enable voice"
          description="turn on the voice pane toggle in the session header"
          right={<Toggle checked={voice.enabled} onChange={(v) => updateVoice("enabled", v)} />}
        />
        <SettingRow
          label="microphone"
          description="grant quant access to your mic (used by voice mode and push-to-talk)"
          right={
            <div className="flex items-center gap-3">
              <SmallButton
                label={micState === "granted" ? "granted ✓" : "request mic access"}
                onClick={() => { void requestMic(); }}
                disabled={micState === "granted"}
              />
              {micMsg && (
                <span
                  style={{
                    fontSize: 11,
                    maxWidth: 320,
                    color: micState === "granted" ? "var(--ok)" : micState === "denied" ? "var(--danger)" : "var(--fg-2)",
                  }}
                >
                  {micMsg}
                </span>
              )}
            </div>
          }
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px 13px", flexWrap: "wrap" }}>
          <StatusChip label="voice" state={ready.state === "pending" ? "untested" : ready.state} />
        </div>
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
              ...(isMobile ? ({ fontSize: 16 } as React.CSSProperties) : {}),
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-2)")}
          />
        </div>
      </Section>

      <Section
        title="voice models"
        description="quant downloads and runs the local speech models for you — no terminal, Docker, or setup. About 330 MB to download (~560 MB on disk); everything stays on your machine."
      >
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {installing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--fg)" }}>{phaseLabel(progress)}</span>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: "var(--panel-3)",
                  overflow: "hidden",
                  border: "1px solid var(--border-2)",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: progressPct != null ? `${progressPct}%` : "40%",
                    background: "var(--accent)",
                    borderRadius: 999,
                    transition: "width 200ms ease",
                    // Indeterminate phases (verify/extract) show a partial bar.
                    opacity: progressPct != null ? 1 : 0.6,
                  }}
                />
              </div>
              <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                keep this window open — the download is about 330 MB and can take a few minutes
              </span>
            </div>
          ) : installed ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Icon name="check" size={14} color="var(--ok)" />
                <span style={{ fontSize: 12, color: "var(--fg)" }}>
                  voice models installed{runtime?.version ? ` · ${runtime.version}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(runtime?.models ?? []).map((m) => (
                  <span
                    key={m.name}
                    style={{
                      fontSize: 10.5,
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: "1px solid var(--border-2)",
                      background: "var(--panel-3)",
                      color: m.installed ? "var(--ok)" : "var(--fg-3)",
                    }}
                  >
                    {m.name} · {m.installed ? formatBytes(m.sizeBytes) || "installed" : "missing"}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <SmallButton label="re-download" onClick={() => void installRuntime()} />
                <SmallButton label="remove" onClick={() => void uninstallRuntime()} />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 11.5, color: "var(--fg-2)", lineHeight: 1.5 }}>
                Press download and quant fetches the speech models + voices (~330 MB, ~560 MB on disk), sets them up, and keeps voice ready — private and zero-cost. No terminal or model picking required.
              </span>
              <div>
                <DownloadButton label="download voice mode" onClick={() => void installRuntime()} />
              </div>
              {progress?.phase === "error" && (
                <span style={{ fontSize: 11, color: "var(--danger)" }}>{progress.error}</span>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section
        title="voice output"
        description="how quant sounds when it talks back"
      >
        <SettingRow
          label="language"
          description="the language you're configuring below (and the one a session's voice mode opens with) · each language keeps its own voice + speed, and you can switch languages live inside a session · English uses the built-in model, Português (BR) downloads an extra speech-recognition model"
          right={
            <SegmentedControl<VoiceConfig["language"]>
              value={voice.language}
              onChange={changeLanguage}
              options={[
                { value: "en", label: "English" },
                { value: "pt-br", label: "Português (BR)" },
              ]}
            />
          }
        />
        {voice.language === "pt-br" && installed && !ptSttInstalled && (
          <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {installing ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--fg)" }}>{phaseLabel(progress)}</span>
                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: "var(--panel-3)",
                    overflow: "hidden",
                    border: "1px solid var(--border-2)",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: progressPct != null ? `${progressPct}%` : "40%",
                      background: "var(--accent)",
                      borderRadius: 999,
                      transition: "width 200ms ease",
                      opacity: progressPct != null ? 1 : 0.6,
                    }}
                  />
                </div>
                <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                  keep this window open — the Portuguese model is about 374 MB and can take a few minutes
                </span>
              </div>
            ) : (
              <>
                <span style={{ fontSize: 11.5, color: "var(--fg-2)", lineHeight: 1.5 }}>
                  Brazilian Portuguese needs an extra speech-recognition model (~374 MB). Download it once and quant sets it up — private and zero-cost, like the base voice models.
                </span>
                <div>
                  <DownloadButton label="download Português (BR) model" onClick={() => void installLanguage()} />
                </div>
                {progress?.phase === "error" && (
                  <span style={{ fontSize: 11, color: "var(--danger)" }}>{progress.error}</span>
                )}
              </>
            )}
          </div>
        )}
        <SettingRow
          label={`voice · ${voice.language === "pt-br" ? "Português (BR)" : "English"}`}
          description={`the spoken voice for ${voice.language === "pt-br" ? "Português (BR)" : "English"} · only ${voice.language === "pt-br" ? "Portuguese" : "English"} voices are shown (default ${VOICE_LANG_DEFAULTS[voice.language]})`}
          right={
            <ComboInput
              value={curVoice}
              onChange={(v) => setLangVoice({ voice: v })}
              width={200}
              placeholder={VOICE_LANG_DEFAULTS[voice.language]}
              options={voiceOptions}
              listId="voice-voices"
            />
          }
        />
        <SettingRow
          label="speed"
          description={`playback rate for ${voice.language === "pt-br" ? "Português (BR)" : "English"}, 0.5–2.0 (default 1.2)`}
          right={
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={curSpeed}
                onChange={(e) => setLangVoice({ speed: parseFloat(e.target.value) })}
                style={{ width: 160, accentColor: "var(--accent)" }}
              />
              <span style={{ color: "var(--fg)", fontSize: 12, width: 32 }}>{curSpeed.toFixed(1)}x</span>
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
          description={`speaks a short ${voice.language === "pt-br" ? "Portuguese" : "English"} phrase using the current voice + speed`}
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
        <SettingRow
          label="sound cues"
          description="play short audio cues on voice-mode transitions (listening, thinking, speaking, ended)"
          right={
            <Toggle
              checked={!voice.muteSoundCues}
              onChange={(v) => updateVoice("muteSoundCues", !v)}
            />
          }
        />
      </Section>
    </>
  );
}
