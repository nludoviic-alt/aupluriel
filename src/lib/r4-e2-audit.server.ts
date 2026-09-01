import { getDb } from "./db.server";

export const R4_E2_DEPLOYED_AT = 1786625330000; // 2026-08-13 12:48:50 UTC

/**
 * Every (risk_version, execution_version) combination considered valid
 * post-deploy. execution_version moved R4/E2 -> R4/E3 same-day (2026-08-13)
 * for the stake-sizing fix (requestedStake now enforced as a hard ceiling —
 * see the Priority 2 MIN() in bot-engine.server.ts); both are legitimate,
 * time-ordered cohorts, not a mismatch — E2 trades predate the fix, E3
 * trades postdate it. Extend this set on the next real version bump instead
 * of hardcoding a single pair.
 */
const VALID_VERSION_COMBOS = new Set(["R4|E2", "R4|E3"]);

export type SampleSizeStatus = "LEARNING" | "EARLY SAMPLE" | "INTERMEDIATE" | "STRONGER SAMPLE";
export type EdgeClassification = "STRONG" | "POSITIVE" | "NEUTRAL" | "WEAK" | "TOXIC";

export function getSampleSizeStatus(tradesCount: number): SampleSizeStatus {
  if (tradesCount < 30) return "LEARNING";
  if (tradesCount < 100) return "EARLY SAMPLE";
  if (tradesCount < 300) return "INTERMEDIATE";
  return "STRONGER SAMPLE";
}

export interface R4E2PerformanceRow {
  symbol: string;
  strategy: string;
  strategyVersion: string;
  riskVersion: string;
  executionVersion: string;
  configHash: string;
  closedTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  expectancyUsd: number;
  sampleSizeStatus: SampleSizeStatus;
}

export interface TemporalBlockStats {
  blockName: string; // "1-100", "101-200", "201-300"
  tradesCount: number;
  winRatePct: number;
  netPnl: number;
  profitFactor: number;
  expectancyR: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdownUsd: number;
}

export interface RobustnessAnalysis {
  classification: EdgeClassification;
  profitConcentrationWarning: boolean;
  top5ProfitPct: number;
  medianR: number;
  p25R: number;
  p75R: number;
  bestTradeR: number;
  worstTradeR: number;
  maxDrawdownUsd: number;
  recoveryFactor: number;
  longestLosingStreak: number;
  temporalBlocks: TemporalBlockStats[];
  robustnessChecks: {
    netPnlPositive: boolean;
    expectancyUsdPositive: boolean;
    expectancyRPositive: boolean;
    profitFactorAboveOne: boolean;
    drawdownCompatible: boolean;
    noProfitConcentration: boolean;
    temporalStability: boolean;
  };
}

