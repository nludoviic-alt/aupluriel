/**
 * Time Performance Filter V3 (2026-08-12).
 * Évalue la performance historique granulaire par (SYMBOL + STRATEGY + STRATEGY_VERSION + HOUR_UTC).
 * Statuts : INSUFFICIENT_DATA (<30 trades), ACTIVE, CAUTION (PF<0.80 & 30-49 trades -> risk x0.5), BLOCKED (PF<0.80 & 50+ trades -> Shadow Mode).
 */

import { getDb } from "./db.server";
import { FEATURE_FLAGS } from "./feature-flags.server";

export type TimeFilterStatus = "INSUFFICIENT_DATA" | "ACTIVE" | "CAUTION" | "BLOCKED";

export interface TimeFilterResult {
  status: TimeFilterStatus;
  isBlocked: boolean;
  riskMultiplier: number;
  reason: string;
  stats: {
    trades: number;
    profitFactor: number;
    expectancyR: number;
    winRatePct: number;
  };
  shadowModeActive: boolean;
  observationMode: boolean;
}

export function evaluateTimeFilter(
  symbol: string,
  strategy: string,
  strategyVersion: string,
  hourUtc: number
): TimeFilterResult {
  const db = getDb();
  const observationMode = FEATURE_FLAGS.OBSERVATION_MODE;

  // 1. Vérifier si un retour Shadow Mode est prêt pour réactivation
  const shadowCheck = checkShadowReactivation(symbol, strategy, strategyVersion, hourUtc);
  if (shadowCheck.reactivated) {
    return {
      status: "ACTIVE",
      isBlocked: false,
      riskMultiplier: 1.0,
      reason: `Réactivé via Shadow Mode : ${shadowCheck.trades} trades virtuels, PF ${shadowCheck.pf.toFixed(2)}, ExpectancyR +${shadowCheck.expR.toFixed(2)}`,
      stats: {
        trades: shadowCheck.trades,
        profitFactor: shadowCheck.pf,
        expectancyR: shadowCheck.expR,
        winRatePct: shadowCheck.winRate,
      },
      shadowModeActive: false,
      observationMode,
    };
  }

  // 2. Évaluer les trades réels (bot_trades) sur le quadruplet exact
  try {
    const row = db.prepare(`
      SELECT COUNT(*) as count,
             SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) as losses,
             SUM(CASE WHEN status='won' THEN profit ELSE 0 END) as gross_win,
             SUM(CASE WHEN status='lost' THEN ABS(profit) ELSE 0 END) as gross_loss,
             AVG(COALESCE(r_multiple, CASE WHEN status='won' THEN 1.0 ELSE -1.0 END)) as avg_r
      FROM bot_trades
      WHERE symbol = ? AND (strategy = ? OR preset = ?) AND strategy_version = ?
        AND CAST(strftime('%H', datetime(time/1000, 'unixepoch')) AS INTEGER) = ?
        AND status IN ('won', 'lost')
    `).get(symbol, strategy, strategy, strategyVersion, hourUtc) as {
      count: number;
      wins: number;
      losses: number;
      gross_win: number;
      gross_loss: number;
      avg_r: number;
    } | undefined;

    const count = row?.count || 0;
    const wins = row?.wins || 0;
    const grossWin = row?.gross_win || 0;
    const grossLoss = row?.gross_loss || 0;
    const avgR = row?.avg_r || 0;
    const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
    const winRate = count > 0 ? (wins / count) * 100 : 0;

    const statsObj = {
      trades: count,
      profitFactor: Number(pf.toFixed(2)),
      expectancyR: Number(avgR.toFixed(2)),
      winRatePct: Number(winRate.toFixed(1)),
    };

    // A. Échantillon insuffisant (< 30 trades) -> INSUFFICIENT_DATA (Jamais bloqué)
    if (count < 30) {
      return {
        status: "INSUFFICIENT_DATA",
        isBlocked: false,
        riskMultiplier: 1.0,
        reason: `Échantillon insuffisant (${count}/30 trades sur ${symbol} ${strategy} ${strategyVersion} à ${hourUtc}h UTC)`,
        stats: statsObj,
        shadowModeActive: false,
        observationMode,
      };
    }

    // B. Statut BLOCKED (50+ trades, PF < 0.80 et ExpectancyR < 0)
    if (count >= 50 && pf < 0.80 && avgR < 0) {
      const isBlocked = observationMode ? false : true;
      return {
        status: "BLOCKED",
        isBlocked,
        riskMultiplier: 0.0,
        reason: `${observationMode ? '[OBSERVATION] WOULD_BE_BLOCKED' : 'BLOCKED'} : ${symbol} (${strategy} ${strategyVersion}) à ${hourUtc}h UTC — PF ${pf.toFixed(2)}, ExpR ${avgR.toFixed(2)} sur ${count} trades`,
        stats: statsObj,
        shadowModeActive: true,
        observationMode,
      };
    }

    // C. Statut CAUTION (30-49 trades, PF < 0.80 et ExpectancyR < 0)
    if (count >= 30 && pf < 0.80 && avgR < 0) {
      return {
        status: "CAUTION",
        isBlocked: false,
        riskMultiplier: 0.50,
        reason: `CAUTION (Risque x0.50) : ${symbol} (${strategy} ${strategyVersion}) à ${hourUtc}h UTC — PF ${pf.toFixed(2)} sur ${count} trades`,
        stats: statsObj,
        shadowModeActive: false,
        observationMode,
      };
    }

    // D. Statut ACTIVE
    return {
      status: "ACTIVE",
      isBlocked: false,
      riskMultiplier: 1.0,
      reason: `ACTIVE : ${symbol} (${strategy} ${strategyVersion}) à ${hourUtc}h UTC — PF ${pf.toFixed(2)}, ExpR +${avgR.toFixed(2)} sur ${count} trades`,
      stats: statsObj,
      shadowModeActive: false,
      observationMode,
    };
  } catch (e) {
    // Fallback permissif
    return {
      status: "INSUFFICIENT_DATA",
      isBlocked: false,
      riskMultiplier: 1.0,
      reason: "Erreur lecture stats horaire — fallback permissif",
      stats: { trades: 0, profitFactor: 1.0, expectancyR: 0, winRatePct: 0 },
      shadowModeActive: false,
      observationMode,
    };
  }
}

