import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Filter, RefreshCw } from "lucide-react";
import { SignalCard, type SignalItem } from "@/components/signal-card";
import { useDerivCandles } from "@/hooks/use-deriv";
import { generateSignal, type SignalDirection } from "@/lib/indicators";
import { GRANULARITY, SYMBOLS } from "@/lib/deriv";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/signals")({
  head: () => ({ meta: [{ title: "Signaux — Au Pluriel" }] }),
  component: SignalsPage,
});

const HISTORY_KEY = "lio23.signal_history";
const MAX_HISTORY = 50;

interface HistoryEntry {
  time: number;
  pair: string;
  dir: string;
  conf: number;
  tf: string;
}

function saveSignalHistory(entry: HistoryEntry) {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const existing: HistoryEntry[] = raw ? JSON.parse(raw) : [];
    const updated = [entry, ...existing].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    /* ignore */
  }
}

function loadSignalHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const MTF_LABELS = ["5m", "15m", "1H", "4H"] as const;

function DirBadge({ dir, strong = false }: { dir: SignalDirection | "MIXTE"; strong?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-1.5 py-0.5 text-xs",
        strong ? "font-bold" : "font-semibold",
        dir === "BUY"
          ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
          : dir === "SELL"
            ? "bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
            : "bg-muted/40 text-muted-foreground",
      )}
    >
      {dir}
    </span>
  );
}

