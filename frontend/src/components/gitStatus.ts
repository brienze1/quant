// Shared git-status presentation for the Files pane (Working tree section +
// per-file tree tags). Status codes come from the backend GitDiffFiles
// (entity.DiffFile): "M" | "A" | "D" | "R" | "?" (untracked).

// Normalize a raw status code to a single display letter (M/A/D/R/U).
export function gitStatusLetter(status: string): string {
  const s = (status || "").trim().charAt(0).toUpperCase();
  if (s === "?") return "U";
  return s || "U";
}

// Token color per git status, matching the design's FileRow status palette.
export function gitStatusColor(status: string): string {
  switch (gitStatusLetter(status)) {
    case "A":
      return "var(--accent)"; // added
    case "D":
      return "var(--danger)"; // deleted
    case "M":
      return "var(--warn)"; // modified
    case "R":
      return "var(--info)"; // renamed
    case "U":
    default:
      return "var(--fg-3)"; // untracked / unknown
  }
}

// Letter shown in the right-aligned status tag.
export function gitStatusLabel(status: string): string {
  return gitStatusLetter(status);
}
