import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock,
  Filter,
  Layers,
  PieChart,
  RefreshCw,
  Search,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getOpenPositions,
  getProfitTable,
  sellContractNow,
  subscribeContract,
  SYMBOLS,
  type OpenPosition,
  type ProfitRecord,
} from "@/lib/deriv";
import { useDerivSession } from "@/hooks/use-deriv-session";
import { useBrokerBalances } from "@/hooks/use-broker-balances";
import { cn } from "@/lib/utils";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { LiveTradeCard } from "@/components/live-trade-card";
import { api } from "@/lib/api";
import type { TradeLog } from "@/lib/signal-core";

export const Route = createFileRoute("/portfolio")({
  head: () => ({ meta: [{ title: "Portfolio — PLURIEL" }] }),
  component: PortfolioPage,
});

type PresetCategoryKey = "default" | "boom" | "boom900" | "vol75" | "rb100" | "vol50" | "crash" | "crash500" | "scalping" | "liquidity" | "gold" | "crash900" | "boomv2" | "scalpingv2" | "liquidityv2" | "goldv2" | "manual";
const PORTFOLIO_PRESETS = ["default", "boom", "boom900", "vol75", "rb100", "vol50", "crash", "crash500", "scalping", "liquidity", "gold", "crash900", "boomv2", "scalpingv2", "liquidityv2", "goldv2"] as const;

interface PresetMeta {
  label: string;
  badge: string;
  color: string;
  borderColor: string;
  bgTone: string;
}

const PRESET_META_MAP: Record<PresetCategoryKey, PresetMeta> = {
  boom: {
    label: "Boom500",
    badge: "⚡ Boom500",
    color: "text-rose-400",
    borderColor: "border-rose-500/30",
    bgTone: "bg-rose-500/10",
  },
  boom900: {
    label: "Boom900",
    badge: "⚡ Boom900",
    color: "text-sky-300",
    borderColor: "border-sky-500/30",
    bgTone: "bg-sky-500/10",
  },
  vol75: {
    label: "Volatility 75 (1s)",
    badge: "📈 Volatility 75 (1s)",
    color: "text-lime-300",
    borderColor: "border-lime-500/30",
    bgTone: "bg-lime-500/10",
  },
  rb100: {
    label: "Range Break 100",
    badge: "↔ Range Break 100",
    color: "text-amber-300",
    borderColor: "border-amber-500/30",
    bgTone: "bg-amber-500/10",
  },
  vol50: {
    label: "Volatility 50 (1s)",
    badge: "📊 Volatility 50 (1s)",
    color: "text-emerald-300",
    borderColor: "border-emerald-500/30",
    bgTone: "bg-emerald-500/10",
  },
  crash: {
    label: "Crash900",
    badge: "📉 Crash900",
    color: "text-purple-400",
    borderColor: "border-purple-500/30",
    bgTone: "bg-purple-500/10",
  },
  crash500: {
    label: "Crash500 — démo",
    badge: "📉 Crash500",
    color: "text-violet-300",
    borderColor: "border-violet-500/30",
    bgTone: "bg-violet-500/10",
  },
  default: {
    label: "Preset Multi",
    badge: "📊 Multi",
    color: "text-amber-400",
    borderColor: "border-amber-500/30",
    bgTone: "bg-amber-500/10",
  },
  scalping: {
    label: "Preset Scalping",
    badge: "🎯 Scalping",
    color: "text-cyan-400",
    borderColor: "border-cyan-500/30",
    bgTone: "bg-cyan-500/10",
  },
  liquidity: {
    label: "Gold Liquidity Sweep",
    badge: "🥇 Liquidity Sweep",
    color: "text-fuchsia-300",
    borderColor: "border-fuchsia-500/30",
    bgTone: "bg-fuchsia-500/10",
  },
  gold: {
    label: "Gold Trend Pullback",
    badge: "🥇 Trend Pullback",
    color: "text-lime-300",
    borderColor: "border-lime-500/30",
    bgTone: "bg-lime-500/10",
  },
  crash900: {
    label: "Crash900 V2",
    badge: "📉 Crash900",
    color: "text-orange-400",
    borderColor: "border-orange-500/30",
    bgTone: "bg-orange-500/10",
  },
  boomv2: {
    label: "Boom V2",
    badge: "⚡ Boom V2",
    color: "text-sky-300",
    borderColor: "border-sky-500/30",
    bgTone: "bg-sky-500/10",
  },
  scalpingv2: {
    label: "Scalping V2",
    badge: "🎯 Scalping V2",
    color: "text-cyan-300",
    borderColor: "border-cyan-500/30",
    bgTone: "bg-cyan-500/10",
  },
  liquidityv2: {
    label: "Liquidity V2",
    badge: "💧 Liquidity V2",
    color: "text-fuchsia-300",
    borderColor: "border-fuchsia-500/30",
    bgTone: "bg-fuchsia-500/10",
  },
  goldv2: {
    label: "Gold Breakout",
    badge: "🥇 Gold Breakout",
    color: "text-amber-300",
    borderColor: "border-amber-500/30",
    bgTone: "bg-amber-500/10",
  },
  manual: {
    label: "Prise Directe Manuelle",
    badge: "✋ Manuel",
    color: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    bgTone: "bg-emerald-500/10",
  },
};

