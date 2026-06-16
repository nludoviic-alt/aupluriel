import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, CheckCircle2, Download, Info, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadTradeLog, type TradeLog } from "@/lib/autotrader";
import {
  bySession,
  bySymbol,
  byConfidence,
  byHour,
  byDay,
  equityCurve,
  exportToCsv,
  insights,
  summarize,
  type Bucket,
  type DayBucket,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/journal")({
  head: () => ({ meta: [{ title: "Journal de performance — LIO23" }] }),
  component: JournalPage,
});

function JournalPage() {
  const [logs, setLogs] = useState<TradeLog[]>([]);

  useEffect(() => {
    setLogs(loadTradeLog());
  }, []);

  const s = summarize(logs);
  const equity = equityCurve(logs);
  const ideas = insights(logs);
  const symbols = bySymbol(logs);
  const sessions = bySession(logs);
  const hours = byHour(logs);
  const confidence = byConfidence(logs);
  const days = byDay(logs);

  const hasData = s.trades > 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[color:var(--brand-cyan)]" />
            Journal de performance
          </h1>
          <p className="text-sm text-muted-foreground">
            Ce qui marche vraiment — par paire, session, heure et niveau de confiance.
          </p>
        </div>
        {hasData && (
          <Button variant="outline" size="sm" onClick={() => exportToCsv(logs)} className="gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        )}
      </div>

      {!hasData && (
        <div className="glass-panel rounded-xl p-8 text-center">
          <Info className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-lg font-semibold">Pas encore de données</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Lance l'Auto-Trader (ou le bouton « Aperçu live ») pour générer des trades. Les statistiques
            apparaîtront ici dès les premiers trades clôturés.
          </p>
        </div>
      )}

      {hasData && (
        <>
          {/* Summary KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Trades clôturés" value={String(s.trades)} sub={`${s.wins}W / ${s.losses}L`} />
            <Stat label="Win Rate" value={`${s.winRate.toFixed(1)}%`} tone={s.winRate >= 55 ? "bull" : "bear"} />
            <Stat
              label="P&L net"
              value={`${s.netPnl >= 0 ? "+" : ""}$${s.netPnl.toFixed(2)}`}
              tone={s.netPnl >= 0 ? "bull" : "bear"}
            />
            <Stat
              label="Profit Factor"
              value={s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)}
              sub="gains / pertes"
              tone={s.profitFactor >= 1.5 ? "bull" : s.profitFactor < 1 ? "bear" : "default"}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Gain moyen" value={`+$${s.avgWin.toFixed(2)}`} tone="bull" />
            <Stat label="Perte moyenne" value={`-$${s.avgLoss.toFixed(2)}`} tone="bear" />
            <Stat
              label="Espérance / trade"
              value={`${s.expectancy >= 0 ? "+" : ""}$${s.expectancy.toFixed(2)}`}
              tone={s.expectancy >= 0 ? "bull" : "bear"}
            />
            <Stat
              label="Série actuelle"
              value={s.currentStreak === 0 ? "—" : `${s.currentStreak > 0 ? "+" : ""}${s.currentStreak}`}
              sub={`max ${s.maxWinStreak}W / ${s.maxLossStreak}L`}
              tone={s.currentStreak > 0 ? "bull" : s.currentStreak < 0 ? "bear" : "default"}
            />
          </div>

          {/* Insights */}
          {ideas.length > 0 && (
            <div className="glass-panel rounded-xl p-5">
              <h2 className="text-base font-semibold mb-3">Recommandations</h2>
              <ul className="space-y-2">
                {ideas.map((i, idx) => (
                  <li key={idx} className="flex gap-2 text-sm">
                    {i.type === "good" ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[color:var(--bull)]" />
                    ) : i.type === "warn" ? (
                      <TrendingDown className="h-4 w-4 shrink-0 mt-0.5 text-[color:var(--bear)]" />
                    ) : (
                      <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                    )}
                    <span className="text-foreground/90">{i.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Equity curve */}
          <div className="glass-panel rounded-xl p-5">
            <h2 className="text-base font-semibold">Courbe de P&L cumulé</h2>
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equity.map((e) => ({ t: e.t, v: e.pnl }))}>
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
          {days.length > 0 && <PerfHeatmap days={days} />}

          {/* Breakdowns */}
          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownTable title="Par paire" buckets={symbols} />
            <BreakdownTable title="Par session" buckets={sessions} />
            <BreakdownTable title="Par niveau de confiance" buckets={confidence} />
            <BreakdownTable title="Par heure (locale)" buckets={hours} />
          </div>
        </>
      )}
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

function PerfHeatmap({ days }: { days: DayBucket[] }) {
  const map = new Map(days.map((d) => [d.date, d]));
  const last = days[days.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
  const lastDate = new Date(last + "T00:00:00");
  const cells: { date: string; day: DayBucket | null }[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(lastDate);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    cells.push({ date: key, day: map.get(key) ?? null });
  }
  const weeks: { date: string; day: DayBucket | null }[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  function color(d: DayBucket | null) {
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

function BreakdownTable({ title, buckets }: { title: string; buckets: Bucket[] }) {
  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {buckets.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">Aucune donnée</div>
      ) : (
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
                        className={cn("block h-full rounded-full", b.winRate >= 55 ? "bg-[color:var(--bull)]" : b.winRate >= 45 ? "bg-[color:var(--brand-amber)]" : "bg-[color:var(--bear)]")}
                        style={{ width: `${Math.min(100, b.winRate)}%` }}
                      />
                    </span>
                    <span className={cn("font-semibold", b.winRate >= 55 ? "text-[color:var(--bull)]" : b.winRate >= 45 ? "text-foreground" : "text-[color:var(--bear)]")}>
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
      )}
    </div>
  );
}
