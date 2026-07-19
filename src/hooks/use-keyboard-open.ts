import { useEffect, useState } from "react";

// True while the on-screen keyboard is (almost certainly) open: the visual
// viewport is markedly shorter than the layout viewport. The 120px threshold
// clears browser-chrome fluctuations (URL bar collapse ~60px) while catching
// every real keyboard (~300px+).
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(window.innerHeight - vv.height > 120);
    check();
    vv.addEventListener("resize", check);
    window.addEventListener("resize", check);
    return () => {
      vv.removeEventListener("resize", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  return open;
}
