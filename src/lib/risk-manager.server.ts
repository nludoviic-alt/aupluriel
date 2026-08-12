import { getDb } from "./db.server";
import type { Preset } from "./bot-engine.server";

// ── Types & Contracts ────────────────────────────────────────────────────────

export type RiskDecisionStatus = "APPROVED" | "REDUCED_RISK" | "REJECTED";

export type RiskRejectionReason =
  | "RISK_DAILY_DD"
  | "RISK_GLOBAL_DD"
  | "RISK_LOSS_STREAK"
  | "RISK_MAX_EXPOSURE"
  | "RISK_SYMBOL_EXPOSURE"
  | "RISK_FAMILY_EXPOSURE"
  | "RISK_MAX_POSITIONS"
  | "RISK_DUPLICATE"
  | "RISK_CONFLICT"
  | "RISK_INVALID_POSITION_SIZE"
  | "RISK_MARGIN"
  | "RISK_STRATEGY_PAUSED"
  | "RISK_ACCOUNT_LIMIT"
  | "RISK_EXECUTION_UNAVAILABLE";

export type StrategyRiskStatus = "NORMAL" | "CAUTION" | "RESTRICTED" | "PAUSED" | "DISABLED";

export interface RiskCheckInput {
  userId: number;
  preset: Preset;
  strategyId: string;
  symbol: string;
  direction: "CALL" | "PUT" | "BUY" | "SELL";
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  confidenceScore: number;
  expectedRr?: number;
  currentEquity: number;
  currentBalance: number;
  setupId?: string;
}

export interface RiskCheckOutput {
  decision: RiskDecisionStatus;
  riskPercent: number; // e.g. 0.25, 0.125, 0
  stakeUsd: number;
  reason?: RiskRejectionReason;
  explanation?: string;
  fingerprint: string;
  strategyStatus: StrategyRiskStatus;
}

export interface PresetRiskMetrics {
  status: StrategyRiskStatus;
  sample30: number;
  sample100: number;
  winRate30: number;
  profitFactor30: number;
  expectancy30: number;
  avgWin30: number;
  avgLoss30: number;
  lossToWinRatio30: number;
  winRate100: number;
  profitFactor100: number;
  expectancy100: number;
  reason?: string;
  stakeMultiplier: number;
}

// ── Default Thresholds & Constants ──────────────────────────────────────────

export const RISK_CONFIG = {
  BASE_RISK_PER_TRADE_PCT: 0.25, // 0.25%
  MAX_RISK_PER_TRADE_PCT: 0.50,  // 0.50%
  SOFT_DAILY_DD_PCT: 1.5,        // 1.5%
  HARD_DAILY_DD_PCT: 2.0,        // 2.0%
  MAX_CONSECUTIVE_LOSSES: 3,
  MAX_TOTAL_OPEN_RISK_PCT: 1.0,  // 1.0%
  MAX_SYMBOL_RISK_PCT: 0.50,     // 0.50%
  MAX_FAMILY_RISK_PCT: 0.75,     // 0.75%
  MAX_ACTIVE_POSITIONS_GLOBAL: 4,
  MAX_ACTIVE_PER_STRATEGY: 1,
  MAX_ACTIVE_PER_SYMBOL: 1,
  GLOBAL_MIN_RR: 1.0,
  COOLDOWN_1_LOSS_MIN: 3,
  COOLDOWN_2_LOSSES_MIN: 8,
};

// Asset Families
export const ASSET_FAMILIES: Record<string, string[]> = {
  BOOM_CRASH: ["BOOM1000", "BOOM500", "BOOM600", "BOOM900", "CRASH1000", "CRASH500", "CRASH600", "CRASH900"],
  VOLATILITY: ["1HZ75V", "1HZ50V", "1HZ10V", "1HZ25V", "1HZ100V", "R_75", "R_50", "R_100", "R_25", "R_10"],
  RANGE_BREAK: ["RB100", "RB200", "RB50"],
};

export function getAssetFamily(symbol: string): string {
  for (const [family, symbols] of Object.entries(ASSET_FAMILIES)) {
    if (symbols.includes(symbol)) return family;
  }
  return "OTHER";
}

