import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity, Bot, BriefcaseBusiness,
  Wallet, TrendingUp, TrendingDown,
  BarChart2, Trophy, ChevronRight, CalendarDays,
} from "lucide-react";
import { PriceChart } from "@/components/price-chart";
import { useDerivTicks } from "@/hooks/use-deriv";
import { getProfitTable, SYMBOLS } from "@/lib/deriv";
import { useDerivSession } from "@/hooks/use-deriv-session";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useBrokerBalances } from "@/hooks/use-broker-balances";
import { api } from "@/lib/api";
import { HealthPanel } from "@/components/health-panel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Au Pluriel" },
      { name: "description", content: "Dashboard de trading Au Pluriel avec données Deriv en temps réel." },
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
    const refresh = () => {
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
    };
    // Ran once on connect and never again — a trade placed manually or by
    // the LOCAL browser engine (neither touches this app's own server state)
    // could close minutes or hours later and "P&L Aujourd'hui" would still
    // show whatever it was at page load, with no way to tell it was stale.
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [connected]);
  return { winRate, todayPnl, tradeCount };
}

function Dashboard() {
  const [chartSymbol, setChartSymbol] = useState(SYMBOLS[0]);
  const [marketFilter, setMarketFilter] = useState<"all" | "crypto" | "forex">("all");
  const { series, last, status } = useDerivTicks(chartSymbol.deriv, 180);

  const visibleSymbols = SYMBOLS.filter((s) =>
    marketFilter === "all" ? true : s.market === marketFilter,
  );

  function selectMarket(f: "all" | "crypto" | "forex") {
    setMarketFilter(f);
    const list = SYMBOLS.filter((s) =>
      f === "all" ? true : s.market === f,
    );
    if (list.length && !list.some((s) => s.deriv === chartSymbol.deriv)) {
      setChartSymbol(list[0]);
    }
  }

  const derivBalance = useDerivBalance();
  const brokerBalances = useBrokerBalances();
  const { winRate, todayPnl, tradeCount } = useRealStats();
  const { user } = useAuth();
  const isForex = chartSymbol.market === "forex";

  const [maxDailyLoss, setMaxDailyLoss] = useState<number>(15);

  useEffect(() => {
    api.get<{ presets?: Record<string, { savedConfig?: { maxDailyLossUsd?: number } }> }>("/api/bot")
      .then((res) => {
        const cfg = res.presets?.default?.savedConfig?.maxDailyLossUsd;
        if (cfg) setMaxDailyLoss(cfg);
      })
      .catch(() => {});
  }, []);

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
              to="/effet-lundi"
              className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/20 transition-all hover:opacity-90 hover:scale-[1.02] sm:py-2.5"
              style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
            >
              <CalendarDays className="h-4 w-4" />
              Effet lundi
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

      {/* ── EFFET LUNDI — seule stratégie active (suivi papier + exécution MT5 démo manuelle) ── */}
      <IdxStatusCard />

      {/* ── LIVE HEALTH & GUARD MONITOR — desktop only ── */}
      <div className="mt-4 hidden md:block">
        <HealthPanel
          currentPnl={todayPnl ?? 0}
          maxDailyLoss={maxDailyLoss}
          activePreset="idxseasonal"
          winRate={winRate ?? 0}
          openPositionsCount={0}
        />
      </div>

      {/* ── BROKER BALANCES ── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <KpiCard
          label="Comptes connectés"
          value={brokerBalances ? Object.values(brokerBalances).filter(Boolean).length : derivBalance ? 1 : 0}
          delta="Soldes séparés par devise"
          icon={<Wallet className="h-5 w-5" />}
          tone="amber"
        />
        {(() => {
          const b = brokerBalances?.deriv;
          return (
            <KpiCard
              className="order-first sm:order-none"
              label="Deriv"
              value={b ? b.balance.toFixed(2) : balanceDisplay ?? "0.00"}
              delta={b ? b.currency : derivBalance?.currency ?? "USD"}
              tone="deriv"
            />
          );
        })()}
        {(() => {
          const b = brokerBalances?.kraken;
          return (
            <KpiCard
              className="hidden sm:flex"
              label="Kraken"
              value={b ? b.balance.toFixed(2) : "0.00"}
              delta={b ? b.currency : "USD"}
              tone="kraken"
            />
          );
        })()}
        {(() => {
          const b = brokerBalances?.binance;
          return (
            <KpiCard
              className="hidden sm:flex"
              label="Binance"
              value={b ? b.balance.toFixed(2) : "0.00"}
              delta={b ? b.currency : "USDT"}
              tone="binance"
            />
          );
        })()}
      </div>

      {/* ── TRADING KPI CARDS ──
          2 cols on mobile (matches the broker-balance grid above it) so
          "Win Rate" and "P&L Aujourd'hui" sit side by side instead of being
          squeezed into a cramped 3rd of the screen each; "Signaux actifs"
          spans the full width below them rather than sitting alone in an
          orphaned 3rd column. 3 even columns from lg: up where there's room. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <KpiCard
          label="Win Rate Deriv"
          value={winRate !== null ? `${winRate.toFixed(1)}%` : "—"}
          delta={tradeCount !== null ? `${tradeCount} derniers contrats Deriv` : "Deriv non connecté"}
          icon={<Trophy className="h-5 w-5" />}
          tone={winRate !== null ? (winRate >= 54.1 ? "bull" : "bear") : "default"}
        />
        <KpiCard
          label="P&L Deriv aujourd'hui"
          value={todayPnl !== null ? `${todayPnl >= 0 ? "+" : "-"}$${Math.abs(todayPnl).toFixed(2)}` : "—"}
          delta={todayPnl !== null ? (todayPnl >= 0 ? "Contrats Deriv clôturés" : "Contrats Deriv clôturés") : "Deriv non connecté"}
          icon={todayPnl !== null && todayPnl >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          tone={todayPnl !== null ? (todayPnl >= 0 ? "bull" : "bear") : "default"}
        />
      </div>

      {/* ── CHART + SESSIONS ── */}
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">

        {/* Chart — the full interactive chart, market filters and symbol picker
            duplicate the dedicated Marchés page and eat a lot of vertical space,
            so mobile only gets the price itself; the rest is desktop-only. */}
        <div className="hidden md:block glass-panel rounded-2xl overflow-hidden">
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
          <div className="h-72 px-2 pb-2 pt-4">
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
              { to: "/effet-lundi", icon: <CalendarDays />, label: "Effet lundi", color: "violet" },
              { to: "/portfolio",  icon: <BriefcaseBusiness />, label: "Portfolio", color: "cyan" },
              { to: "/journal",    icon: <BarChart2 />, label: "Journal", color: "up" },
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

      {/* Footer disclaimer */}
      <div className="flex items-start gap-3 rounded-xl border border-border/30 bg-muted/5 px-4 py-3">
        <Bot className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground/60 leading-relaxed">
          Le trading comporte des risques significatifs. Au Pluriel fournit des analyses algorithmiques, pas des conseils financiers réglementés. Toutes les décisions restent sous contrôle humain.
        </p>
      </div>
    </div>
  );
}

