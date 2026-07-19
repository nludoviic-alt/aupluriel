import { useEffect } from "react";

// Keeps the app shell glued to the *visible* viewport on mobile.
//
// Two custom properties are maintained on <html>:
//   --app-height     the visual viewport's height (fallback for 100dvh)
//   --app-offset-top the visual viewport's offset from the layout viewport
//
// Why offset matters: iOS Safari never resizes the layout viewport when the
// on-screen keyboard opens — it *pans* the visual viewport down so the
// focused field sits above the keyboard (this is not a CSS scroll: it happens
// even with overflow:hidden and position:fixed everywhere, and reads as
// visualViewport.offsetTop > 0). Anything position:fixed to the layout
// viewport (our app shell, the bottom nav) slides out of view during the pan.
// Translating the shell by the measured offset cancels the pan exactly, so
// the shell always covers what the user actually sees.
//
// Why the focusout re-measure: standalone PWAs on iOS sometimes dismiss the
// keyboard without firing a final visualViewport resize, leaving the shell
// stuck at the shorter "keyboard open" height — the visible blank band under
// the bottom nav. Re-measuring a few beats after any field loses focus
// catches that missed event.
export function useAppViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let timers: number[] = [];

    function apply() {
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      root.style.setProperty("--app-height", `${height}px`);
      root.style.setProperty("--app-offset-top", `${offsetTop}px`);
      // The shell is a fixed-height box, so any document scroll is pure
      // keyboard-avoidance drift Safari left behind — undo it through every
      // channel iOS uses (window scroll AND element scrollTop; standalone
      // PWAs have been seen drifting one without the other).
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      if (root.scrollTop !== 0) root.scrollTop = 0;
      if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
    }

    function reapplySoon() {
      timers.forEach(clearTimeout);
      timers = [100, 350, 700].map((ms) => window.setTimeout(apply, ms));
    }

    apply();
    window.addEventListener("resize", apply);
    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);
    // Keyboard open AND close both occasionally skip the final resize event
    // in standalone iOS PWAs — re-measure a few beats after focus moves.
    window.addEventListener("focusin", reapplySoon);
    window.addEventListener("focusout", reapplySoon);

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("resize", apply);
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
      window.removeEventListener("focusin", reapplySoon);
      window.removeEventListener("focusout", reapplySoon);
    };
  }, []);
}
