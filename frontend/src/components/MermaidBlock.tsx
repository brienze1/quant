import { useEffect, useState } from "react";
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
  return <div className="files-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
