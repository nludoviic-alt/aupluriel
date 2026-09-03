import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock, Download, Eye, FileText, Info, Microscope, Shield, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { type TradeLog } from "@/lib/autotrader";
import { api } from "@/lib/api";
import {
  bySession,
  bySymbol,
  byConfidence,
  byHour,
  byDay,
  bySegment,
  withinSegment,
  slippageBySegment,
  errorsByDay,
  equityCurve,
  exceptionalDayImpact,
  exportToCsv,
  insights,
  performanceWindows,
  summarize,
  type Bucket,
  type DayBucket,
  type ExceptionalDayImpact,
  type PerformanceWindow,
  type SegmentStats,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/journal")({
  head: () => ({ meta: [{ title: "Journal de performance — PLURIEL" }] }),
  component: JournalPage,
});

function JournalPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<TradeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrade, setSelectedTrade] = useState<TradeLog | null>(null);
  // Symbols currently in the watchlist of at least one of the three presets
  // (default/boom/crash), minus whatever each preset excludes. Retired
  // symbols (e.g. BOOM600, excluded after real losses) stay in bot_trades
  // forever — without this filter, their historical drag permanently
  // pollutes every KPI on this page, making a config that's actually fixed
  // look like it's still bleeding. null while the config hasn't loaded yet.
  const [activeSymbols, setActiveSymbols] = useState<Set<string> | null>(null);
  // Off by default: only currently-active symbols count toward the numbers
  // above the fold. The full history (including retired symbols) stays one
  // click away, never deleted — just not the default read.
  const [showRetired, setShowRetired] = useState(false);

  useEffect(() => {
    api.get<TradeLog[]>("/api/bot-trades?limit=500")
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
    api.get<{ presets: Record<string, { savedConfig: { symbols?: string[]; excludedSymbols?: string[] } | null }> }>("/api/bot")
      .then((data) => {
        const active = new Set<string>();
        for (const preset of Object.values(data.presets ?? {})) {
          const cfg = preset.savedConfig;
          if (!cfg?.symbols) continue;
          const excluded = new Set(cfg.excludedSymbols ?? []);
          for (const sym of cfg.symbols) if (!excluded.has(sym)) active.add(sym);
        }
        setActiveSymbols(active);
      })
      .catch(() => setActiveSymbols(new Set())); // fetch failed — fall back to showing everything rather than hiding all data
  }, []);

  const retiredCount = activeSymbols ? logs.filter((l) => !activeSymbols.has(l.symbol)).length : 0;
  // Once the active-symbol set is known, filtering IS the real view by
  // default; an empty activeSymbols set (fetch failed, or genuinely no
  // preset configured yet) falls back to showing everything instead of
  // hiding all data behind a filter that couldn't be computed.
  const visibleLogs = showRetired || !activeSymbols || activeSymbols.size === 0
    ? logs
    : // idxseasonal (piste A) est un preset autonome : ses symboles OTC_* ne sont
      // dans aucune watchlist du moteur TA, donc jamais dans activeSymbols. On
      // les garde toujours visibles sinon la validation 200 trades est invisible ici.
      logs.filter((l) => activeSymbols.has(l.symbol) || (l.preset as string) === "idxseasonal");

  const s = summarize(visibleLogs);
  const equity = equityCurve(visibleLogs);
  const ideas = insights(visibleLogs);
  const symbols = bySymbol(visibleLogs);
  const sessions = bySession(visibleLogs);
  const hours = byHour(visibleLogs);
  const confidence = byConfidence(visibleLogs);
  const days = byDay(visibleLogs);
  const segments = bySegment(visibleLogs);
  const tfWithin = withinSegment(visibleLogs, "tfAgreement");
  const confWithin = withinSegment(visibleLogs, "confidence");
  const slippage = slippageBySegment(visibleLogs);
  const errDays = errorsByDay(visibleLogs);
  const windows = performanceWindows(visibleLogs);
  const exceptionalDay = exceptionalDayImpact(visibleLogs);
  const recent100 = windows.find((window) => window.size === 100);
  const frequencyLocked = recent100?.current.trades === 100 && recent100.current.profitFactor < 1;
  const hasFrequencySample = recent100?.current.trades === 100;

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
          {user && (
            <p className="mt-1 text-xs text-muted-foreground">
              Compte {user.username} · journal serveur uniquement
            </p>
          )}
        </div>
        {hasData && (
          <Button variant="outline" size="sm" onClick={() => exportToCsv(logs)} className="gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        )}
      </div>

      {/* Retired-symbol filter — off by default, KPIs below reflect only
          symbols currently in a watchlist. BOOM600 and similar exclusions
          stay in bot_trades forever; without this, their historical drag
          makes an already-fixed config look like it's still losing. */}
      {activeSymbols && activeSymbols.size > 0 && retiredCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {showRetired
              ? `Historique complet affiché — ${retiredCount} trade${retiredCount > 1 ? "s" : ""} sur des paires retirées de la watchlist inclus.`
              : `${retiredCount} trade${retiredCount > 1 ? "s" : ""} sur des paires déjà retirées de la watchlist (ex. BOOM600) masqué${retiredCount > 1 ? "s" : ""} — les chiffres ci-dessous reflètent uniquement ce qui tourne réellement aujourd'hui.`}
          </p>
          <Button variant="outline" size="sm" onClick={() => setShowRetired((v) => !v)} className="shrink-0 text-xs">
            {showRetired ? "Masquer l'historique retiré" : "Afficher aussi l'historique retiré"}
          </Button>
        </div>
      )}

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

          <PerformanceWindows
            windows={windows}
            frequencyLocked={frequencyLocked}
            hasFrequencySample={hasFrequencySample}
            exceptionalDay={exceptionalDay}
          />

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

          {/* Coût de transaction réel, PAR FAMILLE — invisible dans un backtest
              sur bougies. Un total agrégé n'aurait pas de sens : il moyennerait
              un stop de $1.50 (Boom) avec un stop de $100 (forex sur grosse
              mise), et le chiffre serait porté par les gros trades. */}
          {slippage.length > 0 && (
            <div className="glass-panel rounded-xl p-5">
              <h2 className="text-base font-semibold">Coût de transaction réel</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Écart entre les stops/objectifs configurés et ce qui a réellement été encaissé —
                la seule mesure fiable du slippage, qu'un backtest sur bougies ne peut pas voir.
                Séparé par famille : les tailles de stop n'y sont pas comparables.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Famille</th>
                      <th className="px-3 py-2 text-right">Dépassement / perte</th>
                      <th className="px-3 py-2 text-right">Manque / gain</th>
                      <th className="px-3 py-2 text-right">Coût / trade</th>
                      <th className="px-3 py-2 text-right">Mesurés</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slippage.map((s) => (
                      <tr key={s.key} className="border-t border-border/40">
                        <td className="px-3 py-2 font-medium whitespace-nowrap">
                          {s.label}
                          {!s.reliable && <span className="ml-1.5 text-[color:var(--brand-amber)]" title="échantillon trop faible">⚠</span>}
                        </td>
                        {/* Convention unique aux trois colonnes : positif = ça te
                            coûte (rouge), négatif = l'exécution te favorise (vert).
                            Sans perte (ou sans gain) enregistrée il n'y a rien à
                            mesurer — "—" plutôt qu'un "$0.00 → $0.00" qui
                            ressemblerait à une mesure neutre. */}
                        <td className={cn("px-3 py-2 text-right font-mono", s.measuredLosses === 0 ? "text-muted-foreground" : signTone(s.overshootAvg))}>
                          {s.measuredLosses === 0 ? "—" : (
                            <>
                              {signed(s.overshootAvg, 3)}
                              <span className="block text-[10px] font-sans text-muted-foreground">
                                stop ${s.configuredStopAvg.toFixed(2)} → ${s.actualLossAvg.toFixed(2)}
                              </span>
                            </>
                          )}
                        </td>
                        <td className={cn("px-3 py-2 text-right font-mono", s.measuredWins === 0 ? "text-muted-foreground" : signTone(s.shortfallAvg))}>
                          {s.measuredWins === 0 ? "—" : (
                            <>
                              {signed(s.shortfallAvg, 3)}
                              <span className="block text-[10px] font-sans text-muted-foreground">
                                cible ${s.configuredTpAvg.toFixed(2)} → ${s.actualWinAvg.toFixed(2)}
                              </span>
                            </>
                          )}
                        </td>
                        <td className={cn("px-3 py-2 text-right font-mono font-semibold", s.costPerTradeEstimate === null ? "text-muted-foreground" : signTone(s.costPerTradeEstimate))}>
                          {s.costPerTradeEstimate === null ? "—" : signed(s.costPerTradeEstimate, 4)}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                          {s.measuredLosses + s.measuredWins}
                          <span className="block text-[10px]">{s.measuredLosses}L / {s.measuredWins}G</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Lecture : <span className="text-[color:var(--bear)]">positif = ça te coûte</span> ·{" "}
                <span className="text-[color:var(--bull)]">négatif = l'exécution te favorise</span> (pertes
                encaissées sous le stop configuré, ou gains au-dessus de l'objectif).
                ⚠ = moins de 20 trades mesurés, chiffre non concluant.
              </p>
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

          {/* ── Table des trades enregistrés & Inspection de Snapshot Immuable ── */}
          <div className="glass-panel rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Eye className="h-4 w-4 text-[color:var(--brand-cyan)]" />
                  Historique des trades & Snapshots de configuration
                </h2>
                <p className="text-xs text-muted-foreground">
                  Cliquez sur "Inspecter" pour reconstruire les indicateurs, les filtres et la configuration immuable du preset au moment du signal.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 uppercase tracking-wider text-muted-foreground sticky top-0 bg-slate-900 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left">Date &amp; Heure</th>
                    <th className="px-3 py-2 text-left">Paire</th>
                    <th className="px-3 py-2 text-left">Direction</th>
                    <th className="px-3 py-2 text-left">Preset</th>
                    <th className="px-3 py-2 text-right">Mise</th>
                    <th className="px-3 py-2 text-right">P&amp;L</th>
                    <th className="px-3 py-2 text-center">Résultat</th>
                    <th className="px-3 py-2 text-center">Conf.</th>
                    <th className="px-3 py-2 text-center">Snapshot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30 font-mono">
                  {visibleLogs.slice(0, 100).map((trade) => {
                    const isWon = trade.status === "won";
                    const isLost = trade.status === "lost";
                    return (
                      <tr key={trade.id} className="hover:bg-white/[0.03] transition-colors">
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {new Date(trade.time).toLocaleDateString("fr-FR")} {new Date(trade.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-3 py-2 font-bold text-foreground">{trade.symbol}</td>
                        <td className={cn("px-3 py-2 font-semibold", trade.direction === "CALL" || trade.direction === "MULTUP" ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                          {trade.direction}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{trade.preset || trade.strategy || "—"}</td>
                        <td className="px-3 py-2 text-right text-foreground">${trade.stake.toFixed(2)}</td>
                        <td className={cn("px-3 py-2 text-right font-bold", isWon ? "text-[color:var(--bull)]" : isLost ? "text-[color:var(--bear)]" : "text-muted-foreground")}>
                          {trade.profit >= 0 ? "+" : ""}${trade.profit.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={cn("inline-block px-1.5 py-0.5 text-[10px] font-sans font-semibold rounded", isWon ? "bg-emerald-500/20 text-emerald-400" : isLost ? "bg-red-500/20 text-red-400" : "bg-muted text-muted-foreground")}>
                            {trade.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-muted-foreground">{trade.confidence}%</td>
                        <td className="px-3 py-2 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedTrade(trade)}
                            className="h-6 px-2 text-[10px] gap-1 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                          >
                            <Eye className="h-3 w-3" /> Inspecter
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <TradeSnapshotModal trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
        </>
      )}
    </div>
  );
}

function parseSnapshotData(data: Record<string, unknown> | string | undefined): Record<string, unknown> | null {
  if (!data) return null;
  if (typeof data === "object") return data;
  try {
    const parsed = JSON.parse(data);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function TradeSnapshotModal({
  trade,
  onClose,
}: {
  trade: TradeLog | null;
  onClose: () => void;
}) {
  if (!trade) return null;

  const configObj = parseSnapshotData(trade.configSnapshot);
  const indicatorObj = parseSnapshotData(trade.indicatorValues);
  const timeFilterObj = parseSnapshotData(trade.timeFilterDecision);
  const riskManagerObj = parseSnapshotData(trade.riskManagerDecision);

  const dateStr = new Date(trade.time).toLocaleString("fr-FR");

  return (
    <Dialog open={!!trade} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-slate-950 text-foreground border-white/10 p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Eye className="h-5 w-5 text-[color:var(--brand-cyan)]" />
            Snapshot Immuable — Trade {trade.id}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Reconstruction exacte des paramètres de la stratégie, indicateurs et filtres au moment du signal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-xs mt-2">
          {/* Signal Header summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div>
              <span className="text-muted-foreground uppercase text-[10px]">Paire</span>
              <p className="font-bold text-sm text-foreground">{trade.symbol}</p>
            </div>
            <div>
              <span className="text-muted-foreground uppercase text-[10px]">Direction</span>
              <p className={cn("font-bold text-sm", trade.direction === "CALL" || trade.direction === "MULTUP" ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                {trade.direction}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground uppercase text-[10px]">Résultat</span>
              <p className={cn("font-bold text-sm", trade.status === "won" ? "text-[color:var(--bull)]" : trade.status === "lost" ? "text-[color:var(--bear)]" : "text-muted-foreground")}>
                {trade.status === "won" ? `+${trade.profit.toFixed(2)}$` : `${trade.profit.toFixed(2)}$`} ({trade.status})
              </p>
            </div>
            <div>
              <span className="text-muted-foreground uppercase text-[10px]">Mise</span>
              <p className="font-bold text-sm text-foreground">${trade.stake.toFixed(2)}</p>
            </div>
          </div>

          {/* Justification & Note */}
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
            <span className="font-semibold text-cyan-400 flex items-center gap-1.5 mb-1">
              <FileText className="h-3.5 w-3.5" /> Explication du Signal
            </span>
            <p className="text-foreground/90 font-mono text-[11px] leading-relaxed">
              {trade.note || "Aucune note explicative enregistrée."}
            </p>
          </div>

          {/* Stratégie et Version */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02]">
              <span className="text-muted-foreground text-[10px] uppercase">Preset Engine</span>
              <p className="font-mono font-semibold text-foreground">{trade.preset ?? "default"}</p>
            </div>
            <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02]">
              <span className="text-muted-foreground text-[10px] uppercase">Stratégie</span>
              <p className="font-mono font-semibold text-foreground">{trade.strategy || "N/A"}</p>
            </div>
            <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02]">
              <span className="text-muted-foreground text-[10px] uppercase">Version Config</span>
              <p className="font-mono font-semibold text-foreground">{trade.strategyVersion || "V1"}</p>
            </div>
          </div>

          {/* Indicateurs Calculés */}
          <div className="rounded-lg border border-white/10 p-3 space-y-2 bg-white/[0.02]">
            <h4 className="font-semibold flex items-center gap-1.5 text-foreground">
              <Activity className="h-3.5 w-3.5 text-amber-400" /> Indicateurs au moment du Signal
            </h4>
            {indicatorObj ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                <div><span className="text-muted-foreground">Confiance:</span> <strong className="font-mono text-foreground">{String(indicatorObj.confidence ?? trade.confidence)}%</strong></div>
                <div><span className="text-muted-foreground">TF Agreement:</span> <strong className="font-mono text-foreground">{String(indicatorObj.tfAgreement ?? trade.tfAgreement)}/4</strong></div>
                <div><span className="text-muted-foreground">TAS Score:</span> <strong className="font-mono text-foreground">{String(indicatorObj.trendAlignmentScore ?? "N/A")}/4</strong></div>
                <div><span className="text-muted-foreground">Volatilité ATR:</span> <strong className="font-mono text-foreground">{String(indicatorObj.volatilityPct ?? "N/A")}%</strong></div>
                <div><span className="text-muted-foreground">Ratio Volatilité:</span> <strong className="font-mono text-foreground">{String(indicatorObj.volatilityRatio ?? "1")}x</strong></div>
                <div><span className="text-muted-foreground">TF Dominant:</span> <strong className="font-mono text-foreground">{String(indicatorObj.dominantTf ?? "1m")}</strong></div>
              </div>
            ) : (
              <p className="text-muted-foreground text-[11px]">Confiance: {trade.confidence}% | TF Agreement: {trade.tfAgreement}</p>
            )}
          </div>

          {/* Time Filter & Risk Manager Decisions */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02] space-y-1">
              <h4 className="font-semibold flex items-center gap-1.5 text-foreground">
                <Clock className="h-3.5 w-3.5 text-purple-400" /> Time Filter Decision
              </h4>
              {timeFilterObj ? (
                <div className="space-y-1 text-[11px]">
                  <p><span className="text-muted-foreground">Statut:</span> <strong className={timeFilterObj.isBlocked ? "text-red-400" : "text-emerald-400"}>{String(timeFilterObj.status)}</strong></p>
                  <p><span className="text-muted-foreground">Heure UTC:</span> <span className="font-mono text-foreground">{String(timeFilterObj.hourUtc ?? "N/A")}h</span></p>
                  <p><span className="text-muted-foreground">Multiplicateur Risque:</span> <span className="font-mono text-foreground">{String(timeFilterObj.riskMultiplier ?? 1)}x</span></p>
                  {Boolean(timeFilterObj.reason) && <p className="text-muted-foreground italic text-[10px]">{String(timeFilterObj.reason)}</p>}
                </div>
              ) : (
                <p className="text-muted-foreground text-[11px]">Time Filter non configuré (Legacy)</p>
              )}
            </div>

            <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02] space-y-1">
              <h4 className="font-semibold flex items-center gap-1.5 text-foreground">
                <Shield className="h-3.5 w-3.5 text-blue-400" /> Risk Manager V3 Decision
              </h4>
              {riskManagerObj ? (
                <div className="space-y-1 text-[11px]">
                  <p><span className="text-muted-foreground">Décision:</span> <strong className={riskManagerObj.decision === "REJECTED" ? "text-red-400" : "text-emerald-400"}>{String(riskManagerObj.decision)}</strong></p>
                  <p><span className="text-muted-foreground">Mise calculée:</span> <span className="font-mono text-foreground">${Number(riskManagerObj.finalStakeCalculated ?? trade.stake).toFixed(2)}</span></p>
                  <p><span className="text-muted-foreground">Drawdown Jour:</span> <span className="font-mono text-foreground">${Number(riskManagerObj.dailyPnl ?? 0).toFixed(2)}</span></p>
                  {Boolean(riskManagerObj.explanation) && <p className="text-muted-foreground italic text-[10px]">{String(riskManagerObj.explanation)}</p>}
                </div>
              ) : (
                <p className="text-muted-foreground text-[11px]">Risk Check V3 non configuré (Legacy)</p>
              )}
            </div>
          </div>

          {/* Config Snapshot (JSON Viewer / Key Values) */}
          <div className="rounded-lg border border-white/10 p-3 bg-white/[0.02] space-y-2">
            <h4 className="font-semibold text-foreground flex items-center justify-between">
              <span>Config Snapshot Immuable (Preset Configuration)</span>
              <span className="text-[10px] font-normal text-muted-foreground">{dateStr}</span>
            </h4>
            {configObj ? (
              <pre className="max-h-48 overflow-y-auto rounded bg-black/60 p-2.5 font-mono text-[10px] text-cyan-300 border border-white/5 whitespace-pre-wrap leading-tight">
                {JSON.stringify(configObj, null, 2)}
              </pre>
            ) : (
              <p className="text-muted-foreground text-[11px] italic">Snapshot immuable de configuration non disponible pour ce trade legacy.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
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

function PerformanceWindows({
  windows,
  frequencyLocked,
  hasFrequencySample,
  exceptionalDay,
}: {
  windows: PerformanceWindow[];
  frequencyLocked: boolean;
  hasFrequencySample: boolean;
  exceptionalDay: ExceptionalDayImpact | null;
}) {
  return (
    <section className="glass-panel rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Performance récente</h2>
          <p className="text-xs text-muted-foreground">Chaque fenêtre est comparée aux trades qui la précèdent.</p>
        </div>
        <span className={cn(
          "inline-flex items-center gap-1.5 text-xs font-semibold",
          frequencyLocked
            ? "text-[color:var(--bear)]"
            : hasFrequencySample
              ? "text-[color:var(--bull)]"
              : "text-muted-foreground",
        )}>
          {frequencyLocked && <AlertTriangle className="h-3.5 w-3.5" />}
          {frequencyLocked
            ? "Fréquence à ne pas augmenter"
            : hasFrequencySample
              ? "Aucune alerte sur 100 trades"
              : "Échantillon inférieur à 100 trades"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Fenêtre</th>
              <th className="px-4 py-2 text-right">P&amp;L</th>
              <th className="px-4 py-2 text-right">Espérance</th>
              <th className="px-4 py-2 text-right">PF</th>
              <th className="px-4 py-2 text-right">Période précédente</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((window) => {
              const current = window.current;
              const previous = window.previous;
              return (
                <tr key={window.size} className="border-t border-border/40">
                  <td className="px-4 py-2 font-semibold">{current.trades} derniers</td>
                  <td className={cn("px-4 py-2 text-right font-mono font-semibold", current.netPnl >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                    {current.netPnl >= 0 ? "+" : ""}${current.netPnl.toFixed(2)}
                  </td>
                  <td className={cn("px-4 py-2 text-right font-mono", current.expectancy >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                    {current.expectancy >= 0 ? "+" : ""}${current.expectancy.toFixed(3)}
                  </td>
                  <td className={cn("px-4 py-2 text-right font-mono font-semibold", current.profitFactor >= 1 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                    {formatProfitFactor(current.profitFactor)}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {previous
                      ? `${previous.netPnl >= 0 ? "+" : ""}$${previous.netPnl.toFixed(2)} · PF ${formatProfitFactor(previous.profitFactor)}`
                      : "Échantillon insuffisant"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {exceptionalDay?.concentrated && (
        <div className="border-t border-[color:var(--brand-amber)]/25 bg-[color:var(--brand-amber)]/[0.04] px-4 py-3 text-xs">
          <span className="font-semibold text-[color:var(--brand-amber)]">Résultat concentré : </span>
          la meilleure journée ({new Date(`${exceptionalDay.bestDay.date}T00:00:00Z`).toLocaleDateString("fr-FR")})
          représente {exceptionalDay.bestDay.pnl >= 0 ? "+" : ""}${exceptionalDay.bestDay.pnl.toFixed(2)}.
          Sans elle, le P&amp;L serait {exceptionalDay.pnlWithoutBestDay >= 0 ? "+" : ""}${exceptionalDay.pnlWithoutBestDay.toFixed(2)}.
        </div>
      )}
    </section>
  );
}

function formatProfitFactor(value: number): string {
  return value === Infinity ? "∞" : value.toFixed(2);
}

/** Montant signé, convention « coût » : positif = défavorable, négatif =
 * favorable. Le signe est toujours explicite pour qu'aucune colonne ne se lise
 * à l'envers d'une autre. */
function signed(v: number, digits: number): string {
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(digits)}`;
}

function signTone(v: number): string {
  // Sous le centime, l'écart n'est pas significatif — on reste neutre.
  if (Math.abs(v) < 0.01) return "text-muted-foreground";
  return v > 0 ? "text-[color:var(--bear)]" : "text-[color:var(--bull)]";
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
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Segment</th>
              <th className="px-4 py-2 text-right">Trades</th>
              <th className="px-4 py-2 text-right">P&L</th>
              <th className="px-4 py-2 text-right">Espérance</th>
              <th className="px-4 py-2 text-right">PF</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key} className="border-t border-border/40">
                <td className="px-4 py-2 font-medium">{b.label}</td>
                <td className="px-4 py-2 text-right text-muted-foreground">{b.trades}</td>
                <td className={cn("px-4 py-2 text-right font-mono font-semibold", b.pnl >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                  {b.pnl >= 0 ? "+" : ""}{b.pnl.toFixed(2)}
                </td>
                <td className={cn("px-4 py-2 text-right font-mono", b.expectancy >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                  {b.expectancy >= 0 ? "+" : ""}{b.expectancy.toFixed(3)}
                </td>
                <td className={cn("px-4 py-2 text-right font-mono font-semibold", b.profitFactor >= 1 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                  {formatProfitFactor(b.profitFactor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );

  if (bare) return <div className="overflow-x-auto">{content}</div>;

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">{content}</div>
    </div>
  );
}
