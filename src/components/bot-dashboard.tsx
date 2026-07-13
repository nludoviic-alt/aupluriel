import { memo, useMemo, useEffect, useState } from "react";
import { Activity, Gauge, ShieldAlert, TrendingUp, TrendingDown, Zap } from "lucide-react";
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
}

/** Isolated so the once-a-second tick only re-renders this text, not the whole
 * dashboard (equity SVG + full signal grid) — same pattern as autotrader.tsx's
 * ScanCountdown. */
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

export const BotDashboard = memo(function BotDashboard({ logs, lastScan, config, running, pnl }: BotDashboardProps) {
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

  // SVG dimensions
  const W = 400;
  const H = 90;
  const lastPt = equityPoints[equityPoints.length - 1];
  const allPnl = equityPoints.map((p) => p.pnl);
  const minPnl = Math.min(...allPnl, -config.maxDailyLossUsd * 0.15, -0.5);
  const maxPnl = Math.max(
    ...allPnl,
    config.maxDailyProfitUsd > 0 ? config.maxDailyProfitUsd * 0.15 : 0,
    0.5,
  );
  const pnlRange = maxPnl - minPnl || 1;
  const minT = equityPoints[0]?.time ?? 0;
  const maxT = lastPt?.time ?? minT + 1;
  const timeRange = maxT - minT || 1;

  const toX = (t: number) => ((t - minT) / timeRange) * W;
  const toY = (p: number) => H - ((p - minPnl) / pnlRange) * (H - 10) - 4;
  const zeroY = toY(0);
  const lossLimitY = toY(-config.maxDailyLossUsd);
  const profitTargetY = config.maxDailyProfitUsd > 0 ? toY(config.maxDailyProfitUsd) : null;

  const linePath = equityPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.time).toFixed(1)} ${toY(p.pnl).toFixed(1)}`)
    .join(" ");

  const isPositive = (lastPt?.pnl ?? 0) >= 0;
  const lineColor = isPositive ? "var(--bull)" : "var(--bear)";

  // Area under/over zero line (clip to avoid crossing)
  const areaPath =
    equityPoints.length > 1
      ? `${linePath} L ${toX(maxT).toFixed(1)} ${zeroY.toFixed(1)} L ${toX(minT).toFixed(1)} ${zeroY.toFixed(1)} Z`
      : "";

  // ── Risk gauges ──────────────────────────────────────────────────────────────
  const lossRatio = Math.min(1, Math.abs(Math.min(0, pnl)) / config.maxDailyLossUsd);
  const profitRatio =
    config.maxDailyProfitUsd > 0
      ? Math.min(1, Math.max(0, pnl) / config.maxDailyProfitUsd)
      : null;

  // ── Signal grid helpers ──────────────────────────────────────────────────────
  const actionLabel: Record<string, { text: string; cls: string }> = {
    traded:        { text: "● Trade pris",        cls: "text-up font-semibold" },
    "open-trade":  { text: "⏳ Position ouverte",  cls: "text-[color:var(--brand-cyan)]" },
    "session-closed": { text: "○ Hors session",   cls: "text-muted-foreground/50" },
    "no-signal":   { text: "— Pas de signal",      cls: "text-muted-foreground" },
    "low-confidence": { text: "↓ Confiance faible", cls: "text-amber-400" },
    "low-agreement":  { text: "↓ Accord TF faible", cls: "text-amber-400" },
    "not-premium": { text: "🔒 Non premium",       cls: "text-amber-400" },
    volatility:    { text: "⚡ Volatilité",         cls: "text-down" },
    "daily-limit": { text: "🛑 Limite atteinte",   cls: "text-down" },
    cooldown:      { text: "⏸ Cooldown",            cls: "text-amber-400" },
    correlated:    { text: "⛓ Corrélée — skippée",  cls: "text-muted-foreground/60" },
    "news-block":  { text: "📰 Fenêtre macro",       cls: "text-amber-400" },
    "not-tradeable": { text: "🚫 CALL/PUT indispo",   cls: "text-muted-foreground/60" },
    "low-payout":  { text: "💸 Payout trop faible",   cls: "text-amber-400" },
  };

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
    <div className="glass-panel rounded-2xl p-5 md:p-6 space-y-6 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
        <div className="flex items-center gap-2.5">
          <Activity className="h-5 w-5 text-[color:var(--brand-cyan)]" />
          <h2 className="text-sm md:text-base font-bold uppercase tracking-wider text-neutral-200">
            Dashboard Bot
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {winRate !== null && (
            <span className={cn(
              "text-xs font-bold rounded-full border px-2.5 py-1",
              winRate >= 55 ? "text-up border-up/25 bg-up/5" : winRate >= 45 ? "text-amber-400 border-amber-500/25 bg-amber-500/5" : "text-down border-down/25 bg-down/5"
            )}>
              {winRate.toFixed(0)}% win
            </span>
          )}
          {avgProfit !== null && (
            <span className={cn(
              "text-xs font-bold rounded-full border px-2.5 py-1",
              avgProfit >= 0 ? "text-up border-up/25 bg-up/5" : "text-down border-down/25 bg-down/5"
            )}>
              {avgProfit >= 0 ? "+" : ""}${avgProfit.toFixed(2)} moy.
            </span>
          )}
          <span className={cn(
            "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider rounded-full border px-3 py-1",
            running ? "bg-up/10 text-up border-up/25" : "bg-white/[0.02] text-muted-foreground border-white/5"
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-up animate-pulse" : "bg-muted-foreground")} />
            {running ? "Actif" : "Arrêté"}
          </span>
        </div>
      </div>

      {/* ── Equity curve + risk gauges: side by side on wide screens instead
          of stacked full-width blocks, so the card uses its space instead
          of reading as a sparse vertical list. ── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_260px] lg:items-stretch">
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Courbe P&L aujourd'hui</span>
          <span className={cn("text-lg font-bold font-mono-tabular", isPositive ? "text-up" : "text-down")}>
            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
          </span>
        </div>
        <div className="relative rounded-xl overflow-hidden border border-white/5 bg-neutral-950/40 lg:h-[calc(100%-1.75rem)]">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32 lg:h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="equity-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
              </linearGradient>
              <clipPath id="above-zero">
                <rect x="0" y="0" width={W} height={zeroY} />
              </clipPath>
              <clipPath id="below-zero">
                <rect x="0" y={zeroY} width={W} height={H} />
              </clipPath>
            </defs>

            {/* Loss zone background */}
            <rect x="0" y={Math.max(0, zeroY)} width={W} height={Math.max(0, H - zeroY)} fill="var(--bear)" opacity="0.05" />
            {/* Profit zone background */}
            <rect x="0" y="0" width={W} height={Math.max(0, zeroY)} fill="var(--bull)" opacity="0.04" />

            {/* Daily loss limit line */}
            {lossLimitY >= 0 && lossLimitY <= H && (
              <>
                <rect x="0" y={lossLimitY} width={W} height={Math.max(0, H - lossLimitY)} fill="var(--bear)" opacity="0.07" />
                <line x1="0" x2={W} y1={lossLimitY} y2={lossLimitY} stroke="var(--bear)" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
                <text x="4" y={Math.min(H - 2, lossLimitY + 9)} fontSize="7" fill="var(--bear)" opacity="0.7">
                  -{config.maxDailyLossUsd}$
                </text>
              </>
            )}

            {/* Profit target line */}
            {profitTargetY !== null && profitTargetY >= 0 && profitTargetY <= H && (
              <>
                <line x1="0" x2={W} y1={profitTargetY} y2={profitTargetY} stroke="var(--bull)" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
                <text x="4" y={Math.max(8, profitTargetY - 3)} fontSize="7" fill="var(--bull)" opacity="0.7">
                  +{config.maxDailyProfitUsd}$
                </text>
              </>
            )}

            {/* Zero baseline */}
            <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="var(--border)" strokeWidth="1" opacity="0.6" />

            {/* Area fill */}
            {equityPoints.length > 1 && (
              <path d={areaPath} fill={`url(#equity-grad)`} opacity="0.8" />
            )}

            {/* Equity line */}
            {equityPoints.length > 1 && (
              <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.8" strokeLinejoin="round" />
            )}

            {/* Last point dot */}
            {lastPt && equityPoints.length > 1 && (
              <circle cx={toX(lastPt.time)} cy={toY(lastPt.pnl)} r="3" fill={lineColor} />
            )}

            {/* Trade dots */}
            {equityPoints.slice(1, -1).map((p, i) => (
              <circle key={i} cx={toX(p.time)} cy={toY(p.pnl)} r="2" fill={p.pnl >= (equityPoints[i]?.pnl ?? 0) ? "var(--bull)" : "var(--bear)"} opacity="0.8" />
            ))}

          </svg>
          {equityPoints.length <= 1 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center pointer-events-none">
              <div className="relative flex h-6 w-6 items-center justify-center">
                <span className="absolute inline-flex h-full w-full rounded-full bg-muted-foreground/10 animate-ping" />
                <Activity className="relative h-4 w-4 text-muted-foreground/40" />
              </div>
              <span className="text-xs font-medium text-muted-foreground/60">En attente du premier trade…</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Risk gauges — narrow sidebar next to the chart on wide screens ── */}
      <div className="flex flex-col gap-4">
        {/* Loss limit */}
        <div className="rounded-xl bg-neutral-950/40 border border-white/5 p-3.5">
          <div className="flex items-center gap-1.5 mb-2.5">
            <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground/70" />
            <span className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider">Limite perte</span>
          </div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className={cn("font-bold font-mono-tabular", lossRatio > 0.7 ? "text-down" : lossRatio > 0.4 ? "text-amber-400" : "text-foreground")}>
              ${Math.abs(Math.min(0, pnl)).toFixed(2)} / ${config.maxDailyLossUsd}
              {lossRatio > 0 && ` · ${(lossRatio * 100).toFixed(0)}%`}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-neutral-900 border border-white/5 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-500",
                lossRatio > 0.7 ? "bg-down shadow-[0_0_8px_rgba(239,68,68,0.5)]" : lossRatio > 0.4 ? "bg-amber-500" : "bg-muted-foreground/40"
              )}
              style={{ width: `${lossRatio * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground/50 mt-1.5">
            <span>$0</span>
            <span className="text-down/70">Max -${config.maxDailyLossUsd}</span>
          </div>
        </div>

        {/* Profit target */}
        {profitRatio !== null && (
          <div className="rounded-xl bg-neutral-950/40 border border-white/5 p-3.5">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Gauge className="h-3.5 w-3.5 text-muted-foreground/70" />
              <span className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider">Objectif gain</span>
            </div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className={cn("font-bold font-mono-tabular", profitRatio >= 1 ? "text-up" : "text-foreground")}>
                ${Math.max(0, pnl).toFixed(2)} / ${config.maxDailyProfitUsd}
                {profitRatio > 0 && ` · ${(profitRatio * 100).toFixed(0)}%`}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-neutral-900 border border-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-up shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-all duration-500"
                style={{ width: `${profitRatio * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground/50 mt-1.5">
              <span>$0</span>
              <span className="text-up/70">Cible +${config.maxDailyProfitUsd}</span>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* ── Signal grid ── */}
      {lastScan ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              Signaux · {new Date(lastScan.time).toLocaleTimeString()}
            </span>
            <span className="text-xs text-muted-foreground/70">
              <ScanCountdownText lastScanTime={lastScan.time} running={running} />
              <span className="ml-2 opacity-60">≥{config.minConfidence}% · {config.minTfAgreement}/4TF</span>
            </span>
          </div>
          <div className="space-y-2">
            {lastScan.results.map((r) => {
              const label = SYMBOLS.find((s) => s.deriv === r.symbol)?.label ?? r.symbol;
              const conf = r.confidence ?? 0;
              const traded = r.action === "traded";
              const al = actionLabel[r.action] ?? { text: r.action, cls: "text-muted-foreground" };

              return (
                <div key={r.symbol} className={cn(
                  "flex flex-col gap-1.5 rounded-xl px-4 py-3 border transition-all",
                  traded ? "border-up/30 bg-up/8" : "border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.02]"
                )}>
                  {/* Row 1: symbol + direction + status */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-foreground">{label}</span>

                    <div className="flex items-center gap-3 ml-auto">
                      {/* Direction badge */}
                      {r.direction ? (
                        <span className={cn(
                          "inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md",
                          r.direction === "CALL" ? "bg-up/15 text-up" : "bg-down/15 text-down"
                        )}>
                          {r.direction === "CALL"
                            ? <TrendingUp className="h-3.5 w-3.5" />
                            : <TrendingDown className="h-3.5 w-3.5" />}
                          {r.direction}
                        </span>
                      ) : null}

                      {/* TF agreement dots */}
                      {r.agreement !== undefined && (
                        <span className="flex gap-1">
                          {[0, 1, 2, 3].map((i) => (
                            <span
                              key={i}
                              className={cn(
                                "h-2 w-2 rounded-full",
                                i < (r.agreement ?? 0) ? (r.direction === "CALL" ? "bg-up" : "bg-down") : "bg-muted/40"
                              )}
                            />
                          ))}
                        </span>
                      )}

                      {/* Status label */}
                      <span className={cn("text-xs font-semibold shrink-0", al.cls)}>
                        {al.text}
                        {r.action === "low-confidence" && conf > 0 && (
                          <span className="font-normal text-muted-foreground"> {conf.toFixed(0)}<span className="opacity-60">/{config.minConfidence}%</span></span>
                        )}
                        {r.action === "low-agreement" && r.agreement !== undefined && (
                          <span className="font-normal text-muted-foreground"> {r.agreement}<span className="opacity-60">/{config.minTfAgreement}TF</span></span>
                        )}
                        {(r.action === "news-block" || r.action === "low-payout") && r.note && (
                          <span className="font-normal text-muted-foreground"> · {r.note}</span>
                        )}
                        {r.action !== "low-confidence" && r.action !== "low-agreement" && r.action !== "news-block" && r.action !== "low-payout" && conf > 0 && r.action !== "traded" && (
                          <span className="font-normal text-muted-foreground"> {conf.toFixed(0)}%</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Row 2: confidence bar (only when relevant) */}
                  {conf > 0 && (
                    <div className="relative h-2 rounded-full bg-muted/30 overflow-hidden">
                      <div
                        className={cn("absolute inset-y-0 left-0 rounded-full transition-all",
                          traded ? "bg-up" : conf >= config.minConfidence ? "bg-amber-500" : "bg-muted-foreground/30"
                        )}
                        style={{ width: `${conf}%` }}
                      />
                      <div
                        className="absolute inset-y-0 w-0.5 bg-foreground/25"
                        style={{ left: `${config.minConfidence}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : running ? (
        <div className="rounded-xl bg-neutral-950/40 border border-white/5 py-8 text-center text-sm text-muted-foreground">
          Première analyse en cours…
        </div>
      ) : null}
    </div>
  );
});
