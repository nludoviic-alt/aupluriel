import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, CartesianGrid } from "recharts";
import { BarChart3, TrendingUp, TrendingDown, Activity, Clock, Globe, Layers } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/stats")({
  head: () => ({ meta: [{ title: "Statistiques — PLURIEL" }] }),
  component: StatsPage,
});

interface StatsData {
  summary: {
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    netPnl: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    expectancy: number;
  };
  equity: { t: number; pnl: number }[];
  bySymbol: { symbol: string; trades: number; wins: number; winRate: number; pnl: number }[];
  byHour: { hour: number; trades: number; wins: number; winRate: number; pnl: number }[];
  byDay: { date: string; trades: number; wins: number; winRate: number; pnl: number }[];
  bySession: { session: string; trades: number; wins: number; winRate: number; pnl: number }[];
  byMode: { mode: string; trades: number; wins: number; winRate: number; pnl: number }[];
}

const SESSION_LABELS: Record<string, string> = {
  asia: "Asie (23h-08h UTC)",
  london: "Londres (07h-16h UTC)",
  newyork: "New York (13h-22h UTC)",
  other: "Autre",
};

const MODE_LABELS: Record<string, string> = {
  demo: "Démo",
  live: "Live",
};

const SYMBOL_LABELS: Record<string, string> = {
  frxEURUSD: "EUR/USD",
  frxGBPUSD: "GBP/USD",
  frxUSDJPY: "USD/JPY",
  frxAUDUSD: "AUD/USD",
  frxUSDCAD: "USD/CAD",
  frxUSDCHF: "USD/CHF",
  frxEURGBP: "EUR/GBP",
  frxEURJPY: "EUR/JPY",
  frxGBPJPY: "GBP/JPY",
  cryBTCUSD: "BTC/USD",
};

