import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, CheckCircle2, Download, Info, Microscope, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { loadTradeLog, type TradeLog } from "@/lib/autotrader";
import { api } from "@/lib/api";
import {
  bySession,
  bySymbol,
  byConfidence,
  byHour,
  byDay,
  bySegment,
  withinSegment,
  stopSlippage,
  errorsByDay,
  equityCurve,
  exportToCsv,
  insights,
  summarize,
  type Bucket,
  type DayBucket,
  type SegmentStats,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/journal")({
  head: () => ({ meta: [{ title: "Journal de performance — PLURIEL" }] }),
  component: JournalPage,
});

function JournalPage() {
  const [logs, setLogs] = useState<TradeLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load from localStorage immediately (fast, offline-capable)
    const local = loadTradeLog();
    setLogs(local);

    // Then fetch the full persistent history from the server DB (bot_trades)
    // — this never resets, unlike localStorage which is capped at 200 and
    // can be cleared by the user or browser data purge.
    api.get<TradeLog[]>("/api/bot-trades?limit=500")
      .then((serverLogs) => {
        if (serverLogs.length > 0) {
          // Merge: server logs are the source of truth, but keep any local-only
          // entries (e.g., preview trades not sent to server) that aren't in DB.
          const serverIds = new Set(serverLogs.map((t) => t.id));
          const localOnly = local.filter((t) => !serverIds.has(t.id));
          setLogs([...serverLogs, ...localOnly]);
        }
      })
      .catch(() => {
        // Server unreachable — local logs are still displayed
      })
      .finally(() => setLoading(false));
  }, []);

  const s = summarize(logs);
  const equity = equityCurve(logs);
  const ideas = insights(logs);
  const symbols = bySymbol(logs);
  const sessions = bySession(logs);
  const hours = byHour(logs);
  const confidence = byConfidence(logs);
  const days = byDay(logs);
  const segments = bySegment(logs);
  const tfWithin = withinSegment(logs, "tfAgreement");
  const confWithin = withinSegment(logs, "confidence");
  const slippage = stopSlippage(logs);
  const errDays = errorsByDay(logs);

  const hasData = s.trades > 0;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

          {/* Breakdowns — 4 tables stacked eat a lot of mobile scroll for info
              that's secondary to the KPIs/curve above, so they collapse into
              an accordion there; desktop keeps the always-visible 2-col grid. */}
          <div className="hidden md:grid gap-4 lg:grid-cols-2">
            <BreakdownTable title="Par paire" buckets={symbols} />
            <BreakdownTable title="Par session" buckets={sessions} />
            <BreakdownTable title="Par niveau de confiance" buckets={confidence} />
            <BreakdownTable title="Par heure (locale)" buckets={hours} />
          </div>
          <Accordion type="single" collapsible className="md:hidden glass-panel rounded-xl px-4">
            <AccordionItem value="symbol" className="border-border/40">
              <AccordionTrigger>Par paire</AccordionTrigger>
              <AccordionContent><BreakdownTable buckets={symbols} bare /></AccordionContent>
            </AccordionItem>
            <AccordionItem value="session" className="border-border/40">
              <AccordionTrigger>Par session</AccordionTrigger>
              <AccordionContent><BreakdownTable buckets={sessions} bare /></AccordionContent>
            </AccordionItem>
            <AccordionItem value="confidence" className="border-border/40">
              <AccordionTrigger>Par niveau de confiance</AccordionTrigger>
              <AccordionContent><BreakdownTable buckets={confidence} bare /></AccordionContent>
            </AccordionItem>
            <AccordionItem value="hour" className="border-none">
              <AccordionTrigger>Par heure (locale)</AccordionTrigger>
              <AccordionContent><BreakdownTable buckets={hours} bare /></AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* ── Diagnostic segmenté ──
              Les tableaux ci-dessus agrègent toutes les familles d'instruments
              ensemble, ce qui produit des conclusions fausses dès que plusieurs
              presets tournent : chaque preset impose SON accord de timeframes,
              donc comparer les win rates par accord TF revient à comparer des
              instruments entre eux, pas l'effet du paramètre. Cette section
              segmente d'abord, compare en espérance, et affiche l'incertitude. */}
          <div className="glass-panel rounded-xl p-5">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Microscope className="h-4 w-4 text-[color:var(--brand-cyan)]" />
              Diagnostic segmenté
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Le taux de gain n'est pas comparable entre familles : un Multiplier à ratio 6:1 doit
              gagner ~86% du temps pour être à l'équilibre, un binaire forex ~57%. Seule
              l'espérance ($/trade) se compare.
            </p>

            <div className="mt-4 space-y-3">
              {segments.map((seg) => <SegmentCard key={seg.key} seg={seg} />)}
              {segments.length === 0 && (
                <div className="text-sm text-muted-foreground">Aucun trade clôturé à analyser.</div>
              )}
            </div>
          </div>

          {/* Coût de transaction réel — invisible dans un backtest sur bougies. */}
          {(slippage.measuredLosses > 0 || slippage.measuredWins > 0) && (
            <div className="glass-panel rounded-xl p-5">
              <h2 className="text-base font-semibold">Coût de transaction réel</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Écart entre les stops/objectifs configurés et ce qui a réellement été encaissé.
                C'est la seule mesure fiable du slippage — un backtest sur bougies ne peut pas le voir.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat
                  label="Dépassement / perte"
                  value={`${slippage.overshootAvg >= 0 ? "+" : ""}$${slippage.overshootAvg.toFixed(3)}`}
                  sub={`stop $${slippage.configuredStopAvg.toFixed(2)} → réel $${slippage.actualLossAvg.toFixed(2)}`}
                  tone={slippage.overshootAvg > 0.01 ? "bear" : "bull"}
                />
                <Stat
                  label="Manque / gain"
                  value={`${slippage.shortfallAvg >= 0 ? "-" : "+"}$${Math.abs(slippage.shortfallAvg).toFixed(3)}`}
                  sub={`objectif $${slippage.configuredTpAvg.toFixed(2)} → réel $${slippage.actualWinAvg.toFixed(2)}`}
                  tone={slippage.shortfallAvg > 0.01 ? "bear" : "bull"}
                />
                <Stat
                  label="Coût estimé / trade"
                  value={slippage.costPerTradeEstimate === null ? "—" : `$${slippage.costPerTradeEstimate.toFixed(4)}`}
                  sub="à retrancher de l'espérance"
                  tone={(slippage.costPerTradeEstimate ?? 0) > 0 ? "bear" : "default"}
                />
                <Stat
                  label="Échantillon"
                  value={`${slippage.measuredLosses + slippage.measuredWins}`}
                  sub={`${slippage.measuredLosses} pertes / ${slippage.measuredWins} gains mesurés`}
                />
              </div>
              {slippage.measuredLosses + slippage.measuredWins < 30 && (
                <p className="mt-3 text-[11px] text-[color:var(--brand-amber)]">
                  ⚠️ Moins de 30 trades mesurés — chiffre indicatif, pas encore concluant.
                </p>
              )}
            </div>
          )}

          {/* Accord TF / confiance calculés DANS chaque famille. */}
          {(tfWithin.length > 0 || confWithin.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              <WithinCard title="Accord des timeframes (par famille)" groups={tfWithin} />
              <WithinCard title="Niveau de confiance (par famille)" groups={confWithin} />
            </div>
          )}

          {/* Erreurs datées : distingue un incident ponctuel d'un problème courant. */}
          {errDays.length > 0 && (
            <div className="glass-panel rounded-xl p-5">
              <h2 className="text-base font-semibold">Erreurs d'exécution par jour</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Un pic concentré sur quelques jours = incident ponctuel déjà passé. Réparti dans le
                temps = problème courant à corriger.
              </p>
              <div className="mt-3 max-h-56 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {errDays.map((d) => (
                      <tr key={d.date} className="border-t border-border/40">
                        <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">{d.date}</td>
                        <td className="py-2 pr-3 text-right font-semibold text-[color:var(--bear)]">{d.count}</td>
                        <td className="py-2 text-xs text-muted-foreground truncate">{d.topNote}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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

/** Une famille d'instrument. L'espérance est mise en avant plutôt que le taux
 * de gain : c'est la seule valeur comparable d'une famille à l'autre, et
 * l'intervalle de Wilson rend visible un échantillon non concluant. */
function SegmentCard({ seg }: { seg: SegmentStats }) {
  const positive = seg.expectancy >= 0;
  return (
    <div className={cn(
      "rounded-xl border p-4",
      seg.reliable ? "border-border/60" : "border-[color:var(--brand-amber)]/40 bg-[color:var(--brand-amber)]/[0.04]",
    )}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{seg.label}</span>
        <span className={cn("font-mono text-lg font-bold", positive ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
          {positive ? "+" : ""}${seg.expectancy.toFixed(4)}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">/trade</span>
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <Metric label="Trades" value={String(seg.trades)} />
        <Metric label="Gagnants" value={`${seg.winRate.toFixed(1)}%`} />
        <Metric label="Rentabilité" value={seg.breakEvenWinRate === null ? "—" : `${seg.breakEvenWinRate.toFixed(1)}%`} />
        <Metric
          label="Edge"
          value={seg.edge === null ? "—" : `${seg.edge >= 0 ? "+" : ""}${seg.edge.toFixed(1)}pp`}
          tone={seg.edge === null ? undefined : seg.edge >= 0 ? "bull" : "bear"}
        />
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        Gain moyen ${seg.avgWin.toFixed(2)} · perte moyenne ${seg.avgLoss.toFixed(2)} · P&amp;L {seg.pnl >= 0 ? "+" : ""}${seg.pnl.toFixed(2)}
        <br />
        Intervalle de confiance 95% du taux de gain : {seg.winRateLow.toFixed(1)}% – {seg.winRateHigh.toFixed(1)}%
      </div>

      {!seg.reliable && (
        <div className="mt-2 text-[11px] text-[color:var(--brand-amber)]">
          ⚠️ {seg.trades} trades seulement — intervalle trop large pour conclure.
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "font-semibold",
        tone === "bull" && "text-[color:var(--bull)]",
        tone === "bear" && "text-[color:var(--bear)]",
      )}>{value}</div>
    </div>
  );
}

/** Découpage d'une dimension à l'intérieur de chaque famille. Si une famille
 * n'affiche qu'une seule ligne, c'est que son preset fixe ce paramètre — et
 * qu'aucune comparaison n'est possible sur cette dimension. */
function WithinCard({ title, groups }: { title: string; groups: { segment: string; label: string; buckets: SegmentStats[] }[] }) {
  return (
    <div className="glass-panel rounded-xl p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-4">
        {groups.map((g) => (
          <div key={g.segment}>
            <div className="text-xs font-medium text-muted-foreground">{g.label}</div>
            <div className="mt-1.5 space-y-1">
              {g.buckets.map((b) => (
                <div key={b.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="w-20 shrink-0 font-medium">{b.label}</span>
                  <span className="text-muted-foreground">{b.trades}t</span>
                  <span className="flex-1 text-right">{b.winRate.toFixed(0)}%</span>
                  <span className={cn(
                    "w-24 text-right font-mono font-semibold",
                    b.expectancy >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]",
                  )}>
                    {b.expectancy >= 0 ? "+" : ""}${b.expectancy.toFixed(3)}
                  </span>
                  {!b.reliable && <span className="text-[color:var(--brand-amber)]" title="échantillon trop faible">⚠</span>}
                </div>
              ))}
              {g.buckets.length === 1 && (
                <div className="text-[11px] text-muted-foreground italic">
                  Une seule valeur — fixée par le preset, aucune comparaison possible ici.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
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

function BreakdownTable({ title, buckets, bare = false }: { title?: string; buckets: Bucket[]; bare?: boolean }) {
  const content = (
    <>
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
    </>
  );

  if (bare) return content;

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {content}
    </div>
  );
}
