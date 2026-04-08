interface Props {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ message, confirmLabel = "confirm", onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--q-modal-backdrop)" }}>
      <div
        className="w-full max-w-sm p-6"
        style={{
          backgroundColor: "var(--q-bg)",
          border: "1px solid var(--q-border)",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <p className="text-xs mb-5" style={{ color: "var(--q-fg)", whiteSpace: "pre-wrap" }}>
          {message}
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{ color: "var(--q-fg-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--q-fg)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--q-fg-secondary)")}
          >
            cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-xs lowercase transition-colors"
            style={{ backgroundColor: "var(--q-error)", color: "var(--q-bg)", fontWeight: 500 }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
