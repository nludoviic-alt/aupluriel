import React from "react";
import { Activity, AlertTriangle, ShieldCheck, HelpCircle, Eye, TrendingUp, TrendingDown, Scale } from "lucide-react";

export interface StrategyHealthMetrics {
  symbol: string;
  strategy: string;
  strategyVersion: string;
  preset: string;
  sampleSize: number;
  sampleCategory: "LEARNING" | "EARLY_SAMPLE" | "INTERMEDIATE" | "STRONG_SAMPLE" | "MATURE_SAMPLE";
  wins: number;
  losses: number;
  winRatePct: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number;
  expectancyR: number;
  averageR: number;
  averageWin: number;
  averageLoss: number;
  lossWinRatio: number;
  lossAsymmetryWarning: boolean;
  maxDrawdownUsd: number;
  consecutiveLosses: number;
  status: "LEARNING" | "NORMAL" | "CAUTION" | "RESTRICTED" | "PAUSED" | "DISABLED";
  wouldBeStatus: "LEARNING" | "NORMAL" | "CAUTION" | "RESTRICTED" | "PAUSED" | "DISABLED";
  observationMode: boolean;
}

interface StrategyHealthDashboardProps {
  metrics: StrategyHealthMetrics[];
}

export function StrategyHealthDashboard({ metrics }: StrategyHealthDashboardProps) {
  if (!metrics || metrics.length === 0) {
    return (
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 text-center text-slate-400">
        <Activity className="w-8 h-8 mx-auto mb-2 text-slate-500 animate-pulse" />
        <p className="text-sm font-medium">Chargement des métriques de Santé des Moteurs (Strategy Health)...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl bg-slate-900/90 border border-slate-800 p-5 shadow-2xl backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            Moniteur de Santé & Performance des Moteurs (Strategy Health)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Évaluation basée sur <code className="text-cyan-300 font-mono">EXPECTANCY_R + PROFIT_FACTOR + ASYMÉTRIE PERTE/GAIN</code>.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
        {metrics.map((m) => {
          let statusColor = "border-slate-800 bg-slate-950/80";
          let badgeColor = "bg-slate-800 text-slate-300";

          if (m.status === "NORMAL" || m.wouldBeStatus === "NORMAL") {
            statusColor = "border-emerald-800/60 bg-emerald-950/20";
            badgeColor = "bg-emerald-950/80 text-emerald-300 border-emerald-800/60";
          } else if (m.wouldBeStatus === "CAUTION") {
            statusColor = "border-amber-800/60 bg-amber-950/20";
            badgeColor = "bg-amber-950/80 text-amber-300 border-amber-800/60";
          } else if (m.wouldBeStatus === "RESTRICTED" || m.wouldBeStatus === "PAUSED") {
            statusColor = "border-rose-800/60 bg-rose-950/20";
            badgeColor = "bg-rose-950/80 text-rose-300 border-rose-800/60";
          }

          return (
            <div key={`${m.symbol}_${m.strategy}_${m.strategyVersion}`} className={`p-4 rounded-xl border space-y-3 ${statusColor}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-mono">
                  <span className="font-bold text-slate-100">{m.symbol}</span>
                  <span className="text-xs text-slate-400">{m.strategy}</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">{m.strategyVersion}</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badgeColor}`}>
                  {m.observationMode ? m.wouldBeStatus : m.status}
                </span>
              </div>

              {/* Sample Badge */}
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800/60 pb-2">
                <span>Échantillon: <strong className="text-slate-200">{m.sampleSize} trades</strong></span>
                <span className="px-2 py-0.5 rounded bg-slate-900 text-indigo-300 font-mono text-[10px]">
                  {m.sampleCategory}
                </span>
              </div>

              {/* Loss Asymmetry Alert */}
              {m.lossAsymmetryWarning && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-rose-950/60 border border-rose-800/60 text-rose-300 text-[11px]">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Alerte Asymétrie : Perte Moy. (&gt; 2x Gain Moy.)</span>
                </div>
              )}

              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px]">Profit Factor</span>
                  <span className={`font-bold ${m.profitFactor >= 1.05 ? "text-emerald-400" : "text-amber-400"}`}>
                    {m.profitFactor.toFixed(2)}
                  </span>
                </div>
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px]">Expectancy R</span>
                  <span className={`font-bold ${m.expectancyR >= 0 ? "text-cyan-300" : "text-rose-400"}`}>
                    +{m.expectancyR.toFixed(2)}R
                  </span>
                </div>
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px]">Gain Moy. / Perte Moy.</span>
                  <span className="font-semibold text-slate-200">
                    ${m.averageWin.toFixed(1)} / ${m.averageLoss.toFixed(1)}
                  </span>
                </div>
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px]">Ratio Perte/Gain</span>
                  <span className={`font-semibold ${m.lossWinRatio > 2.0 ? "text-rose-400 font-bold" : "text-slate-200"}`}>
                    {m.lossWinRatio.toFixed(2)}x
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
