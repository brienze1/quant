import type { Task } from "../types";

interface Props {
  sessionId: string;
  currentTaskId: string;
  tasks: Task[];
  onSelect: (sessionId: string, targetTaskId: string) => void;
  onCancel: () => void;
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--q-modal-backdrop)" }}
    >
      <div
        className="w-full max-w-sm p-6"
        style={{
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <h2
          className="text-sm font-bold lowercase mb-5"
          style={{ color: "var(--q-fg)" }}
        >
          <span style={{ color: "var(--q-accent)" }}>{">"}</span> move_to_task
        </h2>

        <p
          className="text-[10px] mb-4"
          style={{ color: "var(--q-fg-secondary)" }}
        >
          // select a target task
        </p>

        <div
          className="overflow-y-auto mb-5"
          style={{ maxHeight: 200 }}
        >
          {availableTasks.map((task) => (
            <button
              key={task.id}
              onClick={() => onSelect(sessionId, task.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
              style={{
                color: "var(--q-fg)",
                fontFamily: "'JetBrains Mono', monospace",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--q-bg-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <span style={{ color: "var(--q-accent)" }}>#</span>
              <span>
                {task.tag} {task.name}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{ color: "var(--q-fg-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  );
}
