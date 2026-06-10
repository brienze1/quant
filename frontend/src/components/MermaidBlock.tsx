import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme/provider";

let mermaidSeq = 0;

// Renders a ```mermaid fence to inline SVG. Mermaid is heavy, so it is loaded
// via dynamic import only when a diagram is actually on screen (Rollup splits
// it into its own chunk). Mermaid bakes the theme into the SVG, so the render
// effect is keyed on the app theme type and re-runs on theme switches.
export function MermaidBlock({ code }: { code: string }) {
  const { theme } = useTheme();
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  // Mermaid measures labels in a detached container whose font metrics can
  // differ from the pane's, leaving the computed viewBox too narrow and
  // clipping the rightmost nodes. Re-fit the viewBox to the real content
  // bounding box once the SVG is in the DOM.
  useEffect(() => {
    const el = hostRef.current?.querySelector("svg");
    if (!el) return;
    try {
      const box = el.getBBox();
      const pad = 8;
      el.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`);
      el.style.maxWidth = `${box.width + pad * 2}px`;
    } catch {
      // getBBox throws on detached/hidden SVGs; keep mermaid's own viewBox.
    }
  }, [svg]);

  useEffect(() => {
    // Cancelled flag guards against the StrictMode double-effect and unmounts
    // racing the async render.
    let cancelled = false;
    setFailed(false);
    const id = `files-mermaid-${++mermaidSeq}`;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme.type === "light" ? "default" : "dark",
          // Measure labels with the same font the app applies to the injected
          // SVG, otherwise the computed viewBox is too narrow and clips nodes.
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          themeVariables: { fontFamily: "'JetBrains Mono', ui-monospace, monospace" },
        });
        const result = await mermaid.render(id, code);
        if (!cancelled) setSvg(result.svg);
      })
      .catch(() => {
        // Mermaid can leave a detached error element behind on parse failure.
        document.getElementById("d" + id)?.remove();
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme.type]);

  if (failed) {
    // Parse/render error: fall back to the plain code block.
    return (
      <pre className="files-mermaid-error">
        <code>{code}</code>
      </pre>
    );
  }
  if (!svg) return <div className="files-mermaid files-mermaid--loading">rendering diagram…</div>;
  return <div ref={hostRef} className="files-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
