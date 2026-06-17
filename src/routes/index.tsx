import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Bot, BriefcaseBusiness, CalendarClock, Radar, Wallet, Zap } from "lucide-react";
import { PriceChart } from "@/components/price-chart";
import { SignalCard, type SignalItem } from "@/components/signal-card";
import { useDerivCandles, useDerivTicks } from "@/hooks/use-deriv";
import { generateSignal } from "@/lib/indicators";
import { getProfitTable, GRANULARITY, SYMBOLS } from "@/lib/deriv";
import { useDerivSession } from "@/hooks/use-deriv-session";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — LIO23" },
      { name: "description", content: "Dashboard de trading LIO23 avec données Deriv en temps réel." },
      { property: "og:title", content: "Dashboard — LIO23" },
      { property: "og:description", content: "Portfolio, signaux IA et marchés en temps réel." },
    ],
  }),
  component: Dashboard,
});

function useDerivBalance() {
  const session = useDerivSession();
  if (!session.connected || session.balance === null) return null;
  return { amount: session.balance, currency: session.currency };
}

function useRealStats() {
  const [winRate, setWinRate] = useState<number | null>(null);
  const [todayPnl, setTodayPnl] = useState<number | null>(null);
  const [tradeCount, setTradeCount] = useState<number | null>(null);
  useEffect(() => {
    const token = localStorage.getItem("lio23.deriv_token");
    if (!token) return;
    getProfitTable(200).then((records) => {
      if (records.length === 0) return;
      const wins = records.filter((r) => r.profit > 0).length;
      setWinRate((wins / records.length) * 100);
      setTradeCount(records.length);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const ts = todayStart.getTime() / 1000;
      const todayRecords = records.filter((r) => r.sellTime >= ts);
      setTodayPnl(todayRecords.reduce((acc, r) => acc + r.profit, 0));
    }).catch(() => {});
  }, []);
  return { winRate, todayPnl, tradeCount };
}

