export function EmptyState() {
  return (
    <div
      className="flex items-center justify-center h-full"
      style={{ backgroundColor: "var(--bg)" }}
    >
      <div
        className="text-center max-w-lg"
        style={{ fontFamily: "var(--mono)" }}
      >
        <p className="text-3xl mb-3" style={{ color: "var(--accent)" }}>
          {">"}_ quant
        </p>
        <p className="text-sm mb-8" style={{ color: "var(--fg-2)" }}>
          multiple agents. one dashboard. zero chaos.
        </p>

        <div
          className="text-xs text-left space-y-4"
          style={{ color: "var(--fg-3)" }}
        >
          <div>
            <p style={{ color: "var(--fg-2)" }}>// getting started</p>
            <p>
              <span style={{ color: "var(--accent)" }}>1.</span> click{" "}
              <span style={{ color: "var(--fg)" }}>+ repo</span> to open a git
              repository
            </p>
            <p>
              <span style={{ color: "var(--accent)" }}>2.</span> create a{" "}
              <span style={{ color: "var(--fg)" }}># task</span> to organize your
              work (e.g. PLT-123)
            </p>
            <p>
              <span style={{ color: "var(--accent)" }}>3.</span> add a{" "}
              <span style={{ color: "var(--fg)" }}>session</span> under the task
              to start a claude code agent
            </p>
          </div>

          <div>
            <p style={{ color: "var(--fg-2)" }}>// features</p>
            <p>
              <span style={{ color: "var(--accent)" }}>$</span> run multiple claude
              code sessions in parallel
            </p>
            <p>
              <span style={{ color: "var(--accent)" }}>$</span> sessions persist
              across app restarts
            </p>
            <p>
              <span style={{ color: "var(--accent)" }}>$</span> optional git worktrees
              for branch isolation
            </p>
            <p>
              <span style={{ color: "var(--accent)" }}>$</span> right-click for
              context menus on repos, tasks, sessions
            </p>
          </div>

          <div>
            <p style={{ color: "var(--fg-2)" }}>// tips</p>
            <p>
              <span style={{ color: "var(--warn)" }}>$</span> check "skip
              permissions" to run with --dangerously-skip-permissions
            </p>
            <p>
              <span style={{ color: "var(--warn)" }}>$</span> check "use worktree"
              to isolate work on a new git branch
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
