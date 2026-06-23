import { ArrowDownRight, ArrowUpRight, Minus, ShieldCheck, ShieldAlert, Zap } from "lucide-react";
import type { SignalDirection } from "@/lib/indicators";
import { cn } from "@/lib/utils";

export interface SignalItem {
  pair: string;
  market: string;
  direction: SignalDirection;
  confidence: number;
  triggers: string[];
  time?: number;
  result?: "win" | "loss" | null;
  quality?: "premium" | "good" | "weak";
  blockers?: string[];
}

export function SignalCard({ signal }: { signal: SignalItem }) {
  const isBuy  = signal.direction === "BUY";
  const isSell = signal.direction === "SELL";

  const dirMeta = isBuy
    ? { Icon: ArrowUpRight,  label: "CALL",  panelCls: "glass-panel-up",     textCls: "text-[color:var(--up)]",   badgeCls: "bg-[color:var(--up)]/12 border-[color:var(--up)]/30 text-[color:var(--up)]",   barCls: "from-[color:var(--up)] to-[color:var(--brand-cyan)]" }
    : isSell
    ? { Icon: ArrowDownRight, label: "PUT",  panelCls: "glass-panel",        textCls: "text-[color:var(--down)]", badgeCls: "bg-[color:var(--down)]/12 border-[color:var(--down)]/30 text-[color:var(--down)]", barCls: "from-[color:var(--down)] to-[color:var(--brand-rose)]" }
    : { Icon: Minus,          label: "HOLD", panelCls: "glass-panel",        textCls: "text-muted-foreground",    badgeCls: "bg-muted/30 border-border text-muted-foreground",    barCls: "from-muted-foreground to-muted-foreground" };

  const { Icon, label, panelCls, textCls, badgeCls, barCls } = dirMeta;

  return (
    <div className={cn(panelCls, "rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 hover:scale-[1.01] hover:brightness-110")}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-foreground">{signal.pair}</span>
            <span className="rounded-md bg-muted/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {signal.market}
            </span>
          </div>
          {signal.time && (
            <div className="mt-0.5 text-[11px] text-muted-foreground/60">
              {new Date(signal.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>

        <span className={cn("inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold shrink-0", badgeCls)}>
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
      </div>

      {/* Big direction icon */}
      <div className="flex items-center gap-4">
        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", isBuy ? "bg-[color:var(--up)]/10" : isSell ? "bg-[color:var(--down)]/10" : "bg-muted/20")}>
          <Icon className={cn("h-6 w-6", textCls)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Confiance</span>
            <span className={cn("text-sm font-bold font-mono-tabular", textCls)}>{signal.confidence.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden">
            <div
              className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", barCls)}
              style={{ width: `${Math.max(5, Math.min(100, signal.confidence))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Quality badge */}
      {signal.direction !== "HOLD" && signal.quality && signal.quality !== "weak" && (
        <div className="flex items-center gap-1.5">
          {signal.quality === "premium" ? (
            <>
              <Zap className="h-3 w-3 text-[color:var(--brand-amber)]" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--brand-amber)]">Premium</span>
              <span className="text-[10px] text-muted-foreground">— tous les filtres alignés</span>
            </>
          ) : (
            <>
              <ShieldCheck className="h-3 w-3 text-[color:var(--brand-cyan)]" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--brand-cyan)]">Bon signal</span>
            </>
          )}
        </div>
      )}

      {/* Triggers */}
      {signal.triggers.length > 0 && signal.triggers[0] !== "insufficient-data" && (
        <ul className="space-y-1">
          {signal.triggers.slice(0, 4).map((t) => (
            <li key={t} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("mt-0.5 h-1 w-1 shrink-0 rounded-full", textCls)} />
              {t}
            </li>
          ))}
        </ul>
      )}

      {/* Blockers */}
      {signal.blockers && signal.blockers.length > 0 && (
        <ul className="space-y-1">
          {signal.blockers.slice(0, 2).map((b) => (
            <li key={b} className="flex items-start gap-1.5 text-[11px] text-amber-400/80">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
              {b}
            </li>
          ))}
        </ul>
      )}

      {signal.result && (
        <div className={cn("inline-flex rounded-lg px-2.5 py-1 text-xs font-bold self-start",
          signal.result === "win" ? "bg-[color:var(--up)]/10 text-[color:var(--up)]" : "bg-[color:var(--down)]/10 text-[color:var(--down)]")}>
          {signal.result === "win" ? "✓ Gagnant" : "✗ Perdant"}
        </div>
      )}
    </div>
  );
}
