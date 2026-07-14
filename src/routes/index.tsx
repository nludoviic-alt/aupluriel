import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowUpRight, Bot, BriefcaseBusiness,
  Radar, Wallet, Zap, TrendingUp, TrendingDown,
  BarChart2, Sparkles, Trophy, ChevronRight, Power, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { PriceChart } from "@/components/price-chart";
import { SignalCard, type SignalItem } from "@/components/signal-card";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { useDerivCandles, useDerivTicks } from "@/hooks/use-deriv";
import { generateSignal } from "@/lib/indicators";
import { getProfitTable, GRANULARITY, SYMBOLS } from "@/lib/deriv";
import { useDerivSession } from "@/hooks/use-deriv-session";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Pluriel" },
      { name: "description", content: "Dashboard de trading Pluriel avec données Deriv en temps réel." },
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
  // getProfitTable talks over the already-authenticated Deriv WS session, so
  // gate on the session actually being connected — a raw localStorage token
  // check goes stale the moment the token is only saved server-side (new
  // device, cleared storage) even though the session connects fine.
  const { connected } = useDerivSession();
  const [winRate, setWinRate] = useState<number | null>(null);
  const [todayPnl, setTodayPnl] = useState<number | null>(null);
  const [tradeCount, setTradeCount] = useState<number | null>(null);
  useEffect(() => {
    if (!connected) return;
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
  }, [connected]);
  return { winRate, todayPnl, tradeCount };
}

