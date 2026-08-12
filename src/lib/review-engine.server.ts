import { getDb } from "./db.server";
import { summarize, type Summary } from "./analytics";
import type { TradeLog } from "./autotrader";

export interface ReviewReportSummary {
  reportId: string;
  periodType: "daily" | "weekly";
  periodStart: number;
  periodEnd: number;
  userId: number;
  preset: string;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number;
  expectancyUsd: number;
  maxDrawdownUsd: number;
  totalPnlUsd: number;
  bestSymbol: string | null;
  worstSymbol: string | null;
  topRejectionReasons: Array<{ reason: string; count: number }>;
}

export class ReviewEngine {
  /**
   * Generates and stores a daily or weekly performance review report for a user + preset.
   */
  static generateReport(opts: {
    userId: number;
    preset: string;
    periodType: "daily" | "weekly";
    startTime?: number;
    endTime?: number;
  }): ReviewReportSummary {
    const { userId, preset, periodType } = opts;
    const db = getDb();
    const now = Date.now();

    let start = opts.startTime;
    let end = opts.endTime ?? now;

    if (!start) {
      if (periodType === "daily") {
        start = now - 24 * 3600 * 1000;
      } else {
        start = now - 7 * 24 * 3600 * 1000;
      }
    }

    // 1. Fetch trades in period
    const rawTrades = db
      .prepare(`
        SELECT * FROM bot_trades 
        WHERE user_id = ? AND preset = ? AND time >= ? AND time <= ? AND status IN ('won', 'lost')
        ORDER BY time ASC
      `)
      .all(userId, preset, start, end) as any[];

    const trades: TradeLog[] = rawTrades.map((r) => ({
      id: r.id,
      time: r.time,
      symbol: r.symbol,
      direction: r.direction,
      stake: r.stake,
      payout: r.payout,
      status: r.status,
      profit: r.profit,
      confidence: r.confidence,
      tfAgreement: r.tf_agreement,
      preset: r.preset,
    }));

    const stats: Summary = summarize(trades);

    // 2. Compute symbol breakdown
    const symbolMap = new Map<string, number>();
    for (const t of trades) {
      const current = symbolMap.get(t.symbol) ?? 0;
      symbolMap.set(t.symbol, current + t.profit);
    }

    let bestSymbol: string | null = null;
    let bestPnl = -Infinity;
    let worstSymbol: string | null = null;
    let worstPnl = Infinity;

    for (const [sym, pnl] of symbolMap.entries()) {
      if (pnl > bestPnl) {
        bestPnl = pnl;
        bestSymbol = sym;
      }
      if (pnl < worstPnl) {
        worstPnl = pnl;
        worstSymbol = sym;
      }
    }

    // 3. Fetch top signal rejections in period
    const rejections = db
      .prepare(`
        SELECT reason, COUNT(*) as cnt 
        FROM signal_rejections 
        WHERE user_id = ? AND preset = ? AND time >= ? AND time <= ?
        GROUP BY reason 
        ORDER BY cnt DESC 
        LIMIT 5
      `)
      .all(userId, preset, start, end) as { reason: string; cnt: number }[];

    const reportId = `rev_${periodType}_${preset}_${userId}_${now}`;

    const summary: ReviewReportSummary = {
      reportId,
      periodType,
      periodStart: start,
      periodEnd: end,
      userId,
      preset,
      totalTrades: stats.trades,
      winCount: stats.wins,
      lossCount: stats.losses,
      winRate: Number(stats.winRate.toFixed(4)),
      profitFactor: Number(stats.profitFactor.toFixed(2)),
      expectancyUsd: Number(stats.expectancy.toFixed(2)),
      maxDrawdownUsd: Number((stats.worstTrade || 0).toFixed(2)),
      totalPnlUsd: Number(stats.netPnl.toFixed(2)),
      bestSymbol: bestSymbol ? `${bestSymbol} (+$${bestPnl.toFixed(2)})` : null,
      worstSymbol: worstSymbol ? `${worstSymbol} ($${worstPnl.toFixed(2)})` : null,
      topRejectionReasons: rejections.map((r) => ({ reason: r.reason, count: r.cnt })),
    };

    // 4. Save to SQLite
    db.prepare(`
      INSERT INTO performance_reviews (id, period_type, period_start, period_end, user_id, preset, summary_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(reportId, periodType, start, end, userId, preset, JSON.stringify(summary));

    return summary;
  }

  /**
   * Retrieves stored review reports.
   */
  static getReports(userId: number, preset: string, periodType?: "daily" | "weekly", limit = 20): ReviewReportSummary[] {
    const db = getDb();
    let rows: any[];
    if (periodType) {
      rows = db
        .prepare(`
          SELECT summary_json FROM performance_reviews 
          WHERE user_id = ? AND preset = ? AND period_type = ? 
          ORDER BY period_start DESC LIMIT ?
        `)
        .all(userId, preset, periodType, limit);
    } else {
      rows = db
        .prepare(`
          SELECT summary_json FROM performance_reviews 
          WHERE user_id = ? AND preset = ? 
          ORDER BY period_start DESC LIMIT ?
        `)
        .all(userId, preset, limit);
    }

    return rows.map((r) => JSON.parse(r.summary_json));
  }
}
