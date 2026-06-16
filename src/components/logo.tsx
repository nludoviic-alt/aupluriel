import { cn } from "@/lib/utils";

/**
 * LIO23 logo mark — static geometric vortex, premium trading badge.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("h-9 w-9", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="lm-g1" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="oklch(0.82 0.16 220)" />
          <stop offset="1" stopColor="oklch(0.55 0.16 305)" />
        </linearGradient>
        <linearGradient id="lm-g2" x1="44" y1="4" x2="4" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="oklch(0.55 0.16 305)" />
          <stop offset="1" stopColor="oklch(0.82 0.16 220)" />
        </linearGradient>
        <radialGradient id="lm-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="oklch(0.92 0.18 220)" />
          <stop offset="100%" stopColor="oklch(0.55 0.16 305)" />
        </radialGradient>
        <filter id="lm-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── Outer ring ── */}
      <circle cx="24" cy="24" r="20" stroke="url(#lm-g1)" strokeWidth="1.5" opacity="0.35" />

      {/* ── Ring with dash gap (top-left open) ── */}
      <circle
        cx="24" cy="24" r="20"
        stroke="url(#lm-g1)"
        strokeWidth="2"
        strokeDasharray="90 36"
        strokeDashoffset="-10"
        strokeLinecap="round"
        opacity="0.9"
      />

      {/* ── Middle spiral arc ── */}
      <path
        d="M24 8 A16 16 0 1 1 8.5 32"
        stroke="url(#lm-g2)"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.8"
      />

      {/* ── Inner arc ── */}
      <path
        d="M24 14 A10 10 0 0 1 34 24 A10 10 0 0 1 19 33.5"
        stroke="oklch(0.82 0.16 220)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.9"
        filter="url(#lm-glow)"
      />

      {/* ── Orbital node (cyan) ── */}
      <circle cx="34" cy="24" r="3" fill="oklch(0.82 0.16 220)" filter="url(#lm-glow)" />

      {/* ── Tail node (violet) ── */}
      <circle cx="8.5" cy="32" r="2.2" fill="oklch(0.65 0.18 305)" opacity="0.9" />

      {/* ── Center core ── */}
      <circle cx="24" cy="24" r="5" fill="url(#lm-core)" filter="url(#lm-glow)" />
      <circle cx="24" cy="24" r="2.2" fill="white" opacity="0.95" />
    </svg>
  );
}

export function LogoFull({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="leading-tight">
        <div className="text-base font-extrabold tracking-tight brand-gradient-text">LIO23</div>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Quant Trading AI</div>
      </div>
    </div>
  );
}
