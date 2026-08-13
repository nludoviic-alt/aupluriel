import { getDb } from "./db.server";
import type { Rb100DiagnosticSnapshot, Rb100Strategy, NoTradeFinalReason } from "./rb100-signal.server";

export interface ScoreDistribution {
  strategy: Rb100Strategy | "GLOBAL";
  sampleSize: number;
  min: number;
  mean: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  max: number;
  buckets: {
    under60: number; // <60
    b60_69: number;  // 60-69
    b70_79: number;  // 70-79
    b80_87: number;  // 80-87
    b88_94: number;  // 88-94
    p95plus: number; // 95+
  };
}

export interface CombinationAnalytic {
  combination: string;
  count: number;
  percentage: number;
}

export interface RouterAnalytics {
  totalScans: number;
  rangeRouted: number;
  breakoutRouted: number;
  retestRouted: number;
  noStateRouted: number;
}

export interface StrategyFunnel {
  strategy: Rb100Strategy;
  scans: number;
  routed: number;
  candidates: number;
  hardFilterValid: number;
  scoreValid: number;
  timeValid: number;
  riskValid: number;
  contractValid: number;
  executed: number;
  hardFilterPassRate: number; // (hardFilterValid / candidates) * 100
  topBottleneck: NoTradeFinalReason | "NONE";
}

export interface Rb100DiagnosticReport {
  generatedAt: number;
  routerAnalytics: RouterAnalytics;
  scoreDistributions: Record<Rb100Strategy | "GLOBAL", ScoreDistribution>;
  hardFilterPassRates: Record<Rb100Strategy, number>;
  topCombinationFailures: CombinationAnalytic[];
  funnels: Record<Rb100Strategy, StrategyFunnel>;
  zeroTradeAlert: {
    active: boolean;
    reason: string | null;
    topPipelineBottleneck: string | null;
    passRate: number | null;
  };
  findings: string[];
  recommendations: string[];
}

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * (p / 100))));
  return sorted[idx];
}

function computeDistributionFor(scores: number[], strategyLabel: Rb100Strategy | "GLOBAL"): ScoreDistribution {
  if (scores.length === 0) {
    return {
      strategy: strategyLabel,
      sampleSize: 0,
      min: 0, mean: 0, median: 0, p75: 0, p90: 0, p95: 0, max: 0,
      buckets: { under60: 0, b60_69: 0, b70_79: 0, b80_87: 0, b88_94: 0, p95plus: 0 },
    };
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, x) => acc + x, 0);

  return {
    strategy: strategyLabel,
    sampleSize: sorted.length,
    min: sorted[0],
    mean: +(sum / sorted.length).toFixed(2),
    median: calculatePercentile(sorted, 50),
    p75: calculatePercentile(sorted, 75),
    p90: calculatePercentile(sorted, 90),
    p95: calculatePercentile(sorted, 95),
    max: sorted[sorted.length - 1],
    buckets: {
      under60: sorted.filter((s) => s < 60).length,
      b60_69: sorted.filter((s) => s >= 60 && s <= 69).length,
      b70_79: sorted.filter((s) => s >= 70 && s <= 79).length,
      b80_87: sorted.filter((s) => s >= 80 && s <= 87).length,
      b88_94: sorted.filter((s) => s >= 88 && s <= 94).length,
      p95plus: sorted.filter((s) => s >= 95).length,
    },
  };
}

/**
 * Generate Read-Only RB100 Diagnostic & Analytics Report.
 * NEVER mutates strategy configuration parameters automatically.
 */