function Dashboard() {
  const [chartSymbol, setChartSymbol] = useState(SYMBOLS[0]);
  const [marketFilter, setMarketFilter] = useState<"all" | "crypto" | "forex">("all");
  const { series, last, status } = useDerivTicks(chartSymbol.deriv, 180);

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
  const liveSignals = useLiveSignals();
  const isForex = chartSymbol.market === "forex";

  const priceChange = useMemo(() => {
    if (series.length < 2) return null;
    const first = series[0].price;
    const lp = series[series.length - 1].price;
    return ((lp - first) / first) * 100;
  }, [series]);

  const balanceDisplay = derivBalance
    ? derivBalance.amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonne nuit";

  // Avatar initials
  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : "LI";

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1600px] mx-auto">

      {/* ── HERO USER CARD ── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0A0A0A]">
        {/* Ambient glows */}
        <div className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #f97316 0%, transparent 70%)" }} />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #fbbf24 0%, transparent 70%)" }} />

        <div className="relative flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-6">
          {/* Left: greeting */}
          <div className="flex items-center gap-4">
            <div>
              <p className="text-sm text-muted-foreground">{greeting},</p>
              <h1 className="text-2xl font-black tracking-tight text-foreground leading-tight">
                {user?.username ?? "Trader"}
              </h1>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/10 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-orange-500">
                  Deriv {derivBalance ? "connecté" : "démo"}
                </span>
                {status === "live" && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--up)] animate-pulse inline-block" />
                    En direct
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* CTA buttons — pleine largeur sur mobile, inline sur sm+ */}
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-2">
            <Link
              to="/autotrader"
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/20 transition-all hover:opacity-90 hover:scale-[1.02] sm:py-2.5"
              style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
            >
              <Zap className="h-4 w-4" />
              <span className="hidden xs:inline">Auto-Trader</span>
              <span className="xs:hidden">Bot</span>
            </Link>
            <Link
              to="/signals"
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-foreground transition-all hover:bg-white/[0.08] sm:py-2.5"
            >
              <Radar className="h-4 w-4 text-orange-400" />
              Signaux
            </Link>
            <Link
              to="/portfolio"
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-foreground transition-all hover:bg-white/[0.08] sm:py-2.5"
            >
              <BriefcaseBusiness className="h-4 w-4 text-muted-foreground" />
              Portfolio
            </Link>
          </div>
        </div>
      </div>

      {/* ── BOT STATUS (mobile only — Auto-Trader isn't in the bottom nav) ── */}
      <BotStatusCard />

      {/* ── 4 KPI CARDS ── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Balance"
          value={balanceDisplay ? `${derivBalance?.currency} ${balanceDisplay}` : "—"}
          delta={derivBalance ? "Compte Deriv connecté" : "Mode simulation"}
          icon={<Wallet className="h-5 w-5" />}
          tone="amber"
        />
        <KpiCard
          label="Win Rate"
          value={winRate !== null ? `${winRate.toFixed(1)}%` : "—"}
          delta={tradeCount !== null ? `Sur ${tradeCount} trades` : "Pas encore de données"}
          icon={<Trophy className="h-5 w-5" />}
          tone={winRate !== null ? (winRate >= 54.1 ? "bull" : "bear") : "default"}
        />
        <KpiCard
          label="P&L Aujourd'hui"
          value={todayPnl !== null ? `${todayPnl >= 0 ? "+" : ""}$${todayPnl.toFixed(2)}` : "—"}
          delta={todayPnl !== null ? (todayPnl >= 0 ? "Journée positive" : "Journée négative") : "Aucun trade aujourd'hui"}
          icon={todayPnl !== null && todayPnl >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          tone={todayPnl !== null ? (todayPnl >= 0 ? "bull" : "bear") : "default"}
        />
        <KpiCard
          label="Signaux actifs"
          value={liveSignals.filter(s => s.direction !== "HOLD").length || "—"}
          delta="BTC · ETH · EUR/USD"
          icon={<BarChart2 className="h-5 w-5" />}
          tone="cyan"
        />
      </div>

      {/* ── CHART + SESSIONS ── */}
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">

        {/* Chart — the full interactive chart, market filters and symbol picker
            duplicate the dedicated Marchés page and eat a lot of vertical space,
            so mobile only gets the price itself; the rest is desktop-only. */}
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="flex flex-col gap-3 p-4 pb-4 md:flex-row md:flex-wrap md:items-start md:justify-between md:gap-3 md:p-5 md:pb-0">
            <div className="flex items-center gap-3">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">{chartSymbol.label}</div>
                <div className="font-mono-tabular text-3xl font-black text-foreground leading-none">
                  {last ? last.toFixed(isForex ? 5 : 2) : "—"}
                </div>
              </div>
              {priceChange !== null && (
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-bold border mt-1 self-start",
                  priceChange >= 0
                    ? "text-[color:var(--up)] bg-[color:var(--up)]/10 border-[color:var(--up)]/20"
                    : "text-[color:var(--down)] bg-[color:var(--down)]/10 border-[color:var(--down)]/20",
                )}>
                  {priceChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}%
                </span>
              )}
            </div>
            <div className="hidden md:flex flex-col gap-2 sm:items-end">
              <div className="inline-flex rounded-xl border border-border/60 bg-muted/15 p-0.5">
                {(["all", "crypto", "forex"] as const).map((f) => (
                  <button key={f} onClick={() => selectMarket(f)}
                    className={cn(
                      "rounded-lg px-3 py-2 text-xs font-semibold transition-all capitalize sm:py-1.5",
                      marketFilter === f
                        ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                        : "text-muted-foreground hover:text-foreground",
                    )}>
                    {f === "all" ? "Tous" : f === "crypto" ? "Crypto" : "Forex"}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 sm:justify-end">
                {visibleSymbols.map((s) => (
                  <button key={s.deriv} onClick={() => setChartSymbol(s)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                      chartSymbol.deriv === s.deriv
                        ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.1)]"
                        : "border border-border/40 bg-muted/10 text-muted-foreground hover:text-foreground",
                    )}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="hidden md:block h-72 px-2 pb-2 pt-4">
            {series.length > 1 ? (
              <PriceChart data={series} />
            ) : (
              <div className="grid h-full place-items-center">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Activity className="h-6 w-6 animate-pulse text-[color:var(--brand-violet)]" />
                  <span className="text-sm">En attente des ticks Deriv…</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex flex-col gap-3">

          {/* Balance card */}
          <div className="glass-panel-amber rounded-2xl p-5 relative overflow-hidden group">
            <div className="pointer-events-none absolute -top-8 -right-8 h-32 w-32 rounded-full bg-orange-500/20 blur-2xl group-hover:scale-110 transition-transform" />
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-white/50">Mon compte</span>
                <Wallet className="h-4 w-4 text-orange-400" />
              </div>
              <div className="text-xs text-white/50 uppercase tracking-wider mb-1">
                {derivBalance ? `${derivBalance.currency} · Deriv` : "Simulation"}
              </div>
              <div className="font-mono-tabular text-3xl font-black text-white text-glow-orange leading-none">
                {balanceDisplay ?? "—"}
              </div>
              {tradeCount !== null && (
                <div className="mt-2 text-xs text-white/40">{tradeCount} trades historiques</div>
              )}
            </div>
          </div>

          {/* Sessions marchés — desktop only, secondary info that ate mobile
              scroll space without being actionable there. */}
          <div className="hidden md:block glass-panel rounded-2xl p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-3">Sessions marchés</div>
            <div className="space-y-3">
              {[
                { name: "Tokyo",    open: 0,  close: 9  },
                { name: "Londres",  open: 7,  close: 16 },
                { name: "New York", open: 12, close: 21 },
              ].map(({ name, open, close }) => {
                const h = now.getUTCHours();
                const isOpen = h >= open && h < close;
                const progress = isOpen ? ((h - open) / (close - open)) * 100 : 0;
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full shrink-0", isOpen ? "bg-[color:var(--up)] animate-pulse" : "bg-muted/30")} />
                        <span className="text-sm text-muted-foreground font-medium">{name}</span>
                      </div>
                      <span className={cn("text-xs font-bold", isOpen ? "text-[color:var(--up)]" : "text-muted-foreground/30")}>
                        {isOpen ? "OUVERT" : `${open}h–${close}h`}
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-white/[0.05]">
                      {isOpen && (
                        <div className="h-full rounded-full bg-[color:var(--up)]/40 transition-all" style={{ width: `${progress}%` }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { to: "/autotrader", icon: <Zap />, label: "Bot",      color: "violet" },
              { to: "/portfolio",  icon: <BriefcaseBusiness />, label: "Portfolio", color: "cyan" },
              { to: "/signals",    icon: <Radar />,  label: "Signaux",  color: "up" },
              { to: "/settings",   icon: <Wallet />, label: "Compte",   color: "amber" },
            ].map(({ to, icon, label, color }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center justify-between rounded-xl border px-3 py-3 text-sm font-semibold transition-all hover:scale-[1.02] sm:py-2.5 sm:text-xs",
                  color === "violet" && "border-[color:var(--brand-violet)]/20 bg-[color:var(--brand-violet)]/5 text-[color:var(--brand-violet)] hover:bg-[color:var(--brand-violet)]/12",
                  color === "cyan"   && "border-[color:var(--brand-cyan)]/20 bg-[color:var(--brand-cyan)]/5 text-[color:var(--brand-cyan)] hover:bg-[color:var(--brand-cyan)]/12",
                  color === "up"     && "border-[color:var(--up)]/20 bg-[color:var(--up)]/5 text-[color:var(--up)] hover:bg-[color:var(--up)]/12",
                  color === "amber"  && "border-[color:var(--brand-amber)]/20 bg-[color:var(--brand-amber)]/5 text-[color:var(--brand-amber)] hover:bg-[color:var(--brand-amber)]/12",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
                  {label}
                </div>
                <ChevronRight className="h-3 w-3 opacity-40" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── LIVE SIGNALS ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-500/15">
              <Sparkles className="h-4 w-4 text-orange-400" />
            </div>
            <h2 className="text-base font-bold text-foreground sm:text-sm">Signaux en direct</h2>
            {liveSignals.length > 0 && (
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[color:var(--up)] animate-pulse" />
            )}
          </div>
          <Link to="/signals" className="flex items-center gap-1 text-xs text-orange-500 hover:text-amber-400 transition-colors font-semibold">
            Voir tout <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {liveSignals.length === 0
            ? [0, 1, 2].map((i) => <div key={i} className="glass-panel rounded-2xl h-52 animate-pulse" />)
            : liveSignals.slice(0, 3).map((s) => <SignalCard key={s.pair} signal={s} />)}
        </div>
      </div>

      {/* Footer disclaimer */}
      <div className="flex items-start gap-3 rounded-xl border border-border/30 bg-muted/5 px-4 py-3">
        <Bot className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground/60 leading-relaxed">
          Le trading comporte des risques significatifs. Pluriel fournit des analyses algorithmiques, pas des conseils financiers réglementés. Toutes les décisions restent sous contrôle humain.
        </p>
      </div>
    </div>
  );
}

// ── Bot status card (mobile only) ───────────────────────────────────────────────
// Auto-Trader lost its bottom-nav slot in the app-like mobile redesign — this
// keeps bot control one tap away from the Dashboard instead of two. Start
// always reuses the user's last SAVED config (from /autotrader) rather than
// blind-defaulting, so a quick tap here can't silently reset their stake or
// flip live back to demo (see savedConfig in routes/api/bot.ts).

interface CloudBotStatus {
  enabled: boolean;
  running: boolean;
  mode: "demo" | "live";
  pausedUntil: number | null;
  todayPnl: number;
  todayCount: number;
  allTimeStats: { trades: number; wins: number; losses: number; winRate: number; pnl: number };
  savedConfig: { stakeUsd: number; maxDailyLossUsd: number; mode: "demo" | "live" } | null;
}

function BotStatusCard() {
  const [status, setStatus] = useState<CloudBotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirmState, confirm } = useConfirm();

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<CloudBotStatus>("/api/bot");
      setStatus(data);
    } catch { /* signed out or server unreachable — leave as-is */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function toggle() {
    if (busy || !status) return;
    setBusy(true);
    try {
      if (status.enabled) {
        await api.post("/api/bot", { action: "stop" });
        toast.info("Bot serveur arrêté");
      } else if (status.savedConfig) {
        if (status.savedConfig.mode === "live") {
          const { trades, winRate } = status.allTimeStats;
          const sampleLine = trades < 20
            ? `⚠️ Seulement ${trades} trade(s) enregistré(s) — échantillon trop faible pour juger la fiabilité.`
            : `Historique : ${trades} trades, ${Math.round(winRate * 100)}% de réussite.`;
          const ok = await confirm({
            title: "Démarrer le bot en mode LIVE ?",
            description: `Le bot va trader avec du VRAI argent, 24/7, même téléphone verrouillé. Mise : $${status.savedConfig.stakeUsd} par trade. Limite journalière : $${status.savedConfig.maxDailyLossUsd}.\n\n${sampleLine}`,
            confirmLabel: "Démarrer en réel",
            danger: true,
          });
          if (!ok) return;
        } else {
          // Demo — lighter confirmation so a stray tap can't start the bot.
          const ok = await confirm({
            title: "Démarrer le bot serveur (Démo) ?",
            description: `Le bot va scanner les marchés et trader automatiquement sur ton compte de démonstration Deriv, 24/7, même téléphone verrouillé. Mise : $${status.savedConfig.stakeUsd} par trade.`,
            confirmLabel: "Démarrer",
          });
          if (!ok) return;
        }
        await api.post("/api/bot", { action: "start", config: status.savedConfig });
        toast.success(status.savedConfig.mode === "live" ? "☁️ Bot démarré en LIVE — argent réel" : "☁️ Bot démarré");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur bot serveur");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  const isLive = status.mode === "live";
  const paused = !!status.pausedUntil && status.pausedUntil > Date.now();
  const canToggle = status.enabled || !!status.savedConfig;

  return (
    <div className="md:hidden glass-panel rounded-2xl p-4 flex items-center justify-between gap-3">
      <ConfirmDialog state={confirmState} />
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          status.enabled ? (isLive ? "bg-[color:var(--down)]/15" : "bg-[color:var(--up)]/15") : "bg-muted/15",
        )}>
          <Zap className={cn("h-5 w-5", status.enabled ? (isLive ? "text-[color:var(--down)]" : "text-[color:var(--up)]") : "text-muted-foreground")} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-foreground">Bot Auto-Trader</span>
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
              isLive ? "bg-[color:var(--down)]/15 text-[color:var(--down)]" : "bg-[color:var(--up)]/15 text-[color:var(--up)]",
            )}>
              {isLive ? "Live" : "Démo"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {paused ? "En pause (risque)" : status.enabled ? "Actif" : "Arrêté"}
            {status.enabled && !paused && ` · ${status.todayPnl >= 0 ? "+" : ""}$${status.todayPnl.toFixed(2)} auj.`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to="/autotrader"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
        >
          <Settings2 className="h-4 w-4" />
        </Link>
        {canToggle ? (
          <button
            onClick={toggle}
            disabled={busy}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl transition-colors disabled:opacity-50",
              status.enabled
                ? "bg-[color:var(--down)]/15 text-[color:var(--down)] hover:bg-[color:var(--down)]/25"
                : "bg-[color:var(--up)]/15 text-[color:var(--up)] hover:bg-[color:var(--up)]/25",
            )}
          >
            <Power className="h-4 w-4" />
          </button>
        ) : (
          <Link
            to="/autotrader"
            className="rounded-xl bg-orange-500/15 px-3 py-2 text-xs font-bold text-orange-400 transition-colors hover:bg-orange-500/25"
          >
            Configurer
          </Link>
        )}
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

type Tone = "default" | "bull" | "bear" | "cyan" | "violet" | "amber";

const TONE_STYLES: Record<Tone, { panel: string; value: string; icon: string; dot: string }> = {
  default: { panel: "glass-panel",        value: "text-foreground",               icon: "text-muted-foreground",          dot: "bg-muted-foreground/40" },
  bull:    { panel: "glass-panel-up",     value: "text-[color:var(--up)]",         icon: "text-[color:var(--up)]",          dot: "bg-[color:var(--up)]" },
  bear:    { panel: "glass-panel",        value: "text-[color:var(--down)]",       icon: "text-[color:var(--down)]",        dot: "bg-[color:var(--down)]" },
  cyan:    { panel: "glass-panel-cyan",   value: "text-[color:var(--brand-cyan)]", icon: "text-[color:var(--brand-cyan)]",  dot: "bg-[color:var(--brand-cyan)]" },
  violet:  { panel: "glass-panel-violet", value: "text-white",                     icon: "text-white/60",                   dot: "bg-[color:var(--brand-violet)]" },
  amber:   { panel: "glass-panel-amber",  value: "text-[color:var(--brand-amber)]",icon: "text-[color:var(--brand-amber)]", dot: "bg-[color:var(--brand-amber)]" },
};

function KpiCard({ label, value, delta, tone = "default", icon }: {
  label: string; value: React.ReactNode; delta?: string; tone?: Tone; icon?: React.ReactNode;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div className={cn(t.panel, "rounded-2xl p-4 relative overflow-hidden group hover:scale-[1.01] transition-transform duration-200")}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-bold uppercase tracking-wider text-white/50">{label}</span>
        {icon && <span className={cn("opacity-50 group-hover:opacity-80 transition-opacity [&>svg]:h-4 [&>svg]:w-4", t.icon)}>{icon}</span>}
      </div>
      <div className={cn("font-mono-tabular text-2xl font-black leading-none tracking-tight", t.value)}>{value}</div>
      {delta && <div className="mt-2 text-xs text-white/40">{delta}</div>}
    </div>
  );
}

function useLiveSignals() {
  const { candles: btc } = useDerivCandles("cryBTCUSD", GRANULARITY["15m"], 250);
  const { candles: eur } = useDerivCandles("frxEURUSD", GRANULARITY["15m"], 250);
  const { candles: eth } = useDerivCandles("cryETHUSD", GRANULARITY["15m"], 250);

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
  }, [
    btc.length, btc[btc.length - 1]?.epoch,
    eur.length, eur[eur.length - 1]?.epoch,
    eth.length, eth[eth.length - 1]?.epoch,
  ]);
}
