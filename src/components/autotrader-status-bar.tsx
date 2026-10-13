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
  symbols,
  operationalStatus,
  blockReason,
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
  symbols: string[];
  operationalStatus?: string;
  blockReason?: string | null;
}) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const remainingLoss = Math.max(0, maxDailyLossUsd - lossUsedUsd);
  const limitPct = maxDailyLossUsd > 0 ? Math.min(100, Math.round((lossUsedUsd / maxDailyLossUsd) * 100)) : 0;
  const entriesBlocked = autoEnabled && !!operationalStatus && operationalStatus !== "ACTIVE";
  const statusLabel = entriesBlocked ? "Entrées suspendues" : autoEnabled
    ? autoRunning
      ? "Auto actif"
      : "Auto en démarrage"
    : "Scan seul";
  const statusTone = entriesBlocked ? "text-amber-300" : autoEnabled && autoRunning ? "text-up" : autoEnabled ? "text-amber-300" : "text-muted-foreground";

  if (isMobile) {
    return (
      <div className="sticky top-3 z-30 rounded-2xl border border-white/10 bg-card/90 backdrop-blur-xl p-3.5 shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={cn("inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black uppercase tracking-wider", statusTone)}>
              <span className={cn("h-2.5 w-2.5 rounded-full", autoEnabled && autoRunning ? "animate-pulse bg-emerald-400" : autoEnabled ? "animate-pulse bg-amber-300" : "bg-muted-foreground")} />
              {statusLabel}
            </span>
            <span className="rounded-xl border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-xs font-black text-foreground">
              {presetLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold text-muted-foreground"
          >
            {expanded ? "Réduire" : "Détails"} <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/50 px-4 py-2.5">
          <div>
            <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/80">Solde</div>
            <div className="font-mono text-base font-black text-foreground">{balance}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/80">P&L Jour</div>
            <div
              className={cn(
                "font-mono text-base font-black inline-block px-2 py-0.5 rounded-md",
                pnl >= 0 ? "text-emerald-300 bg-emerald-500/15" : "text-rose-300 bg-rose-500/15",
              )}
            >
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            </div>
          </div>
        </div>

        {blockReason && (
          <div className="mt-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300">
            Alerte Risque : {blockReason}
          </div>
        )}

        {expanded && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 rounded-xl border border-white/10 bg-black/50 p-1">
              {(["demo", "live"] as TradingMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onModeChange(m)}
                  className={cn(
                    "rounded-lg py-2 text-xs font-black uppercase tracking-wider transition-all",
                    mode === m
                      ? m === "demo"
                        ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/30"
                        : "bg-rose-500/25 text-rose-300 border border-rose-500/30"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "demo" ? "Démo" : "Réel"}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/10 bg-black/40 p-2.5 text-center">
                <div className="text-[11px] font-black uppercase text-muted-foreground/80">Marge</div>
                <div className="font-mono text-sm font-black text-foreground">${remainingLoss.toFixed(2)}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/40 p-2.5 text-center">
                <div className="text-[11px] font-black uppercase text-muted-foreground/80">Win Rate</div>
                <div className="font-mono text-sm font-black text-foreground">{winRate}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/40 p-2.5 text-center">
                <div className="text-[11px] font-black uppercase text-muted-foreground/80">Ouverts</div>
                <div className="font-mono text-sm font-black text-cyan">{openTrades}</div>
              </div>
            </div>

            <Button
              onClick={onAuto}
              disabled={cloudBusy}
              className={cn(
                "h-12 w-full gap-2 font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md",
                autoEnabled
                  ? "border border-rose-500/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
                  : "border border-emerald-500/50 bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/35 shadow-[0_0_15px_rgba(16,185,129,0.2)]",
              )}
            >
              {cloudBusy ? <Activity className="h-4 w-4 animate-pulse" /> : <Power className="h-4 w-4" />}
              {autoEnabled ? "Pause automatique" : "Activer l'Auto-Trader"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sticky top-3 z-30 rounded-2xl border border-white/10 bg-card/90 backdrop-blur-xl px-5 py-3.5 shadow-xl shadow-black/30 transition-all">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Left: Mode Switch & Status */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex rounded-xl border border-white/10 bg-black/50 p-1">
            {(["demo", "live"] as TradingMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={cn(
                  "rounded-lg px-4 py-2 text-xs sm:text-sm font-black uppercase tracking-wider transition-all",
                  mode === m
                    ? m === "demo"
                      ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 shadow-sm"
                      : "bg-rose-500/25 text-rose-300 border border-rose-500/40 shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "demo" ? "Démo" : "Réel"}
              </button>
            ))}
          </div>

          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs sm:text-sm font-black uppercase tracking-wider",
              autoEnabled && autoRunning
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                : autoEnabled
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                  : "border-white/10 bg-white/[0.04] text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                autoEnabled && autoRunning
                  ? "animate-pulse bg-emerald-400"
                  : autoEnabled
                    ? "animate-pulse bg-amber-400"
                    : "bg-white/25",
              )}
            />
            {statusLabel}
          </span>

          <span className="rounded-xl border border-white/15 bg-white/[0.05] px-3.5 py-2 text-xs sm:text-sm font-black text-foreground shadow-sm">
            {presetLabel}
          </span>
        </div>

        {/* Center: High-Impact KPI Strip with bold, readable metrics */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-6 rounded-2xl border border-white/10 bg-black/60 px-5 py-2.5 shrink-0 shadow-inner">
          <div>
            <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/80">Solde</div>
            <div className="font-mono text-base sm:text-lg font-black text-foreground">{balance}</div>
          </div>

          <span className="h-7 w-px bg-white/10 hidden sm:block" />

          <div>
            <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/80">P&L Jour</div>
            <div
              className={cn(
                "font-mono text-base sm:text-lg font-black inline-block px-2.5 py-0.5 rounded-md",
                pnl >= 0
                  ? "text-emerald-300 bg-emerald-500/15 border border-emerald-500/30"
                  : "text-rose-300 bg-rose-500/15 border border-rose-500/30",
              )}
            >
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            </div>
          </div>

          <span className="h-7 w-px bg-white/10 hidden sm:block" />

          <div>
            <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/80">Marge Jour</div>
            <div className="font-mono text-base sm:text-lg font-black text-foreground">
              ${remainingLoss.toFixed(2)}
            </div>
          </div>

          <span className="h-7 w-px bg-white/10 hidden sm:block" />

          <div>
            <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/80">Win Rate</div>
            <div className="font-mono text-base sm:text-lg font-black text-foreground">{winRate}</div>
          </div>

          <span className="h-7 w-px bg-white/10 hidden sm:block" />

          <div>
            <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground/80">Positions</div>
            <div className={cn("font-mono text-base sm:text-lg font-black", openTrades > 0 ? "text-cyan animate-pulse" : "text-muted-foreground")}>
              {openTrades}
            </div>
          </div>
        </div>

        {/* Right: Master Control Button */}
        <Button
          onClick={onAuto}
          disabled={cloudBusy}
          className={cn(
            "h-11 sm:h-12 shrink-0 gap-2.5 font-black text-xs sm:text-sm uppercase tracking-wider px-6 rounded-xl transition-all shadow-md",
            autoEnabled
              ? "border border-rose-500/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 shadow-[0_0_15px_rgba(244,63,94,0.2)]"
              : "border border-emerald-500/60 bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/35 shadow-[0_0_20px_rgba(16,185,129,0.25)]",
          )}
        >
          {cloudBusy ? (
            <Activity className="h-4 w-4 animate-pulse" />
          ) : (
            <Power className="h-4 w-4" />
          )}
          {autoEnabled ? "Pause auto" : "Démarrer auto"}
        </Button>
      </div>

      {/* Block reason only if active problem exists */}
      {blockReason && (
        <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2 text-xs sm:text-sm font-bold text-rose-300 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400 animate-ping" />
          <span>Alerte Disjoncteur Risque : {blockReason}</span>
        </div>
      )}
    </div>
  );
}
