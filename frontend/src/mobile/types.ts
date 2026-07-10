import type { ReactNode } from "react";
import type { Repo, Task, Session, Workspace } from "../types";

/** The five bottom-bar destinations. "more" opens a sheet, not a body view. */
export type MobileTab = "chat" | "terminal" | "crew" | "jobs" | "more";

/** Host actions the drawer / sheets ask the App to perform. */
export type MobileAction =
  | "newRepo"
  | "newSession"
  | "renameSession"
  | "archiveSession"
  | "deleteSession";

/**
 * MobileAppBag — the minimal contract MobileShell needs from the host App.
 *
 * The orchestrator (which owns App.tsx) constructs this from real App state and
 * renders `<MobileShell app={bag} />`. It mirrors the design prototype's
 * `mobileApp` bag but is typed against the REAL types in src/types.ts.
 *
 * Anything a reused desktop view already loads itself is NOT in the bag; instead
 * those views are injected via the optional `render*` slots below so the host
 * can wire their real (heavy) prop signatures. When a slot is omitted the shell
 * falls back to a self-contained scripted view so the module renders and
 * typechecks stand-alone.
 *
 * NOTE on theme: the "More" tab reads theme/accent/density directly from the
 * app's `useTheme()` hook (it is self-loading), so `t` / `setTweak` from the
 * prototype are intentionally NOT in the bag — MobileShell is rendered inside
 * the existing <ThemeProvider>.
 */
export interface MobileAppBag {
  /** Open (non-closed) repos. The drawer joins these to tasks/sessions. */
  repos: Repo[];
  /** All tasks; joined to repos by `repoId` for the drawer tree. */
  tasks: Task[];
  /** All sessions; joined to tasks/repos by `taskId`/`repoId` for the tree. */
  sessions: Session[];
  /** id of the session currently focused in the host app, or null. */
  activeSessionId: string | null;

  /** Real crew worker count for the active supervisor (0 = no badge). */
  crewBadge?: number;
  /** All workspaces, for the mobile workspace switcher in the More sheet. */
  workspaces: Workspace[];
  /** id of the currently active workspace. */
  activeWorkspaceId: string;
  /** Switch the active workspace (mirrors the desktop switcher). */
  onSwitchWorkspace: (id: string) => void;
  /** True once a voice session is attached — drives the real orb in the mini-player. */
  voiceActive?: boolean;

  /** Host action dispatcher (new repo/session, rename/archive/delete session). */
  onAction: (action: MobileAction, payload?: Record<string, unknown>) => void;
  /** Focus/open a session by id in the host app. */
  openSession: (sessionId: string) => void;
  /** Kick off the host's new-session flow. */
  newSession: () => void;
  /** Open the host command palette. */
  openPalette: () => void;
  /** Open the host settings surface. */
  openSettings: () => void;

  // ---- Optional render slots: inject the REAL prop-wired desktop views. ----
  // e.g. renderChat={() => <TerminalPane session={active} .../>}
  /** Chat tab body (the active claude session PTY, e.g. <TerminalPane/>). */
  renderChat?: () => ReactNode;
  /** Terminal tab body (a separate embedded-terminal <TerminalPane/>). */
  renderTerminal?: () => ReactNode;
  /** Crew tab body (<CrewPane supervisor=… workers=… />). */
  renderCrew?: () => ReactNode;
  /** Jobs tab body (<JobsView jobs=… agents=… />). */
  renderJobs?: () => ReactNode;
  /** Files sheet body (<FilesPanel session=… />). */
  renderFiles?: () => ReactNode;
  /** Mindmap sheet body. If omitted, <MindmapPane/> is rendered for the active session. */
  renderMindmap?: () => ReactNode;
  /** Agents sheet body (<AgentsView agents=… />). */
  renderAgents?: () => ReactNode;
  /**
   * Full-screen voice sheet body — the REAL desktop voice pipeline
   * (<VoicePane sessionId=… />: audio service + voice bridge + live orb/transcript).
   * When provided, the shell renders it full-bleed inside the voice sheet instead
   * of the self-contained scripted turn machine. Return null when there's no valid
   * session so the scripted fallback shows.
   */
  renderVoice?: () => ReactNode;
  /**
   * Pin the currently active session as the voice session (mirrors the desktop
   * attach-voice handler). Called when the user taps the mic / expands the voice
   * sheet, so `renderVoice`'s <VoicePane/> mounts onto a valid session.
   */
  onStartVoice?: () => void;
}
