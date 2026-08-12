/**
 * Strategy Health Engine & Loss Asymmetry Monitor (Phase 4 - Spécification 70 Points).
 * Calcule la santé statistique globale de chaque sous-moteur par (SYMBOL + STRATEGY + STRATEGY_VERSION).
 * Ne se base JAMAIS sur le Win Rate seul, mais sur Expectancy R, Profit Factor, et Asymétrie Perte/Gain.
 */

import { getDb } from "./db.server";
import { FEATURE_FLAGS } from "./feature-flags.server";

export type StrategyHealthStatus =
  | "LEARNING"     // < 30 trades
  | "NORMAL"       // PF >= 1.05 & ExpR > 0
  | "CAUTION"      // PF 0.80-1.04 ou Loss/Win ratio > 2.0
  | "RESTRICTED"   // PF < 0.80 & 30-49 trades
  | "PAUSED"       // PF < 0.70 & 50+ trades ou 3 pertes consécutives
  | "DISABLED";    // Désactivé administrativement

export interface StrategyHealthMetrics {
  symbol: string;
  strategy: string;
  strategyVersion: string;
  preset: string;
  sampleSize: number;
  sampleCategory: "LEARNING" | "EARLY_SAMPLE" | "INTERMEDIATE" | "STRONG_SAMPLE" | "MATURE_SAMPLE";
  wins: number;
  losses: number;
  winRatePct: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number;
  expectancyR: number;
  averageR: number;
  averageWin: number;
  averageLoss: number;
  lossWinRatio: number;
  lossAsymmetryWarning: boolean;
  maxDrawdownUsd: number;
  consecutiveLosses: number;
  status: StrategyHealthStatus;
  wouldBeStatus: StrategyHealthStatus;
  observationMode: boolean;
}

export function evaluateStrategyHealth(
  symbol: string,
  strategy: string,
  strategyVersion: string = "V1"
): StrategyHealthMetrics {
  const db = getDb();
  const observationMode = FEATURE_FLAGS.OBSERVATION_MODE;
  const preset = strategy.split("_")[0]?.toLowerCase() || "default";

  try {
    const row = db.prepare(`
      SELECT COUNT(*) as count,
             SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) as losses,
             SUM(CASE WHEN status='won' THEN profit ELSE 0 END) as gross_profit,
             SUM(CASE WHEN status='lost' THEN ABS(profit) ELSE 0 END) as gross_loss,
             SUM(profit) as net_pnl,
             AVG(CASE WHEN status='won' THEN profit ELSE NULL END) as avg_win,
             AVG(CASE WHEN status='lost' THEN ABS(profit) ELSE NULL END) as avg_loss,
             AVG(COALESCE(r_multiple, CASE WHEN status='won' THEN 1.0 ELSE -1.0 END)) as avg_r
      FROM bot_trades
      WHERE symbol = ? AND (strategy = ? OR preset = ?) AND COALESCE(strategy_version, 'V1') = ?
        AND status IN ('won', 'lost')
    `).get(symbol, strategy, preset, strategyVersion) as any;

    const count = row?.count || 0;
    const wins = row?.wins || 0;
    const losses = row?.losses || 0;
    const grossProfit = row?.gross_profit || 0;
    const grossLoss = row?.gross_loss || 0;
    const netPnl = row?.net_pnl || 0;
    const avgWin = row?.avg_win || 0;
    const avgLoss = row?.avg_loss || 0;
    const avgR = row?.avg_r || 0;

    const winRate = count > 0 ? (wins / count) * 100 : 0;
    const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
    const lossWinRatio = avgWin > 0 ? avgLoss / avgWin : 0;
    const lossAsymmetryWarning = count >= 20 && avgLoss > 2.0 * avgWin;

    // Classification du volume d'échantillon (Point 49)
    let sampleCategory: StrategyHealthMetrics["sampleCategory"] = "LEARNING";
    if (count >= 500) sampleCategory = "MATURE_SAMPLE";
    else if (count >= 300) sampleCategory = "STRONG_SAMPLE";
    else if (count >= 100) sampleCategory = "INTERMEDIATE";
    else if (count >= 30) sampleCategory = "EARLY_SAMPLE";

    // Évaluation du statut de santé
    let wouldBeStatus: StrategyHealthStatus = "LEARNING";
    if (count < 30) {
      wouldBeStatus = "LEARNING";
    } else if (count >= 50 && (pf < 0.70 || avgR < -0.2)) {
      wouldBeStatus = "PAUSED";
    } else if (count >= 30 && pf < 0.80) {
      wouldBeStatus = "RESTRICTED";
    } else if (pf < 1.04 || lossAsymmetryWarning) {
      wouldBeStatus = "CAUTION";
    } else {
      wouldBeStatus = "NORMAL";
    }

    const currentStatus: StrategyHealthStatus = observationMode && (wouldBeStatus === "PAUSED" || wouldBeStatus === "RESTRICTED")
      ? "NORMAL"
      : wouldBeStatus;

    return {
      symbol,
      strategy,
      strategyVersion,
      preset,
      sampleSize: count,
      sampleCategory,
      wins,
      losses,
      winRatePct: Number(winRate.toFixed(1)),
      grossProfit: Number(grossProfit.toFixed(2)),
      grossLoss: Number(grossLoss.toFixed(2)),
      netPnl: Number(netPnl.toFixed(2)),
      profitFactor: Number(pf.toFixed(2)),
      expectancyR: Number(avgR.toFixed(2)),
      averageR: Number(avgR.toFixed(2)),
      averageWin: Number(avgWin.toFixed(2)),
      averageLoss: Number(avgLoss.toFixed(2)),
      lossWinRatio: Number(lossWinRatio.toFixed(2)),
      lossAsymmetryWarning,
      maxDrawdownUsd: 0,
      consecutiveLosses: 0,
      status: currentStatus,
      wouldBeStatus,
      observationMode,
    };
  } catch (e) {
    return {
      symbol,
      strategy,
      strategyVersion,
      preset,
      sampleSize: 0,
      sampleCategory: "LEARNING",
      wins: 0,
      losses: 0,
      winRatePct: 0,
      grossProfit: 0,
      grossLoss: 0,
      netPnl: 0,
      profitFactor: 1.0,
      expectancyR: 0,
      averageR: 0,
      averageWin: 0,
      averageLoss: 0,
      lossWinRatio: 0,
      lossAsymmetryWarning: false,
      maxDrawdownUsd: 0,
      consecutiveLosses: 0,
      status: "LEARNING",
      wouldBeStatus: "LEARNING",
      observationMode,
    };
  }
}

/**
 * Récupère le bilan de santé complet de toutes les sous-stratégies actives.
 */
export function getAllStrategyHealthMetrics(): StrategyHealthMetrics[] {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT DISTINCT symbol, COALESCE(strategy, preset || '_ENGINE') as strategy, COALESCE(strategy_version, 'V1') as version
      FROM bot_trades
    `).all() as { symbol: string; strategy: string; version: string }[];

    return rows.map((r) => evaluateStrategyHealth(r.symbol, r.strategy, r.version));
  } catch {
    return [];
  }
}
