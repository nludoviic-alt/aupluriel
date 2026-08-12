import React, { useState } from "react";
import { Clock, ShieldAlert, Eye, CheckCircle, AlertTriangle, XCircle, HelpCircle } from "lucide-react";

export interface HourlyHeatmapCell {
  hourUtc: number;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number;
  expectancyR: number;
  status: "INSUFFICIENT_DATA" | "ACTIVE" | "CAUTION" | "BLOCKED";
  wouldBeStatus: "WOULD_BE_ACTIVE" | "WOULD_BE_CAUTION" | "WOULD_BE_BLOCKED" | "INSUFFICIENT_DATA";
  color: "GREY" | "GREEN" | "YELLOW" | "RED";
}

export interface StrategyHourlyMatrix {
  preset: string;
  strategy: string;
  strategyVersion: string;
  symbol: string;
  totalTrades: number;
  totalPnl: number;
  overallProfitFactor: number;
  overallExpectancyR: number;
  hours: HourlyHeatmapCell[];
}

interface HourlyHeatmapDashboardProps {
  data: StrategyHourlyMatrix[];
  observationMode?: boolean;
}

export function HourlyHeatmapDashboard({ data, observationMode = true }: HourlyHeatmapDashboardProps) {
  const [selectedCell, setSelectedCell] = useState<{
    strategy: string;
    symbol: string;
    version: string;
    cell: HourlyHeatmapCell;
  } | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-6 text-center text-slate-400">
        <Clock className="w-8 h-8 mx-auto mb-2 text-slate-500 animate-pulse" />
        <p className="text-sm font-medium">Chargement des données de la Heatmap Horaire (24h UTC)...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl bg-slate-900/90 border border-slate-800 p-5 shadow-2xl backdrop-blur-md">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" />
            Heatmap de Performance Horaire (00h - 23h UTC)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Analyse granulaire par <code className="text-indigo-300 font-mono">SYMBOL + STRATEGY + VERSION + HOUR_UTC</code> (Échantillon min. 30 trades).
          </p>
        </div>

        {/* Observation Mode Badge */}
        {observationMode && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-950/60 border border-cyan-800/50 text-cyan-300 text-xs font-medium">
            <Eye className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span>MODE OBSERVATION ACTIF</span>
          </div>
        )}
      </div>

      {/* Legend Bar */}
      <div className="flex flex-wrap items-center gap-4 text-xs bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/50">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-500/80 inline-block"></span>
          <span className="text-slate-300">Vert : Profitable ($PF \ge 1.05$)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-amber-500/80 inline-block"></span>
          <span className="text-slate-300">Jaune : Caution ($PF < 0.80$, 30-49 trades, Risque x0.5)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-rose-500/80 inline-block"></span>
          <span className="text-slate-300">Rouge : Bloqué ($PF < 0.80$, 50+ trades, Mode Shadow)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-slate-700/60 inline-block"></span>
          <span className="text-slate-400">Gris : Échantillon insuffisant (< 30 trades)</span>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="overflow-x-auto space-y-4 pt-2">
        {data.map((item) => (
          <div key={`${item.symbol}_${item.strategy}_${item.strategyVersion}`} className="space-y-2">
            {/* Strategy Header */}
            <div className="flex items-center justify-between text-xs px-1">
              <div className="flex items-center gap-2 font-mono">
                <span className="font-semibold text-indigo-300">{item.symbol}</span>
                <span className="text-slate-500">|</span>
                <span className="text-slate-200">{item.strategy}</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-semibold">
                  {item.strategyVersion}
                </span>
              </div>
              <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                <span>Trades: <strong className="text-slate-200">{item.totalTrades}</strong></span>
                <span>P&L: <strong className={item.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>${item.totalPnl.toFixed(2)}</strong></span>
                <span>PF: <strong className="text-indigo-300">{item.overallProfitFactor.toFixed(2)}</strong></span>
                <span>ExpR: <strong className="text-cyan-300">+{item.overallExpectancyR.toFixed(2)}R</strong></span>
              </div>
            </div>

            {/* 24 Hours Grid */}
            <div className="grid grid-cols-24 gap-1 bg-slate-950/80 p-1.5 rounded-lg border border-slate-800">
              {item.hours.map((cell) => {
                let bgClass = "bg-slate-800/40 hover:bg-slate-700/60 text-slate-500";
                if (cell.color === "GREEN") bgClass = "bg-emerald-600/70 hover:bg-emerald-500/90 text-emerald-100 font-semibold";
                if (cell.color === "YELLOW") bgClass = "bg-amber-600/70 hover:bg-amber-500/90 text-amber-100 font-semibold";
                if (cell.color === "RED") bgClass = "bg-rose-600/70 hover:bg-rose-500/90 text-rose-100 font-semibold";

                return (
                  <button
                    key={cell.hourUtc}
                    onClick={() =>
                      setSelectedCell({
                        strategy: item.strategy,
                        symbol: item.symbol,
                        version: item.strategyVersion,
                        cell,
                      })
                    }
                    className={`h-8 rounded flex items-center justify-center text-[10px] transition-all cursor-pointer border border-slate-800/40 ${bgClass}`}
                    title={`${cell.hourUtc.toString().padStart(2, "0")}h UTC: ${cell.trades} trades | PF: ${cell.profitFactor}`}
                  >
                    {cell.hourUtc.toString().padStart(2, "0")}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Selected Cell Modal/Detail */}
      {selectedCell && (
        <div className="mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-indigo-400" />
              Détail Tranche Horaire : {selectedCell.symbol} ({selectedCell.strategy} {selectedCell.version}) à {selectedCell.cell.hourUtc.toString().padStart(2, "0")}:00 UTC
            </span>
            <button
              onClick={() => setSelectedCell(null)}
              className="text-slate-400 hover:text-slate-200 cursor-pointer font-bold px-1"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Volume Trades</span>
              <span className="text-sm font-semibold text-slate-200">{selectedCell.cell.trades} trades</span>
            </div>
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Win Rate</span>
              <span className="text-sm font-semibold text-indigo-300">{selectedCell.cell.winRatePct}%</span>
            </div>
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Profit Factor</span>
              <span className="text-sm font-semibold text-emerald-400">{selectedCell.cell.profitFactor.toFixed(2)}</span>
            </div>
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
              <span className="text-slate-400 block text-[10px]">Expectancy R</span>
              <span className="text-sm font-semibold text-cyan-300">+{selectedCell.cell.expectancyR.toFixed(2)}R</span>
            </div>
          </div>

          <div className="pt-2 text-[11px] text-slate-400 flex items-center gap-2">
            <span className="font-medium text-slate-300">Statut Théorique Observation :</span>
            <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-indigo-300 border border-slate-700">
              {selectedCell.cell.wouldBeStatus}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
