import { getDb } from "./db.server";

export type RollingWindow = "LAST_30_TRADES" | "LAST_50_TRADES" | "LAST_100_TRADES" | "HISTORICAL";
export type PerformanceDriftStatus = "NONE" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type StrategyRiskState = "NORMAL" | "CAUTION" | "RESTRICTED" | "SHADOW";

export interface StrategyWindowMetrics {
  window: RollingWindow;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  averageR: number;
  averageWin: number;
  averageLoss: number;
  maxDrawdown: number;
  grossProfit: number;
  grossLoss: number;
}

export interface PerformanceDriftReport {
  strategy: string;
  strategyVersion: string;
  symbol: string;
  driftStatus: PerformanceDriftStatus;
  riskState: StrategyRiskState;
  riskMultiplier: number; // 1.0 (NORMAL), 0.75 (CAUTION), 0.50 (RESTRICTED), 0.0 (SHADOW)
  last30: StrategyWindowMetrics;
  last50: StrategyWindowMetrics;
  last100: StrategyWindowMetrics;
  historical: StrategyWindowMetrics;
  updatedAt: number;
}

interface TradeRecord {
  profit: number;
  stake: number;
  status: string;
  rMultiple?: number;
}

/**
 * Calculates quantitative window metrics over a list of trades.
 */
