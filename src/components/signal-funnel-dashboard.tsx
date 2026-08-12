import React from "react";
import { Filter, ArrowRight, CheckCircle2, ShieldCheck, Clock, Zap, AlertCircle } from "lucide-react";

export interface FunnelSummary {
  dateUtc: string;
  preset: string;
  strategy: string;
  scans: number;
  setups: number;
  validSignals: number;
  timeApproved: number;
  riskApproved: number;
  proposalValid: number;
  executedTrades: number;
  timeApprovalRatePct: number;
  riskApprovalRatePct: number;
  conversionRatePct: number;
}

interface SignalFunnelDashboardProps {
  stats: FunnelSummary[];
}

export function SignalFunnelDashboard({ stats }: SignalFunnelDashboardProps) {
  if (!stats || stats.length === 0) {
    return (
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 text-center text-slate-400">
        <Filter className="w-8 h-8 mx-auto mb-2 text-slate-500 animate-pulse" />
        <p className="text-sm font-medium">Acquisition des métriques de l'Entonnoir de Signal (Signal Funnel)...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl bg-slate-900/90 border border-slate-800 p-5 shadow-2xl backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Filter className="w-5 h-5 text-emerald-400" />
            Entonnoir de Conversion des Signaux (Signal Funnel)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Diagnostic étape par étape de la chaîne de qualification des ordres.
          </p>
        </div>
      </div>

      <div className="space-y-6 pt-2">
        {stats.map((item) => {
          const stages = [
            { label: "1. Scans Marché", val: item.scans, icon: Zap, color: "text-slate-300" },
            { label: "2. Setups Détectés", val: item.setups, icon: Filter, color: "text-blue-400" },
            { label: "3. Signaux Valides", val: item.validSignals, icon: CheckCircle2, color: "text-cyan-400" },
            { label: "4. Validé par Time Filter", val: item.timeApproved, icon: Clock, color: "text-indigo-400" },
            { label: "5. Validé par Risk Manager", val: item.riskApproved, icon: ShieldCheck, color: "text-emerald-400" },
            { label: "6. Proposition Deriv Valide", val: item.proposalValid, icon: CheckCircle2, color: "text-teal-400" },
            { label: "7. Ordres Exécutés", val: item.executedTrades, icon: Zap, color: "text-amber-400" },
          ];

          return (
            <div key={`${item.preset}_${item.strategy}`} className="space-y-3 p-4 rounded-xl bg-slate-950/80 border border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                <span className="font-mono text-sm font-semibold text-slate-200 uppercase">
                  {item.preset} — {item.strategy}
                </span>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-400">Taux Time Filter : <strong className="text-indigo-300">{item.timeApprovalRatePct}%</strong></span>
                  <span className="text-slate-400">Taux Risk Manager : <strong className="text-emerald-300">{item.riskApprovalRatePct}%</strong></span>
                  <span className="text-slate-400">Conversion Globale : <strong className="text-amber-300">{item.conversionRatePct}%</strong></span>
                </div>
              </div>

              {/* Pipeline Horizontal Flow */}
              <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 pt-1">
                {stages.map((stg, idx) => (
                  <div key={stg.label} className="flex flex-col justify-between p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-center">
                    <stg.icon className={`w-4 h-4 mx-auto mb-1 ${stg.color}`} />
                    <span className="text-[10px] text-slate-400 line-clamp-1">{stg.label}</span>
                    <span className="text-sm font-bold text-slate-100 mt-1 font-mono">{stg.val}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
