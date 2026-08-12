import React from "react";
import { Zap, AlertTriangle, ShieldCheck, Clock, RefreshCw, XCircle } from "lucide-react";

export interface ExecutionMetrics {
  proposalsSent: number;
  proposalsSuccess: number;
  proposalsFailed: number;
  buysSent: number;
  buysSuccess: number;
  buysFailed: number;
  avgProposalLatencyMs: number;
  avgBuyLatencyMs: number;
  proposalSuccessRatePct: number;
  buySuccessRatePct: number;
  health: "HEALTHY" | "DEGRADED" | "POOR" | "CRITICAL";
  activeCooldowns: { symbol: string; cooldownUntil: number; reason: string }[];
  recentErrors: { symbol: string; code: string; message: string; timestamp: number }[];
}

interface ExecutionHealthDashboardProps {
  metrics: ExecutionMetrics;
}

export function ExecutionHealthDashboard({ metrics }: ExecutionHealthDashboardProps) {
  if (!metrics) {
    return (
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 text-center text-slate-400">
        <Zap className="w-8 h-8 mx-auto mb-2 text-slate-500 animate-pulse" />
        <p className="text-sm font-medium">Chargement du Moniteur de Latence et Qualité d'Exécution Deriv...</p>
      </div>
    );
  }

  let healthColor = "border-emerald-800/60 bg-emerald-950/20 text-emerald-300";
  if (metrics.health === "DEGRADED") healthColor = "border-amber-800/60 bg-amber-950/20 text-amber-300";
  if (metrics.health === "POOR" || metrics.health === "CRITICAL") healthColor = "border-rose-800/60 bg-rose-950/20 text-rose-300";

  return (
    <div className="space-y-4 rounded-xl bg-slate-900/90 border border-slate-800 p-5 shadow-2xl backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            Moniteur de Latence & Qualité d'Exécution (Deriv API)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Mesure en temps réel de la latence du proposal, latence du buy, taux de réussite et cooldowns d'exécution.
          </p>
        </div>
        <div className={`px-3 py-1 rounded-lg border text-xs font-semibold ${healthColor}`}>
          QUALITÉ D'EXÉCUTION : {metrics.health}
        </div>
      </div>

      {/* Grid Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
        <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Proposals Réussis</span>
          <span className="text-base font-bold text-slate-100 font-mono">
            {metrics.proposalsSuccess} / {metrics.proposalsSent} ({metrics.proposalSuccessRatePct}%)
          </span>
        </div>
        <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Buys Réussis</span>
          <span className="text-base font-bold text-slate-100 font-mono">
            {metrics.buysSuccess} / {metrics.buysSent} ({metrics.buySuccessRatePct}%)
          </span>
        </div>
        <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Latence Proposal Moy.</span>
          <span className="text-base font-bold text-cyan-300 font-mono">
            {metrics.avgProposalLatencyMs} ms
          </span>
        </div>
        <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Latence Buy Moy.</span>
          <span className="text-base font-bold text-indigo-300 font-mono">
            {metrics.avgBuyLatencyMs} ms
          </span>
        </div>
      </div>

      {/* Active Execution Cooldowns */}
      {metrics.activeCooldowns.length > 0 && (
        <div className="space-y-2 pt-2">
          <h4 className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-amber-400" />
            Cooldowns d'Exécution Actifs ({metrics.activeCooldowns.length})
          </h4>
          <div className="space-y-1 text-xs">
            {metrics.activeCooldowns.map((cd) => (
              <div key={cd.symbol} className="p-2 rounded bg-amber-950/40 border border-amber-800/50 text-amber-200 flex justify-between">
                <span className="font-mono font-bold">{cd.symbol}</span>
                <span>{cd.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Deriv Errors */}
      {metrics.recentErrors.length > 0 && (
        <div className="space-y-2 pt-2">
          <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            Dernières Erreurs Retournées par Deriv ({metrics.recentErrors.length})
          </h4>
          <div className="space-y-1 text-[11px] font-mono">
            {metrics.recentErrors.map((err, idx) => (
              <div key={idx} className="p-2 rounded bg-slate-950/80 border border-slate-800 text-slate-300 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-rose-400 font-bold">{err.symbol}</span>
                  <span className="text-slate-400">[{err.code}]</span>
                  <span>{err.message}</span>
                </div>
                <span className="text-slate-500 text-[10px]">
                  {new Date(err.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
