import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CandlestickChart } from "@/components/candlestick-chart";
import { useDerivCandles } from "@/hooks/use-deriv";
import { GRANULARITY, SYMBOLS } from "@/lib/deriv";
import { bollinger, ema, macd, rsi, stochastic } from "@/lib/indicators";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/markets")({
  head: () => ({ meta: [{ title: "Marchés — LIO23" }] }),
  component: MarketsPage,
});

const TFS = ["1m", "5m", "15m", "1H", "4H", "1D"] as const;
type ChartMode = "candles" | "line";
type SubPanel = "rsi" | "macd" | "stoch";

const CHART_STYLE = {
  background: "oklch(0.20 0.035 260)",
  border: "1px solid oklch(1 0 0 / 0.08)",
  borderRadius: 8,
  fontSize: 12,
};

function MarketsPage() {
  const [symbol, setSymbol] = useState(SYMBOLS[0]);
  const [tf, setTf] = useState<(typeof TFS)[number]>("15m");
  const [mode, setMode] = useState<ChartMode>("candles");
  const [subPanel, setSubPanel] = useState<SubPanel>("rsi");
  const { candles, loading } = useDerivCandles(symbol.deriv, GRANULARITY[tf], 200);

  const data = useMemo(() => {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const e50 = ema(closes, 50);
    const e200 = ema(closes, 200);
    const bb = bollinger(closes, 20, 2);
    const r = rsi(closes, 14);
    const m = macd(closes);
    const stoch = stochastic(highs, lows, closes, 14, 3);
    return candles.map((c, i) => ({
      t: c.epoch * 1000,
      close: c.close,
      high: c.high,
      low: c.low,
      open: c.open,
      ema50: e50[i],
      ema200: e200[i],
      bbU: bb.upper[i],
      bbL: bb.lower[i],
      bbM: bb.middle[i],
      rsi: r[i],
      macd: m.macd[i],
      signal: m.signal[i],
      hist: m.histogram[i],
      stochK: stoch.k[i],
      stochD: stoch.d[i],
    }));
  }, [candles]);

  // Price stats
  const stats = useMemo(() => {
    if (!data.length) return null;
    const last = data[data.length - 1];
    const first = data[0];
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const high24 = Math.max(...highs);
    const low24 = Math.min(...lows);
    const change = first.close ? ((last.close - first.close) / first.close) * 100 : 0;
    return { last: last.close, high24, low24, change };
  }, [data]);

  const candleData = data.map((d) => ({ t: d.t, open: d.open, high: d.high, low: d.low, close: d.close }));
  const overlays = {
    ema50: data.map((d) => d.ema50),
    ema200: data.map((d) => d.ema200),
    bbUpper: data.map((d) => d.bbU),
    bbLower: data.map((d) => d.bbL),
    bbMiddle: data.map((d) => d.bbM),
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marchés</h1>
          <p className="text-sm text-muted-foreground">Charts OHLC + indicateurs techniques en direct.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={symbol.deriv}
            onChange={(e) => setSymbol(SYMBOLS.find((s) => s.deriv === e.target.value)!)}
            className="rounded-md border border-border bg-card/60 px-3 py-1.5 text-sm"
          >
            {SYMBOLS.map((s) => (
              <option key={s.deriv} value={s.deriv}>{s.label}</option>
            ))}
          </select>
          <div className="inline-flex rounded-lg border border-border bg-card/40 p-1 text-xs">
            {TFS.map((t) => (
              <button
                key={t}
                onClick={() => setTf(t)}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors",
                  tf === t
                    ? "bg-[color:var(--brand-cyan)]/15 text-[color:var(--brand-cyan)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-border bg-card/40 p-1 text-xs">
            {(["candles", "line"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors capitalize",
                  mode === m
                    ? "bg-[color:var(--brand-cyan)]/15 text-[color:var(--brand-cyan)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "candles" ? "Bougies" : "Ligne"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Price stats bar */}
      {stats && (
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Prix</span>
            <div className="font-bold text-foreground text-lg">
              {stats.last.toFixed(symbol.market === "forex" ? 5 : 2)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Variation</span>
            <div className={cn("font-semibold", stats.change >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
              {stats.change >= 0 ? "+" : ""}{stats.change.toFixed(2)}%
            </div>
          </div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Haut</span>
            <div className="font-medium">{stats.high24.toFixed(symbol.market === "forex" ? 5 : 2)}</div>
          </div>
          <div>
            <span className="text-muted-foreground text-xs uppercase tracking-wider">Bas</span>
            <div className="font-medium">{stats.low24.toFixed(symbol.market === "forex" ? 5 : 2)}</div>
          </div>
        </div>
      )}

      <div className="glass-panel rounded-xl p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {symbol.label} <span className="text-xs font-normal text-muted-foreground">· {tf}</span>
          </h2>
        </div>
        <div className="mt-3 h-[380px]">
          {loading ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">Chargement…</div>
          ) : mode === "candles" ? (
            <CandlestickChart data={candleData} overlays={overlays} chartHeight={380} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data}>
                <XAxis dataKey="t" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} stroke="oklch(0.7 0.03 255 / 0.5)" fontSize={11} minTickGap={40} />
                <YAxis domain={["auto", "auto"]} stroke="oklch(0.7 0.03 255 / 0.5)" fontSize={11} width={70} />
                <Tooltip contentStyle={CHART_STYLE} labelFormatter={(v) => new Date(Number(v)).toLocaleString()} />
                <Line type="monotone" dataKey="close" stroke="var(--brand-cyan)" strokeWidth={1.6} dot={false} name="Close" />
                <Line type="monotone" dataKey="ema50" stroke="var(--brand-amber)" strokeWidth={1.2} dot={false} name="EMA 50" />
                <Line type="monotone" dataKey="ema200" stroke="var(--brand-violet)" strokeWidth={1.2} dot={false} name="EMA 200" />
                <Line type="monotone" dataKey="bbU" stroke="oklch(0.7 0.04 255 / 0.55)" strokeWidth={1} dot={false} strokeDasharray="4 4" name="BB+" />
                <Line type="monotone" dataKey="bbL" stroke="oklch(0.7 0.04 255 / 0.55)" strokeWidth={1} dot={false} strokeDasharray="4 4" name="BB-" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Sub-panel tabs */}
      <div className="inline-flex rounded-lg border border-border bg-card/40 p-1 text-xs">
        {(["rsi", "macd", "stoch"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setSubPanel(p)}
            className={cn(
              "rounded-md px-3 py-1 uppercase tracking-wider transition-colors",
              subPanel === p
                ? "bg-[color:var(--brand-cyan)]/15 text-[color:var(--brand-cyan)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p === "stoch" ? "Stoch" : p.toUpperCase()}
          </button>
        ))}
      </div>

      {subPanel === "rsi" && (
        <div className="glass-panel rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-sm font-semibold">RSI (14)</h3>
            {data.length > 0 && data[data.length - 1].rsi !== null && (
              <span className={cn(
                "text-xs font-semibold rounded-md px-2 py-0.5",
                (data[data.length - 1].rsi ?? 50) > 70
                  ? "bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
                  : (data[data.length - 1].rsi ?? 50) < 30
                    ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                    : "bg-muted/40 text-muted-foreground"
              )}>
                {data[data.length - 1].rsi?.toFixed(1)}
                {(data[data.length - 1].rsi ?? 50) > 70 ? " Suracheté" : (data[data.length - 1].rsi ?? 50) < 30 ? " Survendu" : ""}
              </span>
            )}
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data}>
                <XAxis dataKey="t" hide />
                <YAxis domain={[0, 100]} stroke="oklch(0.7 0.03 255 / 0.5)" fontSize={11} width={40} ticks={[0, 30, 50, 70, 100]} />
                <Tooltip contentStyle={CHART_STYLE} />
                <Line type="monotone" dataKey="rsi" stroke="var(--brand-cyan)" strokeWidth={1.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {subPanel === "macd" && (
        <div className="glass-panel rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">MACD (12,26,9)</h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data}>
                <XAxis dataKey="t" hide />
                <YAxis stroke="oklch(0.7 0.03 255 / 0.5)" fontSize={11} width={40} />
                <Tooltip contentStyle={CHART_STYLE} />
                <Bar dataKey="hist" fill="var(--brand-violet)" />
                <Line type="monotone" dataKey="macd" stroke="var(--brand-cyan)" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="signal" stroke="oklch(0.83 0.17 85)" strokeWidth={1.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {subPanel === "stoch" && (
        <div className="glass-panel rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-sm font-semibold">Stochastique (14,3)</h3>
            {data.length > 0 && data[data.length - 1].stochK !== null && (
              <span className={cn(
                "text-xs font-semibold rounded-md px-2 py-0.5",
                (data[data.length - 1].stochK ?? 50) > 80
                  ? "bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
                  : (data[data.length - 1].stochK ?? 50) < 20
                    ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                    : "bg-muted/40 text-muted-foreground"
              )}>
                K: {data[data.length - 1].stochK?.toFixed(1)}
              </span>
            )}
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data}>
                <XAxis dataKey="t" hide />
                <YAxis domain={[0, 100]} stroke="oklch(0.7 0.03 255 / 0.5)" fontSize={11} width={40} ticks={[0, 20, 50, 80, 100]} />
                <Tooltip contentStyle={CHART_STYLE} />
                <Line type="monotone" dataKey="stochK" stroke="var(--brand-cyan)" strokeWidth={1.5} dot={false} name="%K" />
                <Line type="monotone" dataKey="stochD" stroke="oklch(0.83 0.17 85)" strokeWidth={1.2} dot={false} name="%D" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

export const _ = BarChart;