export function logSafetyAlert(params: {
  alertType: "VERSIONING_MISMATCH" | "CONFIG_HASH_MISSING" | "STAKE_SAFETY_VIOLATION" | "STAKE_BELOW_DERIV_MINIMUM" | "RISK_PAUSE_BYPASS" | "EXECUTION_WITHOUT_VALID_PROPOSAL" | "CONFIG_SNAPSHOT_MISSING" | "STAKE_MIGRATION_ANOMALY" | "DERIV_AUTH_INVALID" | "BOT_CONFIG_INVALID" | "BOT_STALLED";
  userId: number;
  preset: string;
  symbol: string;
  details: string;
}): void {
  try {
    const db = getDb();
    const id = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    db.prepare(`
      INSERT INTO safety_alerts (id, time, alert_type, user_id, preset, symbol, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, Date.now(), params.alertType, params.userId, params.preset, params.symbol, params.details);
  } catch { /* ignore alert logging error */ }
}

export function analyze300TradeRobustness(trades: { profit: number; stake: number; rMultiple?: number }[]): RobustnessAnalysis {
  const closedCount = trades.length;
  let grossProfit = 0, grossLoss = 0, netPnl = 0;
  const rValues: number[] = [];

  for (const t of trades) {
    const p = t.profit || 0;
    netPnl += p;
    if (p > 0) grossProfit += p;
    else if (p < 0) grossLoss += Math.abs(p);

    const r = typeof t.rMultiple === "number" ? t.rMultiple : (t.stake > 0 ? p / t.stake : 0);
    rValues.push(r);
  }

  rValues.sort((a, b) => a - b);

  const bestTradeR = rValues.length ? rValues[rValues.length - 1] : 0;
  const worstTradeR = rValues.length ? rValues[0] : 0;
  const medianR = rValues.length ? rValues[Math.floor(rValues.length / 2)] : 0;
  const p25R = rValues.length ? rValues[Math.floor(rValues.length * 0.25)] : 0;
  const p75R = rValues.length ? rValues[Math.floor(rValues.length * 0.75)] : 0;
  const expectancyR = rValues.length ? rValues.reduce((a, b) => a + b, 0) / rValues.length : 0;

  const topProfits = trades.map((t) => t.profit).filter((p) => p > 0).sort((a, b) => b - a).slice(0, 5);
  const top5Gross = topProfits.reduce((a, b) => a + b, 0);
  const top5ProfitPct = grossProfit > 0 ? (top5Gross / grossProfit) * 100 : 0;
  const profitConcentrationWarning = top5ProfitPct >= 60.0;

  let peak = 0, cum = 0, maxDd = 0, streak = 0, maxStreak = 0;
  for (const t of trades) {
    cum += t.profit;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;

    if (t.profit < 0) {
      streak++;
      if (streak > maxStreak) maxStreak = streak;
    } else {
      streak = 0;
    }
  }

  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);
  const recoveryFactor = maxDd > 0 ? netPnl / maxDd : (netPnl > 0 ? 99 : 0);

  const temporalBlocks: TemporalBlockStats[] = [];
  const blockSize = Math.ceil(closedCount / 3);

  for (let b = 0; b < 3; b++) {
    const slice = trades.slice(b * blockSize, (b + 1) * blockSize);
    if (slice.length === 0) continue;

    let bGrossP = 0, bGrossL = 0, bNet = 0, bWins = 0;
    const bRs: number[] = [];
    for (const t of slice) {
      bNet += t.profit;
      if (t.profit > 0) { bWins++; bGrossP += t.profit; }
      else if (t.profit < 0) { bGrossL += Math.abs(t.profit); }
      const r = typeof t.rMultiple === "number" ? t.rMultiple : (t.stake > 0 ? t.profit / t.stake : 0);
      bRs.push(r);
    }
    const bPf = bGrossL > 0 ? bGrossP / bGrossL : (bGrossP > 0 ? 99 : 0);
    const bExpR = bRs.length ? bRs.reduce((x, y) => x + y, 0) / bRs.length : 0;
    const bWr = (bWins / slice.length) * 100;

    temporalBlocks.push({
      blockName: b === 0 ? "1-100" : b === 1 ? "101-200" : "201-300",
      tradesCount: slice.length,
      winRatePct: Math.round(bWr * 100) / 100,
      netPnl: Math.round(bNet * 100) / 100,
      profitFactor: Math.round(bPf * 100) / 100,
      expectancyR: Math.round(bExpR * 1000) / 1000,
      avgWin: Math.round((bGrossP / Math.max(1, bWins)) * 100) / 100,
      avgLoss: Math.round((bGrossL / Math.max(1, slice.length - bWins)) * 100) / 100,
      maxDrawdownUsd: 0,
    });
  }

  const netPnlPositive = netPnl > 0;
  const expectancyUsdPositive = netPnl / Math.max(1, closedCount) > 0;
  const expectancyRPositive = expectancyR > 0;
  const profitFactorAboveOne = profitFactor > 1.0;
  const drawdownCompatible = maxDd <= 100;
  const noProfitConcentration = !profitConcentrationWarning;
  const temporalStability = temporalBlocks.every((b) => b.netPnl >= 0 || b.profitFactor >= 0.95);

  const passesRobustness =
    netPnlPositive &&
    expectancyUsdPositive &&
    expectancyRPositive &&
    profitFactorAboveOne &&
    drawdownCompatible &&
    noProfitConcentration &&
    temporalStability;

  let classification: EdgeClassification = "TOXIC";

  if (profitFactor >= 1.75 && expectancyR >= 0.35 && passesRobustness) {
    classification = "STRONG";
  } else if (profitFactor >= 1.25 && expectancyR >= 0.15 && passesRobustness) {
    classification = "POSITIVE";
  } else if (profitFactor >= 0.95 && profitFactor < 1.25 && expectancyR >= -0.05) {
    classification = "NEUTRAL";
  } else if (profitFactor >= 0.70 && profitFactor < 0.95) {
    classification = "WEAK";
  } else {
    classification = "TOXIC";
  }

  return {
    classification,
    profitConcentrationWarning,
    top5ProfitPct: Math.round(top5ProfitPct * 100) / 100,
    medianR: Math.round(medianR * 1000) / 1000,
    p25R: Math.round(p25R * 1000) / 1000,
    p75R: Math.round(p75R * 1000) / 1000,
    bestTradeR: Math.round(bestTradeR * 1000) / 1000,
    worstTradeR: Math.round(worstTradeR * 1000) / 1000,
    maxDrawdownUsd: Math.round(maxDd * 100) / 100,
    recoveryFactor: Math.round(recoveryFactor * 100) / 100,
    longestLosingStreak: maxStreak,
    temporalBlocks,
    robustnessChecks: {
      netPnlPositive,
      expectancyUsdPositive,
      expectancyRPositive,
      profitFactorAboveOne,
      drawdownCompatible,
      noProfitConcentration,
      temporalStability,
    },
  };
}

export function getPostR4E2Performance(): R4E2PerformanceRow[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT 
      symbol,
      COALESCE(strategy, preset, 'UNKNOWN') AS strategy,
      COALESCE(strategy_version, 'V1') AS strategy_version,
      COALESCE(risk_version, 'R4') AS risk_version,
      COALESCE(execution_version, 'E2') AS execution_version,
      COALESCE(config_hash, 'hash_legacy') AS config_hash,
      COUNT(*) AS closed_trades,
      SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END) AS losses,
      ROUND(100.0 * SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS win_rate_pct,
      ROUND(SUM(profit), 2) AS net_pnl,
      ROUND(SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END), 2) AS gross_profit,
      ROUND(SUM(CASE WHEN profit < 0 THEN ABS(profit) ELSE 0 END), 2) AS gross_loss,
      ROUND(
        SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END)
        / NULLIF(SUM(CASE WHEN profit < 0 THEN ABS(profit) ELSE 0 END), 0),
        2
      ) AS profit_factor,
      ROUND(AVG(CASE WHEN profit > 0 THEN profit END), 2) AS avg_win,
      ROUND(AVG(CASE WHEN profit < 0 THEN profit END), 2) AS avg_loss,
      ROUND(AVG(profit), 3) AS expectancy_usd
    FROM bot_trades
    WHERE time >= ? AND status IN ('won', 'lost')
    GROUP BY symbol, COALESCE(strategy, preset, 'UNKNOWN'), strategy_version, risk_version, execution_version, config_hash
    ORDER BY expectancy_usd DESC
  `).all(R4_E2_DEPLOYED_AT) as any[];

  return rows.map((r) => ({
    symbol: r.symbol,
    strategy: r.strategy,
    strategyVersion: r.strategy_version,
    riskVersion: r.risk_version,
    executionVersion: r.execution_version,
    configHash: r.config_hash,
    closedTrades: r.closed_trades || 0,
    wins: r.wins || 0,
    losses: r.losses || 0,
    winRatePct: r.win_rate_pct || 0,
    netPnl: r.net_pnl || 0,
    grossProfit: r.gross_profit || 0,
    grossLoss: r.gross_loss || 0,
    profitFactor: r.profit_factor || 0,
    avgWin: r.avg_win || 0,
    avgLoss: r.avg_loss || 0,
    expectancyUsd: r.expectancy_usd || 0,
    sampleSizeStatus: getSampleSizeStatus(r.closed_trades || 0),
  }));
}

export function checkVersioningIntegrity(): { violations: number; mismatchCount: number; validCount: number } {
  const db = getDb();

  const violationsRow = db.prepare(`
    SELECT COUNT(*) AS c
    FROM bot_trades
    WHERE time >= ? AND status IN ('won', 'lost')
    AND (
      risk_version IS NULL
      OR execution_version IS NULL
      OR strategy_version IS NULL
      OR config_hash IS NULL
    )
  `).get(R4_E2_DEPLOYED_AT) as { c: number };

  const versionsRows = db.prepare(`
    SELECT risk_version, execution_version, COUNT(*) AS count
    FROM bot_trades
    WHERE time >= ? AND status IN ('won', 'lost')
    GROUP BY risk_version, execution_version
  `).all(R4_E2_DEPLOYED_AT) as { risk_version: string | null; execution_version: string | null; count: number }[];

  let mismatchCount = 0;
  let validCount = 0;

  for (const row of versionsRows) {
    if (VALID_VERSION_COMBOS.has(`${row.risk_version}|${row.execution_version}`)) {
      validCount += row.count;
    } else {
      mismatchCount += row.count;
      logSafetyAlert({
        alertType: "VERSIONING_MISMATCH",
        userId: 0,
        preset: "system",
        symbol: "GLOBAL",
        details: `Unexpected version combination detected post-deploy: risk_version=${row.risk_version}, execution_version=${row.execution_version}`,
      });
    }
  }

  return {
    violations: violationsRow.c || 0,
    mismatchCount,
    validCount,
  };
}

export function getRiskStopAuditReport(): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT 
      symbol,
      COALESCE(strategy, preset, 'UNKNOWN') AS strategy,
      COALESCE(strategy_version, 'V1') AS strategy_version,
      COALESCE(risk_version, 'R4') AS risk_version,
      COALESCE(execution_version, 'E2') AS execution_version,
      COUNT(*) AS risk_stops
    FROM bot_trades
    WHERE time >= ? AND status = 'risk-stop'
    GROUP BY symbol, COALESCE(strategy, preset, 'UNKNOWN'), strategy_version, risk_version, execution_version
    ORDER BY risk_stops DESC
  `).all(R4_E2_DEPLOYED_AT);
}

export function getShadowSavingsSummary(): {
  riskStops: number;
  shadowWins: number;
  shadowLosses: number;
  shadowWinRatePct: number;
  shadowGrossProfit: number;
  shadowGrossLoss: number;
  shadowNetPnl: number;
  shadowProfitFactor: number;
  capitalSavedUsd: number;
} {
  const db = getDb();
  const rows = db.prepare(`
    SELECT virtual_pnl FROM shadow_trades
    WHERE time >= ?
  `).all(R4_E2_DEPLOYED_AT) as { virtual_pnl: number }[];

  let shadowWins = 0, shadowLosses = 0, shadowGrossProfit = 0, shadowGrossLoss = 0, shadowNetPnl = 0;
  for (const r of rows) {
    const p = r.virtual_pnl || 0;
    shadowNetPnl += p;
    if (p > 0) { shadowWins++; shadowGrossProfit += p; }
    else if (p < 0) { shadowLosses++; shadowGrossLoss += Math.abs(p); }
  }

  const total = shadowWins + shadowLosses;
  const shadowWinRatePct = total > 0 ? (shadowWins / total) * 100 : 0;
  const shadowProfitFactor = shadowGrossLoss > 0 ? shadowGrossProfit / shadowGrossLoss : (shadowGrossProfit > 0 ? 99 : 0);
  const capitalSavedUsd = shadowNetPnl < 0 ? Math.abs(shadowNetPnl) : 0;

  return {
    riskStops: rows.length,
    shadowWins,
    shadowLosses,
    shadowWinRatePct: Math.round(shadowWinRatePct * 100) / 100,
    shadowGrossProfit: Math.round(shadowGrossProfit * 100) / 100,
    shadowGrossLoss: Math.round(shadowGrossLoss * 100) / 100,
    shadowNetPnl: Math.round(shadowNetPnl * 100) / 100,
    shadowProfitFactor: Math.round(shadowProfitFactor * 100) / 100,
    capitalSavedUsd: Math.round(capitalSavedUsd * 100) / 100,
  };
}