function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<StatsData>("/api/stats").then((d) => {
      setData(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-4 md:p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Activity className="mx-auto h-8 w-8 text-muted-foreground animate-pulse" />
          <p className="mt-3 text-sm text-muted-foreground">Chargement des statistiques…</p>
        </div>
      </div>
    );
  }

  if (!data || data.summary.trades === 0) {
    return (
      <div className="p-4 md:p-6">
        <div className="glass-panel rounded-xl p-8 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-lg font-semibold">Pas encore de données</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Les statistiques du bot serveur apparaîtront ici dès les premiers trades clôturés.
          </p>
        </div>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-[color:var(--brand-cyan)]" />
          Statistiques
        </h1>
        <p className="text-sm text-muted-foreground">
          Performance du bot serveur — par symbole, session, heure et mode.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Trades" value={String(s.trades)} sub={`${s.wins}W / ${s.losses}L`} />
        <Stat
          label="Win Rate"
          value={`${s.winRate.toFixed(1)}%`}
          tone={s.winRate >= 57 ? "bull" : "bear"}
          sub={s.winRate >= 57 ? "Au-dessus du breakeven" : "Sous le breakeven"}
        />
        <Stat
          label="P&L net"
          value={`${s.netPnl >= 0 ? "+" : ""}$${s.netPnl.toFixed(2)}`}
          tone={s.netPnl >= 0 ? "bull" : "bear"}
        />
        <Stat
          label="Profit Factor"
          value={s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)}
          tone={s.profitFactor >= 1.5 ? "bull" : s.profitFactor < 1 ? "bear" : "default"}
          sub="gains / pertes"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Gain moyen" value={`+$${s.avgWin.toFixed(2)}`} tone="bull" />
        <Stat label="Perte moyenne" value={`-$${Math.abs(s.avgLoss).toFixed(2)}`} tone="bear" />
        <Stat
          label="Espérance / trade"
          value={`${s.expectancy >= 0 ? "+" : ""}$${s.expectancy.toFixed(2)}`}
          tone={s.expectancy >= 0 ? "bull" : "bear"}
        />
      </div>

      {/* Equity curve */}
      <div className="glass-panel rounded-xl p-5">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-[color:var(--brand-cyan)]" />
          Courbe de P&L cumulé
        </h2>
        <div className="mt-3 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.equity.map((e) => ({ t: e.t, v: e.pnl }))}>
              <defs>
                <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand-cyan)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--brand-cyan)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                tickFormatter={(v) => new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
                stroke="oklch(0.7 0.03 255 / 0.5)"
                fontSize={11}
                minTickGap={40}
              />
              <YAxis stroke="oklch(0.7 0.03 255 / 0.5)" fontSize={11} width={60} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
              <Tooltip
                contentStyle={{ background: "oklch(0.20 0.035 260)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v) => new Date(Number(v)).toLocaleString("fr-FR")}
                formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L cumulé"]}
              />
              <Area type="monotone" dataKey="v" stroke="var(--brand-cyan)" strokeWidth={2} fill="url(#pnlFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Heatmap */}
      {data.byDay.length > 0 && <PerfHeatmap days={data.byDay} />}

      {/* Demo vs Live */}
      {data.byMode.length > 0 && (
        <div className="glass-panel rounded-xl p-5">
          <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-[color:var(--brand-cyan)]" />
            Démo vs Live
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.byMode.map((m) => (
              <div key={m.mode} className="rounded-lg bg-muted/10 border border-border/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold uppercase tracking-wider">{MODE_LABELS[m.mode] ?? m.mode}</span>
                  <span className={cn("text-lg font-bold", m.pnl >= 0 ? "text-up" : "text-down")}>
                    {m.pnl >= 0 ? "+" : ""}${m.pnl.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{m.trades} trades · {m.wins}W / {m.trades - m.wins}L</span>
                  <span className={cn("font-bold", m.winRate >= 57 ? "text-up" : "text-down")}>{m.winRate.toFixed(0)}% WR</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By symbol */}
      <div className="glass-panel rounded-xl p-5">
        <h2 className="text-base font-semibold mb-3">Par symbole</h2>
        <BreakdownTable buckets={data.bySymbol.map((s) => ({ key: s.symbol, label: SYMBOL_LABELS[s.symbol] ?? s.symbol, ...s }))} />
      </div>

      {/* By session */}
      <div className="glass-panel rounded-xl p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
          <Globe className="h-4 w-4 text-[color:var(--brand-cyan)]" />
          Par session
        </h2>
        <BreakdownTable buckets={data.bySession.map((s) => ({ key: s.session, label: SESSION_LABELS[s.session] ?? s.session, ...s }))} />
      </div>

      {/* By hour */}
      <div className="glass-panel rounded-xl p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4 text-[color:var(--brand-cyan)]" />
          Par heure (UTC)
        </h2>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.byHour.map((h) => ({ hour: `${h.hour}h`, trades: h.trades, pnl: h.pnl }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.05)" />
              <XAxis dataKey="hour" stroke="oklch(0.7 0.03 255 / 0.5)" fontSize={10} interval={1} />
              <YAxis stroke="oklch(0.7 0.03 255 / 0.5)" fontSize={11} width={40} />
              <Tooltip
                contentStyle={{ background: "oklch(0.20 0.035 260)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [name === "pnl" ? `$${v.toFixed(2)}` : v, name === "pnl" ? "P&L" : "Trades"]}
              />
              <Bar dataKey="trades" fill="var(--brand-cyan)" opacity={0.6} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 overflow-x-auto">
          <BreakdownTable buckets={data.byHour.filter((h) => h.trades > 0).map((h) => ({ key: String(h.hour), label: `${h.hour}h UTC`, trades: h.trades, wins: h.wins, winRate: h.winRate, pnl: h.pnl }))} />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "bull" | "bear";
}) {
  const cls = { default: "text-foreground", bull: "text-[color:var(--bull)]", bear: "text-[color:var(--bear)]" }[tone];
  return (
    <div className="glass-panel rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tracking-tight", cls)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function PerfHeatmap({ days }: { days: { date: string; trades: number; wins: number; winRate: number; pnl: number }[] }) {
  const map = new Map(days.map((d) => [d.date, d]));
  const last = days[days.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
  const lastDate = new Date(last + "T00:00:00");
  const cells: { date: string; day: typeof days[0] | null }[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(lastDate);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    cells.push({ date: key, day: map.get(key) ?? null });
  }
  const weeks: { date: string; day: typeof days[0] | null }[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  function color(d: typeof days[0] | null) {
    if (!d) return "bg-muted/20";
    if (d.pnl > 5) return "bg-[color:var(--bull)]/80";
    if (d.pnl > 0) return "bg-[color:var(--bull)]/40";
    if (d.pnl < -5) return "bg-[color:var(--bear)]/80";
    if (d.pnl < 0) return "bg-[color:var(--bear)]/40";
    return "bg-muted/40";
  }

  return (
    <div className="glass-panel rounded-xl p-5">
      <h2 className="text-base font-semibold mb-3">Heatmap de performance (12 semaines)</h2>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map(({ date, day }) => (
              <div
                key={date}
                title={day ? `${date} · P&L: $${day.pnl.toFixed(2)} · ${day.trades} trades · ${day.winRate.toFixed(0)}% WR` : date}
                className={cn("h-4 w-4 rounded-sm transition-opacity hover:opacity-70 cursor-default", color(day))}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>Moins</span>
        <div className="flex gap-1">
          <div className="h-3 w-3 rounded-sm bg-[color:var(--bear)]/80" />
          <div className="h-3 w-3 rounded-sm bg-[color:var(--bear)]/40" />
          <div className="h-3 w-3 rounded-sm bg-muted/40" />
          <div className="h-3 w-3 rounded-sm bg-[color:var(--bull)]/40" />
          <div className="h-3 w-3 rounded-sm bg-[color:var(--bull)]/80" />
        </div>
        <span>Plus</span>
      </div>
    </div>
  );
}

function BreakdownTable({ buckets }: { buckets: { key: string; label: string; trades: number; wins: number; winRate: number; pnl: number }[] }) {
  if (buckets.length === 0) {
    return <div className="px-4 py-6 text-center text-sm text-muted-foreground">Aucune donnée</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
        <tr>
          <th className="px-4 py-2 text-left">Segment</th>
          <th className="px-4 py-2 text-right">Trades</th>
          <th className="px-4 py-2 text-right">Win Rate</th>
          <th className="px-4 py-2 text-right">P&L</th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((b) => (
          <tr key={b.key} className="border-t border-border/40">
            <td className="px-4 py-2 font-medium">{b.label}</td>
            <td className="px-4 py-2 text-right text-muted-foreground">{b.trades}</td>
            <td className="px-4 py-2 text-right">
              <span className="inline-flex items-center gap-2">
                <span className="hidden sm:block h-1.5 w-16 overflow-hidden rounded-full bg-muted/40">
                  <span
                    className={cn("block h-full rounded-full", b.winRate >= 57 ? "bg-[color:var(--bull)]" : b.winRate >= 45 ? "bg-[color:var(--brand-amber)]" : "bg-[color:var(--bear)]")}
                    style={{ width: `${Math.min(100, b.winRate)}%` }}
                  />
                </span>
                <span className={cn("font-semibold", b.winRate >= 57 ? "text-[color:var(--bull)]" : b.winRate >= 45 ? "text-foreground" : "text-[color:var(--bear)]")}>
                  {b.winRate.toFixed(0)}%
                </span>
              </span>
            </td>
            <td className={cn("px-4 py-2 text-right font-mono font-semibold", b.pnl >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
              {b.pnl >= 0 ? "+" : ""}{b.pnl.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