/**
 * Vérifie si un créneau bloqué peut être réactivé via l'historique des trades Shadow.
 */
function checkShadowReactivation(symbol: string, strategy: string, strategyVersion: string, hourUtc: number): {
  reactivated: boolean; trades: number; pf: number; expR: number; winRate: number;
} {
  const db = getDb();
  try {
    const row = db.prepare(`
      SELECT COUNT(*) as count,
             SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN status='won' THEN virtual_pnl ELSE 0 END) as gross_win,
             SUM(CASE WHEN status='lost' THEN ABS(virtual_pnl) ELSE 0 END) as gross_loss,
             AVG(r_multiple) as avg_r
      FROM shadow_trades
      WHERE symbol = ? AND strategy = ? AND strategy_version = ?
        AND CAST(strftime('%H', datetime(time/1000, 'unixepoch')) AS INTEGER) = ?
        AND status IN ('won', 'lost')
    `).get(symbol, strategy, strategyVersion, hourUtc) as {
      count: number; wins: number; gross_win: number; gross_loss: number; avg_r: number;
    } | undefined;

    if (!row || row.count < 30) {
      return { reactivated: false, trades: row?.count || 0, pf: 0, expR: 0, winRate: 0 };
    }

    const pf = row.gross_loss > 0 ? row.gross_win / row.gross_loss : row.gross_win > 0 ? 99 : 0;
    const expR = row.avg_r || 0;
    const winRate = (row.wins / row.count) * 100;

    if (pf >= 1.05 && expR > 0) {
      return { reactivated: true, trades: row.count, pf, expR, winRate };
    }
  } catch { /* fallback */ }

  return { reactivated: false, trades: 0, pf: 0, expR: 0, winRate: 0 };
}

/**
 * Enregistre un trade virtuel en mode Shadow.
 */
export function recordShadowTrade(trade: {
  userId: number;
  preset: string;
  strategy: string;
  strategyVersion: string;
  symbol: string;
  direction: string;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  score: number;
  exitPrice: number;
  virtualPnL: number;
  rMultiple: number;
  status: "won" | "lost";
  exitReason: string;
}): void {
  const db = getDb();
  const id = `SHADOW_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();

  try {
    db.prepare(`
      INSERT INTO shadow_trades (
        id, user_id, preset, strategy, strategy_version, symbol, direction,
        entry_price, stop_loss, take_profit, virtual_exit_price, virtual_pnl,
        r_multiple, status, score, time, closed_at, exit_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, trade.userId, trade.preset, trade.strategy, trade.strategyVersion, trade.symbol, trade.direction,
      trade.entryPrice, trade.stopLoss || null, trade.takeProfit || null, trade.exitPrice, trade.virtualPnL,
      trade.rMultiple, trade.status, trade.score, now - 60000, now, trade.exitReason
    );
  } catch (e) {
    console.error("[ShadowTrade Error]:", (e as Error).message);
  }
}
