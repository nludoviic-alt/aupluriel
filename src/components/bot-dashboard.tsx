import { useMemo, useEffect, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
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

export function BotDashboard({ logs, lastScan, config, running, pnl }: BotDashboardProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
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
    <div className="rounded-xl border border-border bg-panel/30 p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          Dashboard Bot
        </h2>
        <div className="flex items-center gap-4">
          {winRate !== null && (
            <span className={cn("text-sm font-bold", winRate >= 55 ? "text-up" : winRate >= 45 ? "text-amber-400" : "text-down")}>
              {winRate.toFixed(0)}% win
            </span>
          )}
          {avgProfit !== null && (
            <span className={cn("text-sm font-bold", avgProfit >= 0 ? "text-up" : "text-down")}>
              {avgProfit >= 0 ? "+" : ""}${avgProfit.toFixed(2)} moy.
            </span>
          )}
          <span className={cn(
            "flex items-center gap-1.5 text-sm rounded-lg px-3 py-1 font-semibold",
            running ? "bg-up/10 text-up" : "bg-muted/30 text-muted-foreground"
          )}>
            <span className={cn("h-2 w-2 rounded-full", running ? "bg-up animate-pulse" : "bg-muted-foreground")} />
            {running ? "Actif" : "Arrêté"}
          </span>
        </div>
      </div>

      {/* ── Equity curve ── */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Courbe P&L aujourd'hui</span>
          <span className={cn("text-lg font-bold font-mono-tabular", isPositive ? "text-up" : "text-down")}>
            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
          </span>
        </div>
        <div className="rounded-lg overflow-hidden border border-border/40 bg-muted/8">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none">
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

            {equityPoints.length <= 1 && (
              <text x={W / 2} y={H / 2 + 4} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)" opacity="0.5">
                En attente du premier trade…
              </text>
            )}
          </svg>
        </div>
      </div>

      {/* ── Risk gauges ── */}
      <div className={cn("grid gap-4", profitRatio !== null ? "sm:grid-cols-2" : "grid-cols-1")}>
        {/* Loss limit */}
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-muted-foreground font-semibold uppercase tracking-wider">Limite perte</span>
            <span className={cn("font-bold", lossRatio > 0.7 ? "text-down" : lossRatio > 0.4 ? "text-amber-400" : "text-muted-foreground")}>
              ${Math.abs(Math.min(0, pnl)).toFixed(2)} / ${config.maxDailyLossUsd}
              {lossRatio > 0 && ` · ${(lossRatio * 100).toFixed(0)}%`}
            </span>
          </div>
          <div className="h-3 rounded-full bg-muted/30 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-500",
                lossRatio > 0.7 ? "bg-down" : lossRatio > 0.4 ? "bg-amber-500" : "bg-muted-foreground/40"
              )}
              style={{ width: `${lossRatio * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground/50 mt-1">
            <span>$0</span>
            <span className="text-down/70">Max -${config.maxDailyLossUsd}</span>
          </div>
        </div>

        {/* Profit target */}
        {profitRatio !== null && (
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider">Objectif gain</span>
              <span className={cn("font-bold", profitRatio >= 1 ? "text-up" : "text-muted-foreground")}>
                ${Math.max(0, pnl).toFixed(2)} / ${config.maxDailyProfitUsd}
                {profitRatio > 0 && ` · ${(profitRatio * 100).toFixed(0)}%`}
              </span>
            </div>
            <div className="h-3 rounded-full bg-muted/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-up transition-all duration-500"
                style={{ width: `${profitRatio * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground/50 mt-1">
              <span>$0</span>
              <span className="text-up/70">Cible +${config.maxDailyProfitUsd}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Signal grid ── */}
      {lastScan ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Signaux · {new Date(lastScan.time).toLocaleTimeString()}
            </span>
            <span className="text-xs text-muted-foreground/70">
              {running ? (() => {
                const secsLeft = Math.max(0, Math.ceil((lastScan.time + SCAN_INTERVAL_MS - Date.now()) / 1000));
                return secsLeft > 0 ? `scan dans ${secsLeft}s` : "scan en cours…";
              })() : null}
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
                  "flex flex-col gap-1.5 rounded-lg px-4 py-3",
                  traded ? "border border-up/30 bg-up/8" : "bg-muted/10"
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
                        {r.action === "news-block" && r.note && (
                          <span className="font-normal text-muted-foreground"> · {r.note}</span>
                        )}
                        {r.action !== "low-confidence" && r.action !== "low-agreement" && r.action !== "news-block" && conf > 0 && r.action !== "traded" && (
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
      ) : (
        <div className="rounded-lg bg-muted/10 py-8 text-center text-sm text-muted-foreground">
          {running ? "Première analyse en cours…" : "Démarre le bot pour voir les signaux en direct"}
        </div>
      )}
    </div>
  );
}
