import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, ChevronUp, Play } from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi-card";
import { fetchCandles, GRANULARITY, SYMBOLS } from "@/lib/deriv";
import {
  backtestBollinger,
  backtestEmaCross,
  backtestRsiMacd,
  type BacktestResult,
} from "@/lib/indicators";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/backtest")({
  head: () => ({ meta: [{ title: "Backtest — LIO23" }] }),
  component: BacktestPage,
});

const STRATS = [
  { id: "rsi-macd", label: "RSI + MACD (long-only)" },
  { id: "ema-cross", label: "EMA 50/200 Cross" },
  { id: "bb-mean-rev", label: "Bollinger Mean Reversion" },
];
const TF = ["15m", "1H", "4H", "1D"] as const;
const COUNTS: Record<string, number> = { "15m": 500, "1H": 700, "4H": 700, "1D": 700 };

function BacktestPage() {
  const [strategy, setStrategy] = useState(STRATS[0].id);
  const [symbol, setSymbol] = useState(SYMBOLS[0]);
  const [tf, setTf] = useState<(typeof TF)[number]>("1H");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [showTrades, setShowTrades] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const candles = await fetchCandles(symbol.deriv, GRANULARITY[tf], COUNTS[tf]);
      let r: BacktestResult;
      if (strategy === "ema-cross") r = backtestEmaCross(candles);
      else if (strategy === "bb-mean-rev") r = backtestBollinger(candles);
      else r = backtestRsiMacd(candles);
      setResult(r);
      setShowTrades(false);
      toast.success(`Backtest terminé · ${r.trades} trades`);
    } catch (e) {
      toast.error(`Erreur Deriv: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Backtest</h1>
        <p className="text-sm text-muted-foreground">
          Teste une stratégie sur les données historiques Deriv.
        </p>
      </div>

      <div className="glass-panel rounded-xl p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Stratégie">
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {STRATS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Paire">
            <select
              value={symbol.deriv}
              onChange={(e) => {
                const s = SYMBOLS.find((x) => x.deriv === e.target.value)!;
                setSymbol(s);
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {SYMBOLS.map((s) => (
                <option key={s.deriv} value={s.deriv}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Timeframe">
            <select
              value={tf}
              onChange={(e) => setTf(e.target.value as (typeof TF)[number])}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {TF.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <Button
              onClick={run}
              disabled={loading}
              className="w-full bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-semibold hover:opacity-90"
            >
              <Play className="mr-2 h-4 w-4" />
              {loading ? "Calcul…" : "Lancer"}
            </Button>
          </div>
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          {strategy === "rsi-macd" && "Achète quand RSI < 40 + MACD cross haussier. Vend quand RSI > 70 ou MACD cross baissier."}
          {strategy === "ema-cross" && "Achète au golden cross EMA 50/200. Vend au death cross."}
          {strategy === "bb-mean-rev" && "Achète quand le prix touche la bande inférieure de Bollinger. Vend quand il revient à la moyenne."}
        </div>
      </div>

      {result && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="ROI" value={`${result.roi.toFixed(2)}%`} tone={result.roi >= 0 ? "bull" : "bear"} delta="Capital $10 000 initial" />
            <KpiCard label="Win Rate" value={`${result.winRate.toFixed(1)}%`} delta={`${result.wins}W / ${result.losses}L / ${result.trades} trades`} tone="cyan" />
            <KpiCard label="Sharpe" value={result.sharpe.toFixed(2)} delta="Annualisé" tone="violet" />
            <KpiCard label="Max DD" value={`-${result.maxDrawdown.toFixed(1)}%`} tone="bear" delta="Drawdown maximum" />
          </div>

          <div className="glass-panel rounded-xl p-4">
            <h2 className="text-base font-semibold">Courbe de capital</h2>
            <div className="mt-3 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={result.equity.map((e) => ({ t: e.t * 1000, v: e.value }))}>
                  <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand-violet)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--brand-violet)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="t"
                    tickFormatter={(v) => new Date(v).toLocaleDateString()}
                    stroke="oklch(0.7 0.03 255 / 0.5)"
                    fontSize={11}
                    minTickGap={50}
                  />
                  <YAxis stroke="oklch(0.7 0.03 255 / 0.5)" fontSize={11} domain={["auto", "auto"]} width={70} />
                  <Tooltip
                    contentStyle={{ background: "oklch(0.20 0.035 260)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 8 }}
                    labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                    formatter={(v: number) => [`$${v.toFixed(2)}`, "Capital"]}
                  />
                  <Area type="monotone" dataKey="v" stroke="var(--brand-violet)" strokeWidth={2} fill="url(#eq)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {result.tradeList.length > 0 && (
            <div className="glass-panel rounded-xl overflow-hidden">
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/10 transition-colors"
                onClick={() => setShowTrades((v) => !v)}
              >
                <span>Liste des trades ({result.tradeList.length})</span>
                {showTrades ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showTrades && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 text-left">#</th>
                        <th className="px-4 py-2.5 text-left">Entrée</th>
                        <th className="px-4 py-2.5 text-left">Sortie</th>
                        <th className="px-4 py-2.5 text-right">Prix entrée</th>
                        <th className="px-4 py-2.5 text-right">Prix sortie</th>
                        <th className="px-4 py-2.5 text-right">PnL</th>
                        <th className="px-4 py-2.5 text-center">Résultat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.tradeList.map((t, i) => (
                        <tr key={i} className="border-t border-border/40">
                          <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {new Date(t.entryEpoch * 1000).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {new Date(t.exitEpoch * 1000).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs">
                            {t.entryPrice.toFixed(t.entryPrice > 100 ? 2 : 5)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs">
                            {t.exitPrice.toFixed(t.exitPrice > 100 ? 2 : 5)}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-2 text-right font-semibold",
                              t.won ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]",
                            )}
                          >
                            {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span
                              className={cn(
                                "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
                                t.won
                                  ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                                  : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
                              )}
                            >
                              {t.won ? "Win" : "Loss"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