// ── Strategy Performance Monitor (Rolling 30/50/100 Trades) ─────────────────

export function getPresetRiskMetrics(userId: number, preset: Preset, strategyId?: string): PresetRiskMetrics {
  const db = getDb();
  const targetStrat = strategyId || preset;

  const rows = db.prepare(`
    SELECT status, profit FROM bot_trades
    WHERE user_id = ? AND (preset = ? OR strategy = ?) AND status IN ('won', 'lost')
    ORDER BY time DESC LIMIT 100
  `).all(userId, preset, targetStrat) as { status: "won" | "lost"; profit: number }[];

  const sample100 = rows.length;
  const trades50 = rows.slice(0, 50);
  const sample50 = trades50.length;
  const trades30 = rows.slice(0, 30);
  const sample30 = trades30.length;

  // 50-trade rolling stats
  let grossWin50 = 0, grossLoss50 = 0;
  for (const t of trades50) {
    if (t.status === "won") grossWin50 += t.profit || 0;
    else if (t.status === "lost") grossLoss50 += Math.abs(t.profit || 0);
  }
  const profitFactor50 = grossLoss50 > 0 ? grossWin50 / grossLoss50 : grossWin50 > 0 ? 99 : 0;

  // 30-trade rolling stats
  let wins30 = 0, grossWin30 = 0, grossLoss30 = 0, netPnl30 = 0;
  for (const t of trades30) {
    netPnl30 += t.profit || 0;
    if (t.status === "won") {
      wins30++;
      grossWin30 += t.profit || 0;
    } else if (t.status === "lost") {
      grossLoss30 += Math.abs(t.profit || 0);
    }
  }

  const winRate30 = sample30 > 0 ? wins30 / sample30 : 0;
  const expectancy30 = sample30 > 0 ? netPnl30 / sample30 : 0;
  const profitFactor30 = grossLoss30 > 0 ? grossWin30 / grossLoss30 : grossWin30 > 0 ? 99 : 0;
  const avgWin30 = wins30 > 0 ? grossWin30 / wins30 : 0;
  const losses30 = sample30 - wins30;
  const avgLoss30 = losses30 > 0 ? grossLoss30 / losses30 : 0;
  const lossToWinRatio30 = avgWin30 > 0 ? avgLoss30 / avgWin30 : 0;

  // 100-trade rolling stats
  let wins100 = 0, grossWin100 = 0, grossLoss100 = 0, netPnl100 = 0;
  for (const t of rows) {
    netPnl100 += t.profit || 0;
    if (t.status === "won") {
      wins100++;
      grossWin100 += t.profit || 0;
    } else if (t.status === "lost") {
      grossLoss100 += Math.abs(t.profit || 0);
    }
  }

  const winRate100 = sample100 > 0 ? wins100 / sample100 : 0;
  const expectancy100 = sample100 > 0 ? netPnl100 / sample100 : 0;
  const profitFactor100 = grossLoss100 > 0 ? grossWin100 / grossLoss100 : grossWin100 > 0 ? 99 : 0;

  // Status Matrix: NORMAL, CAUTION, RESTRICTED, PAUSED
  if (sample50 >= 50 && profitFactor50 < 0.70) {
    return {
      status: "PAUSED",
      sample30, sample100, winRate30, profitFactor30, expectancy30, avgWin30, avgLoss30, lossToWinRatio30,
      winRate100, profitFactor100, expectancy100,
      reason: `Profit Factor 50 trades (PF ${profitFactor50.toFixed(2)}) < 0.70 — Pause automatique de sécurité`,
      stakeMultiplier: 0,
    };
  }

  if (sample30 >= 30 && (profitFactor30 < 0.80 || lossToWinRatio30 > 2.0)) {
    return {
      status: "RESTRICTED",
      sample30, sample100, winRate30, profitFactor30, expectancy30, avgWin30, avgLoss30, lossToWinRatio30,
      winRate100, profitFactor100, expectancy100,
      reason: profitFactor30 < 0.80
        ? `Profit Factor (PF ${profitFactor30.toFixed(2)}) < 0.80 sur 30 trades — Risque réduit (50%)`
        : `Perte moyenne (${avgLoss30.toFixed(2)}$) > 2.0x gain moyen (${avgWin30.toFixed(2)}$) — Risque réduit (50%)`,
      stakeMultiplier: 0.50,
    };
  }

  if (sample30 >= 15 && winRate30 < 0.45) {
    return {
      status: "CAUTION",
      sample30, sample100, winRate30, profitFactor30, expectancy30, avgWin30, avgLoss30, lossToWinRatio30,
      winRate100, profitFactor100, expectancy100,
      reason: `Win rate récent (${(winRate30 * 100).toFixed(0)}%) en baisse — Attention (75% risque)`,
      stakeMultiplier: 0.75,
    };
  }

  return {
    status: "NORMAL",
    sample30, sample100, winRate30, profitFactor30, expectancy30, avgWin30, avgLoss30, lossToWinRatio30,
    winRate100, profitFactor100, expectancy100,
    reason: sample30 < 30 ? `Phase d'apprentissage (${sample30}/30 trades)` : `Équilibre validé (PF ${profitFactor30.toFixed(2)})`,
    stakeMultiplier: 1.0,
  };
}

