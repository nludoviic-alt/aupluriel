process.env.DB_PATH = ":memory:";
import assert from "node:assert/strict";
import test from "node:test";
const { getDb } = await import("../db.server");
const { persistTradeAndRiskOutcome } = await import("../bot-engine.server");

function user() {
  return Number(
    getDb()
      .prepare("INSERT INTO users(email,username,password_hash,status) VALUES(?,?,'x','approved')")
      .run(`${crypto.randomUUID()}@example.invalid`, crypto.randomUUID()).lastInsertRowid,
  );
}

test("execution-cost probes are migrated and persisted on settlement", () => {
  const cols = new Set((getDb().prepare("PRAGMA table_info(bot_trades)").all() as { name: string }[]).map((c) => c.name));
  for (const c of ["first_tick_profit", "first_tick_delay_ms", "profit_at_1m"]) assert.ok(cols.has(c), c);

  const uid = user();
  const now = Date.now();
  const log = {
    id: crypto.randomUUID(), time: now - 90_000, closedAt: now, symbol: "1HZ50V", direction: "MULTUP" as const,
    stake: 2, payout: 0, status: "lost" as const, profit: -0.5, confidence: 80, tfAgreement: 4,
    strategy: "FLUX24_ENGINE", firstTickProfit: -0.03, firstTickDelayMs: 1200, profitAt1m: -0.07,
  };
  persistTradeAndRiskOutcome(uid, "flux24", log, "demo");
  const row = getDb().prepare("SELECT first_tick_profit a, first_tick_delay_ms b, profit_at_1m c FROM bot_trades WHERE id = ?").get(log.id) as { a: number; b: number; c: number };
  assert.deepEqual(row, { a: -0.03, b: 1200, c: -0.07 });
});
