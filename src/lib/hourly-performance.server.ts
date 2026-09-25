/**
 * Module Hourly Performance & Heatmap Data Aggregator (Phase 2 - Spécification 70 Points).
 * Agrège les performances historiques par (SYMBOL + STRATEGY + STRATEGY_VERSION + HOUR_UTC).
 * Génère la matrice 24xN pour la Heatmap UI (GREEN / YELLOW / RED / GREY).
 */

import { getDb } from "./db.server";
import { FEATURE_FLAGS } from "./feature-flags.server";

export interface HourlyHeatmapCell {
  hourUtc: number;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number;
  expectancyR: number;
  status: "INSUFFICIENT_DATA" | "ACTIVE" | "CAUTION" | "BLOCKED";
  wouldBeStatus: "WOULD_BE_ACTIVE" | "WOULD_BE_CAUTION" | "WOULD_BE_BLOCKED" | "INSUFFICIENT_DATA";
  color: "GREY" | "GREEN" | "YELLOW" | "RED";
}

export interface StrategyHourlyMatrix {
  preset: string;
  strategy: string;
  strategyVersion: string;
  symbol: string;
  totalTrades: number;
  totalPnl: number;
  overallProfitFactor: number;
  overallExpectancyR: number;
  hours: HourlyHeatmapCell[];
}

/**
 * Recalcule et sauvegarde les statistiques horaires dans `hourly_performance_stats`.
 */
