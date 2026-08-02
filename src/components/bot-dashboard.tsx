import { memo, useMemo, useEffect, useState } from "react";
import { Activity, Gauge, ShieldAlert, TrendingUp, Zap } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { cn } from "@/lib/utils";
import { SYMBOLS } from "@/lib/deriv";
import type { TradeLog, AutoTraderConfig, ScanResult } from "@/lib/autotrader";
import { SCAN_INTERVAL_MS } from "@/lib/autotrader";

interface BotDashboardProps {
  logs: TradeLog[];
  lastScan: ScanResult | null;
  config: AutoTraderConfig;
  running: boolean;
  pnl: number;
  lossUsedUsd: number;
}

/** Isolated so the once-a-second tick only re-renders this text, not the whole
 * dashboard/signal list — same pattern as autotrader.tsx's ScanCountdown. */
function ScanCountdownText({ lastScanTime, running }: { lastScanTime: number; running: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!running) return null;
  const secsLeft = Math.max(0, Math.ceil((lastScanTime + SCAN_INTERVAL_MS - now) / 1000));
  return <>{secsLeft > 0 ? `scan dans ${secsLeft}s` : "scan en cours…"}</>;
}

const ACTION_LABEL: Record<string, { text: string; cls: string }> = {
  traded:        { text: "Trade pris",        cls: "text-up" },
  "open-trade":  { text: "Position ouverte",  cls: "text-[color:var(--brand-cyan)]" },
  "session-closed": { text: "Hors session",   cls: "text-muted-foreground/50" },
  "no-signal":   { text: "Pas de signal",      cls: "text-muted-foreground" },
  "low-confidence": { text: "Confiance faible", cls: "text-amber-400" },
  "low-agreement":  { text: "Accord TF faible", cls: "text-amber-400" },
  "not-premium": { text: "Non premium",       cls: "text-amber-400" },
  volatility:    { text: "Volatilité",         cls: "text-down" },
  "daily-limit": { text: "Limite atteinte",   cls: "text-down" },
  cooldown:      { text: "Cooldown",            cls: "text-amber-400" },
  correlated:    { text: "Corrélée",  cls: "text-muted-foreground/60" },
  "news-block":  { text: "Fenêtre macro",       cls: "text-amber-400" },
  "not-tradeable": { text: "Indispo",   cls: "text-muted-foreground/60" },
  "low-payout":  { text: "Payout faible",   cls: "text-amber-400" },
};

