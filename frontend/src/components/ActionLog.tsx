import type { Action } from "../types";

interface Props {
  actions: Action[];
  maxVisible: number;
}

const actionConfig: Record<
  Action["type"],
  { prefix: string; prefixColor: string; textColor: string }
> = {
  user_message: { prefix: ">", prefixColor: "var(--fg)", textColor: "var(--fg)" },
  claude_read: { prefix: "$", prefixColor: "var(--fg-2)", textColor: "var(--fg-2)" },
  claude_edit: { prefix: "++", prefixColor: "var(--accent)", textColor: "var(--accent)" },
  claude_create: { prefix: "++", prefixColor: "var(--accent)", textColor: "var(--accent)" },
  claude_bash: { prefix: "$", prefixColor: "var(--warn)", textColor: "var(--warn)" },
  claude_result: { prefix: "$", prefixColor: "var(--accent)", textColor: "var(--accent)" },
};

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ActionLog({ actions, maxVisible }: Props) {
  const total = actions.length;
  const visible = actions.slice(0, maxVisible);
  const remaining = total - visible.length;

  return (
    <div className="ml-4 mr-2 my-1">
      <div
        className="text-[9px] px-2 py-0.5 mb-0.5"
        style={{ color: "var(--fg-3)", fontFamily: "var(--mono)" }}
      >
        // {visible.length} of {total} actions
      </div>
      <div
        className="overflow-y-auto"
        style={{ maxHeight: `${maxVisible * 20}px` }}
      >
        {visible.map((action) => {
          const cfg = actionConfig[action.type];
          return (
            <div
              key={action.id}
              className="flex items-center gap-1.5 px-2 py-0.5"
              style={{ fontFamily: "var(--mono)", fontSize: "9px" }}
            >
              <span className="shrink-0" style={{ color: "var(--fg-3)" }}>
                {formatTime(action.timestamp)}
              </span>
              <span className="shrink-0" style={{ color: cfg.prefixColor }}>
                {cfg.prefix}
              </span>
              <span
                className="overflow-hidden whitespace-nowrap flex-1"
                style={{
                  color: cfg.textColor,
                  textOverflow: "ellipsis",
                }}
              >
                {action.content}
              </span>
            </div>
          );
        })}
      </div>
      {remaining > 0 && (
        <div
          className="text-[9px] px-2 py-0.5"
          style={{ color: "var(--fg-3)", fontFamily: "var(--mono)" }}
        >
          {">> scroll for " + remaining + " more"}
        </div>
      )}
    </div>
  );
}
