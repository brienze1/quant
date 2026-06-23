import { useEffect, useState } from "react";
import type { Session } from "../types";

export type DisplayStatus = Session["status"] | "starting" | "stopping" | "resuming" | "waiting" | "archived";

const statusColors: Record<DisplayStatus, string> = {
  running: "var(--accent)",     // accent — only running is accent
  waiting: "var(--info)",       // info — done, waiting for input
  idle: "var(--fg-4)",          // muted — never started
  paused: "var(--warn)",        // warn — paused
  done: "var(--accent)",        // accent
  error: "var(--danger)",       // danger
  starting: "var(--purple)",    // purple — transitional
  resuming: "var(--purple)",    // purple — transitional
  stopping: "var(--warn)",      // warn — transitional
  archived: "var(--fg-4)",      // muted — archived
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
        fontFamily: "var(--mono)",
        fontSize: "9px",
      }}
    >
      [{isAnimated(status) ? <>{status}<AnimatedDots /></> : status}]
    </span>
  );
}
