import { useState, useEffect } from "react";
import { ShieldCheck, ShieldAlert, AlertTriangle, Clock, RefreshCcw, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthPanelProps {
  currentPnl?: number;
  maxDailyLoss?: number;
  activePreset?: string;
  winRate?: number;
  openPositionsCount?: number;
}

export function HealthPanel({
  currentPnl = 0,
  maxDailyLoss = 500,
  activePreset = "default",
  winRate = 0,
  openPositionsCount = 0,
}: HealthPanelProps) {
  const currentUtcHour = new Date().getUTCHours();
  const isUnfavorableHour = [3, 4, 7, 8, 11, 16, 19].includes(currentUtcHour);
  const hourStr = `${String(currentUtcHour).padStart(2, "0")}:00 UTC`;

  const remainingDailyRisk = Math.max(0, maxDailyLoss + (currentPnl < 0 ? currentPnl : 0));
  const riskUsagePct = Math.min(100, Math.round(((maxDailyLoss - remainingDailyRisk) / maxDailyLoss) * 100));

  return (
    <div className="rounded-2xl border border-white/[0.1] bg-black/50 backdrop-blur-xl p-5 md:p-6 shadow-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-foreground tracking-tight">Santé & Garde-fous en Direct</h3>
            <p className="text-xs text-muted-foreground font-medium">Surveillance temps réel du risque et des plages horaires</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400 uppercase tracking-wider">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          Actif
        </span>
      </div>

      {/* Grid of metrics */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {/* Risk Quota Card */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">Quota Risque Jour</span>
            <span className="text-sm font-mono font-bold text-emerald-400">${remainingDailyRisk.toFixed(2)} restant</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className={cn("h-full transition-all duration-500 rounded-full", riskUsagePct > 80 ? "bg-rose-500" : riskUsagePct > 50 ? "bg-amber-400" : "bg-emerald-400")}
              style={{ width: `${riskUsagePct}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground font-medium">Limite max journalière : ${maxDailyLoss.toFixed(2)}</span>
        </div>

        {/* UTC Hour Status */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">Créneau UTC Actuel</span>
            <span className="text-sm font-mono font-bold text-foreground">{hourStr}</span>
          </div>
          <div className="flex items-center gap-2">
            {isUnfavorableHour ? (
              <>
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span className="text-xs font-bold text-amber-300">Défavorable (Liquidité faible)</span>
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="text-xs font-bold text-emerald-300">Favorable (Plein flux)</span>
              </>
            )}
          </div>
          <span className="text-xs text-muted-foreground font-medium">
            {isUnfavorableHour ? "Warning actif sur les trades manuels" : "Heure optimale pour le scan"}
          </span>
        </div>

        {/* Active Preset & Positions */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 flex flex-col justify-between space-y-2 sm:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">Preset Actif</span>
            <span className="text-sm font-mono font-bold uppercase text-rose-300">{activePreset}</span>
          </div>
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-muted-foreground">Positions Ouvertes :</span>
            <span className="font-mono font-bold text-foreground text-sm">{openPositionsCount} / 3 max</span>
          </div>
          <span className="text-xs text-muted-foreground font-medium">Auto Break-Even actif à +50% TP</span>
        </div>
      </div>
    </div>
  );
}
