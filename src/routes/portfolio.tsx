import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock,
  Layers,
  PieChart,
  RefreshCw,
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

type PresetCategoryKey = "default" | "boom" | "crash" | "scalping" | "liquidity" | "manual";

interface PresetMeta {
  label: string;
  badge: string;
  color: string;
  borderColor: string;
  bgTone: string;
}

const PRESET_META_MAP: Record<PresetCategoryKey, PresetMeta> = {
  boom: {
    label: "Preset Boom",
    badge: "⚡ Boom",
    color: "text-rose-400",
    borderColor: "border-rose-500/30",
    bgTone: "bg-rose-500/10",
  },
  crash: {
    label: "Preset Crash",
    badge: "📉 Crash",
    color: "text-purple-400",
    borderColor: "border-purple-500/30",
    bgTone: "bg-purple-500/10",
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
    label: "Reversal Liquidité",
    badge: "💧 Reversal",
    color: "text-blue-400",
    borderColor: "border-blue-500/30",
    bgTone: "bg-blue-500/10",
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
      const [pos, prof, trades] = await Promise.all([
        getOpenPositions().catch(() => []),
        getProfitTable(50).catch(() => []),
        api.get<TradeLog[]>("/api/bot-trades").catch(() => []),
      ]);
      setPositions(pos);
      setProfits(prof);
      setBotTrades(trades);

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

  const todayPnl = pnlToday(profits);
  const openPnl = positions.reduce((acc, p) => acc + p.profit, 0);
  const totalPnl = todayPnl + openPnl;

  const hasDerivOanda = !!(brokerBalances?.deriv || brokerBalances?.oanda);
  const derivOandaTotal = (brokerBalances?.deriv?.balance ?? 0) + (brokerBalances?.oanda?.balance ?? 0);

  // ── Compute Preset Breakdown ──
  const presetStats = (["default", "boom", "crash", "scalping", "manual"] as const).map((key) => {
    const matching = botTrades.filter((t) => (key === "manual" ? !t.preset : t.preset === key));
    const closed = matching.filter((t) => t.status === "won" || t.status === "lost");
    const wins = closed.filter((t) => t.status === "won" || t.profit > 0).length;
    const losses = closed.filter((t) => t.status === "lost" || t.profit < 0).length;
    const netPnl = closed.reduce((acc, t) => acc + t.profit, 0);
    const totalWon = closed.filter((t) => t.profit > 0).reduce((acc, t) => acc + t.profit, 0);
    const totalLost = Math.abs(closed.filter((t) => t.profit < 0).reduce((acc, t) => acc + t.profit, 0));
    const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

    return {
      key,
      meta: PRESET_META_MAP[key],
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
    netPnl: number;
  }>();

  for (const t of botTrades) {
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
        netPnl: 0,
      };
      symbolMap.set(key, entry);
    }

    entry.tradesCount += 1;
    if (t.status === "won" || t.profit > 0) entry.wins += 1;
    else entry.losses += 1;
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
                <th className="px-4 py-3 text-right">P&L Net Cumulé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono">
              {symbolStats.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground font-sans">
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

      {/* ── SECTION 3: RECENT CLOSED TRADES WITH PRESET BADGES ── */}
      <div className="glass-panel rounded-xl overflow-hidden border border-white/10">
        <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span>Historique des Trades Fermés</span>
          </h2>
          <span className="text-xs font-mono text-muted-foreground">
            {botTrades.length > 0 ? `${botTrades.length} enregistrés` : `${profits.length} récents`}
          </span>
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
            {botTrades.length === 0 && profits.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[11px] text-muted-foreground font-sans">
                  {ready ? "Aucun trade récent enregistrer" : noToken ? "Token requis" : "Chargement…"}
                </td>
              </tr>
            )}

            {/* Display rich botTrades from server database */}
            {botTrades.slice(0, 30).map((t) => {
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
