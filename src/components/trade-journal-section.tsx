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
      {/* ── Mobile: clean modern header + stats card ── */}
      <div className="flex flex-col lg:hidden">
        {/* Header Row */}
        <div className="flex items-center justify-between border-b border-white/5 p-4 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <Activity className="h-4 w-4 animate-pulse" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-[0.15em] text-foreground">Suivi Journal</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">{allCombinedTrades.length} positions</span>
                {cloudActive && (
                  <span className="text-[10px] font-black uppercase text-cyan border-l border-white/10 pl-1.5 ml-1.5">
                    {presetLabels[selectedPreset]}
                  </span>
                )}
              </div>
            </div>
          </div>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="h-8 rounded-lg border border-white/10 bg-black/40 px-2 text-[10px] font-bold text-muted-foreground focus:outline-none"
          >
            <option value={20}>20/pg</option>
            <option value={50}>50/pg</option>
            <option value={100}>100/pg</option>
          </select>
        </div>

        {/* Filters Scroll Row */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none border-b border-white/5 p-3">
          <button
            onClick={() => setFilterSmall((v) => !v)}
            className={cn(
              "shrink-0 h-8 rounded-full border px-3 text-[10px] font-black uppercase tracking-wider transition-all",
              filterSmall ? "border-primary/50 bg-primary/20 text-primary shadow-sm" : "border-white/10 bg-white/[0.03] text-muted-foreground"
            )}
          >
            &lt;5$ {filterSmall ? "ON" : "OFF"}
          </button>
          <div className="h-4 w-px bg-white/10 shrink-0 mx-1" />
          <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1">
            {(["5m", "15m", "1h", "24h", "all"] as const).map((tw) => (
              <button
                key={tw}
                onClick={() => setTimeWindow(tw)}
                className={cn(
                  "rounded-full px-3 py-1 text-[10px] font-black uppercase transition-all",
                  timeWindow === tw ? "bg-blue-600/40 text-blue-300 shadow-sm" : "text-muted-foreground"
                )}
              >
                {tw === "all" ? "∞" : tw}
              </button>
            ))}
          </div>
        </div>

        {/* KPI Dashboard Card (Mobile) */}
        <div className="p-3 border-b border-white/10">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5">
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase text-muted-foreground/60 mb-1">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" /> Période
              </div>
              <div className="font-mono text-sm font-black text-foreground">{timeWindow === "all" ? "Tout" : timeWindow}</div>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5">
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase text-muted-foreground/60 mb-1">
                <span className="h-1.5 w-1.5 rounded-full bg-white/40" /> Trades
              </div>
              <div className="font-mono text-sm font-black text-foreground">{periodTradesCount}</div>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-2.5">
              <div className="text-[9px] font-bold uppercase text-muted-foreground/60 mb-1">W / L</div>
              <div className="font-mono text-sm font-black flex items-baseline gap-1.5">
                <span className="text-emerald-400">{periodWins}</span>
                <span className="text-white/20">/</span>
                <span className="text-rose-400">{periodLosses}</span>
              </div>
            </div>
            <div className={cn(
              "rounded-xl border p-2.5",
              periodTotalProfit >= 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5"
            )}>
              <div className="text-[9px] font-bold uppercase text-muted-foreground/60 mb-1">Total P&L</div>
              <div className={cn("font-mono text-sm font-black", periodTotalProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                {periodTotalProfit >= 0 ? "+" : "-"}${Math.abs(periodTotalProfit).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Desktop: original header + filters ── */}
      <div className="hidden lg:flex flex-col lg:flex-row lg:items-center lg:justify-between border-b border-white/10 p-4 gap-3 bg-black/10">
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilterSmall((v) => !v)}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs font-bold transition-all",
              filterSmall ? "border-primary/50 bg-primary/20 text-primary" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground"
            )}
          >
            Filtre &lt; 5$ {filterSmall ? "ON" : "OFF"}
          </button>
          <div className="inline-flex rounded-lg border border-white/10 bg-black/40 p-0.5">
            {(["5m", "15m", "1h", "24h", "all"] as const).map((tw) => (
              <button
                key={tw}
                onClick={() => setTimeWindow(tw)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-bold transition-all",
                  timeWindow === tw ? "bg-blue-600/30 text-blue-400 border border-blue-500/40 shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tw === "all" ? "Tout" : tw}
              </button>
            ))}
          </div>
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

      {/* ── Summary KPI Bar — mobile: hidden (integrated in header card), desktop: 4 cards grid ── */}
      <div className="hidden lg:grid lg:grid-cols-4 lg:gap-3 lg:p-3 border-b border-white/10">
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
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">W / L</div>
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
            {periodTotalProfit >= 0 ? "+" : ""}${periodTotalProfit.toFixed(2)}
          </div>
        </div>
      </div>

      {/* ── Status Tab Filter Bar — mobile: scrollable, desktop: original ── */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-white/5 bg-black/10 px-3 lg:px-4 py-2.5">
        <div className="flex items-center gap-1.5 shrink-0">
          {(["all", "won", "lost", "open", "error"] as const).map((f) => {
            const count = f === "all" ? windowTrades.length : windowTrades.filter((l) => l.status === f).length;
            return (
              <button
                key={f}
                onClick={() => setLogFilter(f)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap border",
                  logFilter === f
                    ? f === "won"
                      ? "bg-up/20 text-up border-up/30 shadow-[0_0_10px_rgba(74,222,128,0.1)]"
                      : f === "lost"
                      ? "bg-down/20 text-down border-down/30 shadow-[0_0_10px_rgba(244,63,94,0.1)]"
                      : f === "open"
                      ? "bg-cyan/20 text-cyan border-cyan/30 shadow-[0_0_10px_rgba(34,211,238,0.1)]"
                      : "bg-white/15 text-foreground border-white/30"
                    : "bg-white/[0.03] text-muted-foreground border-transparent border-white/5"
                )}
              >
                {f === "all" ? "Tous" : f === "won" ? "Gagnés" : f === "lost" ? "Perdus" : f === "open" ? "Ouverts" : "Erreurs"}
                <span className="ml-1.5 text-[9px] opacity-60">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Table Content ── */}
      {displayTrades.length === 0 ? (
        <div className="p-8 lg:p-12 text-center text-xs font-medium text-muted-foreground">
          Aucun trade enregistré pour la période sélectionnée.
        </div>
      ) : (
        <div>
          {/* ── Mobile: premium redesigned trade cards ── */}
          <div className="space-y-2.5 p-3 md:hidden">
            {displayTrades.map((t) => {
              const isBuy = t.direction === "CALL" || t.direction === "MULTUP";
              const isMultiplier = t.direction === "MULTUP" || t.direction === "MULTDOWN";
              const isWon = t.status === "won";
              const isLost = t.status === "lost";
              const isOpen = t.status === "open" || t.status === "pending";
              const isError = t.status === "error" || t.status === "cooldown" || t.status === "risk-stop";
              const symbolLabel = SYMBOLS.find((s) => s.deriv === t.symbol)?.label ?? t.symbol;
              const stakeVal = t.stake || 10;
              const closedTime = t.closedAt ?? (t.expiry && (isWon || isLost) ? t.expiry : null);

              return (
                <div
                  key={t.id}
                  className="relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-3.5 space-y-2.5 transition-all duration-200 shadow-md hover:bg-white/[0.02]"
                >
                  {/* Left vertical accent indicator bar */}
                  <div
                    className={cn(
                      "absolute left-0 top-0 bottom-0 w-1 rounded-l-full",
                      isWon
                        ? "bg-emerald-500"
                        : isLost
                          ? "bg-rose-500"
                          : isError
                            ? "bg-yellow-400 animate-pulse"
                            : isOpen
                              ? "bg-amber-400 animate-pulse"
                              : "bg-white/20"
                    )}
                  />

                  {/* Header Row: Direction Icon + Symbol + Direction Pill + Status Pill */}
                  <div className="flex items-center justify-between gap-2 pl-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-xl border font-mono text-xs font-black shadow-sm",
                          isBuy
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : "border-rose-500/40 bg-rose-500/15 text-rose-300"
                        )}
                      >
                        {isBuy ? "▲" : "▼"}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-black text-foreground truncate">{symbolLabel}</span>
                          <span
                            className={cn(
                              "rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border shrink-0",
                              isBuy
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                            )}
                          >
                            {isBuy ? "HAUSSE ▲" : "BAISSE ▼"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider shadow-sm",
                        isOpen
                          ? "border border-amber-500/40 bg-amber-500/15 text-amber-300 animate-pulse"
                          : isWon
                            ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : isLost
                              ? "border border-rose-500/40 bg-rose-500/15 text-rose-300"
                              : "border border-white/10 bg-white/[0.04] text-muted-foreground"
                      )}
                    >
                      {isOpen ? "En cours" : isWon ? "Gagné" : isLost ? "Perdu" : isError ? "Erreur" : t.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Timestamps Row: Pris à ... · fermé à ... */}
                  <div className="flex items-center justify-between gap-2 pl-1.5 text-[10px] font-semibold text-muted-foreground/80 border-t border-white/5 pt-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-muted-foreground/60">Pris à</span>
                      <span className="font-mono font-bold text-foreground/90">
                        {new Date(t.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      {closedTime && (isWon || isLost) && (
                        <>
                          <span className="text-white/20 mx-0.5">·</span>
                          <span className="text-muted-foreground/60">fermé à</span>
                          <span className="font-mono font-bold text-foreground/90">
                            {new Date(closedTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        </>
                      )}
                    </div>
                    {t.isLiveDeriv && (
                      <span className="shrink-0 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[8px] font-black text-emerald-300 uppercase tracking-wider">
                        Direct Deriv
                      </span>
                    )}
                  </div>

                  {/* Inset Metrics Bar */}
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[0.06] bg-black/40 p-2.5 pl-3 text-xs">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Mise</div>
                      <div className="font-mono text-xs font-black text-foreground">${stakeVal.toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80">Gain / P&L</div>
                      <div
                        className={cn(
                          "font-mono text-xs font-black",
                          isWon ? "text-emerald-300" : isLost ? "text-rose-400" : isOpen ? "text-amber-300" : "text-muted-foreground"
                        )}
                      >
                        {isWon ? `+$${t.profit.toFixed(2)}` : isLost ? `-$${Math.abs(t.profit).toFixed(2)}` : isOpen ? "En cours" : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop: Modern Horizontal Card List Layout ── */}
          <div className="hidden md:flex flex-col gap-2.5 p-4">
            {displayTrades.map((t) => {
              const isBuy = t.direction === "CALL" || t.direction === "MULTUP";
              const isMultiplier = t.direction === "MULTUP" || t.direction === "MULTDOWN";
              const endTime = t.expiry ?? (t.durationMinutes ? t.time + t.durationMinutes * 60_000 : t.time + (durationMinutes || 15) * 60_000);
              const isWon = t.status === "won";
              const isLost = t.status === "lost";
              const isOpen = t.status === "open" || t.status === "pending";
              const isError = t.status === "error" || t.status === "cooldown" || t.status === "risk-stop";
              const symbolLabel = SYMBOLS.find((s) => s.deriv === t.symbol)?.label ?? t.symbol;
              const stakeVal = t.stake || 10;
              const closedTime = t.closedAt ?? (t.expiry && (isWon || isLost) ? t.expiry : null);

              return (
                <div
                  key={t.id}
                  className="relative overflow-hidden rounded-2xl border border-white/10 bg-card/40 p-4 transition-all duration-200 shadow-md hover:bg-white/[0.03] flex items-center justify-between gap-4"
                >
                  {/* Left vertical accent indicator bar */}
                  <div
                    className={cn(
                      "absolute left-0 top-0 bottom-0 w-1 rounded-l-full",
                      isWon
                        ? "bg-emerald-500"
                        : isLost
                          ? "bg-rose-500"
                          : isError
                            ? "bg-yellow-400 animate-pulse"
                            : isOpen
                              ? "bg-amber-400 animate-pulse"
                              : "bg-white/20"
                    )}
                  />

                  {/* Left Group: Symbol, Direction Pill & Timestamps */}
                  <div className="flex items-center gap-4 pl-2 min-w-0">
                    <span
                      className={cn(
                        "grid h-10 w-10 shrink-0 place-items-center rounded-xl border font-mono text-base font-black shadow-md",
                        isBuy
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-emerald-500/10"
                          : "border-rose-500/40 bg-rose-500/15 text-rose-300 shadow-rose-500/10"
                      )}
                    >
                      {isBuy ? "▲" : "▼"}
                    </span>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-black text-foreground truncate">{symbolLabel}</span>
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider border shrink-0",
                            isBuy
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                          )}
                        >
                          {isBuy ? "HAUSSE ▲" : "BAISSE ▼"}
                        </span>
                      </div>

                      {/* Timestamps */}
                      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/80">
                        <span>
                          Pris à <strong className="font-mono text-foreground">{new Date(t.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</strong>
                        </span>
                        {closedTime && (isWon || isLost) ? (
                          <>
                            <span className="text-white/20">·</span>
                            <span>
                              fermé à <strong className="font-mono text-foreground">{new Date(closedTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</strong>
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-white/20">·</span>
                            <span>{isMultiplier ? "ferme au TP/SL" : `fin ~${new Date(endTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Group: Stake, Net P&L & Status Badge */}
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Mise</div>
                      <div className="font-mono text-sm font-black text-foreground">${stakeVal.toFixed(2)}</div>
                    </div>

                    <div className="text-right">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80">Résultat P&L</div>
                      <div
                        className={cn(
                          "font-mono text-sm font-black",
                          isWon ? "text-emerald-300" : isLost ? "text-rose-400" : isOpen ? "text-amber-300" : "text-muted-foreground"
                        )}
                      >
                        {isWon ? `+$${t.profit.toFixed(2)}` : isLost ? `-$${Math.abs(t.profit).toFixed(2)}` : isOpen ? "En cours" : "—"}
                      </div>
                    </div>

                    <span
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider shadow-sm",
                        isOpen
                          ? "border border-amber-500/40 bg-amber-500/15 text-amber-300 animate-pulse"
                          : isWon
                            ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : isLost
                              ? "border border-rose-500/40 bg-rose-500/15 text-rose-300"
                              : isError
                                ? "border border-yellow-400/40 bg-yellow-500/15 text-yellow-300"
                                : "border border-white/10 bg-white/[0.04] text-muted-foreground"
                      )}
                    >
                      {isOpen ? "En cours" : isWon ? `Gagné (+$${t.profit.toFixed(2)})` : isLost ? `Perdu (-$${Math.abs(t.profit).toFixed(2)})` : isError ? "Erreur" : t.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {!cloudActive && (
            <div className="flex justify-end px-3 lg:px-4 py-2 border-t border-white/10 bg-black/40">
              <button
                onClick={async () => {
                  const ok = await confirm({ title: "Effacer le journal ?", description: "Tout l'historique sera supprimé.", confirmLabel: "Effacer", danger: true });
                  if (!ok) return;
                  localStorage.removeItem("lio23.autotrader_log");
                  setEngineLogs([]);
                }}
                className="text-[11px] lg:text-xs text-muted-foreground hover:text-red-400 transition-colors font-semibold underline decoration-dashed"
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
