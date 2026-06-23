import { useState, useEffect } from "react";
import * as api from "../api";
import { ModalShell, ModalSelect, ModalCancel, ModalSubmit } from "./ModalShell";

interface Props {
  sessionId: string;
  currentBranch: string;
  onSubmit: (branch: string) => void;
  onCancel: () => void;
}

export function GitPullModal({ sessionId, currentBranch, onSubmit, onCancel }: Props) {
  const [branch, setBranch] = useState(currentBranch);
  const [branches, setBranches] = useState<string[]>([]);

  useEffect(() => {
    api.listBranches(sessionId)
      .then((list) => {
        setBranches(list);
        if (list.length > 0 && list.includes(currentBranch)) {
          setBranch(currentBranch);
        } else if (list.length > 0) {
          setBranch(list[0]);
        }
      })
      .catch(() => {
        setBranches([currentBranch]);
      });
  }, [sessionId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!branch) return;
    onSubmit(branch);
  }

  const displayBranches = branches.length > 0 ? branches : [currentBranch];

  return (
    <ModalShell width={400} onClose={onCancel} align="center">
      <form onSubmit={handleSubmit} style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <span className="mono" style={{ fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--fg-3)" }}>
            // git pull origin
          </span>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 6 }}>
            current branch: <span style={{ color: "var(--accent)" }}>{currentBranch}</span>
          </div>
        </div>

        <ModalSelect
          value={branch}
          onChange={setBranch}
          options={displayBranches.map((b) => ({ value: b, label: b }))}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14 }}>
          <ModalCancel onClick={onCancel} />
          <ModalSubmit type="submit" disabled={!branch}>
            pull
          </ModalSubmit>
        </div>
      </form>
    </ModalShell>
  );
}