function getPresetMeta(presetKey?: string | null): PresetMeta {
  if (!presetKey) return PRESET_META_MAP.manual;
  return PRESET_META_MAP[presetKey as PresetCategoryKey] || PRESET_META_MAP.manual;
}

function useDerivAuth() {
  const session = useDerivSession();
  return {
    ready: session.connected,
    balance: session.balance,
    currency: session.currency,
    noToken: !session.connecting && session.error === "Aucun token Deriv configuré",
  };
}

function usePortfolio() {
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [profits, setProfits] = useState<ProfitRecord[]>([]);
  const [botTrades, setBotTrades] = useState<TradeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const unsubsRef = useRef<Map<number, () => void>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Performance cards depend only on the local bot journal. Do not make
      // them wait for the slower authenticated Deriv portfolio/profit calls.
      // This is especially visible when arriving from Piste on mobile.
      const botTradesRequest = api.get<TradeLog[]>("/api/bot-trades").catch(() => []);
      const derivRequest = Promise.all([
        getOpenPositions().catch(() => []),
        getProfitTable(50).catch(() => []),
      ]);
      const trades = await botTradesRequest;
      setBotTrades(trades);
      const [pos, prof] = await derivRequest;
      setPositions(pos);
      setProfits(prof);

      // Subscribe to live P&L for each open position
      pos.forEach((p) => {
        if (unsubsRef.current.has(p.contractId)) return;
        const unsub = subscribeContract(p.contractId, (update) => {
          setPositions((prev) =>
            prev.map((x) =>
              x.contractId === update.contractId
                ? { ...x, profit: update.profit, currentSpot: update.currentSpot }
                : x,
            ),
          );
          if (update.status === "won" || update.status === "lost") {
            setPositions((prev) => prev.filter((x) => x.contractId !== update.contractId));
            unsubsRef.current.get(update.contractId)?.();
            unsubsRef.current.delete(update.contractId);
            refresh();
          }
        });
        unsubsRef.current.set(p.contractId, unsub);
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      for (const unsub of unsubsRef.current.values()) unsub();
    };
  }, [refresh]);

  async function close(contractId: number) {
    try {
      const soldFor = await sellContractNow(contractId);
      toast.success(`Position fermée — vendue ${soldFor.toFixed(2)}`);
      unsubsRef.current.get(contractId)?.();
      unsubsRef.current.delete(contractId);
      setPositions((prev) => prev.filter((p) => p.contractId !== contractId));
      setTimeout(refresh, 1500);
    } catch (e) {
      toast.error(`Fermeture échouée: ${(e as Error).message}`);
    }
  }

  return { positions, profits, botTrades, loading, refresh, close };
}

