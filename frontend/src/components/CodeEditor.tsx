import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { useTheme } from "../theme/provider";
import { quantCodeMirrorTheme } from "./codemirrorTheme";

interface Props {
  fileName: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

export function CodeEditor({ fileName, value, onChange, onSave }: Props) {
  const { theme } = useTheme();
  const [language, setLanguage] = useState<Extension | null>(null);

  // Keep the save handler in a ref so the keymap extension stays stable.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Lazy-load the language support matching the file name (its own chunk).
  useEffect(() => {
    let cancelled = false;
    setLanguage(null);
    const desc = LanguageDescription.matchFilename(languages, fileName);
    if (!desc) return;
    desc
      .load()
      .then((support) => {
        if (!cancelled) setLanguage(support);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileName]);

  const cmTheme = useMemo(() => quantCodeMirrorTheme(theme.type), [theme.type]);

  const extensions = useMemo(() => {
    const exts: Extension[] = [
      // Prec.highest so Mod-S beats any default binding and never reaches the
      // browser (which would try to save the page).
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
        ])
      ),
    ];
    if (language) exts.push(language);
    return exts;
  }, [language]);

  return (
    <CodeMirror
      className="files-editor"
      value={value}
      onChange={onChange}
      theme={cmTheme}
      extensions={extensions}
      height="100%"
      style={{ height: "100%", fontSize: 12 }}
    />
  );
}
