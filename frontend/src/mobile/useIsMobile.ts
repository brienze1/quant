import { useEffect, useState } from "react";

/**
 * Live matchMedia hook — true when the viewport is phone-sized (≤900px), or when
 * `window.__forceMobile` is set (dev/preview override). Mirrors the design
 * prototype's `useIsMobile`.
 */
export function useIsMobile(query = "(max-width: 900px)"): boolean {
  const [match, setMatch] = useState<boolean>(() => {
    if (typeof window !== "undefined" && (window as unknown as { __forceMobile?: boolean }).__forceMobile) {
      return true;
    }
    return typeof matchMedia !== "undefined" ? matchMedia(query).matches : false;
  });

  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { __forceMobile?: boolean }).__forceMobile) {
      setMatch(true);
      return;
    }
    if (typeof matchMedia === "undefined") return;
    const mm = matchMedia(query);
    const on = (e: MediaQueryListEvent) => setMatch(e.matches);
    setMatch(mm.matches);
    mm.addEventListener("change", on);
    return () => mm.removeEventListener("change", on);
  }, [query]);

  return match;
}
