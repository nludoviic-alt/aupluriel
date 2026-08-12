import React from "react";
import { HelpCircle, CheckCircle2, XCircle, AlertTriangle, Clock, ShieldCheck, Zap, Layers } from "lucide-react";

export interface SymbolDiagnosticItem {
  symbol: string;
  preset: string;
  signalStatus: "VALID" | "NO_SETUP" | "LOW_SCORE" | "NO_DIRECTION";
  signalScore?: number;
  marketRegime: string;
  dataQualityStatus: "HEALTHY" | "DEGRADED" | "STALE" | "INVALID";
  timeFilterStatus: "INSUFFICIENT_DATA" | "ACTIVE" | "CAUTION" | "BLOCKED";
  timeFilterWouldBeStatus?: string;
  riskStatus: "APPROVED" | "REDUCED_RISK" | "REJECTED";
  riskReason?: string;
  proposalStatus: "VALID" | "REJECTED" | "NOT_CHECKED";
  proposalReason?: string;
  finalDecision: "EXECUTED" | "OBSERVED_ONLY" | "REJECTED";
  finalNote?: string;
  timestamp: string;
}

interface WhyNoTradeDashboardProps {
  diagnostics: SymbolDiagnosticItem[];
}

export function WhyNoTradeDashboard({ diagnostics }: WhyNoTradeDashboardProps) {
  if (!diagnostics || diagnostics.length === 0) {
    return (
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 text-center text-slate-400">
        <HelpCircle className="w-8 h-8 mx-auto mb-2 text-slate-500 animate-pulse" />
        <p className="text-sm font-medium">Acquisition des diagnostics en direct (Why No Trade)...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl bg-slate-900/90 border border-slate-800 p-5 shadow-2xl backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-amber-400" />
            Tableau de Diagnostic en Direct (Why No Trade Dashboard)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Explique instantanément pourquoi chaque actif a été tradeé, observé ou rejeté.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto space-y-3 pt-2">
        {diagnostics.map((d) => {
          let decisionBadge = "bg-slate-800 text-slate-300 border-slate-700";
          if (d.finalDecision === "EXECUTED") decisionBadge = "bg-emerald-950/80 text-emerald-300 border-emerald-800/80";
          if (d.finalDecision === "OBSERVED_ONLY") decisionBadge = "bg-cyan-950/80 text-cyan-300 border-cyan-800/80";
          if (d.finalDecision === "REJECTED") decisionBadge = "bg-rose-950/80 text-rose-300 border-rose-800/80";

          return (
            <div key={`${d.symbol}_${d.timestamp}`} className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-2">
                <div className="flex items-center gap-2 font-mono">
                  <span className="font-bold text-slate-100 text-sm">{d.symbol}</span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] uppercase font-semibold">
                    {d.preset}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 text-[10px] border border-indigo-800/50">
                    Régime: {d.marketRegime}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded text-xs font-semibold border ${decisionBadge}`}>
                    {d.finalDecision === "EXECUTED" && "✓ ORDRE EXÉCUTÉ"}
                    {d.finalDecision === "OBSERVED_ONLY" && "👁️ MODE OBSERVATION"}
                    {d.finalDecision === "REJECTED" && "✕ REJETÉ"}
                  </span>
                </div>
              </div>

              {/* Grid 5 Status Columns */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px] mb-0.5">Signal Technique</span>
                  <span className={`font-semibold ${d.signalStatus === "VALID" ? "text-emerald-400" : "text-slate-300"}`}>
                    {d.signalStatus} {d.signalScore ? `(${d.signalScore}/100)` : ""}
                  </span>
                </div>

                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px] mb-0.5">Qualité Données</span>
                  <span className={`font-semibold ${d.dataQualityStatus === "HEALTHY" ? "text-emerald-400" : "text-amber-400"}`}>
                    {d.dataQualityStatus}
                  </span>
                </div>

                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px] mb-0.5">Time Filter</span>
                  <span className={`font-semibold ${d.timeFilterStatus === "ACTIVE" ? "text-emerald-400" : "text-indigo-300"}`}>
                    {d.timeFilterWouldBeStatus || d.timeFilterStatus}
                  </span>
                </div>

                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px] mb-0.5">Risk Manager</span>
                  <span className={`font-semibold ${d.riskStatus === "APPROVED" ? "text-emerald-400" : "text-amber-300"}`}>
                    {d.riskStatus}
                  </span>
                </div>

                <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                  <span className="text-slate-400 block text-[10px] mb-0.5">Proposition Deriv</span>
                  <span className={`font-semibold ${d.proposalStatus === "VALID" ? "text-emerald-400" : "text-slate-400"}`}>
                    {d.proposalStatus}
                  </span>
                </div>
              </div>

              {/* Note / Reason if rejected or observed */}
              {d.finalNote && (
                <div className="text-[11px] text-slate-300 bg-slate-900/40 p-2 rounded border border-slate-800/50 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{d.finalNote}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
