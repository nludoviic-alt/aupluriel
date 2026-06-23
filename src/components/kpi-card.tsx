import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KpiProps {
  label: string;
  value: ReactNode;
  delta?: string;
  tone?: "default" | "bull" | "bear" | "cyan" | "violet" | "amber";
  icon?: ReactNode;
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
};

export function KpiCard({ label, value, delta, tone = "default", icon }: KpiProps) {
  const t = TONE[tone];
  return (
    <div className={cn(t.panel, "rounded-2xl p-4 transition-all duration-200 hover:scale-[1.02] hover:brightness-110 group")}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", t.dot)} />
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{label}</span>
        </div>
        {icon && <span className={cn("opacity-50 group-hover:opacity-80 transition-opacity", t.value)}>{icon}</span>}
      </div>
      <div className={cn("font-mono-tabular text-2xl font-bold leading-none", t.value, t.glow)}>{value}</div>
      {delta && <div className="mt-2 text-xs text-muted-foreground/70">{delta}</div>}
    </div>
  );
}
