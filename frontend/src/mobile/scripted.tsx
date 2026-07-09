/* ============================================================
   Self-contained scripted fallback views. These render when the host does not
   inject a real prop-wired desktop view via a MobileAppBag render slot, so the
   mobile module always renders (and typechecks) stand-alone. They are the ported
   design-source interactions, not live data.
   ============================================================ */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "../components/Icon";
import { MoSheet } from "./Sheet";
import { StatusDot, Pill, moBuzz } from "./primitives";
import type { Session } from "../types";

/* ---------------- Chat ---------------- */

type ChatMsg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; pending?: boolean }
  | { role: "tool"; tool: string; text: string }
  | { role: "report"; type: "done" | "progress" | "question"; from: string; text: string };

const MO_QUANT_LINES = [
  "on it — dispatched api-backend and the researcher, watching for reports.",
  "web-frontend is waiting on the login-error UI decision; everything else is running.",
  "told web-frontend to use the inline banner and wire in the new guard.",
  "researcher is 70% through the token-rotation docs — two endpoints still undocumented.",
  "12 auth tests pass — pushed feat/auth-refactor and pinged the crew.",
];

const MO_CHAT_SEED: ChatMsg[] = [
  { role: "user", text: "kick off the auth-refactor across the crew and keep me posted while I review the frontend." },
  { role: "tool", tool: "crew_dispatch", text: 'worker: "api-backend" · task: "auth-refactor: token guard" → dispatched' },
  { role: "report", type: "done", from: "api-backend", text: "12 auth tests pass, fixed the expired-token guard, branch pushed." },
  { role: "assistant", text: "api-backend is green — the guard is fixed and feat/auth-refactor is pushed. I'll hand it to web-frontend and confirm the token-rotation docs." },
];

function BubbleTools() {
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
      {(["copy", "refresh", "dots"] as IconName[]).map((ic) => (
        <span
          key={ic}
          className="mo-tap"
          style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--panel-3)", color: "var(--fg-3)" }}
        >
          <Icon name={ic} size={14} />
        </span>
      ))}
    </div>
  );
}

