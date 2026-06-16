import { ArrowDownRight, ArrowUpRight, Minus, ShieldCheck, ShieldAlert } from "lucide-react";
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

const QUALITY_META: Record<string, { label: string; cls: string }> = {
  premium: { label: "PREMIUM", cls: "bg-[color:var(--bull)]/15 text-[color:var(--bull)] border-[color:var(--bull)]/30" },
  good:    { label: "BON",     cls: "bg-[color:var(--brand-cyan)]/15 text-[color:var(--brand-cyan)] border-[color:var(--brand-cyan)]/30" },
  weak:    { label: "FAIBLE",  cls: "bg-muted/40 text-muted-foreground border-border" },
};

export function SignalCard({ signal }: { signal: SignalItem }) {
  const isBuy = signal.direction === "BUY";
  const isSell = signal.direction === "SELL";
  const Icon = isBuy ? ArrowUpRight : isSell ? ArrowDownRight : Minus;
  const dirColor = isBuy
    ? "text-[color:var(--bull)] bg-[color:var(--bull)]/10 border-[color:var(--bull)]/30"
    : isSell
      ? "text-[color:var(--bear)] bg-[color:var(--bear)]/10 border-[color:var(--bear)]/30"
      : "text-muted-foreground bg-muted/40 border-border";

  return (
    <div className="glass-panel rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold tracking-tight text-foreground">{signal.pair}</span>
            <span className="rounded-md bg-muted/40 px-1.5 py-0.5 text-xs uppercase tracking-wider text-muted-foreground">
              {signal.market}
            </span>
          </div>
          {signal.time && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {new Date(signal.time).toLocaleTimeString()}
            </div>
          )}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
            dirColor,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {signal.direction}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Confiance</span>
          <span className="font-semibold text-foreground">{signal.confidence.toFixed(0)}%</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)]"
            style={{ width: `${Math.max(5, Math.min(100, signal.confidence))}%` }}
          />
        </div>
      </div>

      {/* Quality badge — only meaningful when there's a directional signal */}
      {signal.direction !== "HOLD" && signal.quality && (
        <div className="mt-3 flex items-center gap-1.5">
          {signal.quality === "weak" ? (
            <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5 text-[color:var(--bull)]" />
          )}
          <span className={cn("rounded-md border px-1.5 py-0.5 text-xs font-bold tracking-wide", QUALITY_META[signal.quality].cls)}>
            {QUALITY_META[signal.quality].label}
          </span>
          <span className="text-xs text-muted-foreground">
            {signal.quality === "premium" ? "Tous les filtres alignés" : signal.quality === "good" ? "Confluence correcte" : "Prudence — peu de confirmations"}
          </span>
        </div>
      )}

      {signal.triggers.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {signal.triggers.slice(0, 5).map((t) => (
            <li key={t} className="flex gap-1.5">
              <span className="text-[color:var(--brand-cyan)]">•</span>
              {t}
            </li>
          ))}
        </ul>
      )}

      {/* Blockers — reasons not to trade */}
      {signal.blockers && signal.blockers.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {signal.blockers.map((b) => (
            <li key={b} className="flex gap-1.5 text-amber-400/90">
              <span>⚠</span>
              {b}
            </li>
          ))}
        </ul>
      )}

      {signal.result && (
        <div
          className={cn(
            "mt-3 inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
            signal.result === "win"
              ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
              : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
          )}
        >
          {signal.result === "win" ? "Gagnant" : "Perdant"}
        </div>
      )}
    </div>
  );
}