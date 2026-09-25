import { Activity, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TradingMode } from "@/lib/autotrader";

export function AutoTraderStatusBar({
  mode,
  presetLabel,
  autoEnabled,
  autoRunning,
  cloudBusy,
  pnl,
  lossUsedUsd,
  maxDailyLossUsd,
  openTrades,
  balance,
  winRate,
  onAuto,
  onModeChange,
}: {
  mode: TradingMode;
  presetLabel: string;
  autoEnabled: boolean;
  autoRunning: boolean;
  cloudBusy: boolean;
  pnl: number;
  lossUsedUsd: number;
  maxDailyLossUsd: number;
  openTrades: number;
  balance: string;
  winRate: string;
  onAuto: () => void;
  onModeChange: (mode: TradingMode) => void;
}) {
  const remainingLoss = Math.max(0, maxDailyLossUsd - lossUsedUsd);
  const limitPct = maxDailyLossUsd > 0 ? Math.min(100, Math.round((lossUsedUsd / maxDailyLossUsd) * 100)) : 0;
  const statusLabel = autoEnabled
    ? autoRunning
      ? "Auto actif"
      : "Auto en démarrage"
    : "Scan seul";
  const statusTone = autoEnabled && autoRunning ? "text-up" : autoEnabled ? "text-amber-300" : "text-muted-foreground";

  return (
    <div className="sticky top-3 z-30 rounded-2xl border border-border/70 bg-background p-3 shadow-2xl shadow-black/20">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="grid grid-cols-2 rounded-xl border border-border/60 bg-muted/10 p-1">
            {(["demo", "live"] as TradingMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-colors",
                  mode === m
                    ? m === "live"
                      ? "bg-down/15 text-down"
                      : "bg-up/15 text-up"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "live" ? "Live" : "Démo"}
              </button>
            ))}
          </div>
          <span className={cn("inline-flex items-center gap-2 rounded-xl border border-border/60 bg-muted/10 px-3 py-2 text-xs font-black uppercase tracking-wider", statusTone)}>
            <span className={cn("h-2 w-2 rounded-full", autoEnabled && autoRunning ? "animate-pulse bg-up" : autoEnabled ? "animate-pulse bg-amber-300" : "bg-muted-foreground")} />
            {statusLabel}
          </span>
          <span className="truncate rounded-xl border border-border/60 bg-muted/10 px-3 py-2 text-xs font-bold text-muted-foreground">
            {presetLabel}
          </span>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5 lg:flex lg:items-center">
          <StatusMetric label="Solde" value={balance} tone="text-foreground" />
          <StatusMetric
            label="P&L jour"
            value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`}
            tone={pnl >= 0 ? "text-up" : "text-down"}
          />
          <StatusMetric
            label="Perte restante"
            value={`$${remainingLoss.toFixed(2)}`}
            tone={limitPct >= 70 ? "text-down" : limitPct >= 40 ? "text-amber-300" : "text-foreground"}
          />
          <StatusMetric label="Win" value={winRate} tone={winRate === "—" ? "text-muted-foreground" : "text-foreground"} />
          <StatusMetric label="Ouverts" value={`${openTrades}`} tone={openTrades > 0 ? "text-cyan" : "text-muted-foreground"} />
        </div>

        <Button
          onClick={onAuto}
          disabled={cloudBusy}
          className={cn(
            "h-11 w-full shrink-0 gap-2 font-black lg:w-auto",
            autoEnabled
              ? "border border-down/30 bg-down/15 text-down hover:bg-down/25"
              : "border border-primary/30 bg-primary/15 text-primary hover:bg-primary/25",
          )}
        >
          {cloudBusy ? <Activity className="h-4 w-4 animate-pulse" /> : <Power className="h-4 w-4" />}
          {autoEnabled ? "Pause auto" : "Activer auto"}
        </Button>
      </div>
    </div>
  );
}

function StatusMetric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-mono-tabular text-sm font-black", tone)}>{value}</div>
    </div>
  );
}