function ChatMessage({ m }: { m: ChatMsg }) {
  if (m.role === "user") {
    return (
      <div
        className="mo-msg-in"
        style={{ alignSelf: "flex-end", maxWidth: "86%", background: "var(--accent)", color: "var(--on-accent)", borderRadius: "16px 16px 5px 16px", padding: "11px 14px", fontSize: 15, lineHeight: 1.45, fontWeight: 500, boxShadow: "0 1px 2px rgba(0,0,0,.2)" }}
      >
        {m.text}
      </div>
    );
  }
  if (m.role === "tool") {
    return (
      <div className="mo-msg-in" style={{ alignSelf: "stretch", background: "var(--panel-2)", border: "1px solid var(--border-2)", borderRadius: 14, padding: "11px 13px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 7, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 11.5, fontWeight: 600 }}>
            <Icon name="terminal" size={12} /> {m.tool}
          </span>
          <span style={{ flex: 1 }} />
          <Pill tone="accent" soft>done</Pill>
        </div>
        <div className="mono" style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5 }}>{m.text}</div>
      </div>
    );
  }
  if (m.role === "report") {
    const REP: Record<string, [string, IconName]> = { done: ["var(--accent)", "check"], progress: ["var(--info)", "arrowDown"], question: ["var(--warn)", "question"] };
    const [c, ic] = REP[m.type] || REP.done;
    return (
      <div className="mo-msg-in" style={{ alignSelf: "stretch", borderRadius: 14, overflow: "hidden", border: `1px solid color-mix(in srgb, ${c} 35%, var(--border))`, background: `color-mix(in srgb, ${c} 8%, var(--panel-2))` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid color-mix(in srgb, ${c} 22%, var(--border))` }}>
          <Icon name={ic} size={13} color={c} />
          <span className="mono" style={{ fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", color: c, fontWeight: 600 }}>crew · {m.type}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>from {m.from}</span>
        </div>
        <div style={{ padding: "9px 12px", fontSize: 14, lineHeight: 1.5, color: "var(--fg)" }}>{m.text}</div>
      </div>
    );
  }
  return (
    <div className="mo-msg-in" style={{ alignSelf: "stretch", display: "flex", gap: 10 }}>
      <span style={{ width: 26, height: 26, flex: "none", borderRadius: 8, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--accent-soft)" }}>
        <Icon name="sparkles" size={14} color="var(--accent)" />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, lineHeight: 1.6, color: "var(--fg-2)" }}>{m.text}</div>
        {!m.pending && <BubbleTools />}
        {m.pending && <span className="cursor-blink" style={{ display: "inline-block", width: 8, height: 15, background: "var(--accent)", verticalAlign: "-2px" }} />}
      </div>
    </div>
  );
}

export function MoChat() {
  const [msgs, setMsgs] = useState<ChatMsg[]>(MO_CHAT_SEED);
  const [val, setVal] = useState("");
  const scRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = scRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  const send = () => {
    const text = val.trim();
    if (!text) return;
    moBuzz();
    setVal("");
    if (taRef.current) taRef.current.style.height = "auto";
    setMsgs((m) => [...m, { role: "user", text }, { role: "assistant", text: "", pending: true }]);
    const reply = MO_QUANT_LINES[Math.floor(Math.random() * MO_QUANT_LINES.length)];
    setTimeout(
      () =>
        setMsgs((m) => {
          const n = [...m];
          n[n.length - 1] = { role: "assistant", text: reply };
          return n;
        }),
      900,
    );
  };
  const grow = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    setVal(el.value);
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={scRef} className="mo-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 14px 6px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px", borderRadius: 999, background: "var(--panel-2)", border: "1px solid var(--border-2)", marginBottom: 2 }}>
          <Icon name="sparkles" size={13} color="var(--accent)" />
          <span style={{ fontSize: 11.5, color: "var(--fg-3)" }} className="mono">Claude Code · crew mode</span>
        </div>
        {msgs.map((m, i) => (
          <ChatMessage key={i} m={m} />
        ))}
      </div>
      <div style={{ flex: "none", padding: "8px 10px 10px", borderTop: "1px solid var(--border-2)", background: "var(--panel)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 20, padding: "6px 6px 6px 14px" }}>
          <span className="mono" style={{ color: "var(--accent)", fontSize: 15, paddingBottom: 9, flex: "none" }}>❯</span>
          <textarea
            ref={taRef}
            value={val}
            onChange={grow}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Reply, or steer the crew"
            spellCheck={false}
            style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", color: "var(--fg)", fontFamily: "var(--sans)", fontSize: 16, lineHeight: 1.4, padding: "8px 0", maxHeight: 120 }}
          />
          <button
            onClick={send}
            className="mo-tap"
            aria-label="Send"
            style={{ width: 38, height: 38, flex: "none", borderRadius: 999, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: val.trim() ? "var(--accent)" : "var(--panel-3)", color: val.trim() ? "var(--on-accent)" : "var(--fg-4)", transition: "background .15s" }}
          >
            <Icon name="send" size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Terminal ---------------- */

type CmdBlock = { cmd: string; out?: string; ok?: boolean; running?: boolean };

const MO_TERM_SEED: CmdBlock[] = [
  { cmd: "git log --oneline -3", out: "a1f3c0e fix: guard against expired tokens\n7b2e119 test: cover token-rotation edge cases\n3c9d4a2 chore: scaffold auth-refactor" },
  { cmd: "npm test -- auth", out: "PASS  test/auth/token-guard.test.ts\n✓ rejects expired tokens (12 ms)\nTests: 12 passed, 12 total", ok: true },
];
const MO_TERM_CANNED: Record<string, string> = {
  ls: "src/  test/  package.json  tsconfig.json  README.md",
  "git status": "On branch feat/auth-refactor\nnothing to commit, working tree clean",
  "git push": "To github.com:quant/backend.git\n * [new branch]  feat/auth-refactor → feat/auth-refactor",
  "npm test": "Tests: 12 passed, 12 total",
  pwd: "~/src/quant",
};

function CmdBlockView({ b }: { b: CmdBlock }) {
  const sc = b.ok === false ? "var(--danger)" : "var(--accent)";
  return (
    <div style={{ position: "relative", borderRadius: 11, overflow: "hidden", border: "1px solid var(--border-2)", background: "var(--panel-2)" }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2.5, background: sc, opacity: 0.7 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 12px 4px 14px" }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>quant on</span>
        <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--info)" }}>
          <Icon name="branch" size={11} /> feat/auth-refactor
        </span>
      </div>
      <div className="mono" style={{ display: "flex", gap: 8, padding: "0 12px 4px 14px", fontSize: 14 }}>
        <span style={{ color: "var(--accent)" }}>❯</span>
        <span style={{ color: "var(--fg)", overflowWrap: "anywhere" }}>
          {b.cmd}
          {b.running && <span className="cursor-blink" style={{ display: "inline-block", width: 8, height: 15, background: "var(--accent)", verticalAlign: "-2px", marginLeft: 2 }} />}
        </span>
      </div>
      {b.out && (
        <div className="mono" style={{ padding: "3px 12px 11px 26px", fontSize: 13, lineHeight: 1.55, color: "var(--fg-2)", whiteSpace: "pre-wrap" }}>
          {b.out}
        </div>
      )}
    </div>
  );
}

function QuickKey({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={() => {
        moBuzz(6);
        onClick();
      }}
      className="mo-tap"
      style={{ flex: "1 1 0", minWidth: 0, height: 38, borderRadius: 9, border: "1px solid var(--border-2)", cursor: "pointer", background: "var(--panel-2)", color: "var(--fg-2)", fontFamily: "var(--mono)", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      {children}
    </button>
  );
}

export function MoTerminal() {
  const [blocks, setBlocks] = useState<CmdBlock[]>(MO_TERM_SEED);
  const [val, setVal] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const inpRef = useRef<HTMLInputElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks]);
  const run = (raw?: string) => {
    const cmd = (raw != null ? raw : val).trim();
    if (!cmd) return;
    moBuzz();
    if (cmd === "clear") {
      setBlocks([]);
      setVal("");
      return;
    }
    setHist((h) => [...h, cmd]);
    const key = Object.keys(MO_TERM_CANNED).find((k) => cmd === k || cmd.startsWith(k + " "));
    const out = key ? MO_TERM_CANNED[key] : `zsh: running \`${cmd}\`…\n✓ done`;
    setBlocks((b) => [...b, { cmd, running: true }]);
    setVal("");
    setTimeout(
      () =>
        setBlocks((b) => {
          const n = [...b];
          n[n.length - 1] = { cmd, out, ok: true };
          return n;
        }),
      550,
    );
  };
  const insert = (s: string) => {
    setVal((v) => v + s);
    if (inpRef.current) inpRef.current.focus();
  };
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel)" }}>
      <div ref={scRef} className="mo-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
        {blocks.map((b, i) => (
          <CmdBlockView key={i} b={b} />
        ))}
      </div>
      <div className="mo-scroll" style={{ flex: "none", display: "flex", gap: 6, padding: "6px 10px", overflowX: "auto", borderTop: "1px solid var(--border-2)" }}>
        <QuickKey onClick={() => insert("cd ")}>cd</QuickKey>
        <QuickKey onClick={() => insert("git ")}>git</QuickKey>
        <QuickKey onClick={() => insert("--")}>--</QuickKey>
        <QuickKey onClick={() => insert("|")}>|</QuickKey>
        <QuickKey onClick={() => insert("~/")}>~/</QuickKey>
        <QuickKey onClick={() => run("clear")}>clear</QuickKey>
        <QuickKey
          onClick={() => {
            const last = hist[hist.length - 1];
            if (last) setVal(last);
          }}
        >
          <Icon name="arrowUp" size={15} />
        </QuickKey>
      </div>
      <div style={{ flex: "none", padding: "6px 10px 10px", background: "var(--panel)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, height: 46, padding: "0 8px 0 13px", borderRadius: 13, background: "var(--panel-2)", border: "1px solid var(--border)" }}>
          <span className="mono" style={{ color: "var(--accent)", fontSize: 15, flex: "none" }}>❯</span>
          <input
            ref={inpRef}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                run();
              }
            }}
            placeholder="run a command"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--fg)", fontFamily: "var(--mono)", fontSize: 16 }}
          />
          <button
            onClick={() => run()}
            className="mo-tap"
            aria-label="Run"
            style={{ width: 36, height: 36, flex: "none", borderRadius: 999, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: val.trim() ? "var(--accent)" : "var(--panel-3)", color: val.trim() ? "var(--on-accent)" : "var(--fg-4)" }}
          >
            <Icon name="send" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Crew ---------------- */

type Worker = { name: string; status: string; meta?: string };

const MO_CREW_SEED: Worker[] = [
  { name: "api-backend", status: "running", meta: "⏱ 12m" },
  { name: "web-frontend", status: "waiting", meta: "question" },
  { name: "researcher", status: "running", meta: "wt · 70%" },
];

function CrewWorkerRow({ w, onUnassign }: { w: Worker; onUnassign: (name: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 12px", borderRadius: 12, background: "var(--panel-2)", border: "1px solid var(--border-2)" }}>
      <StatusDot status={w.status} size={9} glow />
      <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: "var(--fg)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{w.name}</span>
      {w.meta && <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{w.meta}</span>}
      <button
        onClick={() => {
          moBuzz();
          onUnassign(w.name);
        }}
        className="mo-tap"
        aria-label="Unassign"
        style={{ width: 34, height: 34, flex: "none", borderRadius: 999, border: "none", cursor: "pointer", background: "var(--panel-3)", color: "var(--fg-3)", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

function CrewInbox({ type, from, state, summary, delivered }: { type: "done" | "progress" | "question"; from: string; state: string; summary: string; delivered?: boolean }) {
  const T: Record<string, [string, IconName]> = { done: ["var(--accent)", "check"], progress: ["var(--info)", "arrowDown"], question: ["var(--warn)", "question"] };
  const [c, ic] = T[type] || T.done;
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", opacity: delivered ? 0.62 : 1, border: "1px solid var(--border-2)", background: "var(--panel-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 12px" }}>
        <Icon name={ic} size={13} color={c} />
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.07em", textTransform: "uppercase", color: c, fontWeight: 600 }}>{type}</span>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{from}</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 9.5, color: "var(--fg-4)" }}>{state}</span>
      </div>
      <div style={{ padding: "0 12px 10px", fontSize: 13, lineHeight: 1.45, color: "var(--fg-2)" }}>{summary}</div>
    </div>
  );
}

export function MoCrew({ sessions }: { sessions: Session[] }) {
  const [workers, setWorkers] = useState<Worker[]>(MO_CREW_SEED);
  const [pick, setPick] = useState(false);
  const assigned = new Set(workers.map((w) => w.name));
  const avail = sessions.filter((s) => !s.archivedAt && !assigned.has(s.name));
  const assign = (s: Session) => {
    moBuzz();
    setWorkers((w) => [...w, { name: s.name, status: s.status || "starting", meta: "just assigned" }]);
    setPick(false);
  };
  const unassign = (name: string) => setWorkers((w) => w.filter((x) => x.name !== name));
  const label: CSSProperties = { fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-3)", fontWeight: 600 };
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--panel)" }}>
      <div className="mo-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 12px 6px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 4px", marginBottom: 10 }}>
          <span className="mono" style={label}>Workers</span>
          <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{workers.length} assigned</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {workers.map((w) => (
            <CrewWorkerRow key={w.name} w={w} onUnassign={unassign} />
          ))}
          {workers.length === 0 && <div className="mono" style={{ padding: "14px", textAlign: "center", fontSize: 12, color: "var(--fg-4)" }}>no workers assigned yet.</div>}
        </div>
        <button
          onClick={() => setPick(true)}
          className="mo-tap"
          style={{ width: "100%", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 12, border: "1.5px dashed var(--border)", background: "transparent", color: "var(--accent)", fontFamily: "var(--sans)", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
        >
          <Icon name="plus" size={16} /> Assign a session
        </button>

        <div style={{ height: 1, background: "var(--border-2)", margin: "16px 4px" }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 4px", marginBottom: 10 }}>
          <span className="mono" style={label}>Inbox</span>
          <span style={{ fontSize: 11, color: "var(--fg-4)" }}>injects when idle</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <CrewInbox type="question" from="web-frontend" state="queued · 1m" summary="login errors — inline banner or full page?" />
          <CrewInbox type="progress" from="researcher" state="queued · 4m" summary="70% through the token-rotation docs, 2 endpoints undocumented" />
          <CrewInbox type="done" from="api-backend" state="✓ delivered · 2m" delivered summary="12 auth tests pass, fixed the expired-token guard, branch pushed" />
        </div>
      </div>

      <MoSheet open={pick} onClose={() => setPick(false)} title="Assign a session">
        <div style={{ padding: "0 12px" }}>
          {avail.length === 0 && <div className="mono" style={{ padding: "20px 14px", textAlign: "center", fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.6 }}>every session is already assigned.</div>}
          {avail.map((s) => (
            <button
              key={s.id}
              onClick={() => assign(s)}
              className="mo-tap"
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "12px 12px", marginBottom: 4, borderRadius: 12, border: "none", cursor: "pointer", textAlign: "left", background: "var(--panel-2)" }}
            >
              <StatusDot status={s.status} size={9} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14.5, fontWeight: 500, color: "var(--fg)" }}>{s.name}</span>
              </span>
              <span style={{ display: "flex", width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", background: "var(--accent-soft)", color: "var(--accent)" }}>
                <Icon name="plus" size={16} />
              </span>
            </button>
          ))}
        </div>
      </MoSheet>
    </div>
  );
}

/* ---------------- Generic empty state (Jobs/Files/Agents fallback) ---------------- */

export function MoEmpty({ icon, label, sub }: { icon: IconName; label: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "24px", background: "var(--panel)" }}>
      <span style={{ width: 46, height: 46, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--panel-3)", color: "var(--fg-3)" }}>
        <Icon name={icon} size={22} />
      </span>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)" }}>{label}</div>
      {sub && <div style={{ fontSize: 12.5, color: "var(--fg-4)", textAlign: "center", lineHeight: 1.5, maxWidth: 260 }}>{sub}</div>}
    </div>
  );
}
