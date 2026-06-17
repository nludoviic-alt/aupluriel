import { useEffect, useState } from "react";
import { TrendingDown, TrendingUp, Clock } from "lucide-react";
import { useDerivTicks } from "@/hooks/use-deriv";
import { SYMBOLS } from "@/lib/deriv";
import { cn } from "@/lib/utils";

/** Minimal shape a live trade needs — satisfied by autotrader TradeLog and Deriv OpenPosition. */
export interface LiveTradeLike {
  id: string;
  symbol: string;
  direction: "CALL" | "PUT";
  stake: number;
  confidence?: number;
  entryPrice?: number;
  expiry?: number;       // epoch ms
  /** Real P&L from Deriv (overrides the binary win/loss estimate when provided). */
  liveProfit?: number;
}

function symbolLabel(deriv: string) {
  return SYMBOLS.find((s) => s.deriv === deriv)?.label ?? deriv;
}

/** Live sparkline + entry line + running win/loss state for an open trade. */
export function LiveTradeCard({ trade }: { trade: LiveTradeLike }) {
  const { series, last } = useDerivTicks(trade.symbol, 80);
  const [secsLeft, setSecsLeft] = useState(0);

  useEffect(() => {
    if (!trade.expiry) return;
    const tick = () => setSecsLeft(Math.max(0, Math.ceil((trade.expiry! - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [trade.expiry]);

  const entry = trade.entryPrice ?? series[0]?.price ?? 0;
  const current = last ?? entry;
  const isForex = trade.symbol.startsWith("frx");
  const decimals = isForex ? 5 : 2;

  // Use real Deriv P&L when available, else binary estimate (CALL>entry / PUT<entry)
  const winning =
    trade.liveProfit !== undefined
      ? trade.liveProfit >= 0
      : trade.direction === "CALL"
        ? current > entry
        : current < entry;
  const deltaPct = entry > 0 ? ((current - entry) / entry) * 100 : 0;

  // Build sparkline path
  const prices = series.map((s) => s.price);
  const allVals = entry > 0 ? [...prices, entry] : prices;
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;
  const W = 300;
  const H = 80;
  const toX = (i: number) => (prices.length > 1 ? (i / (prices.length - 1)) * W : W);
  const toY = (p: number) => H - ((p - min) / range) * (H - 8) - 4;
  const linePath = prices.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(p).toFixed(1)}`).join(" ");
  const entryY = entry > 0 ? toY(entry) : H / 2;
  const lineColor = winning ? "var(--bull)" : "var(--bear)";

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{symbolLabel(trade.symbol)}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold",
              trade.direction === "CALL"
                ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
            )}
          >
            {trade.direction === "CALL" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {trade.direction}
          </span>
        </div>
        {trade.expiry && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {Math.floor(secsLeft / 60)}m {String(secsLeft % 60).padStart(2, "0")}s
          </span>
        )}
      </div>

      {/* Live sparkline with entry reference line */}
      <div className="mt-3 overflow-hidden rounded-lg bg-muted/15">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`fill-${trade.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.35} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* entry reference line */}
          {entry > 0 && (
            <line
              x1="0" x2={W} y1={entryY} y2={entryY}
              stroke="var(--brand-cyan)" strokeWidth="1" strokeDasharray="4 3" opacity="0.6"
            />
          )}
          {prices.length > 1 && (
            <>
              <path d={`${linePath} L ${W} ${H} L 0 ${H} Z`} fill={`url(#fill-${trade.id})`} />
              <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.8" />
            </>
          )}
        </svg>
      </div>

      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Entrée → Actuel</div>
          <div className="text-sm font-mono text-foreground">
            {entry > 0 ? entry.toFixed(decimals) : "—"} <span className="text-muted-foreground">→</span> {current.toFixed(decimals)}
          </div>
        </div>
        <div className="text-right">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold",
              winning ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]" : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
            )}
          >
            {winning ? "● Gagnant" : "● Perdant"}
          </span>
          <div className={cn("mt-0.5 text-xs font-mono", winning ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
            {trade.liveProfit !== undefined
              ? `${trade.liveProfit >= 0 ? "+" : ""}${trade.liveProfit.toFixed(2)}`
              : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(3)}%`}
          </div>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        Mise ${trade.stake.toFixed(2)}
        {trade.liveProfit === undefined && ` · Gain potentiel $${(trade.stake * 0.85).toFixed(2)}`}
        {trade.confidence !== undefined && ` · Conf. ${trade.confidence}%`}
      </div>
    </div>
  );
}
