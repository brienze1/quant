// File-tab ids layered over the existing opaque-string openTabIds model:
// "file:<sessionId>:<relPath>". Session ids contain no ":", so the first ":"
// after the prefix splits owner from path (relPath may itself contain ":").
//
// File tabs are NOT persisted across restarts (App filters them out of the
// Go-config tab write). They survive workspace switches, but drafts drop
// because the panels unmount — accepted for v1.

export const FILE_TAB_PREFIX = "file:";

export function makeFileTabId(sessionId: string, relPath: string): string {
  return FILE_TAB_PREFIX + sessionId + ":" + relPath;
}

export function isFileTabId(tabId: string): boolean {
  return tabId.startsWith(FILE_TAB_PREFIX);
}

export function parseFileTabId(
  tabId: string
): { sessionId: string; relPath: string } | null {
  if (!isFileTabId(tabId)) return null;
  const rest = tabId.slice(FILE_TAB_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  return { sessionId: rest.slice(0, sep), relPath: rest.slice(sep + 1) };
}

export function isFileTabOfSession(tabId: string, sessionId: string): boolean {
  return tabId.startsWith(FILE_TAB_PREFIX + sessionId + ":");
}

export function fileBasename(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx === -1 ? relPath : relPath.slice(idx + 1);
}
