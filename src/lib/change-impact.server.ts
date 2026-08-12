import { getDb } from "./db.server";
import { summarize, type Summary } from "./analytics";
import type { TradeLog } from "./autotrader";

export interface ChangeImpactComparison {
  versionId: string;
  versionTag: string;
  preset: string;
  userId: number;
  timestamp: number;
  changeSummary: string;
  windowSize: number;
  tradesBefore: number;
  tradesAfter: number;
  beforeStats: Summary;
  afterStats: Summary;
  delta: {
    winRate: number;
    profitFactor: number;
    expectancyUsd: number;
    maxDrawdownUsd: number;
    totalPnlUsd: number;
  };
  verdict: "IMPROVED" | "DEGRADED" | "NEUTRAL" | "INSUFFICIENT_DATA";
}

export class ChangeImpactTracker {
  /**
   * Compares N trades right before vs N trades right after a given strategy config version edit.
   */
  static analyzeImpact(opts: {
    userId: number;
    preset: string;
    versionId: string;
    windowSize?: number;
  }): ChangeImpactComparison | null {
    const { userId, preset, versionId, windowSize = 20 } = opts;
    const db = getDb();

    const versionRow = db
      .prepare("SELECT * FROM config_versions WHERE id = ? AND user_id = ? AND preset = ?")
      .get(versionId, userId, preset) as any;

    if (!versionRow) return null;

    const changeTime = versionRow.created_at;

    // Fetch up to windowSize trades strictly BEFORE changeTime
    const rawBefore = db
      .prepare(`
        SELECT * FROM bot_trades 
        WHERE user_id = ? AND preset = ? AND time < ? AND status IN ('won', 'lost')
        ORDER BY time DESC LIMIT ?
      `)
      .all(userId, preset, changeTime, windowSize) as any[];

    // Fetch up to windowSize trades strictly AFTER changeTime
    const rawAfter = db
      .prepare(`
        SELECT * FROM bot_trades 
        WHERE user_id = ? AND preset = ? AND time >= ? AND status IN ('won', 'lost')
        ORDER BY time ASC LIMIT ?
      `)
      .all(userId, preset, changeTime, windowSize) as any[];

    const tradesBefore: TradeLog[] = rawBefore.map(mapDbTradeToLog);
    const tradesAfter: TradeLog[] = rawAfter.map(mapDbTradeToLog);

    const beforeStats = summarize(tradesBefore);
    const afterStats = summarize(tradesAfter);

    const deltaWinRate = afterStats.winRate - beforeStats.winRate;
    const deltaPF = afterStats.profitFactor - beforeStats.profitFactor;
    const deltaExp = afterStats.expectancyUsd - beforeStats.expectancyUsd;
    const deltaDD = afterStats.maxDrawdownUsd - beforeStats.maxDrawdownUsd;
    const deltaPnl = afterStats.totalPnlUsd - beforeStats.totalPnlUsd;

    let verdict: "IMPROVED" | "DEGRADED" | "NEUTRAL" | "INSUFFICIENT_DATA" = "NEUTRAL";
    if (tradesAfter.length < 5) {
      verdict = "INSUFFICIENT_DATA";
    } else if (deltaPF >= 0.25 || deltaExp >= 1.0) {
      verdict = "IMPROVED";
    } else if (deltaPF <= -0.25 || deltaExp <= -1.0) {
      verdict = "DEGRADED";
    }

    return {
      versionId,
      versionTag: versionRow.version_tag,
      preset,
      userId,
      timestamp: changeTime,
      changeSummary: versionRow.change_summary || "Modification de configuration",
      windowSize,
      tradesBefore: tradesBefore.length,
      tradesAfter: tradesAfter.length,
      beforeStats,
      afterStats,
      delta: {
        winRate: Number(deltaWinRate.toFixed(4)),
        profitFactor: Number(deltaPF.toFixed(2)),
        expectancyUsd: Number(deltaExp.toFixed(2)),
        maxDrawdownUsd: Number(deltaDD.toFixed(2)),
        totalPnlUsd: Number(deltaPnl.toFixed(2)),
      },
      verdict,
    };
  }
}

function mapDbTradeToLog(r: any): TradeLog {
  return {
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
    contractId: r.contract_id ?? undefined,
    closedAt: r.closed_at ?? undefined,
    note: r.note ?? undefined,
    strategy: r.strategy ?? undefined,
    entryPrice: r.entry_price ?? undefined,
    durationMinutes: r.duration_minutes ?? undefined,
    expiry: r.expiry ?? undefined,
    components: r.components ? JSON.parse(r.components) : undefined,
    multiplier: r.multiplier ?? undefined,
    stopLossUsd: r.stop_loss ?? undefined,
    takeProfitUsd: r.take_profit ?? undefined,
    mode: r.mode ?? undefined,
    preset: r.preset ?? undefined,
  };
}
