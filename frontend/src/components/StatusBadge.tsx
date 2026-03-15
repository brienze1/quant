import { useEffect, useState } from "react";
import type { Session } from "../types";

export type DisplayStatus = Session["status"] | "starting" | "stopping" | "resuming" | "waiting" | "archived";

const statusColors: Record<DisplayStatus, string> = {
  running: "#10B981",    // green — only running is green
  waiting: "#06B6D4",    // cyan — done, waiting for input
  idle: "#6B7280",       // gray — never started
  paused: "#6B7280",     // gray — same as idle
  done: "#06B6D4",       // cyan
  error: "#EF4444",      // red
  starting: "#A78BFA",   // purple — transitional
  resuming: "#A78BFA",   // purple — transitional
  stopping: "#F59E0B",   // amber — transitional
  archived: "#6B7280",   // gray — archived
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