function symbolLabel(derivSym: string) {
  return SYMBOLS.find((s) => s.deriv === derivSym)?.label ?? derivSym;
}

function timeLeft(expiryEpoch: number) {
  const secs = expiryEpoch - Math.floor(Date.now() / 1000);
  if (secs <= 0) return "Expiré";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function TimeLeft({ expiry }: { expiry: number }) {
  const [label, setLabel] = useState(() => timeLeft(expiry));
  useEffect(() => {
    const id = setInterval(() => setLabel(timeLeft(expiry)), 1000);
    return () => clearInterval(id);
  }, [expiry]);
  return <span>{label}</span>;
}

function pnlToday(profits: ProfitRecord[]) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const ts = todayStart.getTime() / 1000;
  return profits
    .filter((p) => p.sellTime >= ts)
    .reduce((acc, p) => acc + p.profit, 0);
}

export default function PortfolioPage() {
  const { ready, balance, currency, noToken } = useDerivAuth();
  const { positions, profits, botTrades, loading, refresh, close } = usePortfolio();
  const { confirmState, confirm } = useConfirm();
  const brokerBalances = useBrokerBalances();
  const [activePresets, setActivePresets] = useState<Set<string> | null>(null);

  useEffect(() => {
    api.get<{ presets?: Record<string, { enabled?: boolean }>; visiblePresets?: string[] }>("/api/bot")
      .then((status) => {
        // Piste owns the display catalogue for both Portfolio and Auto-Trader.
        setActivePresets(new Set(status.visiblePresets ?? Object.keys(status.presets ?? {})));
      })
      .catch(() => setActivePresets(new Set()));
  }, []);

  // Historical rows remain in the database, but Portfolio reports only the
  // currently supported preset set, whether a given engine is stopped or on.
  const visibleBotTrades = useMemo(
    () => activePresets === null
      ? botTrades
      : botTrades.filter((trade) => !trade.preset || activePresets.has(trade.preset)),
    [activePresets, botTrades],
  );

  const todayPnl = pnlToday(profits);
  const openPnl = positions.reduce((acc, p) => acc + p.profit, 0);
  const totalPnl = todayPnl + openPnl;

  const hasDerivOanda = !!(brokerBalances?.deriv || brokerBalances?.oanda);
  const derivOandaTotal = (brokerBalances?.deriv?.balance ?? 0) + (brokerBalances?.oanda?.balance ?? 0);

  // ── History Filter States ──
  const [historyPresetFilter, setHistoryPresetFilter] = useState<string>("all");
  const [historyOutcomeFilter, setHistoryOutcomeFilter] = useState<"all" | "won" | "lost">("all");
  const [historySearchQuery, setHistorySearchQuery] = useState<string>("");

  useEffect(() => {
    if (historyPresetFilter !== "all" && historyPresetFilter !== "manual" && activePresets && !activePresets.has(historyPresetFilter)) {
      setHistoryPresetFilter("all");
    }
  }, [activePresets, historyPresetFilter]);

  const filteredBotTrades = useMemo(() => {
    return visibleBotTrades.filter((t) => {
      // 1. Outcome filter
      const isWin = t.status === "won" || t.profit > 0;
      const isLoss = t.status === "lost" || t.profit < 0;
      if (historyOutcomeFilter === "won" && !isWin) return false;
      if (historyOutcomeFilter === "lost" && !isLoss) return false;

      // 2. Preset filter
      if (historyPresetFilter !== "all") {
        const pKey = t.preset ?? "manual";
        if (pKey !== historyPresetFilter) return false;
      }

      // 3. Search query
      if (historySearchQuery.trim()) {
        const q = historySearchQuery.toLowerCase().trim();
        const label = symbolLabel(t.symbol).toLowerCase();
        const sym = t.symbol.toLowerCase();
        if (!label.includes(q) && !sym.includes(q)) return false;
      }

      return true;
    });
  }, [visibleBotTrades, historyOutcomeFilter, historyPresetFilter, historySearchQuery]);

  const filteredSummary = useMemo(() => {
    const closed = filteredBotTrades.filter((t) => t.status === "won" || t.status === "lost");
    const wins = closed.filter((t) => t.status === "won" || t.profit > 0).length;
    const losses = closed.filter((t) => t.status === "lost" || t.profit < 0).length;
    const netPnl = closed.reduce((acc, t) => acc + t.profit, 0);
    const totalWon = closed.filter((t) => t.profit > 0).reduce((acc, t) => acc + t.profit, 0);
    const totalLost = Math.abs(closed.filter((t) => t.profit < 0).reduce((acc, t) => acc + t.profit, 0));
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
    return { count: closed.length, wins, losses, winRate, netPnl, totalWon, totalLost };
  }, [filteredBotTrades]);

  const keysToDisplay = activePresets
    ? [...PORTFOLIO_PRESETS.filter((p) => activePresets.has(p)), "manual"]
    : [...PORTFOLIO_PRESETS, "manual"];
  const presetStats = keysToDisplay.map((key) => {
    const matching = visibleBotTrades.filter((t) => (key === "manual" ? !t.preset : t.preset === key));
    const closed = matching.filter((t) => t.status === "won" || t.status === "lost");
    const wins = closed.filter((t) => t.status === "won" || t.profit > 0).length;
    const losses = closed.filter((t) => t.status === "lost" || t.profit < 0).length;
    const netPnl = closed.reduce((acc, t) => acc + t.profit, 0);
    const totalWon = closed.filter((t) => t.profit > 0).reduce((acc, t) => acc + t.profit, 0);
    const totalLost = Math.abs(closed.filter((t) => t.profit < 0).reduce((acc, t) => acc + t.profit, 0));
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

    return {
      key,
      meta: PRESET_META_MAP[key as keyof typeof PRESET_META_MAP] ?? PRESET_META_MAP.default,
      tradesCount: closed.length,
      wins,
      losses,
      winRate,
      netPnl,
      totalWon,
      totalLost,
    };
  });

  // ── Compute Symbol / Market Breakdown ──
  const symbolMap = new Map<string, {
    symbol: string;
    label: string;
    market: string;
    presets: Set<string>;
    tradesCount: number;
    wins: number;
    losses: number;
    totalWon: number;
    totalLost: number;
    netPnl: number;
  }>();

  for (const t of visibleBotTrades) {
    if (t.status !== "won" && t.status !== "lost") continue;
    const symObj = SYMBOLS.find((s) => s.deriv === t.symbol);
    const label = symObj?.label ?? t.symbol;
    const market = symObj?.market ?? "Marché";
    const key = t.symbol;

    let entry = symbolMap.get(key);
    if (!entry) {
      entry = {
        symbol: t.symbol,
        label,
        market,
        presets: new Set<string>(),
        tradesCount: 0,
        wins: 0,
        losses: 0,
        totalWon: 0,
        totalLost: 0,
        netPnl: 0,
      };
      symbolMap.set(key, entry);
    }

    entry.tradesCount += 1;
    if (t.status === "won" || t.profit > 0) {
      entry.wins += 1;
      entry.totalWon += t.profit;
    } else {
      entry.losses += 1;
      entry.totalLost += Math.abs(t.profit);
    }
    entry.netPnl += t.profit;
    entry.presets.add(t.preset ?? "manual");
  }

  const symbolStats = Array.from(symbolMap.values()).sort((a, b) => b.netPnl - a.netPnl);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight">Suivi des Gains & Portfolio</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tableau de bord de performance ventilé par <strong>Presets d'Exécution</strong> et par <strong>Marchés</strong>.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="rounded-xl border-white/10 bg-white/[0.03]">
          <RefreshCw className={cn("mr-1.5 h-4 w-4 text-primary", loading && "animate-spin")} />
          Actualiser les données
        </Button>
      </div>

      {noToken && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-400">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-400">Token Deriv manquant</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Configure ton token API Deriv pour accéder aux positions réelles, au solde live et à l'historique des trades.
            </p>
            <a
              href="/settings"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
            >
              Configurer dans Paramètres →
            </a>
          </div>
        </div>
      )}

      {!noToken && ready && (
        <div className="flex items-center gap-2 text-xs text-[color:var(--bull)] font-medium">
          <span className="h-2 w-2 rounded-full bg-[color:var(--bull)] animate-pulse" />
          Flux Direct Temps Réel · Tracking du Bot & Positions Live
        </div>
      )}

      {/* Global KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiBox
          label={hasDerivOanda ? "Balance Total (Deriv + OANDA)" : `Solde (${currency})`}
          value={hasDerivOanda ? `$${derivOandaTotal.toFixed(2)}` : balance !== null ? `$${balance.toFixed(2)}` : "—"}
          icon={<Wallet className="h-4 w-4 text-cyan-400" />}
          tone="cyan"
        />
        <KpiBox
          label="P&L Positions Live"
          value={openPnl >= 0 ? `+$${openPnl.toFixed(2)}` : `-$${Math.abs(openPnl).toFixed(2)}`}
          icon={<TrendingUp className="h-4 w-4" />}
          tone={openPnl >= 0 ? "bull" : "bear"}
        />
        <KpiBox
          label="P&L Fermés Aujourd'hui"
          value={todayPnl >= 0 ? `+$${todayPnl.toFixed(2)}` : `-$${Math.abs(todayPnl).toFixed(2)}`}
          icon={todayPnl >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
          tone={todayPnl >= 0 ? "bull" : "bear"}
        />
        <KpiBox
          label="Total P&L en Cours"
          value={totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`}
          icon={<TrendingDown className="h-4 w-4" />}
          tone={totalPnl >= 0 ? "bull" : "bear"}
        />
      </div>

      {/* ── SECTION 1: PERFORMANCE RECAP BY PRESET ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h2 className="text-base font-extrabold tracking-tight">1. Suivi des Gains & Pertes par Preset</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {presetStats.map((st) => (
            <div
              key={st.key}
              className={cn(
                "rounded-xl border p-4 flex flex-col justify-between gap-3 transition-all bg-black/30",
                st.meta.borderColor
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-md border", st.meta.borderColor, st.meta.bgTone, st.meta.color)}>
                  {st.meta.badge}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground font-bold">{st.tradesCount} trades</span>
              </div>

              <div>
                <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">P&L Net Cumulé</div>
                <div className={cn("text-xl font-black font-mono mt-0.5", st.netPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {st.netPnl >= 0 ? `+$${st.netPnl.toFixed(2)}` : `-$${Math.abs(st.netPnl).toFixed(2)}`}
                </div>
              </div>

              <div className="pt-2 border-t border-white/5 grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div>
                  <span className="text-muted-foreground">Gagné : </span>
                  <span className="text-emerald-400 font-bold">+${st.totalWon.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground font-bold">Win Rate : </span>
                  <span className="text-foreground font-bold">{st.winRate.toFixed(0)}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SECTION 2: PERFORMANCE BY MARKET (SYMBOLS) ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChart className="h-4 w-4 text-primary" />
            <h2 className="text-base font-extrabold tracking-tight">2. Ventilation des Gains par Marché</h2>
          </div>
          <span className="text-xs text-muted-foreground font-mono">{symbolStats.length} marchés enregistrés</span>
        </div>

        <div className="glass-panel rounded-xl overflow-hidden border border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-muted/20 uppercase tracking-wider font-bold text-muted-foreground text-[10px]">
              <tr>
                <th className="px-4 py-3 text-left">Marché / Actif</th>
                <th className="px-4 py-3 text-left">Preset(s) Utilisé(s)</th>
                <th className="px-4 py-3 text-center">Trades (W / L)</th>
                <th className="px-4 py-3 text-right">Taux de Victoire</th>
                <th className="px-4 py-3 text-right">Gains / Pertes Bruts</th>
                <th className="px-4 py-3 text-right">P&L Net Cumulé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono">
              {symbolStats.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-foreground font-sans">
                    Aucune donnée de marché disponible pour le moment.
                  </td>
                </tr>
              )}
              {symbolStats.map((sym) => {
                const wr = sym.tradesCount > 0 ? (sym.wins / sym.tradesCount) * 100 : 0;
                return (
                  <tr key={sym.symbol} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-sans font-extrabold text-foreground">
                      {sym.label}
                      <span className="block text-[10px] text-muted-foreground font-normal">{sym.market}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {Array.from(sym.presets).map((pKey) => {
                          const meta = getPresetMeta(pKey);
                          return (
                            <span key={pKey} className={cn("text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border", meta.borderColor, meta.bgTone, meta.color)}>
                              {meta.badge}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center font-bold">
                      <span className="text-foreground">{sym.tradesCount}</span>{" "}
                      <span className="text-emerald-400 font-normal">({sym.wins}W</span> / <span className="text-rose-400 font-normal">{sym.losses}L)</span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      <span className={cn(wr >= 60 ? "text-emerald-400" : wr >= 50 ? "text-amber-400" : "text-rose-400")}>
                        {wr.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-[11px]">
                      <span className="text-emerald-400 font-bold">+${sym.totalWon.toFixed(2)}</span>
                      <span className="text-muted-foreground font-normal"> / </span>
                      <span className="text-rose-400 font-bold">-${sym.totalLost.toFixed(2)}</span>
                    </td>
                    <td className={cn("px-4 py-3 text-right font-black text-sm", sym.netPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {sym.netPnl >= 0 ? `+$${sym.netPnl.toFixed(2)}` : `-$${Math.abs(sym.netPnl).toFixed(2)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live position visuals */}
      {positions.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[color:var(--brand-cyan)] animate-pulse" />
            <h2 className="text-base font-extrabold tracking-tight">Positions en Mouvement Live</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {positions.map((p) => (
              <LiveTradeCard
                key={p.contractId}
                trade={{
                  id: String(p.contractId),
                  symbol: p.symbol,
                  direction: p.contractType === "PUT" ? "PUT" : "CALL",
                  stake: p.buyPrice,
                  expiry: p.dateExpiry * 1000,
                  liveProfit: p.profit,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Open positions Table */}
      <div className="glass-panel rounded-xl overflow-hidden border border-white/10">
        <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <span>Positions Ouvertes</span>
            <span className="rounded-full bg-primary/20 text-primary px-2 py-0.5 text-[10px] font-bold">
              {positions.length}
            </span>
          </h2>
        </div>
        <table className="w-full">
          <thead className="bg-muted/20 text-xs font-semibold text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left">Actif</th>
              <th className="px-4 py-2.5 text-left">Direction</th>
              <th className="px-4 py-2.5 text-right">Mise</th>
              <th className="px-4 py-2.5 text-right">Spot actuel</th>
              <th className="px-4 py-2.5 text-right">P&L</th>
              <th className="px-4 py-2.5 text-right">Expiration</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[11px] text-muted-foreground">
                  {ready ? "Aucune position ouverte actuellement" : noToken ? "Token requis" : "Chargement…"}
                </td>
              </tr>
            )}
            {positions.map((p) => (
              <tr key={p.contractId} className="border-t border-border/40 hover:bg-muted/10 transition-colors">
                <td className="px-4 py-3 font-medium text-xs">{symbolLabel(p.symbol)}</td>
                <td className="px-4 py-3 text-xs">
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs font-semibold",
                      p.contractType === "CALL" || p.contractType === "MULTUP"
                        ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                        : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
                    )}
                  >
                    {p.contractType === "CALL" || p.contractType === "MULTUP" ? "▲" : "▼"} {p.contractType}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">${p.buyPrice.toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground text-xs">
                  {p.currentSpot > 0 ? p.currentSpot.toFixed(p.symbol && p.symbol.startsWith("frx") ? 5 : 2) : "—"}
                </td>
                <td
                  className={cn(
                    "px-4 py-3 text-right font-mono font-semibold text-xs",
                    p.profit >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]",
                  )}
                >
                  {p.profit >= 0 ? "+" : ""}
                  ${p.profit.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground text-[10px]">
                  <span className="flex items-center justify-end gap-1">
                    <Clock className="h-3 w-3" />
                    <TimeLeft expiry={p.dateExpiry} />
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Fermer la position ?",
                        description: `Vendre ${symbolLabel(p.symbol)} (${p.contractType}) maintenant au prix du marché. P&L actuel : ${p.profit >= 0 ? "+" : ""}${p.profit.toFixed(2)}.`,
                        confirmLabel: "Fermer",
                        danger: p.profit < 0,
                      });
                      if (ok) close(p.contractId);
                    }}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-[color:var(--bear)]"
                    title="Fermer la position"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── SECTION 3: RECENT CLOSED TRADES WITH INTERACTIVE FILTERS ── */}
      <div className="glass-panel rounded-xl overflow-hidden border border-white/10 space-y-0">
        <div className="px-4 py-3 border-b border-border/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">3. Historique des Trades & Filtres Interactifs</h2>
          </div>
          <span className="text-xs font-mono text-muted-foreground">
            {filteredBotTrades.length} / {visibleBotTrades.length > 0 ? visibleBotTrades.length : profits.length} trades affichés
          </span>
        </div>

        {/* Filter Toolbar */}
        <div className="p-3 bg-black/40 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Left: Search input */}
          <div className="relative min-w-[200px] flex-1 sm:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(e.target.value)}
              placeholder="Chercher un marché (ex: BOOM, EURUSD)..."
              className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>

          {/* Center: Outcome tabs (Tous / Won / Lost) */}
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1">
            <button
              onClick={() => setHistoryOutcomeFilter("all")}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer",
                historyOutcomeFilter === "all"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Tous ({visibleBotTrades.length})
            </button>
            <button
              onClick={() => setHistoryOutcomeFilter("won")}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer",
                historyOutcomeFilter === "won"
                  ? "bg-emerald-500 text-black shadow-sm"
                  : "text-emerald-400/70 hover:text-emerald-400"
              )}
            >
              🟢 Victoires ({visibleBotTrades.filter((t) => t.status === "won" || t.profit > 0).length})
            </button>
            <button
              onClick={() => setHistoryOutcomeFilter("lost")}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer",
                historyOutcomeFilter === "lost"
                  ? "bg-rose-500 text-white shadow-sm"
                  : "text-rose-400/70 hover:text-rose-400"
              )}
            >
              🔴 Pertes ({visibleBotTrades.filter((t) => t.status === "lost" || t.profit < 0).length})
            </button>
          </div>

          {/* Right: Preset filter select */}
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={historyPresetFilter}
              onChange={(e) => setHistoryPresetFilter(e.target.value)}
              className="h-8 rounded-lg border border-white/10 bg-black/60 px-3 text-xs font-semibold text-foreground focus:outline-none focus:border-primary/50 cursor-pointer"
            >
              <option value="all">Tous les Presets</option>
              {PORTFOLIO_PRESETS.map((preset) => (
                <option key={preset} value={preset}>{PRESET_META_MAP[preset].badge} {PRESET_META_MAP[preset].label}</option>
              ))}
              <option value="manual">✋ Prise Directe Manuelle</option>
            </select>
          </div>
        </div>

        {/* Dynamic Filter Summary Strip */}
        <div className="px-4 py-2 bg-white/[0.02] border-b border-white/5 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-muted-foreground font-sans text-[10px] font-semibold uppercase">Total Gagné Filtré : </span>
              <span className="font-bold text-emerald-400">+${filteredSummary.totalWon.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground font-sans text-[10px] font-semibold uppercase">Total Perdu Filtré : </span>
              <span className="font-bold text-rose-400">-${filteredSummary.totalLost.toFixed(2)}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div>
              <span className="text-muted-foreground font-sans text-[10px] font-semibold uppercase">Win Rate : </span>
              <span className="font-bold text-foreground">{filteredSummary.winRate.toFixed(1)}%</span>
            </div>
            <div>
              <span className="text-muted-foreground font-sans text-[10px] font-semibold uppercase">P&L Net Filtré : </span>
              <span className={cn("font-black text-sm", filteredSummary.netPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                {filteredSummary.netPnl >= 0 ? `+$${filteredSummary.netPnl.toFixed(2)}` : `-$${Math.abs(filteredSummary.netPnl).toFixed(2)}`}
              </span>
            </div>
          </div>
        </div>

        <table className="w-full text-xs font-mono">
          <thead className="bg-muted/20 text-[10px] uppercase tracking-wider text-muted-foreground font-sans font-bold">
            <tr>
              <th className="px-4 py-2.5 text-left">Actif</th>
              <th className="px-4 py-2.5 text-left">Preset Source</th>
              <th className="px-4 py-2.5 text-left">Direction</th>
              <th className="px-4 py-2.5 text-right">Mise</th>
              <th className="px-4 py-2.5 text-right">P&L Net</th>
              <th className="px-4 py-2.5 text-right font-sans">Heure</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {filteredBotTrades.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-foreground font-sans">
                  Aucun trade ne correspond aux filtres sélectionnés.
                </td>
              </tr>
            )}

            {/* Display filtered trades */}
            {filteredBotTrades.slice(0, 50).map((t) => {
              const meta = getPresetMeta(t.preset);
              const isWin = t.status === "won" || t.profit > 0;
              return (
                <tr key={t.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-2.5 font-sans font-bold text-foreground">
                    {symbolLabel(t.symbol)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn("text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border", meta.borderColor, meta.bgTone, meta.color)}>
                      {meta.badge}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-sans">
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[10px] font-bold",
                        t.direction === "CALL" || t.direction === "MULTUP"
                          ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                          : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
                      )}
                    >
                      {t.direction === "CALL" || t.direction === "MULTUP" ? "▲" : "▼"} {t.direction}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">
                    ${t.stake.toFixed(2)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2.5 text-right font-bold text-xs",
                      isWin ? "text-emerald-400" : "text-rose-400",
                    )}
                  >
                    {isWin ? "+" : ""}
                    ${t.profit.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[10px] text-muted-foreground font-sans">
                    {new Date(t.time).toLocaleTimeString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog state={confirmState} />
    </div>
  );
}

function KpiBox({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "cyan" | "bull" | "bear" | "violet";
}) {
  const colors = {
    cyan: "text-[color:var(--brand-cyan)] border-[color:var(--brand-cyan)]/20 bg-[color:var(--brand-cyan)]/5",
    bull: "text-[color:var(--bull)] border-[color:var(--bull)]/20 bg-[color:var(--bull)]/5",
    bear: "text-[color:var(--bear)] border-[color:var(--bear)]/20 bg-[color:var(--bear)]/5",
    violet: "text-[color:var(--brand-violet)] border-[color:var(--brand-violet)]/20 bg-[color:var(--brand-violet)]/5",
  }[tone];

  return (
    <div className={cn("rounded-xl border p-4", colors)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">{label}</span>
        <span className="opacity-60">{icon}</span>
      </div>
      <div className="mt-2 font-mono-tabular text-2xl font-black leading-none">{value}</div>
    </div>
  );
}
