import { Activity, X } from "lucide-react";
import { SYMBOLS } from "@/lib/deriv";
import { cn } from "@/lib/utils";
import type { TradeLog } from "@/lib/autotrader";

/** Live open-position strip. Shows the trade's real terms (mise, direction,
 * entrée) — no fabricated MT5-style "lot size", these are Deriv binary
 * options/multipliers, not MT5 positions. */
export function LivePositionsPanel({
  openTrades,
  onDismiss,
}: {
  openTrades: TradeLog[];
  onDismiss?: (trade: TradeLog) => void;
}) {
  if (!openTrades.length) return null;

  return (
    <div className="glass-panel overflow-hidden rounded-2xl border border-cyan/30 bg-[#070B14]/95 p-4 shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-cyan animate-pulse" />
          <span className="text-xs font-black uppercase tracking-widest text-neutral-200">
            Positions en direct
          </span>
        </div>
        <span className="font-mono text-xs font-bold text-muted-foreground bg-white/[0.04] px-2.5 py-0.5 rounded-full border border-white/10">
          {openTrades.length} position{openTrades.length > 1 ? "s" : ""} active{openTrades.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="space-y-2">
        {openTrades.map((t, idx) => {
          const isBuy = t.direction === "CALL" || t.direction === "MULTUP";
          const profit = t.profit || 0;
          const symbolLabel = SYMBOLS.find((s) => s.deriv === t.symbol)?.label ?? t.symbol;

          return (
            <div
              key={t.id || idx}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/60 px-4 py-3 shadow-inner"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-black uppercase tracking-wider",
                    isBuy
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-red-500/20 text-red-400 border border-red-500/30"
                  )}
                >
                  {isBuy ? "BUY" : "SELL"}
                </span>
                <span className="font-bold text-foreground text-sm">{symbolLabel}</span>
                {t.entryPrice ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    @ {t.entryPrice.toFixed(2)}
                  </span>
                ) : null}
                {t.durationMinutes ? (
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {t.durationMinutes} min
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-4">
                <span
                  className={cn(
                    "font-mono text-sm font-black tracking-wider",
                    profit >= 0 ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  ${profit >= 0 ? "+" : ""}{profit.toFixed(4)}
                </span>
                <span className="font-mono text-xs text-muted-foreground/80 bg-white/[0.04] px-2 py-0.5 rounded border border-white/5">
                  Mise ${t.stake.toFixed(2)}
                </span>
                <span className="font-mono text-[10px] font-bold text-muted-foreground/60">
                  {idx + 1}/{openTrades.length}
                </span>
                {onDismiss && (
                  <button
                    type="button"
                    onClick={() => onDismiss(t)}
                    title="Fermer la carte (n'affecte pas le contrat réel)"
                    className="text-muted-foreground/60 hover:text-foreground transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
