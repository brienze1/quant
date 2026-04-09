export function EmptyState() {
  return (
    <div
      className="flex items-center justify-center h-full"
      style={{ backgroundColor: "var(--q-bg)" }}
    >
      <div
        className="text-center max-w-lg"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <p className="text-3xl mb-3" style={{ color: "var(--q-accent)" }}>
          {">"}_ quant
        </p>
        <p className="text-sm mb-8" style={{ color: "var(--q-fg-secondary)" }}>
          multiple agents. one dashboard. zero chaos.
        </p>

        <div
          className="text-xs text-left space-y-4"
          style={{ color: "var(--q-fg-muted)" }}
        >
          <div>
            <p style={{ color: "var(--q-fg-secondary)" }}>// getting started</p>
            <p>
              <span style={{ color: "var(--q-accent)" }}>1.</span> click{" "}
              <span style={{ color: "var(--q-fg)" }}>+ repo</span> to open a git
              repository
            </p>
            <p>
              <span style={{ color: "var(--q-accent)" }}>2.</span> create a{" "}
              <span style={{ color: "var(--q-fg)" }}># task</span> to organize your
              work (e.g. PLT-123)
            </p>
            <p>
              <span style={{ color: "var(--q-accent)" }}>3.</span> add a{" "}
              <span style={{ color: "var(--q-fg)" }}>session</span> under the task
              to start a claude code agent
            </p>
          </div>

          <div>
            <p style={{ color: "var(--q-fg-secondary)" }}>// features</p>
            <p>
              <span style={{ color: "var(--q-accent)" }}>$</span> run multiple claude
              code sessions in parallel
            </p>
            <p>
              <span style={{ color: "var(--q-accent)" }}>$</span> sessions persist
              across app restarts
            </p>
            <p>
              <span style={{ color: "var(--q-accent)" }}>$</span> optional git worktrees
              for branch isolation
            </p>
            <p>
              <span style={{ color: "var(--q-accent)" }}>$</span> right-click for
              context menus on repos, tasks, sessions
            </p>
          </div>

          <div>
            <p style={{ color: "var(--q-fg-secondary)" }}>// tips</p>
            <p>
              <span style={{ color: "var(--q-warning)" }}>$</span> check "skip
              permissions" to run with --dangerously-skip-permissions
            </p>
            <p>
              <span style={{ color: "var(--q-warning)" }}>$</span> check "use worktree"
              to isolate work on a new git branch
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
