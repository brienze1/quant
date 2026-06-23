import { ModalShell, ModalCancel, ModalSubmit } from "./ModalShell";

interface Props {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ message, confirmLabel = "confirm", onConfirm, onCancel }: Props) {
  return (
    <ModalShell width={400} onClose={onCancel} align="center">
      <div style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
        <p
          className="mono"
          style={{ margin: 0, fontSize: 12.5, color: "var(--fg)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}
        >
          {message}
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14 }}>
          <ModalCancel onClick={onCancel} />
          <ModalSubmit tone="danger" onClick={onConfirm}>
            {confirmLabel}
          </ModalSubmit>
        </div>
      </div>
    </ModalShell>
  );
}
