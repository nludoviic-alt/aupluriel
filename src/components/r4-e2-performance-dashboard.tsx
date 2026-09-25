import React, { useState, useEffect } from "react";
import { ShieldCheck, AlertTriangle, Cpu, TrendingUp, Lock } from "lucide-react";

export function R4E2PerformanceDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [symbolFilter, setSymbolFilter] = useState("ALL");
  const [strategyFilter, setStrategyFilter] = useState("ALL");

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 15000);
    return () => clearInterval(timer);
  }, []);

  async function fetchData() {
    try {
      const res = await fetch("/api/admin/r4-e2-audit");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch { /* ignore fetch error */ }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="p-6 text-center text-gray-400">
        <Cpu className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
        Chargement de la matrice de performance Post R4/E2...
      </div>
    );
  }

  if (!data || !data.performanceMatrix) {
    return (
      <div className="p-6 text-center text-red-400">
        <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
        Erreur de chargement des données R4/E2.
      </div>
    );
  }

  const matrix = data.performanceMatrix || [];
  const health = data.versioningHealth || { violations: 0, mismatchCount: 0, validCount: 0 };
  const shadow = data.shadowSavings || { riskStops: 0, capitalSavedUsd: 0, shadowWinRatePct: 0, shadowProfitFactor: 0 };

  const filteredMatrix = matrix.filter((row: any) => {
    if (symbolFilter !== "ALL" && row.symbol !== symbolFilter) return false;
    if (strategyFilter !== "ALL" && row.strategy !== strategyFilter) return false;
    return true;
  });

  const uniqueSymbols = Array.from(new Set(matrix.map((r: any) => r.symbol)));
  const uniqueStrategies = Array.from(new Set(matrix.map((r: any) => r.strategy)));

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            <h2 className="text-xl font-bold text-white">Matrice de Performance Post R4 / E2</h2>
            <span className="bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-0.5 rounded-full border border-emerald-500/20 font-mono">
              ACTIVE (R4 / E2)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Timestamp de référence : <span className="font-mono text-slate-300">R4_E2_DEPLOYED_AT = {new Date(data.deployedAt).toUTCString()}</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-lg text-right">
            <div className="text-[10px] uppercase text-slate-400">Violations SÉCURITÉ</div>
            <div className={`text-sm font-bold font-mono ${health.violations === 0 ? "text-emerald-400" : "text-red-400"}`}>
              {health.violations} violation(s)
            </div>
          </div>
          <div className="bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-lg text-right">
            <div className="text-[10px] uppercase text-slate-400">Incohérences VERSION</div>
            <div className={`text-sm font-bold font-mono ${health.mismatchCount === 0 ? "text-emerald-400" : "text-amber-400"}`}>
              {health.mismatchCount} incohérence(s)
            </div>
          </div>
        </div>
      </div>

      {/* Shadow Risk Savings Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs text-slate-400 flex items-center justify-between">
            <span>Capital Épargné par Risk Manager</span>
            <Lock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">${shadow.capitalSavedUsd.toFixed(2)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Sur les trades bloqués post-déploiement</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs text-slate-400 flex items-center justify-between">
            <span>Arrêts de Sécurité (Risk Stops)</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white mt-1">{shadow.riskStops}</div>
          <div className="text-[11px] text-slate-500 mt-1">Événements de coupe-circuit</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs text-slate-400">Win Rate Virtuel Shadow</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{shadow.shadowWinRatePct}%</div>
          <div className="text-[11px] text-slate-500 mt-1">Taux de réussite des trades évités</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
          <div className="text-xs text-slate-400">Profit Factor Shadow</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{shadow.shadowProfitFactor.toFixed(2)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Confirmation d'efficacité du filtre</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="text-[11px] uppercase text-slate-400 block mb-1">Symbole</label>
            <select
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary"
            >
              <option value="ALL">Tous les symboles</option>
              {uniqueSymbols.map((s: any) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] uppercase text-slate-400 block mb-1">Stratégie</label>
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary"
            >
              <option value="ALL">Toutes les stratégies</option>
              {uniqueStrategies.map((s: any) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-slate-400">
          <span className="text-white font-bold">{filteredMatrix.length}</span> groupe(s) homogène(s) identifié(s)
        </div>
      </div>

      {/* Main Performance Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-700">
              <tr>
                <th className="p-3">Symbole</th>
                <th className="p-3">Stratégie</th>
                <th className="p-3">Version Strat.</th>
                <th className="p-3">Risk / Exec</th>
                <th className="p-3 text-right">Trades</th>
                <th className="p-3 text-right">Win Rate</th>
                <th className="p-3 text-right">P&L Net ($)</th>
                <th className="p-3 text-right">Profit Factor</th>
                <th className="p-3 text-right">Expectancy ($)</th>
                <th className="p-3 text-center">Échantillon Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredMatrix.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-slate-500">
                    Aucun trade fermé n'a été enregistré sous la nouvelle architecture R4 / E2 depuis {new Date(data.deployedAt).toLocaleTimeString()}.
                  </td>
                </tr>
              ) : (
                filteredMatrix.map((row: any, idx: number) => {
                  const isPositive = row.netPnl >= 0;
                  const sampleBadgeColor =
                    row.sampleSizeStatus === "STRONGER SAMPLE" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                    row.sampleSizeStatus === "INTERMEDIATE" ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" :
                    row.sampleSizeStatus === "EARLY SAMPLE" ? "bg-amber-500/10 text-amber-400 border-amber-500/30" :
                    "bg-slate-800 text-slate-400 border-slate-700";

                  return (
                    <tr key={idx} className="hover:bg-slate-800/40 font-mono">
                      <td className="p-3 font-semibold text-white">{row.symbol}</td>
                      <td className="p-3 text-slate-300">{row.strategy}</td>
                      <td className="p-3">
                        <span className="bg-slate-800 px-2 py-0.5 rounded text-[11px] border border-slate-700 text-slate-300">
                          {row.strategyVersion}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="bg-purple-500/10 text-purple-300 px-1.5 py-0.5 rounded text-[10px] border border-purple-500/20 font-bold mr-1">
                          {row.riskVersion}
                        </span>
                        <span className="bg-blue-500/10 text-blue-300 px-1.5 py-0.5 rounded text-[10px] border border-blue-500/20 font-bold">
                          {row.executionVersion}
                        </span>
                      </td>
                      <td className="p-3 text-right font-bold text-white">{row.closedTrades}</td>
                      <td className="p-3 text-right font-bold">{row.winRatePct}%</td>
                      <td className={`p-3 text-right font-bold ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
                        {isPositive ? `+$${row.netPnl.toFixed(2)}` : `-$${Math.abs(row.netPnl).toFixed(2)}`}
                      </td>
                      <td className="p-3 text-right font-bold">{row.profitFactor.toFixed(2)}</td>
                      <td className={`p-3 text-right ${row.expectancyUsd >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {row.expectancyUsd >= 0 ? `+$${row.expectancyUsd.toFixed(3)}` : `-$${Math.abs(row.expectancyUsd).toFixed(3)}`}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded font-sans border font-semibold ${sampleBadgeColor}`}>
                          {row.sampleSizeStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
