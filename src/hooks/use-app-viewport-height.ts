import { useEffect } from "react";

// Keeps a `--app-height` custom property on <html> in sync with the actual
// visible viewport height. CSS `100dvh` alone is enough on most browsers,
// but some mobile WebViews/PWAs don't recompute it reliably right after the
// on-screen keyboard closes, leaving app shells stuck at the shorter
// "keyboard open" height — this measures window.visualViewport (which does
// track the real usable area) and pushes the corrected value in as a
// fallback the layout can read via `var(--app-height, 100dvh)`.
export function useAppViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;

    function setHeight() {
      const height = viewport?.height ?? window.innerHeight;
      root.style.setProperty("--app-height", `${height}px`);
    }

    setHeight();
    window.addEventListener("resize", setHeight);
    viewport?.addEventListener("resize", setHeight);
    viewport?.addEventListener("scroll", setHeight);

    return () => {
      window.removeEventListener("resize", setHeight);
      viewport?.removeEventListener("resize", setHeight);
      viewport?.removeEventListener("scroll", setHeight);
    };
  }, []);
}