// ── Carte « Effet lundi » ─────────────────────────────────────────────────────
// Seule stratégie active depuis l'archivage des presets (2026-09-20). Lecture
// seule : l'armement se fait depuis la page /effet-lundi.

interface IdxCardData {
  enabled: boolean;
  mode?: "paper" | "deriv";
  killSwitch: { active: boolean; pf: number; n: number } | null;
  stats: { count: number; open: number; pnl: number };
  plan?: { legs: { entryAtMs: number; mt5Name: string }[] };
}

function IdxStatusCard() {
  const [data, setData] = useState<IdxCardData | null>(null);
  useEffect(() => {
    api.get<IdxCardData>("/api/idx-seasonal").then(setData).catch(() => {});
  }, []);
  const next = data?.plan?.legs[0]?.entryAtMs;
  const state = !data ? "…" : data.killSwitch?.active ? "Kill-switch actif" : data.enabled ? "Armé" : "Désarmé";
  return (
    <div className="glass-panel mt-4 flex items-center justify-between gap-3 rounded-2xl p-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color:var(--up)]/15">
          <CalendarDays className="h-5 w-5 text-[color:var(--up)]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-foreground">Effet lundi</span>
            <span className="rounded-full bg-[color:var(--up)]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[color:var(--up)]">
              {data?.mode === "deriv" ? "Démo" : "Papier"}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {state}
            {data && ` · ${data.stats.count} trade(s) papier`}
            {next && ` · prochain lundi ${new Date(next).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`}
          </div>
        </div>
      </div>
      <Link
        to="/effet-lundi"
        className="shrink-0 rounded-xl bg-orange-500/15 px-3 py-2 text-xs font-bold text-orange-400 transition-colors hover:bg-orange-500/25"
      >
        Ordres du lundi
      </Link>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

type Tone = "default" | "bull" | "bear" | "cyan" | "violet" | "amber" | "deriv" | "kraken" | "binance";

const TONE_STYLES: Record<Tone, { panel: string; value: string; icon: string; dot: string }> = {
  default: { panel: "glass-panel",        value: "text-foreground",               icon: "text-muted-foreground",          dot: "bg-muted-foreground/40" },
  bull:    { panel: "glass-panel-up",     value: "text-[color:var(--up)]",         icon: "text-[color:var(--up)]",          dot: "bg-[color:var(--up)]" },
  bear:    { panel: "glass-panel",        value: "text-[color:var(--down)]",       icon: "text-[color:var(--down)]",        dot: "bg-[color:var(--down)]" },
  cyan:    { panel: "glass-panel-cyan",   value: "text-[color:var(--brand-cyan)]", icon: "text-[color:var(--brand-cyan)]",  dot: "bg-[color:var(--brand-cyan)]" },
  violet:  { panel: "glass-panel-violet", value: "text-white",                     icon: "text-white/60",                   dot: "bg-[color:var(--brand-violet)]" },
  amber:   { panel: "glass-panel-amber",  value: "text-[color:var(--brand-amber)]",icon: "text-[color:var(--brand-amber)]", dot: "bg-[color:var(--brand-amber)]" },
  deriv:   { panel: "bg-red-500/[0.06] border border-red-500/20",       value: "text-foreground", icon: "text-red-400", dot: "bg-red-500" },
  kraken:  { panel: "bg-violet-500/[0.06] border border-violet-500/20",  value: "text-foreground", icon: "text-violet-400", dot: "bg-violet-500" },
  binance: { panel: "bg-amber-500/[0.06] border border-amber-500/20",    value: "text-foreground", icon: "text-amber-400", dot: "bg-amber-500" },
};

function KpiCard({ label, value, delta, tone = "default", icon, className }: {
  label: string; value: ReactNode; delta?: string; tone?: Tone; icon?: ReactNode; className?: string;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div className={cn(t.panel, "flex h-full flex-col justify-between rounded-2xl p-4 relative overflow-hidden group hover:scale-[1.01] transition-transform duration-200", className)}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-wider text-white/50 leading-tight">{label}</span>
        {icon && <span className={cn("shrink-0 opacity-50 group-hover:opacity-80 transition-opacity [&>svg]:h-4 [&>svg]:w-4", t.icon)}>{icon}</span>}
      </div>
      <div>
        <div className={cn("font-mono-tabular text-2xl font-black leading-none tracking-tight", t.value)}>{value}</div>
        {delta && <div className="mt-2 text-xs text-white/40">{delta}</div>}
      </div>
    </div>
  );
}