// ── Main Risk Manager Verification Pipeline ────────────────────────────────

export function evaluateRiskCheck(input: RiskCheckInput): RiskCheckOutput {
  const db = getDb();
  const fingerprint = `${input.strategyId}_${input.symbol}_${input.direction}_${input.setupId || "standard"}`;

  // 1. Get Strategy Risk Metrics
  const metrics = getPresetRiskMetrics(input.userId, input.preset, input.strategyId);
  if (metrics.status === "PAUSED" || metrics.status === "DISABLED") {
    logRejection(input, "RISK_STRATEGY_PAUSED", metrics.reason || "Moteur suspendu par le Risk Manager", fingerprint);
    return {
      decision: "REJECTED",
      riskPercent: 0,
      stakeUsd: 0,
      reason: "RISK_STRATEGY_PAUSED",
      explanation: metrics.reason,
      fingerprint,
      strategyStatus: metrics.status,
    };
  }

  // 2. Check Daily Drawdown (Soft 1.5% / Hard 2.0%)
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const todayPnlRow = db.prepare(`
    SELECT SUM(profit) as pnl FROM bot_trades
    WHERE user_id = ? AND time >= ? AND status IN ('won', 'lost')
  `).get(input.userId, todayStart) as { pnl: number | null };

  const todayPnl = todayPnlRow.pnl || 0;
  const equity = Math.max(10, input.currentEquity || input.currentBalance || 1000);
  const dailyLossPct = todayPnl < 0 ? (Math.abs(todayPnl) / equity) * 100 : 0;

  if (dailyLossPct >= RISK_CONFIG.HARD_DAILY_DD_PCT) {
    logRejection(input, "RISK_DAILY_DD", `Daily Drawdown (${dailyLossPct.toFixed(2)}%) >= ${RISK_CONFIG.HARD_DAILY_DD_PCT}% Hard Limit`, fingerprint);
    return {
      decision: "REJECTED",
      riskPercent: 0,
      stakeUsd: 0,
      reason: "RISK_DAILY_DD",
      explanation: `Daily Drawdown (${dailyLossPct.toFixed(2)}%) >= ${RISK_CONFIG.HARD_DAILY_DD_PCT}%`,
      fingerprint,
      strategyStatus: metrics.status,
    };
  }

  // 3. Check Consecutive Loss Streak (per strategy)
  const recentTrades = db.prepare(`
    SELECT status FROM bot_trades
    WHERE user_id = ? AND (preset = ? OR strategy = ?) AND status IN ('won', 'lost')
    ORDER BY time DESC LIMIT 5
  `).all(input.userId, input.preset, input.strategyId) as { status: "won" | "lost" }[];

  let streak = 0;
  for (const t of recentTrades) {
    if (t.status === "lost") streak++;
    else break;
  }

  if (streak >= RISK_CONFIG.MAX_CONSECUTIVE_LOSSES) {
    logRejection(input, "RISK_LOSS_STREAK", `${streak} pertes consécutives — Pause de la stratégie ${input.strategyId}`, fingerprint);
    return {
      decision: "REJECTED",
      riskPercent: 0,
      stakeUsd: 0,
      reason: "RISK_LOSS_STREAK",
      explanation: `${streak} pertes consécutives sur la stratégie ${input.strategyId}`,
      fingerprint,
      strategyStatus: "PAUSED",
    };
  }

  // 4. Duplicate Trade Protection (fingerprint active check)
  const activeDuplicate = db.prepare(`
    SELECT id FROM bot_trades
    WHERE user_id = ? AND symbol = ? AND direction = ? AND status = 'open'
  `).get(input.userId, input.symbol, input.direction);

  if (activeDuplicate) {
    logRejection(input, "RISK_DUPLICATE", `Position identique déjà ouverte sur ${input.symbol} (${input.direction})`, fingerprint);
    return {
      decision: "REJECTED",
      riskPercent: 0,
      stakeUsd: 0,
      reason: "RISK_DUPLICATE",
      explanation: `Position ${input.direction} déjà active sur ${input.symbol}`,
      fingerprint,
      strategyStatus: metrics.status,
    };
  }

  // 5. Conflict Manager (Opposing direction on same symbol)
  const opposingDirection = input.direction === "CALL" || input.direction === "BUY" ? ["PUT", "SELL"] : ["CALL", "BUY"];
  const activeConflict = db.prepare(`
    SELECT id FROM bot_trades
    WHERE user_id = ? AND symbol = ? AND status = 'open' AND direction IN (${opposingDirection.map(() => "?").join(",")})
  `).get(input.userId, input.symbol, ...opposingDirection);

  if (activeConflict) {
    logRejection(input, "RISK_CONFLICT", `Conflit de direction opposée sur ${input.symbol}`, fingerprint);
    return {
      decision: "REJECTED",
      riskPercent: 0,
      stakeUsd: 0,
      reason: "RISK_CONFLICT",
      explanation: `Conflit : position opposée déjà ouverte sur ${input.symbol}`,
      fingerprint,
      strategyStatus: metrics.status,
    };
  }

  // 6. Max Active Positions Limits (Global, Strategy, Symbol)
  const activeGlobalCount = (db.prepare(`
    SELECT COUNT(*) as c FROM bot_trades WHERE user_id = ? AND status = 'open'
  `).get(input.userId) as { c: number }).c;

  if (activeGlobalCount >= RISK_CONFIG.MAX_ACTIVE_POSITIONS_GLOBAL) {
    logRejection(input, "RISK_MAX_POSITIONS", `Limite globale de positions ouvertes (${activeGlobalCount}/${RISK_CONFIG.MAX_ACTIVE_POSITIONS_GLOBAL}) atteinte`, fingerprint);
    return {
      decision: "REJECTED",
      riskPercent: 0,
      stakeUsd: 0,
      reason: "RISK_MAX_POSITIONS",
      explanation: `Limite globale de ${RISK_CONFIG.MAX_ACTIVE_POSITIONS_GLOBAL} positions atteinte`,
      fingerprint,
      strategyStatus: metrics.status,
    };
  }

  const activeStrategyCount = (db.prepare(`
    SELECT COUNT(*) as c FROM bot_trades WHERE user_id = ? AND (preset = ? OR strategy = ?) AND status = 'open'
  `).get(input.userId, input.preset, input.strategyId) as { c: number }).c;

  if (activeStrategyCount >= RISK_CONFIG.MAX_ACTIVE_PER_STRATEGY) {
    logRejection(input, "RISK_MAX_POSITIONS", `Limite de position pour la stratégie ${input.strategyId} (${activeStrategyCount}/${RISK_CONFIG.MAX_ACTIVE_PER_STRATEGY}) atteinte`, fingerprint);
    return {
      decision: "REJECTED",
      riskPercent: 0,
      stakeUsd: 0,
      reason: "RISK_MAX_POSITIONS",
      explanation: `Une position est déjà ouverte sur la stratégie ${input.strategyId}`,
      fingerprint,
      strategyStatus: metrics.status,
    };
  }

  // 7. Family Exposure Check
  const family = getAssetFamily(input.symbol);
  const familySymbols = ASSET_FAMILIES[family] || [input.symbol];
  const activeFamilyStakeRow = db.prepare(`
    SELECT SUM(stake) as total_stake FROM bot_trades
    WHERE user_id = ? AND status = 'open' AND symbol IN (${familySymbols.map(() => "?").join(",")})
  `).get(input.userId, ...familySymbols) as { total_stake: number | null };

  const currentFamilyExposurePct = ((activeFamilyStakeRow.total_stake || 0) / equity) * 100;
  if (currentFamilyExposurePct >= RISK_CONFIG.MAX_FAMILY_RISK_PCT) {
    logRejection(input, "RISK_FAMILY_EXPOSURE", `Exposition famille ${family} (${currentFamilyExposurePct.toFixed(2)}%) >= ${RISK_CONFIG.MAX_FAMILY_RISK_PCT}%`, fingerprint);
    return {
      decision: "REJECTED",
      riskPercent: 0,
      stakeUsd: 0,
      reason: "RISK_FAMILY_EXPOSURE",
      explanation: `Exposition max famille ${family} (${RISK_CONFIG.MAX_FAMILY_RISK_PCT}%) atteinte`,
      fingerprint,
      strategyStatus: metrics.status,
    };
  }

  // 8. Risk Sizing Calculation
  let baseRiskPct = RISK_CONFIG.BASE_RISK_PER_TRADE_PCT;

  // Apply Soft Daily DD reduction if daily loss >= 1.5%
  if (dailyLossPct >= RISK_CONFIG.SOFT_DAILY_DD_PCT) {
    baseRiskPct = baseRiskPct / 2; // 0.125%
  }

  // Apply 2 consecutive losses reduction
  if (streak === 2) {
    baseRiskPct = baseRiskPct / 2;
  }

  // Apply Strategy Metrics multiplier
  baseRiskPct = baseRiskPct * metrics.stakeMultiplier;

  const finalRiskPct = Math.min(RISK_CONFIG.MAX_RISK_PER_TRADE_PCT, Math.max(0.05, baseRiskPct));

  // Compute position stake USD
  let stakeUsd = Math.max(1, Math.round((equity * (finalRiskPct / 100)) * 100) / 100);

  // Check Account Balance
  if (input.currentBalance > 0 && stakeUsd > input.currentBalance) {
    logRejection(input, "RISK_ACCOUNT_LIMIT", `Solde insuffisant ($${input.currentBalance.toFixed(2)}) pour la mise ($${stakeUsd.toFixed(2)})`, fingerprint);
    return {
      decision: "REJECTED",
      riskPercent: 0,
      stakeUsd: 0,
      reason: "RISK_ACCOUNT_LIMIT",
      explanation: `Solde compte insuffisant pour la mise calibrée`,
      fingerprint,
      strategyStatus: metrics.status,
    };
  }

  const decisionStatus: RiskDecisionStatus = finalRiskPct < RISK_CONFIG.BASE_RISK_PER_TRADE_PCT ? "REDUCED_RISK" : "APPROVED";

  return {
    decision: decisionStatus,
    riskPercent: finalRiskPct,
    stakeUsd,
    fingerprint,
    strategyStatus: metrics.status,
  };
}

// ── Log Rejections to Database ──────────────────────────────────────────────

function logRejection(input: RiskCheckInput, reason: RiskRejectionReason, explanation: string, fingerprint: string) {
  try {
    getDb().prepare(`
      INSERT INTO signal_rejections (id, user_id, preset, symbol, time, score, reason, diagnostics)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `risk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      input.userId,
      input.preset,
      input.symbol,
      Date.now(),
      input.confidenceScore,
      reason,
      JSON.stringify({ explanation, strategyId: input.strategyId, direction: input.direction, fingerprint })
    );
  } catch { /* ignore log write error */ }
}