function SignalsPage() {
  const [filter, setFilter] = useState<"all" | "synthetic" | "indices" | "crypto" | "forex" | "commodity">("all");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setHistory(loadSignalHistory());
  }, []);

  const filtered = SYMBOLS.filter((s) => filter === "all" || s.market === filter);

  function onSignalReady(entry: HistoryEntry) {
    saveSignalHistory(entry);
    setHistory(loadSignalHistory());
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Signaux</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Générés en direct · RSI + MACD + EMA + multi-timeframe
          </p>
        </div>
        <div className="flex items-center gap-2 min-w-0 max-w-full">
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Actualiser
          </button>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="inline-flex items-center rounded-lg border border-border bg-card/40 p-1 text-xs whitespace-nowrap">
              <Filter className="ml-2 mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {(["all", "synthetic", "indices", "forex", "commodity", "crypto"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-1 capitalize transition-colors",
                    filter === f
                      ? "bg-[color:var(--brand-cyan)]/15 text-[color:var(--brand-cyan)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f === "all" ? "Tous" : f === "synthetic" ? "Synthétiques" : f === "indices" ? "Indices" : f === "commodity" ? "Mat. prem." : f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((s) => (
          <LiveSignal key={s.deriv} sym={s} onReady={onSignalReady} refreshKey={refreshKey} />
        ))}
      </div>

      {/* Multi-timeframe analysis */}
      <div>
        <h2 className="mb-3 text-base font-semibold">Analyse multi-timeframe</h2>
        <div className="glass-panel overflow-x-auto rounded-xl">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left">Paire</th>
                {MTF_LABELS.map((tf) => (
                  <th key={tf} className="px-4 py-2.5 text-center">{tf}</th>
                ))}
                <th className="px-4 py-2.5 text-center">Consensus</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <MtfRow key={s.deriv} sym={s} refreshKey={refreshKey} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Signal history */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Historique des signaux</h2>
          {history.length > 0 && (
            <button
              onClick={() => {
                localStorage.removeItem(HISTORY_KEY);
                setHistory([]);
              }}
              className="text-xs text-muted-foreground hover:text-[color:var(--bear)] transition-colors"
            >
              Effacer
            </button>
          )}
        </div>
        <div className="glass-panel overflow-x-auto rounded-xl">
          {history.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Aucun historique — les signaux BUY/SELL apparaîtront ici automatiquement.
            </div>
          ) : (
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left">Heure</th>
                  <th className="px-4 py-2.5 text-left">Paire</th>
                  <th className="px-4 py-2.5 text-left">TF</th>
                  <th className="px-4 py-2.5 text-left">Direction</th>
                  <th className="px-4 py-2.5 text-right">Confiance</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r, idx) => (
                  <tr key={idx} className="border-t border-border/40">
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {new Date(r.time).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{r.pair}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.tf}</td>
                    <td className="px-4 py-2.5">
                      <DirBadge dir={r.dir as SignalDirection} />
                    </td>
                    <td className="px-4 py-2.5 text-right">{r.conf}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveSignal({
  sym,
  onReady,
  refreshKey,
}: {
  sym: (typeof SYMBOLS)[number];
  onReady: (entry: HistoryEntry) => void;
  refreshKey: number;
}) {
  const { candles, loading } = useDerivCandles(sym.deriv, GRANULARITY["15m"], 250, refreshKey);
  const [saved, setSaved] = useState(false);

  const sig = useMemo(() => {
    if (!candles.length) return null;
    return generateSignal(candles);
  }, [candles]);

  useEffect(() => {
    if (sig && !saved && sig.triggers[0] !== "insufficient-data" && sig.direction !== "HOLD") {
      onReady({ time: Date.now(), pair: sym.label, dir: sig.direction, conf: Math.round(sig.confidence), tf: "15m" });
      setSaved(true);
    }
  }, [sig, saved, sym.label, onReady]);

  if (loading || !sig) {
    return <div className="glass-panel h-44 animate-pulse rounded-xl" />;
  }

  const item: SignalItem = {
    pair: sym.label,
    market: sym.market,
    direction: sig.direction,
    confidence: sig.confidence,
    triggers: sig.triggers,
    quality: sig.quality,
    blockers: sig.blockers,
    time: candles[candles.length - 1].epoch * 1000,
  };
  return <SignalCard signal={item} />;
}

/** Each row loads data for all 4 timeframes independently — hooks called unconditionally. */
function MtfRow({ sym, refreshKey }: { sym: (typeof SYMBOLS)[number]; refreshKey: number }) {
  const { candles: c5m } = useDerivCandles(sym.deriv, GRANULARITY["5m"], 250, refreshKey);
  const { candles: c15m } = useDerivCandles(sym.deriv, GRANULARITY["15m"], 250, refreshKey);
  const { candles: c1h } = useDerivCandles(sym.deriv, GRANULARITY["1H"], 250, refreshKey);
  const { candles: c4h } = useDerivCandles(sym.deriv, GRANULARITY["4H"], 250, refreshKey);

  const sigs = useMemo(
    () =>
      [c5m, c15m, c1h, c4h].map((candles) => {
        if (!candles.length) return null;
        return generateSignal(candles);
      }),
    [c5m, c15m, c1h, c4h],
  );

  const consensus = useMemo(() => {
    const valid = sigs.filter((s) => s && s.triggers[0] !== "insufficient-data");
    if (valid.length < 4) return null;
    const buys = valid.filter((s) => s?.direction === "BUY").length;
    const sells = valid.filter((s) => s?.direction === "SELL").length;
    return buys >= 3 ? "BUY" : sells >= 3 ? "SELL" : "MIXTE";
  }, [sigs]);

  return (
    <tr className="border-t border-border/40">
      <td className="px-4 py-2.5 font-medium">{sym.label}</td>
      {sigs.map((sig, i) => (
        <td key={i} className="px-4 py-2.5 text-center">
          {!sig || sig.triggers[0] === "insufficient-data" ? (
            <span className="text-muted-foreground text-xs">…</span>
          ) : (
            <DirBadge dir={sig.direction} />
          )}
        </td>
      ))}
      <td className="px-4 py-2.5 text-center">
        {consensus === null ? (
          <span className="text-xs text-muted-foreground">…</span>
        ) : (
          <DirBadge dir={consensus as SignalDirection | "MIXTE"} strong />
        )}
      </td>
    </tr>
  );
}
