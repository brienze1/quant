import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "../theme";
import type { Accent } from "../theme/store";
import { MindmapPane } from "../components/MindmapPane";
import "./mobile.css";

import type { MobileAppBag, MobileTab } from "./types";
import { MoTopBar, MoTabBar } from "./Chrome";
import { MoSheet, MoWideWrap } from "./Sheet";
import { MoSessionDrawer } from "./SessionDrawer";
import { MoMoreSheet, type MorePanel } from "./MoreSheet";
import { VoiceMini, VoiceSheet, type TranscriptLine } from "./Voice";
import type { VoiceState } from "./VoiceOrb";
import { MoChat, MoTerminal, MoCrew, MoEmpty } from "./scripted";

const ACCENT_HEX: Record<Accent, string> = {
  emerald: "#2ed3a0",
  iris: "#7b7bff",
  blue: "#3a8bff",
};

// Scripted voice turn lines — used by the fallback turn machine below.
const MO_USER_LINES = [
  "kick off the auth-refactor across the crew and keep me posted.",
  "what's blocking web-frontend right now?",
  "answer its UI question — use the inline banner.",
  "give me a status on the researcher.",
  "push the branch once tests are green.",
];
const MO_QUANT_LINES = [
  "on it — dispatched api-backend and the researcher, watching for reports.",
  "web-frontend is waiting on the login-error UI decision; everything else is running.",
  "told web-frontend to use the inline banner and wire in the new guard.",
  "researcher is 70% through the token-rotation docs — two endpoints still undocumented.",
  "12 auth tests pass — pushed feat/auth-refactor and pinged the crew.",
];

/**
 * MobileShell — the touch-native shell that mounts below 900px. It hosts a top
 * bar, a five-tab bottom bar (Chat / Terminal / Crew / Jobs / More), a sessions
 * drawer, panel sheets (Files / Mindmap / Agents), and the voice mini-player +
 * full-screen orb.
 *
 * Real desktop views are injected through `app.render*` slots (see MobileAppBag);
 * when a slot is absent a self-contained scripted fallback renders instead.
 */
