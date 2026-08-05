import { useState, useEffect } from "react";
import { ShieldCheck, ShieldAlert, AlertTriangle, Clock, RefreshCcw, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthPanelProps {
  currentPnl: number;
  maxDailyLoss: number;
  activePreset: string;
  winRate: number;
  openPositionsCount: number;
}

export function HealthPanel({
  currentPnl = 0,
  maxDailyLoss = 15,
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
    <div className="rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-xl p-5 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-foreground tracking-tight">Santé & Garde-fous en Direct</h3>
            <p className="text-[11px] text-muted-foreground">Surveillance temps réel du risque et des plages horaires</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
          Actif
        </span>
      </div>

      {/* Grid of metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Risk Quota Card */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Quota Risque Jour</span>
            <span className="text-xs font-mono font-bold text-emerald-400">${remainingDailyRisk.toFixed(2)} restant</span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className={cn("h-full transition-all duration-500 rounded-full", riskUsagePct > 80 ? "bg-rose-500" : riskUsagePct > 50 ? "bg-amber-400" : "bg-emerald-400")}
              style={{ width: `${riskUsagePct}%` }}
            />
          </div>
          <span className="mt-1.5 text-[10px] text-muted-foreground/80">Limite max journalière : ${maxDailyLoss.toFixed(2)}</span>
        </div>

        {/* UTC Hour Status */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Créneau UTC Actuel</span>
            <span className="text-xs font-mono font-bold text-foreground">{hourStr}</span>
          </div>
          <div className="flex items-center gap-1.5 my-1">
            {isUnfavorableHour ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-xs font-bold text-amber-300">Défavorable (Liquidité faible)</span>
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="text-xs font-bold text-emerald-300">Favorable (Plein flux)</span>
              </>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground/80">
            {isUnfavorableHour ? "Warning actif sur les trades manuels" : "Heure optimale pour le scan"}
          </span>
        </div>

        {/* Active Preset & Positions */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 flex flex-col justify-between sm:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Preset Actif</span>
            <span className="text-xs font-mono font-bold uppercase text-rose-300">{activePreset}</span>
          </div>
          <div className="flex items-center justify-between text-xs my-1">
            <span className="text-muted-foreground">Positions Ouvertes :</span>
            <span className="font-mono font-bold text-foreground">{openPositionsCount} / 3 max</span>
          </div>
          <span className="text-[10px] text-muted-foreground/80">Auto Break-Even actif à +50% TP</span>
        </div>
      </div>
    </div>
  );
}
