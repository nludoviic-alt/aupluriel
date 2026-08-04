import { useMemo, useState } from "react";
import { SYMBOLS } from "@/lib/deriv";
import { cn } from "@/lib/utils";
import type { TradeLog } from "@/lib/autotrader";

type PresetKey = "default" | "boom" | "crash" | "scalping" | "liquidity";

export function TradeJournalSection({
  journalTrades,
  cloudActive,
  selectedPreset,
  presetLabels,
  logFilter,
  setLogFilter,
  confirm,
  setEngineLogs,
  durationMinutes = 15,
}: {
  journalTrades: TradeLog[];
  cloudActive: boolean;
  selectedPreset: PresetKey;
  presetLabels: Record<PresetKey, string>;
  logFilter: "all" | "won" | "lost" | "open" | "error";
  setLogFilter: (f: "all" | "won" | "lost" | "open" | "error") => void;
  confirm: (opts: any) => Promise<boolean>;
  setEngineLogs: (logs: TradeLog[] | ((prev: TradeLog[]) => TradeLog[])) => void;
  durationMinutes?: number;
}) {
  const [timeWindow, setTimeWindow] = useState<"5m" | "15m" | "1h" | "24h" | "all">("15m");
  const [filterSmall, setFilterSmall] = useState<boolean>(false);
  const [pageSize, setPageSize] = useState<number>(50);

  // Compute time window cutoff
  const now = Date.now();
  const windowCutoff = useMemo(() => {
    if (timeWindow === "5m") return now - 5 * 60 * 1000;
    if (timeWindow === "15m") return now - 15 * 60 * 1000;
    if (timeWindow === "1h") return now - 60 * 60 * 1000;
    if (timeWindow === "24h") return now - 24 * 60 * 60 * 1000;
    return 0;
  }, [timeWindow, now]);

  // Filter trades by time window and small stake/profit filter
  const windowTrades = useMemo(() => {
    return journalTrades.filter((t) => {
      if (windowCutoff > 0 && t.time < windowCutoff) return false;
      if (filterSmall && Math.abs(t.profit) < 5 && t.stake < 5) return false;
      return true;
    });
  }, [journalTrades, windowCutoff, filterSmall]);

  // Period stats
  const periodTradesCount = windowTrades.length;
  const periodWins = windowTrades.filter((t) => t.status === "won").length;
  const periodLosses = windowTrades.filter((t) => t.status === "lost").length;
  const periodTotalProfit = windowTrades
    .filter((t) => t.status === "won" || t.status === "lost")
    .reduce((sum, t) => sum + (t.profit || 0), 0);

  // Filtered by status tab
  const displayTrades = useMemo(() => {
    const statusFiltered = logFilter === "all" ? windowTrades : windowTrades.filter((l) => l.status === logFilter);
    return statusFiltered.slice(0, pageSize);
  }, [windowTrades, logFilter, pageSize]);

  return (
    <div className="glass-panel overflow-hidden rounded-2xl border border-white/10 bg-[#0B0F19]/90 shadow-2xl">
      {/* ── Top Bar Controls (Matching Screenshot Header) ── */}
      <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-black uppercase tracking-widest text-muted-foreground/90">Trades Récents</span>
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
            {journalTrades.length} au total
          </span>
          {cloudActive && (
            <span className="rounded-md border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-cyan">
              {presetLabels[selectedPreset]}
            </span>
          )}
        </div>

        {/* Filter controls matching screenshot */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Small filter toggle */}
          <button
            onClick={() => setFilterSmall((v) => !v)}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs font-bold transition-all",
              filterSmall
                ? "border-primary/50 bg-primary/20 text-primary"
                : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground"
            )}
          >
            Filtre &lt; 5$ {filterSmall ? "ON" : "OFF"}
          </button>

          {/* Timeframe pills */}
          <div className="inline-flex rounded-lg border border-white/10 bg-black/40 p-0.5">
            {(["5m", "15m", "1h", "24h", "all"] as const).map((tw) => (
              <button
                key={tw}
                onClick={() => setTimeWindow(tw)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-bold transition-all",
                  timeWindow === tw
                    ? "bg-blue-600/30 text-blue-400 border border-blue-500/40 shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tw === "all" ? "Tout" : tw}
              </button>
            ))}
          </div>

          {/* Page size dropdown */}
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-white/10 bg-black/40 px-2.5 text-xs font-bold text-muted-foreground hover:text-foreground focus:outline-none"
          >
            <option value={20}>20/page</option>
            <option value={50}>50/page</option>
            <option value={100}>100/page</option>
          </select>
        </div>
      </div>

      {/* ── Summary KPI Bar Cards (Matching Screenshot 4 Cards) ── */}
      <div className="grid grid-cols-2 gap-2 border-b border-white/10 p-3 sm:grid-cols-4 sm:gap-3">
        {/* Card 1: Période */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Période</div>
          <div className="mt-1 font-mono text-base font-black text-foreground">{timeWindow === "all" ? "Tout" : timeWindow}</div>
        </div>

        {/* Card 2: Trades */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Trades</div>
          <div className="mt-1 font-mono text-base font-black text-foreground">{periodTradesCount}</div>
        </div>

        {/* Card 3: Wins/Losses */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Wins / Losses</div>
          <div className="mt-1 font-mono text-base font-black">
            <span className="text-up">{periodWins}</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="text-down">{periodLosses}</span>
          </div>
        </div>

        {/* Card 4: Total P&L */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Total</div>
          <div className={cn("mt-1 font-mono text-base font-black", periodTotalProfit >= 0 ? "text-up" : "text-down")}>
            {periodTotalProfit >= 0 ? "+" : ""}${periodTotalProfit.toFixed(4)}
          </div>
        </div>
      </div>

      {/* ── Status Tab Filter Bar ── */}
      <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-4 py-2">
        <div className="flex items-center gap-1">
          {(["all", "won", "lost", "open", "error"] as const).map((f) => {
            const count = f === "all" ? windowTrades.length : windowTrades.filter((l) => l.status === f).length;
            return (
              <button
                key={f}
                onClick={() => setLogFilter(f)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-bold transition-all",
                  logFilter === f
                    ? f === "won"
                      ? "bg-up/20 text-up border border-up/30"
                      : f === "lost"
                      ? "bg-down/20 text-down border border-down/30"
                      : f === "open"
                      ? "bg-cyan/20 text-cyan border border-cyan/30"
                      : "bg-white/15 text-foreground border border-white/20"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "all" ? "Tous" : f === "won" ? "Gagnés" : f === "lost" ? "Perdus" : f === "open" ? "Ouverts" : "Erreurs"} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Table Content (Styled like screenshot) ── */}
      {displayTrades.length === 0 ? (
        <div className="p-12 text-center text-xs font-medium text-muted-foreground">
          Aucun trade enregistré pour la période sélectionnée.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/10 bg-black/40 text-[10px] font-black uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Origine / Paire</th>
                <th className="px-4 py-3 text-right">Mise</th>
                <th className="px-4 py-3 text-center">Conf. / Heure</th>
                <th className="px-4 py-3 text-center">Fin</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {displayTrades.map((t) => {
                const isBuy = t.direction === "CALL" || t.direction === "MULTUP";
                const isWon = t.status === "won";
                const isLost = t.status === "lost";
                const symbolLabel = SYMBOLS.find((s) => s.deriv === t.symbol)?.label ?? t.symbol;

                return (
                  <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                    {/* TYPE */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
                          isBuy ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"
                        )}
                      >
                        {isBuy ? "BUY" : "SELL"}
                      </span>
                    </td>

                    {/* SYMBOLE */}
                    <td className="px-4 py-3 font-bold text-foreground max-w-[160px] truncate" title={symbolLabel}>
                      {symbolLabel}
                    </td>

                    {/* MISE */}
                    <td className="px-4 py-3 text-right font-mono-tabular font-bold text-muted-foreground">
                      {t.stake > 0 ? `$${t.stake.toFixed(2)}` : "—"}
                    </td>

                    {/* CONF / HEURE */}
                    <td className="px-4 py-3 text-center font-mono text-muted-foreground">
                      {new Date(t.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      {t.confidence > 0 && <span className="ml-1 text-[10px] text-cyan">({t.confidence}%)</span>}
                    </td>

                    {/* FIN */}
                    <td className="px-4 py-3 text-center font-mono text-muted-foreground">
                      {new Date(t.time + (durationMinutes || 15) * 60 * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </td>

                    {/* STATUS */}
                    <td className="px-4 py-3 text-center">
                      <span
                        className={cn(
                          "inline-flex rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
                          t.status === "open"
                            ? "bg-cyan/15 text-cyan border border-cyan/30 animate-pulse"
                            : isWon
                            ? "bg-emerald-500/10 text-emerald-400"
                            : isLost
                            ? "bg-red-500/10 text-red-400"
                            : "bg-white/10 text-muted-foreground"
                        )}
                      >
                        {t.status === "open" ? "OPEN" : isWon ? "CLOSED" : isLost ? "CLOSED" : t.status.toUpperCase()}
                      </span>
                    </td>

                    {/* PROFIT */}
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-mono-tabular font-black text-sm whitespace-nowrap",
                        isWon ? "text-emerald-400" : isLost ? "text-red-400" : "text-muted-foreground"
                      )}
                    >
                      {isWon && `+$${t.profit.toFixed(4)}`}
                      {isLost && `-$${Math.abs(t.profit).toFixed(4)}`}
                      {!isWon && !isLost && "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!cloudActive && (
            <div className="flex justify-end px-4 py-2.5 border-t border-white/10 bg-black/40">
              <button
                onClick={async () => {
                  const ok = await confirm({ title: "Effacer le journal ?", description: "Tout l'historique sera supprimé.", confirmLabel: "Effacer", danger: true });
                  if (!ok) return;
                  localStorage.removeItem("lio23.autotrader_log");
                  setEngineLogs([]);
                }}
                className="text-xs text-muted-foreground hover:text-red-400 transition-colors font-semibold underline decoration-dashed"
              >
                Effacer le journal
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
