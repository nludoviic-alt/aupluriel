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
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/60 p-6 backdrop-blur-xl shadow-[0_12px_40px_-12px_rgba(0,0,0,0.7)] before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-[color:var(--brand-cyan)] animate-pulse" />
          <h2 className="text-xs font-black tracking-widest text-neutral-300 uppercase">
            Dashboard Bot
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {winRate !== null && (
            <span className={cn(
              "flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider rounded-md border px-2.5 py-1 backdrop-blur-md bg-neutral-900/40",
              winRate >= 55 ? "text-up border-up/25 bg-up/5" : winRate >= 45 ? "text-amber-400 border-amber-500/25 bg-amber-500/5" : "text-down border-down/25 bg-down/5"
            )}>
              {winRate.toFixed(0)}% win
            </span>
          )}
          {avgProfit !== null && (
            <span className={cn(
              "flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider rounded-md border px-2.5 py-1 backdrop-blur-md bg-neutral-900/40",
              avgProfit >= 0 ? "text-up border-up/25 bg-up/5" : "text-down border-down/25 bg-down/5"
            )}>
              {avgProfit >= 0 ? "+" : ""}${avgProfit.toFixed(2)} moy.
            </span>
          )}
          <span className={cn(
            "flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider rounded-md border px-3 py-1 backdrop-blur-md transition-all duration-300",
            running 
              ? "bg-up/10 text-up border-up/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]" 
              : "bg-neutral-900/40 text-neutral-400 border-neutral-800"
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full transition-all duration-300", 
              running ? "bg-up animate-pulse shadow-[0_0_8px_var(--up)]" : "bg-neutral-500"
            )} />
            {running ? "Actif" : "Arrêté"}
          </span>
        </div>
      </div>

      {/* Equity curve + risk gauges */}
      <div className="grid gap-5 lg:grid-cols-[1fr_260px] lg:items-stretch">
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-neutral-500">Courbe P&L aujourd'hui</span>
            <span className={cn("text-2xl font-black font-mono-tabular tracking-tight", isPositive ? "text-up text-glow-green" : "text-down text-glow-orange")}>
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            </span>
          </div>
          <div className="relative rounded-xl overflow-hidden border border-white/5 bg-neutral-950/60 lg:h-[calc(100%-1.75rem)] min-h-[140px]">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32 lg:h-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="equity-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0.01} />
                </linearGradient>
                <filter id="glow-path" x="-10%" y="-10%" width="120%" height="120%">
                  <feGaussianBlur stdDeviation="1.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Faint Gridlines */}
              <g opacity="0.15">
                <line x1="0" x2={W} y1={H * 0.25} y2={H * 0.25} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3" />
                <line x1="0" x2={W} y1={H * 0.5} y2={H * 0.5} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3" />
                <line x1="0" x2={W} y1={H * 0.75} y2={H * 0.75} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3" />
              </g>

              {/* Loss zone background */}
              <rect x="0" y={Math.max(0, zeroY)} width={W} height={Math.max(0, H - zeroY)} fill="var(--bear)" opacity="0.03" />
              {/* Profit zone background */}
              <rect x="0" y="0" width={W} height={Math.max(0, zeroY)} fill="var(--bull)" opacity="0.02" />

              {/* Daily loss limit line */}
              {lossLimitY >= 0 && lossLimitY <= H && (
                <>
                  <rect x="0" y={lossLimitY} width={W} height={Math.max(0, H - lossLimitY)} fill="var(--bear)" opacity="0.04" />
                  <line x1="0" x2={W} y1={lossLimitY} y2={lossLimitY} stroke="var(--bear)" strokeWidth="0.75" strokeDasharray="4 3" opacity="0.4" />
                  <text x="4" y={Math.min(H - 2, lossLimitY + 9)} fontSize="7" fill="var(--bear)" opacity="0.6" className="font-mono">
                    -{config.maxDailyLossUsd}$
                  </text>
                </>
              )}

              {/* Profit target line */}
              {profitTargetY !== null && profitTargetY >= 0 && profitTargetY <= H && (
                <>
                  <line x1="0" x2={W} y1={profitTargetY} y2={profitTargetY} stroke="var(--bull)" strokeWidth="0.75" strokeDasharray="4 3" opacity="0.4" />
                  <text x="4" y={Math.max(8, profitTargetY - 3)} fontSize="7" fill="var(--bull)" opacity="0.6" className="font-mono">
                    +{config.maxDailyProfitUsd}$
                  </text>
                </>
              )}

              {/* Zero baseline */}
              <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="var(--border)" strokeWidth="1" opacity="0.4" />

              {/* Area fill */}
              {equityPoints.length > 1 && (
                <path d={areaPath} fill={`url(#equity-grad)`} opacity="0.8" />
              )}

              {/* Equity line with neon glow */}
              {equityPoints.length > 1 && (
                <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" filter="url(#glow-path)" />
              )}

              {/* Last point dot */}
              {lastPt && equityPoints.length > 1 && (
                <circle cx={toX(lastPt.time)} cy={toY(lastPt.pnl)} r="3" fill={lineColor} className="shadow-[0_0_8px_currentColor]" />
              )}

              {/* Trade dots */}
              {equityPoints.slice(1, -1).map((p, i) => (
                <circle key={i} cx={toX(p.time)} cy={toY(p.pnl)} r="2" fill={p.pnl >= (equityPoints[i]?.pnl ?? 0) ? "var(--bull)" : "var(--bear)"} opacity="0.9" />
              ))}
            </svg>

            {equityPoints.length <= 1 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center bg-neutral-950/40 pointer-events-none p-4 animate-fade-in">
                {/* Market Scanning Radar Effect */}
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full rounded-full border border-cyan/15 animate-ping opacity-60" style={{ animationDuration: "3s" }} />
                  <span className="absolute inline-flex h-[75%] w-[75%] rounded-full border border-cyan/20 animate-ping opacity-40" style={{ animationDuration: "2s" }} />
                  <div className="absolute inset-0 rounded-full border border-cyan/10 bg-cyan/5 flex items-center justify-center">
                    <Activity className="h-5 w-5 text-cyan animate-pulse" />
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-neutral-300">Scanner de Marché en Veille</span>
                  <p className="text-[10px] text-muted-foreground/80 max-w-[250px] leading-relaxed">
                    En attente du premier trade… Le bot se déclenchera automatiquement.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Risk gauges — sidebar */}
        <div className="flex flex-col justify-between gap-4">
          {/* Loss limit */}
          <div className="flex-1 rounded-xl bg-neutral-950/60 border border-white/5 p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground/80" />
                  <span className="text-[10px] text-neutral-400 font-extrabold uppercase tracking-widest">Limite perte</span>
                </div>
                <span className={cn("text-xs font-extrabold font-mono-tabular px-1.5 py-0.5 rounded bg-black/45 border border-white/5 shadow-inner", lossRatio > 0.7 ? "text-down text-glow-orange border-down/20" : lossRatio > 0.4 ? "text-amber-400 border-amber-500/20" : "text-neutral-300")}>
                  ${Math.abs(Math.min(0, pnl)).toFixed(2)} / ${config.maxDailyLossUsd}
                </span>
              </div>

              {/* Segmented LED Bar */}
              <div className="flex gap-1 h-2.5 items-stretch mt-3">
                {Array.from({ length: 10 }).map((_, idx) => {
                  const threshold = (idx + 1) / 10;
                  const isLit = lossRatio >= threshold;
                  return (
                    <div
                      key={idx}
                      className={cn(
                        "flex-1 rounded-sm transition-all duration-300",
                        isLit
                          ? lossRatio > 0.7 
                            ? "bg-down shadow-[0_0_6px_var(--down)]" 
                            : lossRatio > 0.4 
                              ? "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]" 
                              : "bg-neutral-400 shadow-[0_0_4px_rgba(255,255,255,0.2)]"
                          : "bg-neutral-900/60 border border-white/5"
                      )}
                    />
                  );
                })}
              </div>
            </div>

            <div className="flex justify-between items-center text-[10px] text-muted-foreground/60 mt-3 font-semibold uppercase tracking-wider">
              <span>Marge</span>
              <span className={cn("font-bold font-mono", lossRatio > 0.7 ? "text-down" : "text-muted-foreground")}>
                MAX -${config.maxDailyLossUsd}
              </span>
            </div>
          </div>

          {/* Profit target */}
          {profitRatio !== null && (
            <div className="flex-1 rounded-xl bg-neutral-950/60 border border-white/5 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5">
                    <Gauge className="h-3.5 w-3.5 text-muted-foreground/80" />
                    <span className="text-[10px] text-neutral-400 font-extrabold uppercase tracking-widest">Objectif gain</span>
                  </div>
                  <span className={cn("text-xs font-extrabold font-mono-tabular px-1.5 py-0.5 rounded bg-black/45 border border-white/5 shadow-inner", profitRatio >= 1 ? "text-up text-glow-green border-up/20" : "text-neutral-300")}>
                    ${Math.max(0, pnl).toFixed(2)} / ${config.maxDailyProfitUsd}
                  </span>
                </div>

                {/* Segmented LED Bar */}
                <div className="flex gap-1 h-2.5 items-stretch mt-3">
                  {Array.from({ length: 10 }).map((_, idx) => {
                    const threshold = (idx + 1) / 10;
                    const isLit = profitRatio >= threshold;
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "flex-1 rounded-sm transition-all duration-300",
                          isLit
                            ? "bg-up shadow-[0_0_6px_var(--up)]"
                            : "bg-neutral-900/60 border border-white/5"
                        )}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-between items-center text-[10px] text-muted-foreground/60 mt-3 font-semibold uppercase tracking-wider">
                <span>Cible</span>
                <span className="text-up/80 font-bold font-mono">
                  +${config.maxDailyProfitUsd}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Signal grid */}
      {lastScan ? (
        <div className="border-t border-white/5 pt-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-neutral-400 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
              SIGNAUX EN TEMPS RÉEL · {new Date(lastScan.time).toLocaleTimeString()}
            </span>
            <span className="text-[10px] font-bold text-muted-foreground/80 flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-neutral-900 px-1.5 py-0.5 border border-white/5 text-[9px] font-semibold text-cyan">
                <ScanCountdownText lastScanTime={lastScan.time} running={running} />
              </span>
              <span className="opacity-60 font-medium">≥{config.minConfidence}% · {config.minTfAgreement}/4TF</span>
            </span>
          </div>
          <div className="grid gap-2">
            {lastScan.results.map((r) => {
              const label = SYMBOLS.find((s) => s.deriv === r.symbol)?.label ?? r.symbol;
              const conf = r.confidence ?? 0;
              const traded = r.action === "traded";
              const al = actionLabel[r.action] ?? { text: r.action, cls: "text-muted-foreground" };

              return (
                <div key={r.symbol} className={cn(
                  "relative overflow-hidden flex flex-col gap-2 rounded-xl px-4 py-3.5 border transition-all duration-300",
                  traded 
                    ? "border-up/30 bg-up/5 shadow-[0_4px_20px_rgba(16,185,129,0.05)] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-up" 
                    : "border-white/5 bg-neutral-950/20 hover:border-white/10 hover:bg-neutral-950/40"
                )}>
                  {/* Row 1: symbol + direction + status */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-neutral-200">{label}</span>

                    <div className="flex items-center gap-3 ml-auto">
                      {/* Direction badge */}
                      {r.direction ? (
                        <span className={cn(
                          "inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded border uppercase tracking-wider shadow-sm",
                          r.direction === "CALL" 
                            ? "bg-up/10 text-up border-up/20" 
                            : "bg-down/10 text-down border-down/20"
                        )}>
                          {r.direction === "CALL"
                            ? <TrendingUp className="h-3 w-3" />
                            : <TrendingDown className="h-3 w-3" />}
                          {r.direction}
                        </span>
                      ) : null}

                      {/* TF agreement dots */}
                      {r.agreement !== undefined && (
                        <span className="flex gap-1.5 items-center">
                          {[0, 1, 2, 3].map((i) => (
                            <span
                              key={i}
                              className={cn(
                                "h-1.5 w-1.5 rounded-full transition-all duration-300",
                                i < (r.agreement ?? 0) 
                                  ? r.direction === "CALL" 
                                    ? "bg-up shadow-[0_0_4px_var(--up)]" 
                                    : "bg-down shadow-[0_0_4px_var(--down)]" 
                                  : "bg-neutral-800"
                              )}
                            />
                          ))}
                        </span>
                      )}

                      {/* Status label */}
                      <span className={cn("text-[10px] font-extrabold uppercase tracking-wide shrink-0", al.cls)}>
                        {al.text}
                        {r.action === "low-confidence" && conf > 0 && (
                          <span className="font-normal normal-case text-muted-foreground/60"> {conf.toFixed(0)}<span className="opacity-45">/{config.minConfidence}%</span></span>
                        )}
                        {r.action === "low-agreement" && r.agreement !== undefined && (
                          <span className="font-normal normal-case text-muted-foreground/60"> {r.agreement}<span className="opacity-45">/{config.minTfAgreement}TF</span></span>
                        )}
                        {(r.action === "news-block" || r.action === "low-payout") && r.note && (
                          <span className="font-normal normal-case text-muted-foreground/60"> · {r.note}</span>
                        )}
                        {r.action !== "low-confidence" && r.action !== "low-agreement" && r.action !== "news-block" && r.action !== "low-payout" && conf > 0 && r.action !== "traded" && (
                          <span className="font-normal normal-case text-muted-foreground/60"> {conf.toFixed(0)}%</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Row 2: confidence bar */}
                  {conf > 0 && (
                    <div className="relative h-1.5 rounded-full bg-neutral-900 overflow-hidden border border-white/5">
                      <div
                        className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                          traded ? "bg-up" : conf >= config.minConfidence ? "bg-amber-500" : "bg-neutral-500"
                        )}
                        style={{ width: `${conf}%` }}
                      />
                      <div
                        className="absolute inset-y-0 w-px bg-white/20"
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
        <div className="rounded-xl bg-neutral-950/60 border border-white/5 py-8 text-center text-xs font-semibold text-muted-foreground uppercase tracking-widest animate-pulse">
          Première analyse en cours…
        </div>
      ) : null}
    </div>
  );
});
