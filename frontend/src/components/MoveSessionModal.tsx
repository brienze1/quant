import { useState } from "react";
import type { Task } from "../types";
import { ModalShell, ModalTitle, ModalCancel } from "./ModalShell";

interface Props {
  sessionId: string;
  currentTaskId: string;
  tasks: Task[];
  onSelect: (sessionId: string, targetTaskId: string) => void;
  onCancel: () => void;
}

function TaskRow({
  task,
  onClick,
}: {
  task: Task;
  onClick: () => void;
}) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "8px 12px",
        borderRadius: 7,
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--mono)",
        fontSize: 12,
        color: "var(--fg)",
        background: h ? "var(--hover)" : "transparent",
      }}
    >
      <span style={{ color: "var(--accent)", flex: "none" }}>#</span>
      <span>
        {task.tag} {task.name}
      </span>
    </button>
  );
}

export function MoveSessionModal({
  sessionId,
  currentTaskId,
  tasks,
  onSelect,
  onCancel,
}: Props) {
  const availableTasks = tasks.filter((t) => t.id !== currentTaskId);

  return (
    <ModalShell width={400} onClose={onCancel} align="center">
      <div style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
        <ModalTitle>move_to_task</ModalTitle>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>
          // select a target task
        </span>
        <div className="scroll" style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {availableTasks.map((task) => (
            <TaskRow key={task.id} task={task} onClick={() => onSelect(sessionId, task.id)} />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
          <ModalCancel onClick={onCancel} />
        </div>
      </div>
    </ModalShell>
  );
}
