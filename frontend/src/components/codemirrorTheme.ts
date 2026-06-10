import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

// CodeMirror theme driven entirely by the app's CSS variables: style-mod emits
// the var() strings verbatim into the generated stylesheet, so live theme
// switches (including imported VS Code themes) restyle the editor for free.
// Only `theme` (dark/light) needs the resolved type, for CM's base styling.
export function quantCodeMirrorTheme(type: "dark" | "light" | "hc"): Extension {
  return createTheme({
    theme: type === "light" ? "light" : "dark",
    settings: {
      background: "var(--q-bg)",
      foreground: "var(--q-fg)",
      caret: "var(--q-term-cursor)",
      selection: "var(--q-selection-bg)",
      selectionMatch: "var(--q-selection-bg)",
      lineHighlight: "var(--q-bg-hover)",
      gutterBackground: "var(--q-bg)",
      gutterForeground: "var(--q-fg-muted)",
      gutterActiveForeground: "var(--q-fg-secondary)",
      gutterBorder: "transparent",
      fontFamily: "'JetBrains Mono', monospace",
    },
    styles: [
      { tag: [t.comment, t.blockComment, t.lineComment], color: "var(--q-fg-muted)", fontStyle: "italic" },
      { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.moduleKeyword], color: "var(--q-term-magenta)" },
      { tag: [t.string, t.special(t.string), t.regexp], color: "var(--q-term-green)" },
      { tag: [t.number, t.bool, t.null, t.atom], color: "var(--q-term-yellow)" },
      { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--q-term-blue)" },
      { tag: [t.typeName, t.className, t.namespace], color: "var(--q-term-cyan)" },
      { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: "var(--q-term-fg)" },
      { tag: t.propertyName, color: "var(--q-term-blue)" },
      { tag: t.tagName, color: "var(--q-term-red)" },
      { tag: t.attributeName, color: "var(--q-term-yellow)" },
      { tag: [t.meta, t.annotation, t.processingInstruction], color: "var(--q-fg-secondary)" },
      { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "var(--q-fg-secondary)" },
      { tag: t.heading, color: "var(--q-term-blue)", fontWeight: "bold" },
      { tag: t.link, color: "var(--q-term-cyan)", textDecoration: "underline" },
      { tag: t.url, color: "var(--q-term-cyan)" },
      { tag: t.emphasis, fontStyle: "italic" },
      { tag: t.strong, fontWeight: "bold" },
      { tag: t.strikethrough, textDecoration: "line-through" },
      { tag: t.invalid, color: "var(--q-error)" },
    ],
  });
}
