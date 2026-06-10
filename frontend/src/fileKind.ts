// File-kind routing for the files feature: which viewer/editor a path gets.

export type FileKind = "image" | "svg" | "html" | "markdown" | "code";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif"]);

export function fileKind(path: string): FileKind {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === "svg") return "svg";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "md" || ext === "markdown") return "markdown";
  return "code";
}

// Kinds with a rendered preview mode in addition to source (images are
// view-only and not part of the preview/source toggle).
export function kindHasPreview(kind: FileKind): boolean {
  return kind === "svg" || kind === "html" || kind === "markdown";
}