export function calculateWindowMetrics(window: RollingWindow, trades: TradeRecord[]): StrategyWindowMetrics {
  const total = trades.length;
  if (total === 0) {
    return {
      window,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      profitFactor: 0,
      expectancyR: 0,
      averageR: 0,
      averageWin: 0,
      averageLoss: 0,
      maxDrawdown: 0,
      grossProfit: 0,
      grossLoss: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const rMultiples: number[] = [];
  const winRs: number[] = [];
  const lossRs: number[] = [];

  let cumulativePnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;

  for (const t of trades) {
    const pnl = t.profit || 0;
    cumulativePnl += pnl;
    if (cumulativePnl > peakPnl) peakPnl = cumulativePnl;
    const dd = peakPnl - cumulativePnl;
    if (dd > maxDrawdown) maxDrawdown = dd;

    const stake = t.stake > 0 ? t.stake : 5;
    // R-multiple estimation: profit / stake (or stored r_multiple if explicit)
    const r = t.rMultiple !== undefined && t.rMultiple !== null ? t.rMultiple : pnl / stake;
    rMultiples.push(r);

    if (pnl > 0 || t.status === "won") {
      wins++;
      grossProfit += pnl;
      winRs.push(r);
    } else if (pnl < 0 || t.status === "lost") {
      losses++;
      grossLoss += Math.abs(pnl);
      lossRs.push(Math.abs(r));
    }
  }

  const winRate = wins / total;
  const absLoss = Math.abs(grossLoss);
  const profitFactor = absLoss > 0 ? Math.round((grossProfit / absLoss) * 100) / 100 : grossProfit > 0 ? 99 : 0;

  const avgWinR = winRs.length > 0 ? winRs.reduce((a, b) => a + b, 0) / winRs.length : 0;
  const avgLossR = lossRs.length > 0 ? lossRs.reduce((a, b) => a + b, 0) / lossRs.length : 0;
  const averageWin = wins > 0 ? grossProfit / wins : 0;
  const averageLoss = losses > 0 ? grossLoss / losses : 0;

  // Expectancy R = (WinRate * AvgR_Win) - ((1 - WinRate) * AvgR_Loss)
  const expectancyR = Math.round(((winRate * avgWinR) - ((1 - winRate) * avgLossR)) * 100) / 100;
  const averageR = Math.round((rMultiples.reduce((a, b) => a + b, 0) / total) * 100) / 100;

  return {
    window,
    trades: total,
    wins,
    losses,
    winRate: Math.round(winRate * 1000) / 10,
    profitFactor,
    expectancyR,
    averageR,
    averageWin: Math.round(averageWin * 100) / 100,
    averageLoss: Math.round(averageLoss * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossLoss: Math.round(grossLoss * 100) / 100,
  };
}

/**
 * Fetches closed trade records for a strategy/version/symbol up to `limit`.
 */
function fetchStrategyTrades(strategy: string, strategyVersion: string, symbol: string, limit: number): TradeRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT profit, stake, status, r_multiple as rMultiple
    FROM bot_trades
    WHERE strategy = ? AND strategy_version = ? AND symbol = ? AND status IN ('won', 'lost', 'closed')
    ORDER BY time DESC
    LIMIT ?
  `).all(strategy, strategyVersion, symbol, limit) as TradeRecord[];
}

/**
 * Fetches virtual shadow trade records for a strategy in SHADOW mode.
 */
function fetchShadowTrades(strategy: string, strategyVersion: string, symbol: string, limit: number): TradeRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT virtual_pnl as profit, 5 as stake, status, r_multiple as rMultiple
    FROM shadow_trades
    WHERE strategy = ? AND strategy_version = ? AND symbol = ? AND status IN ('won', 'lost', 'closed')
    ORDER BY time DESC
    LIMIT ?
  `).all(strategy, strategyVersion, symbol, limit) as TradeRecord[];
}

/**
 * Evaluates performance drift status and determines risk allocation state.
 */
export function evaluatePerformanceDrift(
  strategy: string,
  strategyVersion = "V1",
  symbol: string
): PerformanceDriftReport {
  const db = getDb();

  // 1. Fetch trade samples
  const trades30 = fetchStrategyTrades(strategy, strategyVersion, symbol, 30);
  const trades50 = fetchStrategyTrades(strategy, strategyVersion, symbol, 50);
  const trades100 = fetchStrategyTrades(strategy, strategyVersion, symbol, 100);
  const tradesHist = fetchStrategyTrades(strategy, strategyVersion, symbol, 500);

  const m30 = calculateWindowMetrics("LAST_30_TRADES", trades30);
  const m50 = calculateWindowMetrics("LAST_50_TRADES", trades50);
  const m100 = calculateWindowMetrics("LAST_100_TRADES", trades100);
  const mHist = calculateWindowMetrics("HISTORICAL", tradesHist);

  // 2. Retrieve current persisted state (if any)
  const existing = db.prepare(`
    SELECT drift_status, risk_state, risk_multiplier FROM strategy_performance_drift
    WHERE strategy = ? AND strategy_version = ? AND symbol = ?
  `).get(strategy, strategyVersion, symbol) as { drift_status: PerformanceDriftStatus; risk_state: StrategyRiskState; risk_multiplier: number } | undefined;

  let currentRiskState: StrategyRiskState = existing?.risk_state ?? "NORMAL";
  let driftStatus: PerformanceDriftStatus = "NONE";

  // 3. Drift Evaluation Rules
  if (m30.trades >= 30 && m30.profitFactor < 0.50 && m30.expectancyR < -0.5) {
    driftStatus = "CRITICAL";
  } else if (m30.trades >= 30 && m30.profitFactor < 0.80 && m30.expectancyR < 0) {
    driftStatus = "HIGH";
  } else if (m50.trades >= 50 && m50.profitFactor < 0.90) {
    driftStatus = "MODERATE";
  } else if (m100.trades >= 100 && m100.profitFactor < 0.98) {
    driftStatus = "LOW";
  } else {
    driftStatus = "NONE";
  }

  // 4. Progressive Risk State Transitions (De-escalation & Recovery)
  let newRiskState: StrategyRiskState = currentRiskState;
  let riskMultiplier = 1.0;

  if (currentRiskState === "SHADOW") {
    // ── PROGRESSIVE REACTIVATION FROM SHADOW ──
    // Requires: ShadowTrades >= 30 AND ShadowPF >= 1.05 AND ShadowExpectancyR > 0
    const shadowTrades30 = fetchShadowTrades(strategy, strategyVersion, symbol, 30);
    const mShadow30 = calculateWindowMetrics("LAST_30_TRADES", shadowTrades30);

    if (mShadow30.trades >= 30 && mShadow30.profitFactor >= 1.05 && mShadow30.expectancyR > 0) {
      // Step 1 of Recovery: SHADOW (0%) -> RESTRICTED (50%)
      newRiskState = "RESTRICTED";
      riskMultiplier = 0.50;
    } else {
      newRiskState = "SHADOW";
      riskMultiplier = 0.0;
    }
  } else if (currentRiskState === "RESTRICTED") {
    // Check if recovery continues to CAUTION or deteriorates to SHADOW
    if (m30.trades >= 30 && m30.profitFactor >= 1.05 && m30.expectancyR > 0) {
      newRiskState = "CAUTION";
      riskMultiplier = 0.75;
    } else if (driftStatus === "HIGH" || driftStatus === "CRITICAL") {
      newRiskState = "SHADOW";
      riskMultiplier = 0.0;
    } else {
      newRiskState = "RESTRICTED";
      riskMultiplier = 0.50;
    }
  } else if (currentRiskState === "CAUTION") {
    if (m30.trades >= 30 && m30.profitFactor >= 1.10 && m30.expectancyR > 0) {
      newRiskState = "NORMAL";
      riskMultiplier = 1.0;
    } else if (driftStatus === "HIGH" || driftStatus === "CRITICAL") {
      newRiskState = "SHADOW";
      riskMultiplier = 0.0;
    } else {
      newRiskState = "CAUTION";
      riskMultiplier = 0.75;
    }
  } else {
    // NORMAL state
    if (driftStatus === "CRITICAL" || driftStatus === "HIGH") {
      newRiskState = "SHADOW";
      riskMultiplier = 0.0;
    } else if (driftStatus === "MODERATE") {
      newRiskState = "CAUTION";
      riskMultiplier = 0.75;
    } else if (driftStatus === "LOW") {
      newRiskState = "CAUTION";
      riskMultiplier = 0.75;
    } else {
      newRiskState = "NORMAL";
      riskMultiplier = 1.0;
    }
  }

  // 5. Persist drift report in SQLite
  db.prepare(`
    INSERT INTO strategy_performance_drift (
      strategy, strategy_version, symbol, drift_status, risk_state, risk_multiplier,
      last_30_json, last_50_json, last_100_json, historical_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(strategy, strategy_version, symbol) DO UPDATE SET
      drift_status = excluded.drift_status,
      risk_state = excluded.risk_state,
      risk_multiplier = excluded.risk_multiplier,
      last_30_json = excluded.last_30_json,
      last_50_json = excluded.last_50_json,
      last_100_json = excluded.last_100_json,
      historical_json = excluded.historical_json,
      updated_at = unixepoch()
  `).run(
    strategy,
    strategyVersion,
    symbol,
    driftStatus,
    newRiskState,
    riskMultiplier,
    JSON.stringify(m30),
    JSON.stringify(m50),
    JSON.stringify(m100),
    JSON.stringify(mHist)
  );

  return {
    strategy,
    strategyVersion,
    symbol,
    driftStatus,
    riskState: newRiskState,
    riskMultiplier,
    last30: m30,
    last50: m50,
    last100: m100,
    historical: mHist,
    updatedAt: Date.now(),
  };
}

/**
 * Returns active risk multiplier for Risk Manager checks.
 * Returns 0.0 if strategy is in SHADOW mode (live trades blocked).
 */
export function getStrategyRiskMultiplier(strategy: string, strategyVersion = "V1", symbol: string): { riskMultiplier: number; riskState: StrategyRiskState; isShadow: boolean } {
  const report = evaluatePerformanceDrift(strategy, strategyVersion, symbol);
  return {
    riskMultiplier: report.riskMultiplier,
    riskState: report.riskState,
    isShadow: report.riskState === "SHADOW",
  };
}