export function generateRb100DiagnosticReport(): Rb100DiagnosticReport {
  const db = getDb();

  // Load snapshots from DB or signal_rejections
  let snapshots: Rb100DiagnosticSnapshot[] = [];
  try {
    const rows = db.prepare(`SELECT diagnostics FROM signal_rejections WHERE preset='rb100' ORDER BY time DESC LIMIT 500`).all() as { diagnostics: string }[];
    snapshots = rows
      .map((r) => {
        try {
          const parsed = JSON.parse(r.diagnostics);
          if (parsed && parsed.snapshotId) return parsed as Rb100DiagnosticSnapshot;
        } catch {
          // fallback ignore
        }
        return null;
      })
      .filter((x): x is Rb100DiagnosticSnapshot => x !== null);
  } catch {
    snapshots = [];
  }

  // Router Analytics
  const totalScans = snapshots.length;
  const rangeRouted = snapshots.filter((s) => s.marketState === "RANGE").length;
  const breakoutRouted = snapshots.filter((s) => s.marketState === "BREAKOUT").length;
  const retestRouted = snapshots.filter((s) => s.marketState === "RETEST").length;
  const noStateRouted = snapshots.filter((s) => s.marketState === "NO_STATE").length;

  const routerAnalytics: RouterAnalytics = {
    totalScans,
    rangeRouted,
    breakoutRouted,
    retestRouted,
    noStateRouted,
  };

  // Score distributions by strategy
  const strategies: Rb100Strategy[] = ["RB100_RANGE_TRADER", "RB100_BREAKOUT_RETEST", "RB100_BREAKOUT_DIRECT"];
  const scoreDistributions: Record<Rb100Strategy | "GLOBAL", ScoreDistribution> = {
    GLOBAL: computeDistributionFor(snapshots.map((s) => s.finalScore), "GLOBAL"),
    RB100_RANGE_TRADER: computeDistributionFor(snapshots.filter((s) => s.strategy === "RB100_RANGE_TRADER").map((s) => s.finalScore), "RB100_RANGE_TRADER"),
    RB100_BREAKOUT_RETEST: computeDistributionFor(snapshots.filter((s) => s.strategy === "RB100_BREAKOUT_RETEST").map((s) => s.finalScore), "RB100_BREAKOUT_RETEST"),
    RB100_BREAKOUT_DIRECT: computeDistributionFor(snapshots.filter((s) => s.strategy === "RB100_BREAKOUT_DIRECT").map((s) => s.finalScore), "RB100_BREAKOUT_DIRECT"),
  };

  // Hard Filter Pass Rates
  const hardFilterPassRates: Record<Rb100Strategy, number> = {
    RB100_RANGE_TRADER: 0,
    RB100_BREAKOUT_RETEST: 0,
    RB100_BREAKOUT_DIRECT: 0,
  };

  strategies.forEach((strat) => {
    const list = snapshots.filter((s) => s.strategy === strat);
    const passedCount = list.filter((s) => s.hardFiltersPassed).length;
    hardFilterPassRates[strat] = list.length > 0 ? +((passedCount / list.length) * 100).toFixed(1) : 0;
  });

  // Combination Analytics
  const comboCounts: Record<string, number> = {};
  snapshots.forEach((s) => {
    if (s.allRejectionReasons && s.allRejectionReasons.length > 0) {
      const sortedCombo = [...s.allRejectionReasons].sort().join(" + ");
      comboCounts[sortedCombo] = (comboCounts[sortedCombo] || 0) + 1;
    }
  });

  const totalRejections = snapshots.filter((s) => s.finalDecision === "REJECT").length;
  const topCombinationFailures: CombinationAnalytic[] = Object.entries(comboCounts)
    .map(([combo, count]) => ({
      combination: combo,
      count,
      percentage: totalRejections > 0 ? +((count / totalRejections) * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Strategy Funnels
  const funnels: Record<Rb100Strategy, StrategyFunnel> = {
    RB100_RANGE_TRADER: buildFunnelFor("RB100_RANGE_TRADER", snapshots),
    RB100_BREAKOUT_RETEST: buildFunnelFor("RB100_BREAKOUT_RETEST", snapshots),
    RB100_BREAKOUT_DIRECT: buildFunnelFor("RB100_BREAKOUT_DIRECT", snapshots),
  };

  // Zero Trade Alert
  const totalExecuted = Object.values(funnels).reduce((acc, f) => acc + f.executed, 0);
  const isAlertActive = totalScans >= 20 && totalExecuted === 0;

  // Determine top pipeline bottleneck
  const bottleneckCounts: Record<string, number> = {};
  snapshots.forEach((s) => {
    bottleneckCounts[s.noTradeFinalReason] = (bottleneckCounts[s.noTradeFinalReason] || 0) + 1;
  });
  const topBottleneckKey = Object.entries(bottleneckCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "NONE";

  const zeroTradeAlert = {
    active: isAlertActive,
    reason: isAlertActive ? `Aucun trade exécuté sur ${totalScans} opportunités analysées` : null,
    topPipelineBottleneck: isAlertActive ? topBottleneckKey : null,
    passRate: isAlertActive ? (totalScans > 0 ? +((snapshots.filter((s) => s.hardFiltersPassed).length / totalScans) * 100).toFixed(1) : 0) : null,
  };

  // Diagnostic Findings & Recommendations
  const findings: string[] = [];
  const recommendations: string[] = [];

  if (noStateRouted / Math.max(totalScans, 1) >= 0.5) {
    findings.push(`Attention: ${+((noStateRouted / totalScans) * 100).toFixed(1)}% des scans sont non routés (NO_STATE). Le Market State Detector élimine la majorité des mouvements avant les stratégies.`);
    recommendations.push("Examiner la définition des bornes de range M5 pour éviter de rejeter les transitions.");
  }

  if (topCombinationFailures.length > 0) {
    findings.push(`Combinaison de rejets la plus prévalente: ${topCombinationFailures[0].combination} (${topCombinationFailures[0].percentage}% des rejets).`);
  }

  findings.push(`Score Médian Global: ${scoreDistributions.GLOBAL.median} | Max: ${scoreDistributions.GLOBAL.max}`);
  findings.push(`Taux de passage Hard Filters - Range: ${hardFilterPassRates.RB100_RANGE_TRADER}% | Retest: ${hardFilterPassRates.RB100_BREAKOUT_RETEST}% | Direct: ${hardFilterPassRates.RB100_BREAKOUT_DIRECT}%`);

  if (isAlertActive) {
    recommendations.push(`Alerte Zero Trade active: Le goulot d'étranglement principal est '${topBottleneckKey}'. Analyser la combinaison de filtres associée avant de modifier les seuils.`);
  }

  return {
    generatedAt: Date.now(),
    routerAnalytics,
    scoreDistributions,
    hardFilterPassRates,
    topCombinationFailures,
    funnels,
    zeroTradeAlert,
    findings,
    recommendations,
  };
}

function buildFunnelFor(strat: Rb100Strategy, snapshots: Rb100DiagnosticSnapshot[]): StrategyFunnel {
  const list = snapshots.filter((s) => s.strategy === strat);
  const scans = list.length;
  const routed = scans;
  const candidates = scans;
  const hardFilterValid = list.filter((s) => s.hardFiltersPassed).length;
  const scoreValid = list.filter((s) => s.finalScore >= s.requiredScore).length;
  const timeValid = scoreValid; // Session filters
  const riskValid = list.filter((s) => s.noTradeFinalReason !== "RISK_REJECTED").length;
  const contractValid = list.filter((s) => s.noTradeFinalReason !== "CONTRACT_REJECTED").length;
  const executed = list.filter((s) => s.finalDecision === "TAKE").length;

  const bottleneckCounts: Record<string, number> = {};
  list.forEach((s) => {
    bottleneckCounts[s.noTradeFinalReason] = (bottleneckCounts[s.noTradeFinalReason] || 0) + 1;
  });
  const topBottleneck = (Object.entries(bottleneckCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as NoTradeFinalReason) ?? "NONE";

  return {
    strategy: strat,
    scans,
    routed,
    candidates,
    hardFilterValid,
    scoreValid,
    timeValid,
    riskValid,
    contractValid,
    executed,
    hardFilterPassRate: scans > 0 ? +((hardFilterValid / scans) * 100).toFixed(1) : 0,
    topBottleneck,
  };
}