export function MobileShell({ app }: { app: MobileAppBag }) {
  const { accent } = useTheme();
  const accentHex = ACCENT_HEX[accent] || ACCENT_HEX.emerald;

  const [tab, setTab] = useState<MobileTab>("chat");
  const [drawer, setDrawer] = useState(false);
  const [more, setMore] = useState(false);
  const [panel, setPanel] = useState<MorePanel | null>(null);

  // voice
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([
    { who: "you", text: "kick off the auth-refactor across the crew and keep me posted." },
    { who: "quant", text: "on it — dispatched api-backend and the researcher, watching for their reports." },
  ]);
  const uIdx = useRef(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const activeName = app.sessions.find((s) => s.id === app.activeSessionId)?.name ?? null;

  // Real voice runtime: when the host provides `renderVoice` it returns the REAL
  // desktop <VoicePane/> (audio service + voice bridge + live orb/transcript) for
  // the pinned session; the shell renders it full-bleed in the sheet and the
  // scripted turn machine below is unused. The scripted machine + timers remain
  // ONLY as the stand-alone fallback (renderVoice absent, e.g. tests / no session).
  const voiceBody: ReactNode = app.renderVoice ? app.renderVoice() : null;

  // Scripted fallback turn machine (used only when there's no real voice body).
  const micTap = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (voiceState === "idle" || voiceState === "speaking") {
      setVoiceState("listening");
    } else if (voiceState === "listening") {
      const u = MO_USER_LINES[uIdx.current % MO_USER_LINES.length];
      const q = MO_QUANT_LINES[uIdx.current % MO_QUANT_LINES.length];
      uIdx.current++;
      setTranscript((tr) => [...tr, { who: "you", text: u }]);
      setVoiceState("thinking");
      timers.current.push(
        setTimeout(() => {
          setVoiceState("speaking");
          setTranscript((tr) => [...tr, { who: "quant", text: q }]);
          timers.current.push(setTimeout(() => setVoiceState("idle"), 3400));
        }, 900),
      );
    }
  };
  // Open the full-screen voice sheet. Pin the active session as the voice session
  // (so renderVoice's <VoicePane/> has a valid session to mount on); only advance
  // the scripted state when there's no real voice body.
  const expandVoice = () => {
    app.onStartVoice?.();
    setVoiceOpen(true);
    if (!voiceBody && voiceState === "idle") setVoiceState("listening");
  };
  // VoiceMini mic tap: with real voice, pin + open the sheet (VoicePane owns the
  // mic); otherwise drive the scripted machine in place.
  const miniMic = () => {
    if (app.renderVoice) expandVoice();
    else micTap();
  };

  const titleFor =
    tab === "terminal"
      ? activeName || "terminal"
      : tab === "crew"
        ? "crew"
        : tab === "jobs"
          ? "jobs"
          : activeName || "jarvis";

  // tab body (real injected view, else scripted fallback)
  let body: ReactNode;
  if (tab === "chat") body = app.renderChat ? app.renderChat() : <MoChat />;
  else if (tab === "terminal") body = app.renderTerminal ? app.renderTerminal() : <MoTerminal />;
  else if (tab === "crew") body = app.renderCrew ? app.renderCrew() : <MoCrew sessions={app.sessions} />;
  else if (tab === "jobs")
    body = app.renderJobs ? (
      <MoWideWrap>{app.renderJobs()}</MoWideWrap>
    ) : (
      <MoEmpty icon="list" label="Jobs" sub="Connect the host JobsView via app.renderJobs to see scheduled jobs here." />
    );
  else body = <MoChat />;

  const showTopStatus = tab === "chat" || tab === "terminal";

  // mindmap fallback: reuse the real self-contained MindmapPane for the active session
  const mindmapBody: ReactNode = app.renderMindmap
    ? app.renderMindmap()
    : app.activeSessionId
      ? <MindmapPane sessionId={app.activeSessionId} />
      : <MoEmpty icon="waypoints" label="Mindmap" sub="Open a session to see its plan graph." />;

  const filesBody: ReactNode = app.renderFiles
    ? app.renderFiles()
    : <MoEmpty icon="folder" label="Files" sub="Connect the host FilesPanel via app.renderFiles." />;

  const agentsBody: ReactNode = app.renderAgents
    ? <MoWideWrap>{app.renderAgents()}</MoWideWrap>
    : <MoEmpty icon="users" label="Agents" sub="Connect the host AgentsView via app.renderAgents." />;

  return (
    <div className="mo-shell" style={{ display: "flex", flexDirection: "column", width: "100vw", overflow: "hidden", background: "var(--bg)" }}>
      <MoTopBar
        title={titleFor}
        status={showTopStatus ? "running" : null}
        onMenu={() => setDrawer(true)}
        onPalette={app.openPalette}
        onNew={app.newSession}
      />

      <div key={tab} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", animation: "moPopIn .24s cubic-bezier(.32,.72,0,1)" }}>
        {body}
      </div>

      {!voiceOpen && <VoiceMini state={voiceState} accentHex={accentHex} onExpand={expandVoice} onMic={miniMic} />}
      <MoTabBar
        tab={more ? "more" : tab}
        onTab={(k) => {
          if (k === "more") setMore(true);
          else {
            setMore(false);
            setTab(k);
          }
        }}
        crewBadge={2}
      />

      {/* overlays */}
      <MoSessionDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        app={app}
        onOpenSession={(id) => {
          app.openSession(id);
          setTab("chat");
        }}
      />
      <MoMoreSheet
        open={more}
        onClose={() => setMore(false)}
        onOpenPanel={(p) => {
          setMore(false);
          setPanel(p);
        }}
        onSettings={app.openSettings}
        onPalette={app.openPalette}
      />

      {/* panel sheets from More */}
      <MoSheet open={panel === "files"} onClose={() => setPanel(null)} full title="Files" pad={false}>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>{filesBody}</div>
      </MoSheet>
      <MoSheet open={panel === "mindmap"} onClose={() => setPanel(null)} full title="Mindmap" pad={false}>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>{mindmapBody}</div>
      </MoSheet>
      <MoSheet open={panel === "agents"} onClose={() => setPanel(null)} full title="Agents" pad={false}>
        {agentsBody}
      </MoSheet>

      <VoiceSheet
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        state={voiceState}
        accentHex={accentHex}
        transcript={transcript}
        onMic={micTap}
        subtitle={activeName ? `quant · ${activeName}` : "quant"}
        body={voiceBody}
      />
    </div>
  );
}