export const BotDashboard = memo(function BotDashboard({ logs, lastScan, config, running, pnl, lossUsedUsd }: BotDashboardProps) {
  // ── Equity curve ─────────────────────────────────────────────────────────────
  const equityPoints = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayLogs = [...logs]
      .filter((l) => (l.status === "won" || l.status === "lost") && l.time >= startOfDay.getTime())
      .sort((a, b) => a.time - b.time);

    let running = 0;
    const pts: { time: number; pnl: number }[] = [{ time: startOfDay.getTime(), pnl: 0 }];
    for (const log of todayLogs) {
      running += log.profit;
      pts.push({ time: log.time, pnl: running });
    }
    // Extend to now so the curve reaches the right edge
    if (pts.length > 1) pts.push({ time: Date.now(), pnl: running });
    return pts;
  }, [logs]);

  const lastPt = equityPoints[equityPoints.length - 1];
  const isPositive = (lastPt?.pnl ?? 0) >= 0;
  const lineColor = isPositive ? "var(--bull)" : "var(--bear)";

  // ── Risk gauges ──────────────────────────────────────────────────────────────
  const lossRatio = Math.min(1, lossUsedUsd / config.maxDailyLossUsd);
  const profitRatio =
    config.maxDailyProfitUsd > 0
      ? Math.min(1, Math.max(0, pnl) / config.maxDailyProfitUsd)
      : null;

  // ── Today stats ──────────────────────────────────────────────────────────────
  const todayLogs = logs.filter((l) => {
    const sod = new Date(); sod.setHours(0, 0, 0, 0);
    return l.time >= sod.getTime();
  });
  const wins = todayLogs.filter((l) => l.status === "won").length;
  const losses = todayLogs.filter((l) => l.status === "lost").length;
  const total = wins + losses;
  const winRate = total > 0 ? (wins / total) * 100 : null;
  const avgProfit = total > 0
    ? todayLogs.filter((l) => l.status === "won" || l.status === "lost").reduce((s, l) => s + l.profit, 0) / total
    : null;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
          <Activity className="h-4 w-4 text-[color:var(--brand-cyan)]" />
          Dashboard Bot
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {winRate !== null && (
            <span className={cn("font-semibold", winRate >= 55 ? "text-up" : winRate >= 45 ? "text-amber-400" : "text-down")}>
              {winRate.toFixed(0)}% win
            </span>
          )}
          {avgProfit !== null && (
            <span className={cn("font-semibold", avgProfit >= 0 ? "text-up" : "text-down")}>
              {avgProfit >= 0 ? "+" : ""}${avgProfit.toFixed(2)} moy.
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-up animate-pulse" : "bg-muted-foreground/50")} />
            {running ? "Actif" : "Arrêté"}
          </span>
        </div>
      </div>

      {/* Equity curve + risk gauges */}
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="glass-panel rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[color:var(--brand-cyan)]" />
              Courbe P&L aujourd'hui
            </h3>
            <span className={cn("text-xl font-bold font-mono-tabular tracking-tight", isPositive ? "text-up" : "text-down")}>
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            </span>
          </div>

          {equityPoints.length > 1 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityPoints.map((p) => ({ t: p.time, v: p.pnl }))}>
                  <defs>
                    <linearGradient id="botEquityFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={lineColor} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="t"
                    tickFormatter={(v) => new Date(v).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    stroke="oklch(0.7 0.03 255 / 0.5)"
                    fontSize={11}
                    minTickGap={40}
                  />
                  <YAxis stroke="oklch(0.7 0.03 255 / 0.5)" fontSize={11} width={55} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
                  <Tooltip
                    contentStyle={{ background: "oklch(0.20 0.035 260)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(v) => new Date(Number(v)).toLocaleTimeString("fr-FR")}
                    formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]}
                  />
                  <ReferenceLine y={0} stroke="oklch(1 0 0 / 0.15)" />
                  <ReferenceLine
                    y={-config.maxDailyLossUsd}
                    stroke="var(--bear)"
                    strokeDasharray="4 3"
                    strokeOpacity={0.6}
                    label={{ value: `-${config.maxDailyLossUsd}$`, position: "insideBottomLeft", fill: "var(--bear)", fontSize: 10 }}
                  />
                  {config.maxDailyProfitUsd > 0 && (
                    <ReferenceLine
                      y={config.maxDailyProfitUsd}
                      stroke="var(--bull)"
                      strokeDasharray="4 3"
                      strokeOpacity={0.6}
                      label={{ value: `+${config.maxDailyProfitUsd}$`, position: "insideTopLeft", fill: "var(--bull)", fontSize: 10 }}
                    />
                  )}
                  <Area type="monotone" dataKey="v" stroke={lineColor} strokeWidth={2} fill="url(#botEquityFill)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 flex flex-col items-center justify-center gap-2 text-center">
              <Activity className="h-8 w-8 text-muted-foreground animate-pulse" />
              <p className="text-sm text-muted-foreground">
                En attente du premier trade… le bot se déclenchera automatiquement.
              </p>
            </div>
          )}
        </div>

        {/* Risk gauges — sidebar */}
        <div className="flex flex-col gap-4">
          {/* Loss limit */}
          <div className="glass-panel rounded-xl p-4 flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Limite perte
                </div>
                <span className={cn("text-xs font-bold font-mono-tabular", lossRatio > 0.5 ? "text-down" : "text-amber-400")}>
                  ${lossUsedUsd.toFixed(2)} / ${config.maxDailyLossUsd}
                </span>
              </div>
              <div className="flex gap-1 h-2.5">
                {Array.from({ length: 10 }).map((_, idx) => {
                  const segmentProgress = Math.min(1, Math.max(0, (lossRatio - idx / 10) * 10));
                  return (
                    <div key={idx} className="flex-1 overflow-hidden rounded-full border border-white/15 bg-white/[0.03]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          lossRatio > 0.5 ? "bg-down" : "bg-amber-500",
                        )}
                        style={{ width: `${segmentProgress * 100}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-between items-center text-xs text-muted-foreground mt-3">
              <span>Marge</span>
              <span className="font-mono">MAX -${config.maxDailyLossUsd}</span>
            </div>
          </div>

          {/* Profit target */}
          {profitRatio !== null && (
            <div className="glass-panel rounded-xl p-4 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                    <Gauge className="h-3.5 w-3.5" />
                    Objectif gain
                  </div>
                  <span className={cn("text-xs font-bold font-mono-tabular", profitRatio >= 1 ? "text-up" : "text-foreground")}>
                    ${Math.max(0, pnl).toFixed(2)} / ${config.maxDailyProfitUsd}
                  </span>
                </div>
                <div className="flex gap-1 h-2.5">
                  {Array.from({ length: 10 }).map((_, idx) => {
                    const threshold = (idx + 1) / 10;
                    const isLit = profitRatio >= threshold;
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "flex-1 rounded-full transition-all duration-300",
                          isLit ? "bg-up" : "border border-white/15 bg-white/[0.03]",
                        )}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-between items-center text-xs text-muted-foreground mt-3">
                <span>Cible</span>
                <span className="font-mono text-up/80">+${config.maxDailyProfitUsd}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

interface LiveSignalsProps {
  lastScan: ScanResult | null;
  config: AutoTraderConfig;
  running: boolean;
}

/** Compact, fixed-height signal list — one line per symbol, no expanding
 * cards. Rendered separately from BotDashboard so callers can place it
 * anywhere in the page (e.g. below the gold ticker). */
export const LiveSignals = memo(function LiveSignals({ lastScan, config, running }: LiveSignalsProps) {
  if (!lastScan) {
    return running ? (
      <div className="glass-panel rounded-xl py-6 text-center text-sm text-muted-foreground">
        Première analyse en cours…
      </div>
    ) : null;
  }

  return (
    <div className="glass-panel rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          Signaux en temps réel
        </h3>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <ScanCountdownText lastScanTime={lastScan.time} running={running} />
          <span>≥{config.minConfidence}% · {config.minTfAgreement}/4TF</span>
        </span>
      </div>
      {(() => {
        // Only the actionable signals — confidence at/above the trading
        // threshold, or an actual open/executed trade. Everything else
        // (no-signal, low-confidence, cooldown, hors-session…) is noise that
        // was making this list as long as the whole watchlist on every scan.
        const greenResults = lastScan.results.filter(
          (r) => r.action === "traded" || r.action === "open-trade" || (r.confidence ?? 0) >= config.minConfidence,
        );
        if (greenResults.length === 0) {
          return (
            <div className="py-4 text-center text-xs text-muted-foreground">
              Aucun signal ≥ {config.minConfidence}% pour l'instant.
            </div>
          );
        }
        return (
          <div className="divide-y divide-border/40">
            {greenResults.map((r) => {
              const label = SYMBOLS.find((s) => s.deriv === r.symbol)?.label ?? r.symbol;
              const conf = r.confidence ?? 0;
              const al = ACTION_LABEL[r.action] ?? { text: r.action, cls: "text-muted-foreground" };

              return (
                <div key={r.symbol} className="flex items-center gap-3 py-2 text-sm">
                  <span className="font-medium truncate w-24 shrink-0">{label}</span>

                  {r.direction ? (
                    <span className={cn("text-xs font-bold w-9 shrink-0", r.direction === "CALL" ? "text-up" : "text-down")}>
                      {r.direction}
                    </span>
                  ) : (
                    <span className="w-9 shrink-0" />
                  )}

                  <span className="hidden sm:block h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted/40">
                    <span className="block h-full rounded-full bg-up" style={{ width: `${conf}%` }} />
                  </span>

                  <span className={cn("ml-auto text-xs font-semibold truncate", al.cls)}>
                    {conf > 0 ? `${conf.toFixed(0)}%` : al.text}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
});
