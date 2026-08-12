import React from "react";
import { ShieldAlert, RefreshCw, CheckCircle2, AlertTriangle, Power, Database } from "lucide-react";

export interface ReconciliationReport {
  timestamp: string;
  preset: string;
  localOpenCount: number;
  derivOpenCount: number;
  matchedCount: number;
  reconciledOrphans: number;
  untrackedDerivCount: number;
  hasDesyncError: boolean;
  status: "OK" | "RECONCILED_ORPHANS" | "DESYNC_ERROR";
  details: string[];
}

export interface CircuitBreakerState {
  isActive: boolean;
  reason?: string;
  triggeredAt?: string;
  autoTriggers: {
    dataQualityFailure: boolean;
    executionQualityCritical: boolean;
    reconciliationDesync: boolean;
    hardDailyDrawdownExceeded: boolean;
  };
}

interface ReconciliationCircuitBreakerDashboardProps {
  reconciliation?: ReconciliationReport;
  circuitBreaker?: CircuitBreakerState;
}

export function ReconciliationCircuitBreakerDashboard({
  reconciliation,
  circuitBreaker,
}: ReconciliationCircuitBreakerDashboardProps) {
  return (
    <div className="space-y-4 rounded-xl bg-slate-900/90 border border-slate-800 p-5 shadow-2xl backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-cyan-400" />
            Réconciliation DB / Broker & Interrupteur de Sécurité (Kill Switch)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Garantit la synchronisation exacte entre SQLite local et Deriv WebSocket.
          </p>
        </div>

        {/* Kill Switch Status Badge */}
        <div className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-2 ${
          circuitBreaker?.isActive ? "bg-rose-950/80 border-rose-800 text-rose-300" : "bg-emerald-950/80 border-emerald-800 text-emerald-300"
        }`}>
          <Power className={`w-4 h-4 ${circuitBreaker?.isActive ? "text-rose-400 animate-pulse" : "text-emerald-400"}`} />
          <span>KILL SWITCH : {circuitBreaker?.isActive ? "ACTIVÉ (ORDRES BLOQUÉS)" : "SÉCURITÉ NORMAL (INACTIF)"}</span>
        </div>
      </div>

      {/* Kill Switch Alert banner */}
      {circuitBreaker?.reason && (
        <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 animate-bounce" />
          <div>
            <span className="font-bold">Motif du Kill Switch : </span>
            <span>{circuitBreaker.reason}</span>
          </div>
        </div>
      )}

      {/* Reconciliation Stats Grid */}
      {reconciliation && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Positions Locales (DB)</span>
              <span className="text-base font-bold text-slate-100 font-mono">{reconciliation.localOpenCount}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Positions Broker (Deriv)</span>
              <span className="text-base font-bold text-slate-100 font-mono">{reconciliation.derivOpenCount}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Orphelins Réconciliés</span>
              <span className={`text-base font-bold font-mono ${reconciliation.reconciledOrphans > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {reconciliation.reconciledOrphans}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800">
              <span className="text-slate-400 block text-[11px]">Contrats Non Suivis</span>
              <span className={`text-base font-bold font-mono ${reconciliation.untrackedDerivCount > 0 ? "text-rose-400 font-bold" : "text-emerald-400"}`}>
                {reconciliation.untrackedDerivCount}
              </span>
            </div>
          </div>

          {/* Details list */}
          {reconciliation.details.length > 0 && (
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60 text-xs space-y-1 text-slate-300 font-mono">
              <span className="font-semibold text-slate-400 block text-[11px]">Détails des Réconciliations :</span>
              {reconciliation.details.map((d, idx) => (
                <div key={idx} className="flex items-center gap-1.5 text-amber-300">
                  <span>•</span>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
