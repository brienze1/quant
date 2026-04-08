import { useEffect, useState } from "react";
import type { Session } from "../types";

export type DisplayStatus = Session["status"] | "starting" | "stopping" | "resuming" | "waiting" | "archived";

const statusColors: Record<DisplayStatus, string> = {
  running: "var(--q-accent)",    // green — only running is green
  waiting: "var(--q-cyan)",    // cyan — done, waiting for input
  idle: "var(--q-fg-secondary)",       // gray — never started
  paused: "var(--q-fg-secondary)",     // gray — same as idle
  done: "var(--q-cyan)",       // cyan
  error: "var(--q-error)",      // red
  starting: "var(--q-purple)",   // purple — transitional
  resuming: "var(--q-purple)",   // purple — transitional
  stopping: "var(--q-warning)",   // amber — transitional
  archived: "var(--q-fg-secondary)",   // gray — archived
};

const isAnimated = (s: DisplayStatus) =>
  s === "starting" || s === "stopping" || s === "resuming" || s === "running";

interface Props {
  status: DisplayStatus;
  className?: string;
}

function AnimatedDots() {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d % 3) + 1);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return <>{".".repeat(dots) + " ".repeat(3 - dots)}</>;
}

export function StatusBadge({ status, className = "" }: Props) {
  return (
    <span
      className={`shrink-0 ${className}`}
      style={{
        color: statusColors[status],
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "9px",
      }}
    >
      [{isAnimated(status) ? <>{status}<AnimatedDots /></> : status}]
    </span>
  );
}