function Dashboard() {
  const [chartSymbol, setChartSymbol] = useState(SYMBOLS[0]);
  const [marketFilter, setMarketFilter] = useState<"all" | "crypto" | "forex">("all");
  const { series, last, status } = useDerivTicks(chartSymbol.deriv, 180);

  // Filter pairs by market: "forex" also includes commodities (gold)
  const visibleSymbols = SYMBOLS.filter((s) =>
    marketFilter === "all" ? true : marketFilter === "crypto" ? s.market === "crypto" : s.market !== "crypto",
  );

  function selectMarket(f: "all" | "crypto" | "forex") {
    setMarketFilter(f);
    const list = SYMBOLS.filter((s) =>
      f === "all" ? true : f === "crypto" ? s.market === "crypto" : s.market !== "crypto",
    );
    if (list.length && !list.some((s) => s.deriv === chartSymbol.deriv)) {
      setChartSymbol(list[0]);
    }
  }
  const derivBalance = useDerivBalance();
  const { winRate, todayPnl, tradeCount } = useRealStats();
  const { user } = useAuth();
  const firstName = user?.username ?? "trader";

  const liveSignals = useLiveSignals();

  const equity = useMemo(() => {
    let v = 10000;
    const out: { t: number; price: number }[] = [];
    const now = Date.now();
    for (let i = 0; i < 60; i++) {
      v *= 1 + (Math.random() - 0.45) * 0.012;
      out.push({ t: now - (60 - i) * 60_000, price: v });
    }
    return out;
  }, []);
  const portfolio = equity[equity.length - 1]?.price ?? 10000;

  // 24h change from first to last tick
  const priceChange = useMemo(() => {
    if (series.length < 2) return null;
    const first = series[0].price;
    const lp = series[series.length - 1].price;
    return ((lp - first) / first) * 100;
  }, [series]);

  const isForex = chartSymbol.market === "forex";
  const balanceDisplay = derivBalance
    ? `${derivBalance.currency} ${derivBalance.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${portfolio.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const now = new Date();

  return (
    <div className="p-6 space-y-5">
      {/* ── Top stats strip (Voltrex-style) ───────────────────────── */}
      <div className="glass-panel rounded-2xl px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Bonjour, <span className="text-[color:var(--brand-cyan)]">{firstName}</span>
                </h1>
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wider",
                  status === "live"
                    ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                    : "bg-muted/40 text-muted-foreground",
                )}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", status === "live" ? "bg-[color:var(--bull)] animate-pulse" : "bg-muted-foreground")} />
                  {status === "live" ? "Live" : status === "connecting" ? "…" : "Off"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Crypto & Forex · via Deriv</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Metric
              label={derivBalance ? `Balance (${derivBalance.currency})` : "Portfolio (démo)"}
              value={balanceDisplay}
              tone="cyan"
            />
            <Metric
              label="Win Rate"
              value={winRate !== null ? `${winRate.toFixed(1)}%` : "—"}
              sub={tradeCount !== null ? `${tradeCount} trades` : undefined}
              tone="bull"
            />
            <Metric
              label="P&L aujourd'hui"
              value={todayPnl !== null ? `${todayPnl >= 0 ? "+" : ""}${todayPnl.toFixed(2)}` : "—"}
              tone={todayPnl === null ? "default" : todayPnl >= 0 ? "bull" : "bear"}
            />
            <Metric
              label={`${chartSymbol.label} (24h)`}
              value={last ? last.toFixed(isForex ? 5 : 2) : "—"}
              sub={priceChange !== null ? `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}%` : undefined}
              subTone={priceChange !== null ? (priceChange >= 0 ? "bull" : "bear") : "default"}
            />
          </div>
        </div>
      </div>

      {/* ── Status / session bar (epoch-style) ─────────────────────── */}
      <div className="glass-panel flex flex-wrap items-center gap-4 rounded-xl px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[color:var(--brand-violet)]/15 text-[color:var(--brand-violet)]">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Session</div>
            <div className="text-sm font-semibold text-foreground">Marché en direct</div>
          </div>
        </div>
        <div className="hidden text-xs text-muted-foreground sm:block">
          {now.toLocaleDateString("fr-FR")} · {now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-muted/40 md:block">
            <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)]" />
          </div>
          <span className="text-xs text-muted-foreground">Deriv WS · app_id 1089</span>
        </div>
      </div>

      {/* ── Main: chart (2/3) + action panel (1/3) ─────────────────── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-foreground">{chartSymbol.label}</h2>
                {priceChange !== null && (
                  <span className={cn("text-xs font-semibold", priceChange >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                    {priceChange >= 0 ? "▲" : "▼"} {Math.abs(priceChange).toFixed(2)}%
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">
                {last ? last.toFixed(isForex ? 5 : 2) : "—"}
              </div>
            </div>
            <span className="rounded-lg border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">
              Temps réel
            </span>
          </div>

          {/* Market filter: Tous / Crypto / Forex */}
          <div className="mt-3 inline-flex rounded-lg border border-border bg-muted/20 p-0.5">
            {([
              { id: "all", label: "Tous" },
              { id: "crypto", label: "Crypto" },
              { id: "forex", label: "Forex" },
            ] as const).map((f) => (
              <button
                key={f.id}
                onClick={() => selectMarket(f.id)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                  marketFilter === f.id
                    ? "bg-[color:var(--brand-cyan)]/15 text-[color:var(--brand-cyan)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Symbol selector (allocation-style chips) */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {visibleSymbols.map((s) => (
              <button
                key={s.deriv}
                onClick={() => setChartSymbol(s)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                  chartSymbol.deriv === s.deriv
                    ? "bg-[color:var(--brand-cyan)]/15 text-[color:var(--brand-cyan)] border border-[color:var(--brand-cyan)]/30"
                    : "border border-border bg-muted/30 text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="mt-4 h-80">
            {series.length > 1 ? (
              <PriceChart data={series} />
            ) : (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 animate-pulse" />
                  En attente des ticks Deriv…
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right action panel (Voltrex deposit-style) */}
        <div className="glass-panel flex flex-col rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Mon compte</h2>
            <Wallet className="h-4 w-4 text-[color:var(--brand-cyan)]" />
          </div>

          <div className="mt-3 rounded-xl border border-border/60 bg-muted/20 p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Balance</div>
            <div className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">{balanceDisplay}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {derivBalance ? "Compte Deriv connecté" : "Mode démo — connecte ton token"}
            </div>
          </div>

          {/* Quick actions */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <ActionTile to="/autotrader" icon={<Zap className="h-4 w-4" />} label="Auto-Trader" />
            <ActionTile to="/portfolio" icon={<BriefcaseBusiness className="h-4 w-4" />} label="Portfolio" />
            <ActionTile to="/signals" icon={<Radar className="h-4 w-4" />} label="Signaux" />
            <ActionTile to="/settings" icon={<Wallet className="h-4 w-4" />} label="Déposer" />
          </div>

          <div className="mt-4 rounded-xl border border-border/60 bg-muted/10 p-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-[color:var(--brand-cyan)]" />
              <span className="text-sm font-semibold text-foreground">Assistant Lio23</span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              Analyse marché, signaux et backtest en langage naturel — avec les données Deriv en direct.
            </p>
          </div>

          <Button asChild className="mt-4 w-full bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-semibold hover:opacity-90">
            <Link to="/assistant">
              Ouvrir le chat <ArrowUpRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Bottom: signal cards (copy-trading style) ──────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Signaux IA actifs</h2>
          <Link to="/signals" className="text-xs text-[color:var(--brand-cyan)] hover:underline">
            Voir tout →
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {liveSignals.length === 0
            ? [0, 1, 2].map((i) => (
                <div key={i} className="glass-panel h-44 animate-pulse rounded-2xl" />
              ))
            : liveSignals.slice(0, 3).map((s) => <SignalCard key={s.pair} signal={s} />)}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        ⚠️ Le trading comporte des risques. LIO23 fournit des analyses, pas des conseils financiers.
        Toutes les décisions restent sous contrôle humain.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "default",
  subTone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "cyan" | "bull" | "bear" | "violet";
  subTone?: "default" | "bull" | "bear";
}) {
  const toneCls = {
    default: "text-foreground",
    cyan: "text-[color:var(--brand-cyan)]",
    bull: "text-[color:var(--bull)]",
    bear: "text-[color:var(--bear)]",
    violet: "text-[color:var(--brand-violet)]",
  }[tone];
  const subCls = {
    default: "text-muted-foreground",
    bull: "text-[color:var(--bull)]",
    bear: "text-[color:var(--bear)]",
  }[subTone];
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-xl font-bold tracking-tight", toneCls)}>{value}</div>
      {sub && <div className={cn("text-xs font-medium", subCls)}>{sub}</div>}
    </div>
  );
}

function ActionTile({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-[color:var(--brand-cyan)]/40 hover:bg-[color:var(--brand-cyan)]/5"
    >
      <span className="text-[color:var(--brand-cyan)]">{icon}</span>
      {label}
    </Link>
  );
}

function useLiveSignals() {
  // Fixed, unconditional candle hooks (no hooks-in-loop)
  const { candles: btc } = useDerivCandles("cryBTCUSD", GRANULARITY["15m"], 250);
  const { candles: eur } = useDerivCandles("frxEURUSD", GRANULARITY["15m"], 250);
  const { candles: eth } = useDerivCandles("cryETHUSD", GRANULARITY["15m"], 250);

  // Memoize the heavy signal computation: only recompute when candle data
  // actually changes (last epoch), NOT on every live tick re-render.
  return useMemo(() => {
    const defs = [
      { def: SYMBOLS.find((s) => s.deriv === "cryBTCUSD")!, candles: btc },
      { def: SYMBOLS.find((s) => s.deriv === "frxEURUSD")!, candles: eur },
      { def: SYMBOLS.find((s) => s.deriv === "cryETHUSD")!, candles: eth },
    ];
    const out: SignalItem[] = defs.map(({ def, candles }) => {
      const sig = generateSignal(candles);
      return {
        pair: def.label,
        market: def.market,
        direction: sig.direction,
        confidence: sig.confidence,
        triggers: sig.triggers,
        quality: sig.quality,
        blockers: sig.blockers,
        time: candles[candles.length - 1]?.epoch ? candles[candles.length - 1].epoch * 1000 : undefined,
      };
    });
    const ready = out.every((s) => s.triggers.length > 0 && s.triggers[0] !== "insufficient-data");
    return ready ? out : [];
    // Key on the latest epoch + length of each series — stable across ticks
  }, [
    btc.length, btc[btc.length - 1]?.epoch,
    eur.length, eur[eur.length - 1]?.epoch,
    eth.length, eth[eth.length - 1]?.epoch,
  ]);
}

useLiveSignals.displayName = "useLiveSignals";
