import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KpiProps {
  label: string;
  value: ReactNode;
  delta?: string;
  tone?: "default" | "bull" | "bear" | "cyan" | "violet" | "amber" | "deriv" | "oanda" | "kraken" | "binance";
  icon?: ReactNode;
  className?: string;
}

const TONE = {
  default: {
    value: "text-foreground",
    glow: "",
    panel: "glass-panel",
    dot: "bg-muted-foreground",
    bar: "bg-muted/40",
  },
  bull: {
    value: "text-[color:var(--up)]",
    glow: "text-glow-green",
    panel: "glass-panel-up",
    dot: "bg-[color:var(--up)]",
    bar: "bg-[color:var(--up)]/20",
  },
  bear: {
    value: "text-[color:var(--down)]",
    glow: "",
    panel: "glass-panel",
    dot: "bg-[color:var(--down)]",
    bar: "bg-[color:var(--down)]/20",
  },
  cyan: {
    value: "text-[color:var(--brand-cyan)]",
    glow: "text-glow-cyan",
    panel: "glass-panel-cyan",
    dot: "bg-[color:var(--brand-cyan)]",
    bar: "bg-[color:var(--brand-cyan)]/20",
  },
  violet: {
    value: "text-[color:var(--brand-violet)]",
    glow: "text-glow-violet",
    panel: "glass-panel-violet",
    dot: "bg-[color:var(--brand-violet)]",
    bar: "bg-[color:var(--brand-violet)]/20",
  },
  amber: {
    value: "text-[color:var(--brand-amber)]",
    glow: "",
    panel: "glass-panel-amber",
    dot: "bg-[color:var(--brand-amber)]",
    bar: "bg-[color:var(--brand-amber)]/20",
  },
  deriv: {
    value: "text-foreground",
    glow: "",
    panel: "bg-red-500/[0.06] border border-red-500/20",
    dot: "bg-red-500",
    bar: "bg-red-500/20",
  },
  oanda: {
    value: "text-foreground",
    glow: "",
    panel: "bg-emerald-500/[0.06] border border-emerald-500/20",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500/20",
  },
  kraken: {
    value: "text-foreground",
    glow: "",
    panel: "bg-violet-500/[0.06] border border-violet-500/20",
    dot: "bg-violet-500",
    bar: "bg-violet-500/20",
  },
  binance: {
    value: "text-foreground",
    glow: "",
    panel: "bg-amber-500/[0.06] border border-amber-500/20",
    dot: "bg-amber-500",
    bar: "bg-amber-500/20",
  },
};

export function KpiCard({ label, value, delta, tone = "default", icon, className }: KpiProps) {
  const t = TONE[tone];
  return (
    <div className={cn(t.panel, "flex h-full flex-col justify-between rounded-2xl p-4 transition-all duration-200 hover:scale-[1.02] hover:brightness-110 group", className)}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("h-2 w-2 rounded-full shrink-0", t.dot)} />
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold leading-tight">{label}</span>
        </div>
        {icon && <span className={cn("shrink-0 opacity-50 group-hover:opacity-80 transition-opacity", t.value)}>{icon}</span>}
      </div>
      <div>
        <div className={cn("font-mono-tabular text-2xl font-bold leading-none", t.value, t.glow)}>{value}</div>
        {delta && <div className="mt-2 text-xs text-muted-foreground/70">{delta}</div>}
      </div>
    </div>
  );
}
