import { useDerivTicks } from "@/hooks/use-deriv";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

const TICKERS = [
  { symbol: "cryBTCUSD", label: "BTC/USD",  decimals: 2 },
  { symbol: "cryETHUSD", label: "ETH/USD",  decimals: 2 },
  { symbol: "frxEURUSD", label: "EUR/USD",  decimals: 5 },
  { symbol: "frxGBPUSD", label: "GBP/USD",  decimals: 5 },
] as const;

function TickerItem({ symbol, label, decimals }: { symbol: string; label: string; decimals: number }) {
  const { series, last, status } = useDerivTicks(symbol, 60);

  const change = series.length >= 2
    ? ((series[series.length - 1].price - series[0].price) / series[0].price) * 100
    : null;
  const up = change !== null && change >= 0;

  return (
    <div className="flex items-center gap-2.5 border-r border-white/[0.06] px-4 py-0 shrink-0 last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{label}</span>
      <span className={cn(
        "font-mono-tabular text-sm font-bold tabular-nums transition-colors duration-300",
        status === "live" ? "text-foreground" : "text-muted-foreground/40"
      )}>
        {last ? last.toFixed(decimals) : "——"}
      </span>
      {change !== null && (
        <span className={cn(
          "flex items-center gap-0.5 text-[10px] font-bold",
          up ? "text-[color:var(--up)]" : "text-[color:var(--down)]"
        )}>
          {up
            ? <TrendingUp className="h-3 w-3" />
            : <TrendingDown className="h-3 w-3" />}
          {up ? "+" : ""}{change.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

export function TickerBar() {
  return (
    <div className="sticky top-14 z-20 flex h-9 items-center border-b border-white/[0.05] bg-[oklch(0.17_0.035_255)] overflow-x-auto scrollbar-none">
      <div className="flex items-center h-full min-w-max">
        {TICKERS.map((t) => (
          <TickerItem key={t.symbol} {...t} />
        ))}
      </div>

      {/* LIVE badge — always right */}
      <div className="ml-auto pl-4 pr-3 flex items-center gap-1.5 shrink-0">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[color:var(--up)] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--up)]" />
        </span>
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[color:var(--up)]">Temps réel</span>
      </div>
    </div>
  );
}