export function syncHourlyPerformanceStats(): void {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT symbol,
             COALESCE(strategy, preset, 'UNKNOWN') as strategy,
             COALESCE(strategy_version, 'V1') as strategy_version,
             CAST(strftime('%H', datetime(time/1000, 'unixepoch')) AS INTEGER) as hour_utc,
             COUNT(*) as trades,
             SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as wins,
             SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) as losses,
             SUM(CASE WHEN status='won' THEN profit ELSE 0 END) as gross_profit,
             SUM(CASE WHEN status='lost' THEN ABS(profit) ELSE 0 END) as gross_loss,
             SUM(profit) as net_pnl,
             AVG(COALESCE(r_multiple, CASE WHEN status='won' THEN 1.0 ELSE -1.0 END)) as avg_r
      FROM bot_trades
      WHERE status IN ('won', 'lost')
      GROUP BY symbol, strategy, strategy_version, hour_utc
    `).all() as any[];

    const insertStmt = db.prepare(`
      INSERT INTO hourly_performance_stats (
        symbol, strategy, strategy_version, hour_utc, trades, wins, losses,
        win_rate, gross_profit, gross_loss, net_pnl, profit_factor, expectancy_r, average_r, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(symbol, strategy, strategy_version, hour_utc) DO UPDATE SET
        trades = excluded.trades,
        wins = excluded.wins,
        losses = excluded.losses,
        win_rate = excluded.win_rate,
        gross_profit = excluded.gross_profit,
        gross_loss = excluded.gross_loss,
        net_pnl = excluded.net_pnl,
        profit_factor = excluded.profit_factor,
        expectancy_r = excluded.expectancy_r,
        average_r = excluded.average_r,
        status = excluded.status,
        updated_at = unixepoch()
    `);

    for (const r of rows) {
      const trades = r.trades || 0;
      const wins = r.wins || 0;
      const grossProfit = r.gross_profit || 0;
      const grossLoss = r.gross_loss || 0;
      const netPnl = r.net_pnl || 0;
      const avgR = r.avg_r || 0;

      const winRate = trades > 0 ? (wins / trades) * 100 : 0;
      const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

      let status = "INSUFFICIENT_DATA";
      if (trades >= 50 && pf < 0.80 && avgR < 0) {
        status = "BLOCKED";
      } else if (trades >= 30 && pf < 0.80 && avgR < 0) {
        status = "CAUTION";
      } else if (trades >= 30) {
        status = "ACTIVE";
      }

      insertStmt.run(
        r.symbol, r.strategy, r.strategy_version, r.hour_utc, trades, wins, r.losses || 0,
        Number(winRate.toFixed(1)), Number(grossProfit.toFixed(2)), Number(grossLoss.toFixed(2)),
        Number(netPnl.toFixed(2)), Number(pf.toFixed(2)), Number(avgR.toFixed(2)), Number(avgR.toFixed(2)),
        status
      );
    }
  } catch (e) {
    console.error("[syncHourlyPerformanceStats Error]:", (e as Error).message);
  }
}

/**
 * Récupère la matrice 24xN complète pour l'affichage de la Heatmap Horaire.
 */
export function getHourlyPerformanceHeatmap(presetFilter?: string): StrategyHourlyMatrix[] {
  syncHourlyPerformanceStats();
  const db = getDb();
  const observationMode = FEATURE_FLAGS.OBSERVATION_MODE;

  // Liste des combinaisons actives (symbol, strategy, version)
  let query = `
    SELECT DISTINCT symbol, strategy, strategy_version
    FROM hourly_performance_stats
  `;
  const params: any[] = [];

  const rows = db.prepare(query).all(...params) as { symbol: string; strategy: string; strategy_version: string }[];

  const result: StrategyHourlyMatrix[] = [];

  for (const row of rows) {
    const hourlyRows = db.prepare(`
      SELECT hour_utc, trades, wins, losses, win_rate, gross_profit, gross_loss, net_pnl, profit_factor, expectancy_r, status
      FROM hourly_performance_stats
      WHERE symbol = ? AND strategy = ? AND strategy_version = ?
    `).all(row.symbol, row.strategy, row.strategy_version) as any[];

    const map = new Map<number, any>();
    let totalTrades = 0;
    let totalPnl = 0;
    let totalWin = 0;
    let totalLoss = 0;
    let sumR = 0;

    for (const h of hourlyRows) {
      map.set(h.hour_utc, h);
      totalTrades += h.trades;
      totalPnl += h.net_pnl;
      totalWin += h.gross_profit;
      totalLoss += h.gross_loss;
      sumR += h.expectancy_r * h.trades;
    }

    const overallPf = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 99 : 0;
    const overallExpR = totalTrades > 0 ? sumR / totalTrades : 0;

    const hours: HourlyHeatmapCell[] = [];
    for (let h = 0; h < 24; h++) {
      const data = map.get(h);
      if (!data || data.trades === 0) {
        hours.push({
          hourUtc: h,
          trades: 0,
          wins: 0,
          losses: 0,
          winRatePct: 0,
          grossProfit: 0,
          grossLoss: 0,
          netPnl: 0,
          profitFactor: 0,
          expectancyR: 0,
          status: "INSUFFICIENT_DATA",
          wouldBeStatus: "INSUFFICIENT_DATA",
          color: "GREY",
        });
      } else {
        const trades = data.trades;
        const pf = data.profit_factor;
        const expR = data.expectancy_r;

        let rawStatus: "INSUFFICIENT_DATA" | "ACTIVE" | "CAUTION" | "BLOCKED" = "INSUFFICIENT_DATA";
        let wouldBeStatus: "WOULD_BE_ACTIVE" | "WOULD_BE_CAUTION" | "WOULD_BE_BLOCKED" | "INSUFFICIENT_DATA" = "INSUFFICIENT_DATA";
        let color: "GREY" | "GREEN" | "YELLOW" | "RED" = "GREY";

        if (trades < 30) {
          rawStatus = "INSUFFICIENT_DATA";
          wouldBeStatus = "INSUFFICIENT_DATA";
          color = "GREY";
        } else if (trades >= 50 && pf < 0.80 && expR < 0) {
          rawStatus = observationMode ? "ACTIVE" : "BLOCKED";
          wouldBeStatus = "WOULD_BE_BLOCKED";
          color = "RED";
        } else if (trades >= 30 && pf < 0.80 && expR < 0) {
          rawStatus = "CAUTION";
          wouldBeStatus = "WOULD_BE_CAUTION";
          color = "YELLOW";
        } else {
          rawStatus = "ACTIVE";
          wouldBeStatus = "WOULD_BE_ACTIVE";
          color = "GREEN";
        }

        hours.push({
          hourUtc: h,
          trades,
          wins: data.wins,
          losses: data.losses,
          winRatePct: data.win_rate,
          grossProfit: data.gross_profit,
          grossLoss: data.gross_loss,
          netPnl: data.net_pnl,
          profitFactor: pf,
          expectancyR: expR,
          status: rawStatus,
          wouldBeStatus,
          color,
        });
      }
    }

    result.push({
      preset: row.strategy.split("_")[0]?.toLowerCase() || "default",
      strategy: row.strategy,
      strategyVersion: row.strategy_version,
      symbol: row.symbol,
      totalTrades,
      totalPnl: Number(totalPnl.toFixed(2)),
      overallProfitFactor: Number(overallPf.toFixed(2)),
      overallExpectancyR: Number(overallExpR.toFixed(2)),
      hours,
    });
  }

  return result;
}
