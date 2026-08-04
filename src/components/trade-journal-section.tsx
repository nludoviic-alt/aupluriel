import { useMemo, useState } from "react";
import { Activity, CheckCircle2 } from "lucide-react";
import { SYMBOLS, normalizeContractDirection, type OpenPosition } from "@/lib/deriv";
import { cn } from "@/lib/utils";
import type { TradeLog } from "@/lib/autotrader";

type PresetKey = "default" | "boom" | "crash" | "scalping" | "liquidity";

export function TradeJournalSection({
  journalTrades,
  liveDerivPositions = [],
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
  liveDerivPositions?: OpenPosition[];
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

  const allCombinedTrades = useMemo(() => {
    const list: Array<TradeLog & { isLiveDeriv?: boolean }> = [];

    if (liveDerivPositions && liveDerivPositions.length > 0) {
      for (const pos of liveDerivPositions) {
        const direction = normalizeContractDirection(pos.contractType);
        list.push({
          id: `deriv-${pos.contractId}`,
          time: pos.dateStart * 1000,
          timestamp: pos.dateStart * 1000,
          symbol: pos.symbol,
          direction,
          stake: pos.buyPrice,
          status: "open",
          profit: pos.profit,
          pnl: pos.profit,
          confidence: 0,
          isLiveDeriv: true,
          // Deriv's date_expiry is only a real settlement time for binaries —
          // for Multiplier contracts it's absent/defaulted server-side and
          // means nothing (they close on TP/SL, not on a clock), so it's kept
          // off MULTUP/MULTDOWN rows entirely rather than displayed as fact.
          ...(direction === "CALL" || direction === "PUT" ? { expiry: pos.dateExpiry * 1000 } : {}),
        } as unknown as TradeLog & { isLiveDeriv?: boolean });
      }
    }

    for (const t of journalTrades) {
      if (!list.some((item) => item.id === `deriv-${t.contractId}` || item.id === t.id)) {
        list.push(t);
      }
    }

    return list;
  }, [journalTrades, liveDerivPositions]);

  // Filter trades by time window and small stake/profit filter
  const windowTrades = useMemo(() => {
    return allCombinedTrades.filter((t) => {
      if (t.isLiveDeriv) return true; // Keep live Deriv positions visible
      if (windowCutoff > 0 && t.time < windowCutoff) return false;
      if (filterSmall && Math.abs(t.profit) < 5 && t.stake < 5) return false;
      return true;
    });
  }, [allCombinedTrades, windowCutoff, filterSmall]);

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
      {/* ── Top Bar Controls ── */}
      <div className="flex flex-col gap-3 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-7 w-7 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <Activity className="h-4 w-4 animate-pulse" />
          </div>
          <span className="text-xs font-black uppercase tracking-wider text-foreground">Suivi des Contrats & Positions</span>
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
            {allCombinedTrades.length} au total
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
        <div>
          {/* ── Mobile: cards — the table below overflowed the viewport on
              phones (a 4th column ran off-screen with no way to see it, since
              overflow-x-auto just clips silently rather than showing a scroll
              affordance for a table this dense). ── */}
          <div className="divide-y divide-white/[0.06] md:hidden">
            {displayTrades.map((t) => {
              const isBuy = t.direction === "CALL" || t.direction === "MULTUP";
              const isMultiplier = t.direction === "MULTUP" || t.direction === "MULTDOWN";
              const endTime = t.expiry ?? (t.durationMinutes ? t.time + t.durationMinutes * 60_000 : t.time + (durationMinutes || 15) * 60_000);
              const isWon = t.status === "won";
              const isLost = t.status === "lost";
              const isOpen = t.status === "open" || t.status === "pending";
              const symbolLabel = SYMBOLS.find((s) => s.deriv === t.symbol)?.label ?? t.symbol;
              const stakeVal = t.stake || 10;

              return (
                <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "shrink-0 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider",
                        isBuy ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                      )}
                    >
                      {isBuy ? "▲" : "▼"}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-foreground">{symbolLabel}</div>
                      <div className="font-mono text-[10px] text-muted-foreground/70">
                        {new Date(t.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        {" · "}${stakeVal.toFixed(2)}
                        {!isMultiplier && !isOpen ? "" : isMultiplier ? " · TP/SL" : ` · fin ~${new Date(endTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {isOpen ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-black uppercase text-amber-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> En cours
                      </span>
                    ) : isWon ? (
                      <span className="font-mono text-sm font-black text-emerald-400">+${t.profit.toFixed(2)}</span>
                    ) : isLost ? (
                      <span className="font-mono text-sm font-black text-rose-400">-${Math.abs(t.profit).toFixed(2)}</span>
                    ) : (
                      <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{t.status.toUpperCase()}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop: full table ── */}
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/10 bg-black/40 text-[11px] font-black uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3.5">Sens</th>
                <th className="px-4 py-3.5">Marché / Paire</th>
                <th className="px-4 py-3.5 text-right">Mise Engagée</th>
                <th className="px-4 py-3.5 text-right">Gain Potentiel</th>
                <th className="px-4 py-3.5 text-center">Heure / Fin</th>
                <th className="px-4 py-3.5 text-center">Statut</th>
                <th className="px-4 py-3.5 text-right">Résultat P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {displayTrades.map((t) => {
                const isBuy = t.direction === "CALL" || t.direction === "MULTUP";
                // Multiplier contracts (Boom/Crash/Scalping) have no fixed expiry — they
                // close on TP/SL, not on a clock, so a "fin ~" time is fabricated for them
                // and was routinely off by 10-20+ minutes. Only binaries get a real ETA.
                const isMultiplier = t.direction === "MULTUP" || t.direction === "MULTDOWN";
                const endTime = t.expiry ?? (t.durationMinutes ? t.time + t.durationMinutes * 60_000 : t.time + (durationMinutes || 15) * 60_000);
                const isWon = t.status === "won";
                const isLost = t.status === "lost";
                const isOpen = t.status === "open" || t.status === "pending";
                const symbolLabel = SYMBOLS.find((s) => s.deriv === t.symbol)?.label ?? t.symbol;
                const stakeVal = t.stake || 10;
                const potentialProfit = isWon ? t.profit : stakeVal * 0.85;

                return (
                  <tr key={t.id} className="hover:bg-white/[0.03] transition-all">
                    {/* SENS */}
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-black uppercase tracking-wider shadow-sm",
                          isBuy ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                        )}
                      >
                        {isBuy ? "▲ HAUSSE" : "▼ BAISSE"}
                      </span>
                    </td>

                    {/* SYMBOLE */}
                    <td className="px-4 py-4 font-black text-sm text-foreground max-w-[180px] truncate" title={symbolLabel}>
                      {symbolLabel}
                    </td>

                    {/* MISE ENGAGÉE */}
                    <td className="px-4 py-4 text-right font-mono text-sm font-black text-foreground">
                      ${stakeVal.toFixed(2)} USD
                    </td>

                    {/* GAIN POTENTIEL */}
                    <td className="px-4 py-4 text-right font-mono text-sm font-black text-emerald-300">
                      +${potentialProfit.toFixed(2)} USD <span className="text-[10px] font-semibold text-emerald-400/80">(+85%)</span>
                    </td>

                    {/* CONF / HEURE */}
                    <td className="px-4 py-4 text-center font-mono text-xs text-muted-foreground/80">
                      <div>{new Date(t.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
                      {isMultiplier ? (
                        <div className="text-[10px] text-muted-foreground/50">ferme au TP/SL</div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground/50">fin ~{new Date(endTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
                      )}
                    </td>

                    {/* STATUS */}
                    <td className="px-4 py-4 text-center">
                      {isOpen ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-black uppercase text-amber-300 animate-pulse">
                          <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                          En cours
                        </span>
                      ) : isWon ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-black uppercase text-emerald-300">
                          Gagné
                        </span>
                      ) : isLost ? (
                        <span className="inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/15 px-3 py-1 text-xs font-black uppercase text-rose-300">
                          Perdu
                        </span>
                      ) : (
                        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-bold text-muted-foreground">
                          {t.status.toUpperCase()}
                        </span>
                      )}
                    </td>

                    {/* PROFIT RÉSULTAT */}
                    <td
                      className={cn(
                        "px-4 py-4 text-right font-mono font-black text-sm whitespace-nowrap",
                        isWon ? "text-emerald-400" : isLost ? "text-rose-400" : "text-muted-foreground"
                      )}
                    >
                      {isWon && `+$${t.profit.toFixed(2)} USD`}
                      {isLost && `-$${Math.abs(t.profit).toFixed(2)} USD`}
                      {!isWon && !isLost && "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

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
