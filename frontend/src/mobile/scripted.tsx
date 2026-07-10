/* ============================================================
   Honest empty-state fallbacks for the mobile shell. These render only when the
   host App does NOT inject a real prop-wired desktop view via a MobileAppBag
   render slot (e.g. no active session, or a fresh/empty instance). They never
   fabricate data — they point the user at how to get a real session on screen,
   exactly like the desktop app's empty states.
   ============================================================ */
import { Icon, type IconName } from "../components/Icon";

/* ---------------- Generic empty state ---------------- */

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

/* ----- Per-tab empty states (shown when no real session view is injected) ----- */

export function MoChat() {
  return <MoEmpty icon="sparkles" label="No session open" sub="Tap ☰ to open a session, or create one in the Quant desktop app — its Claude conversation shows here." />;
}

export function MoTerminal() {
  return <MoEmpty icon="terminal" label="No session open" sub="Open a session from ☰ to attach its terminal here." />;
}

export function MoCrew() {
  return <MoEmpty icon="users" label="No crew" sub="Assign sessions to a supervisor in the Quant desktop app to run a crew — the roster and inbox appear here." />;
}
