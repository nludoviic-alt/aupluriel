import { useEffect, useState } from "react";

const MOBILE_MQ = "(max-width: 767px)";
const KEYBOARD_THRESHOLD_PX = 120;

export type VisualViewportFrame = {
  /** visualViewport.height on mobile; null on desktop / unsupported */
  height: number | null;
  /** visualViewport.offsetTop on mobile; 0 when closed / desktop */
  offsetTop: number;
  /** True while the on-screen keyboard is (almost certainly) open */
  keyboardOpen: boolean;
};

const INITIAL: VisualViewportFrame = {
  height: null,
  offsetTop: 0,
  keyboardOpen: false,
};

/**
 * Mobile-only binding to `window.visualViewport`.
 * On iOS PWA the keyboard shrinks the visual viewport without resizing
 * `100dvh` — consumers should size the messenger shell to `height` and
 * `translateY(offsetTop)` so the composer stays above the keyboard
 * (WhatsApp / Telegram behaviour). Desktop (≥768px) returns null height
 * so callers keep their existing `h-dvh` / layout-viewport sizing.
 */
export function useVisualViewportFrame(): VisualViewportFrame {
  const [frame, setFrame] = useState<VisualViewportFrame>(INITIAL);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const mq = window.matchMedia(MOBILE_MQ);

    const read = (): VisualViewportFrame => {
      if (!mq.matches) {
        return INITIAL;
      }
      return {
        height: vv.height,
        offsetTop: vv.offsetTop,
        keyboardOpen: window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX,
      };
    };

    const sync = () => setFrame(read());
    sync();

    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    mq.addEventListener("change", sync);

    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      mq.removeEventListener("change", sync);
    };
  }, []);

  return frame;
}

/** Convenience: true while the on-screen keyboard is open (any viewport width). */
export function useKeyboardOpen() {
  return useVisualViewportFrame().keyboardOpen;
}
