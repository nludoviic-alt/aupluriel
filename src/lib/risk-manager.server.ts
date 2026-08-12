import { getDb } from "./db.server";
import type { Preset } from "./bot-engine.server";

export type PresetRiskStatus = "VALIDATED" | "NORMAL" | "RESTRICTED" | "PAUSED";

export interface PresetRiskMetrics {
  status: PresetRiskStatus;
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
  minConfidenceAdjustment: number;
  stakeMultiplier: number;
}

/** Computes rolling Risk Manager metrics for a preset from SQLite `bot_trades`.
 * Evaluates rules on rolling windows of 30 and 100 closed trades:
 * 1. IF ProfitFactor < 0.80 AND sample >= 30 => PAUSED (stakeMultiplier = 0)
 * 2. IF AverageLoss > 2.0 * AverageWin AND sample >= 30 => RESTRICTED (stakeMultiplier = 0.6, minConfidence +5)
 * 3. IF ProfitFactor >= 1.20 AND Expectancy > 0 AND sample >= 100 => VALIDATED
 */
export function getPresetRiskMetrics(userId: number, preset: Preset): PresetRiskMetrics {
  const db = getDb();

  // Fetch up to 100 most recent closed trades for this user and preset
  const rows = db.prepare(`
    SELECT status, profit FROM bot_trades
    WHERE user_id = ? AND preset = ? AND status IN ('won', 'lost')
    ORDER BY time DESC LIMIT 100
  `).all(userId, preset) as { status: "won" | "lost"; profit: number }[];

  const sample100 = rows.length;
  const trades30 = rows.slice(0, 30);
  const sample30 = trades30.length;

  // Compute 30-trade stats
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

  // Compute 100-trade stats
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

  // Rule evaluation
  if (sample30 >= 30 && profitFactor30 < 0.80) {
    return {
      status: "PAUSED",
      sample30, sample100, winRate30, profitFactor30, expectancy30, avgWin30, avgLoss30, lossToWinRatio30,
      winRate100, profitFactor100, expectancy100,
      reason: `Profit Factor 30 trades (PF ${profitFactor30.toFixed(2)}) < 0.80 — Pause automatique de sécurité`,
      minConfidenceAdjustment: 0,
      stakeMultiplier: 0,
    };
  }

  if (sample30 >= 30 && lossToWinRatio30 > 2.0) {
    return {
      status: "RESTRICTED",
      sample30, sample100, winRate30, profitFactor30, expectancy30, avgWin30, avgLoss30, lossToWinRatio30,
      winRate100, profitFactor100, expectancy100,
      reason: `Perte moyenne (${avgLoss30.toFixed(2)}$) > 2.0x gain moyen (${avgWin30.toFixed(2)}$) — Risque réduit (x0.6) & Confiance +5 pts`,
      minConfidenceAdjustment: 5,
      stakeMultiplier: 0.6,
    };
  }

  if (sample100 >= 100 && profitFactor100 >= 1.20 && expectancy100 > 0) {
    return {
      status: "VALIDATED",
      sample30, sample100, winRate30, profitFactor30, expectancy30, avgWin30, avgLoss30, lossToWinRatio30,
      winRate100, profitFactor100, expectancy100,
      reason: `Certifié Data 100 trades (PF ${profitFactor100.toFixed(2)} >= 1.20, EV +$${expectancy100.toFixed(2)})`,
      minConfidenceAdjustment: 0,
      stakeMultiplier: 1.0,
    };
  }

  return {
    status: "NORMAL",
    sample30, sample100, winRate30, profitFactor30, expectancy30, avgWin30, avgLoss30, lossToWinRatio30,
    winRate100, profitFactor100, expectancy100,
    reason: sample30 < 30 ? `Phase d'apprentissage (${sample30}/30 trades)` : `Équilibre validé (PF ${profitFactor30.toFixed(2)})`,
    minConfidenceAdjustment: 0,
    stakeMultiplier: 1.0,
  };
}
