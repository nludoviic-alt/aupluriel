import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KpiProps {
  label: string;
  value: ReactNode;
  delta?: string;
  tone?: "default" | "bull" | "bear" | "cyan" | "violet";
  icon?: ReactNode;
}

export function KpiCard({ label, value, delta, tone = "default", icon }: KpiProps) {
  const toneClass =
    tone === "bull"
      ? "text-[color:var(--bull)]"
      : tone === "bear"
        ? "text-[color:var(--bear)]"
        : tone === "cyan"
          ? "text-[color:var(--brand-cyan)]"
          : tone === "violet"
            ? "text-[color:var(--brand-violet)]"
            : "text-foreground";
  return (
    <div className="glass-panel rounded-xl p-4 transition-all hover:translate-y-[-2px] hover:border-[color:var(--brand-cyan)]/40">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.14em] text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <div className={cn("mt-3 text-2xl font-semibold tracking-tight", toneClass)}>{value}</div>
      {delta && <div className="mt-1 text-xs text-muted-foreground">{delta}</div>}
    </div>
  );
}