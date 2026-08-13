/**
 * Passive observation of valid signals rejected by risk controls.
 * This module never creates an order, changes a configuration, or feeds a
 * result back into risk sizing. Its P&L is a marked-to-market hypothesis only.
 */
import { getDb } from "./db.server";
import { fetchRecentTicksServer } from "./deriv.server";

export const SHADOW_RISK_REASONS = new Set([
  "RISK_LOSS_STREAK",
  "RISK_DAILY_DD",
  "STRATEGY_AUTO_SHADOW",
]);

export function shouldObserveRiskRejection(reason: string | undefined): boolean {
  return !!reason && SHADOW_RISK_REASONS.has(reason);
}

export async function recordRiskShadowObservation(input: {
  userId: number; preset: string; strategy: string; strategyVersion: string;
  symbol: string; direction: "CALL" | "PUT" | "BUY" | "SELL";
  score: number; reason: string; notionalStake: number; holdMinutes: number;
}): Promise<void> {
  if (!shouldObserveRiskRejection(input.reason)) return;
  const ticks = await fetchRecentTicksServer(input.symbol, 1).catch(() => []);
  const entryPrice = ticks.at(-1);
  if (!entryPrice || !Number.isFinite(entryPrice)) return;
  const now = Date.now();
  const id = `risk_shadow_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const evaluationAt = now + Math.max(1, Math.min(input.holdMinutes, 60)) * 60_000;
  getDb().prepare(`
    INSERT INTO shadow_trades (
      id, user_id, preset, strategy, strategy_version, symbol, direction,
      entry_price, status, score, time, block_reason, evaluation_at, notional_stake
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
  `).run(id, input.userId, input.preset, input.strategy, input.strategyVersion,
    input.symbol, input.direction, entryPrice, input.score, now, input.reason,
    evaluationAt, Math.max(0, input.notionalStake));
}

/** Close observations due for marking. Deliberately uses direction-only R:
 * +1R / -1R and the rejected notional as a transparent, broker-independent
 * hypothetical P&L. */
export async function settleDueRiskShadowObservations(): Promise<void> {
  const rows = getDb().prepare(`
    SELECT id, symbol, direction, entry_price, notional_stake
    FROM shadow_trades
    WHERE status = 'open' AND block_reason IN ('RISK_LOSS_STREAK', 'RISK_DAILY_DD', 'STRATEGY_AUTO_SHADOW')
      AND evaluation_at IS NOT NULL AND evaluation_at <= ?
    ORDER BY evaluation_at ASC LIMIT 50
  `).all(Date.now()) as Array<{ id: string; symbol: string; direction: string; entry_price: number; notional_stake: number | null }>;
  for (const row of rows) {
    const ticks = await fetchRecentTicksServer(row.symbol, 1).catch(() => []);
    const exit = ticks.at(-1);
    if (!exit || !Number.isFinite(exit)) continue;
    const long = row.direction === "CALL" || row.direction === "BUY";
    const won = long ? exit > row.entry_price : exit < row.entry_price;
    const r = won ? 1 : -1;
    const stake = Math.max(0, row.notional_stake ?? 0);
    getDb().prepare(`
      UPDATE shadow_trades SET virtual_exit_price = ?, virtual_pnl = ?, r_multiple = ?,
        status = ?, closed_at = ?, exit_reason = 'HOLD_EXPIRY'
      WHERE id = ? AND status = 'open'
    `).run(exit, r * stake, r, won ? "won" : "lost", Date.now(), row.id);
  }
}
