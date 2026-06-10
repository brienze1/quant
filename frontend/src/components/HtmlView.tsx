import { useEffect, useState } from "react";
import "./FilesPane.css";

// Sandboxed live HTML preview. Known limitations (by design):
// - sandbox="allow-scripts" without allow-same-origin: scripts run, but the
//   document is opaque-origin, so relative assets (images/css/js next to the
//   file) don't resolve — injecting a <base> would need same-origin, skipped.
// - Cmd+S is swallowed while the iframe has focus (keys don't bubble out).
export function HtmlView({ content }: { content: string }) {
  // Debounce srcDoc so the iframe isn't torn down on every keystroke.
  const [doc, setDoc] = useState(content);

  useEffect(() => {
    const t = setTimeout(() => setDoc(content), 300);
    return () => clearTimeout(t);
  }, [content]);

  return (
    <iframe
      className="files-html-frame"
      title="html preview"
      sandbox="allow-scripts"
      srcDoc={doc}
    />
  );
}
