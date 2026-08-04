import { useState } from "react";
import { Activity, ChevronDown, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
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
  const isMobile = useIsMobile();
  // Collapsed by default on mobile — the full 5-metric grid + mode switch +
  // status badge stacked vertically used to eat close to half the screen
  // permanently (this bar is sticky), before the user ever saw a position or
  // the journal. Desktop is unaffected (always the full row).
  const [expanded, setExpanded] = useState(false);
  const remainingLoss = Math.max(0, maxDailyLossUsd - lossUsedUsd);
  const limitPct = maxDailyLossUsd > 0 ? Math.min(100, Math.round((lossUsedUsd / maxDailyLossUsd) * 100)) : 0;
  const statusLabel = autoEnabled
    ? autoRunning
      ? "Auto actif"
      : "Auto en démarrage"
    : "Scan seul";
  const statusTone = autoEnabled && autoRunning ? "text-up" : autoEnabled ? "text-amber-300" : "text-muted-foreground";

  if (isMobile) {
    return (
      <div className="sticky top-3 z-30 rounded-2xl border border-border/70 bg-background p-3 shadow-2xl shadow-black/20">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/10 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider", statusTone)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", autoEnabled && autoRunning ? "animate-pulse bg-up" : autoEnabled ? "animate-pulse bg-amber-300" : "bg-muted-foreground")} />
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-muted-foreground"
          >
            {expanded ? "Réduire" : "Détails"} <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <StatusMetric label="Solde" value={balance} tone="text-foreground" />
          <StatusMetric label="P&L jour" value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`} tone={pnl >= 0 ? "text-up" : "text-down"} />
        </div>

        {expanded && (
          <div className="mt-2.5 space-y-2.5">
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
            <span className="block truncate rounded-xl border border-border/60 bg-muted/10 px-3 py-2 text-xs font-bold text-muted-foreground">
              {presetLabel}
            </span>
            <div className="grid grid-cols-3 gap-2">
              <StatusMetric
                label="Perte restante"
                value={`$${remainingLoss.toFixed(2)}`}
                tone={limitPct >= 70 ? "text-down" : limitPct >= 40 ? "text-amber-300" : "text-foreground"}
              />
              <StatusMetric label="Win" value={winRate} tone={winRate === "—" ? "text-muted-foreground" : "text-foreground"} />
              <StatusMetric label="Ouverts" value={`${openTrades}`} tone={openTrades > 0 ? "text-cyan" : "text-muted-foreground"} />
            </div>
          </div>
        )}

        <Button
          onClick={onAuto}
          disabled={cloudBusy}
          className={cn(
            "mt-2.5 h-11 w-full gap-2 font-black",
            autoEnabled
              ? "border border-down/30 bg-down/15 text-down hover:bg-down/25"
              : "border border-primary/30 bg-primary/15 text-primary hover:bg-primary/25",
          )}
        >
          {cloudBusy ? <Activity className="h-4 w-4 animate-pulse" /> : <Power className="h-4 w-4" />}
          {autoEnabled ? "Pause auto" : "Activer auto"}
        </Button>
      </div>
    );
  }

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
