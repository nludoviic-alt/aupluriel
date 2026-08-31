import assert from "node:assert/strict";
import test from "node:test";
import { getDb } from "../db.server";
import { getAutoAdaptivePauseRecovery, getPresetRiskMetrics } from "../risk-manager.server";

let nextUserId = 700_000;

function makeTestUser(label: string): number {
  const db = getDb();
  const email = `test-pause-recovery-${label}-${nextUserId}@example.invalid`;
  db.prepare(
    "INSERT INTO users (email, username, password_hash, status) VALUES (?, ?, 'x', 'approved')",
  ).run(email, `test-pause-recovery-${label}-${nextUserId}`);
  const { id } = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number };
  nextUserId++;
  return id;
}

const PRESET = "vol75";
const STRATEGY = "VOL75_1S_TREND_PULLBACK";

/** Real trades: `losers` losses then `winners` wins — PF is fully controlled by
 * the profit magnitudes below (win 1, loss 3 => 50 trades at 10W/40L => PF far
 * under 0.70, the auto-adaptive PAUSE threshold). */
function seedRealTrades(userId: number, winners: number, losers: number) {
  const db = getDb();
  let t = Date.now() - 60 * 60_000;
  const ins = db.prepare(`
    INSERT INTO bot_trades (id, user_id, time, symbol, direction, stake, status, profit, strategy, preset)
    VALUES (?, ?, ?, '1HZ75V', 'CALL', 5, ?, ?, ?, ?)
  `);
  for (let i = 0; i < losers; i++) ins.run(`r_${userId}_l_${i}`, userId, t++, "lost", -3, STRATEGY, PRESET);
  for (let i = 0; i < winners; i++) ins.run(`r_${userId}_w_${i}`, userId, t++, "won", 1, STRATEGY, PRESET);
}

function seedShadowTrades(
  userId: number,
  winners: number,
  losers: number,
  ageMs = 60 * 60_000,
) {
  const db = getDb();
  const base = Date.now() - ageMs;
  const ins = db.prepare(`
    INSERT INTO shadow_trades (id, user_id, preset, strategy, symbol, direction, entry_price, virtual_pnl, status, time, closed_at, block_reason)
    VALUES (?, ?, ?, ?, '1HZ75V', 'CALL', 100, ?, ?, ?, ?, 'RISK_PRESET_PAUSED')
  `);
  let n = 0;
  for (let i = 0; i < winners; i++)
    ins.run(`s_${userId}_w_${i}`, userId, PRESET, STRATEGY, 2, "won", base + n, base + n++ + 1);
  for (let i = 0; i < losers; i++)
    ins.run(`s_${userId}_l_${i}`, userId, PRESET, STRATEGY, -1, "lost", base + n, base + n++ + 1);
}

function cleanup(userId: number) {
  const db = getDb();
  db.prepare("DELETE FROM shadow_trades WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM bot_trades WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

test("paused preset with no shadow data stays PAUSED", () => {
  const userId = makeTestUser("nodata");
  try {
    seedRealTrades(userId, 10, 40); // PF ~0.08
    const m = getPresetRiskMetrics(userId, PRESET);
    assert.equal(m.status, "PAUSED");
    assert.equal(m.stakeMultiplier, 0);
  } finally {
    cleanup(userId);
  }
});

test("fresh shadow recovery (>=25 trades, PF>=1.1) grants supervised re-entry at 50% stake", () => {
  const userId = makeTestUser("recovered");
  try {
    seedRealTrades(userId, 10, 40);
    // 20 wins (+2 each = +40) / 8 losses (-1 each = -8) => shadow PF 5.0, n=28
    seedShadowTrades(userId, 20, 8);
    const rec = getAutoAdaptivePauseRecovery(userId, PRESET);
    assert.equal(rec.eligible, true);
    assert.equal(rec.shadowSample, 28);
    const m = getPresetRiskMetrics(userId, PRESET);
    assert.equal(m.status, "RESTRICTED");
    assert.equal(m.stakeMultiplier, 0.5);
    assert.match(m.reason ?? "", /Réactivation supervisée/);
  } finally {
    cleanup(userId);
  }
});

test("shadow sample too small stays PAUSED", () => {
  const userId = makeTestUser("small");
  try {
    seedRealTrades(userId, 10, 40);
    seedShadowTrades(userId, 10, 2); // n=12 < 25
    assert.equal(getAutoAdaptivePauseRecovery(userId, PRESET).eligible, false);
    assert.equal(getPresetRiskMetrics(userId, PRESET).status, "PAUSED");
  } finally {
    cleanup(userId);
  }
});

test("shadow PF below 1.1 stays PAUSED", () => {
  const userId = makeTestUser("weakpf");
  try {
    seedRealTrades(userId, 10, 40);
    // 15 wins (+2 = +30) / 15 losses (-3 = -45) => PF 0.67
    const db = getDb();
    const base = Date.now() - 60_000;
    const ins = db.prepare(`
      INSERT INTO shadow_trades (id, user_id, preset, strategy, symbol, direction, entry_price, virtual_pnl, status, time, closed_at, block_reason)
      VALUES (?, ?, ?, ?, '1HZ75V', 'CALL', 100, ?, ?, ?, ?, 'RISK_PRESET_PAUSED')
    `);
    for (let i = 0; i < 15; i++) ins.run(`s_${userId}_w_${i}`, userId, PRESET, STRATEGY, 2, "won", base + i, base + i);
    for (let i = 0; i < 15; i++) ins.run(`s_${userId}_l_${i}`, userId, PRESET, STRATEGY, -3, "lost", base + 100 + i, base + 100 + i);
    assert.equal(getAutoAdaptivePauseRecovery(userId, PRESET).eligible, false);
    assert.equal(getPresetRiskMetrics(userId, PRESET).status, "PAUSED");
  } finally {
    cleanup(userId);
  }
});

test("stale shadow sample (older than the recency window) stays PAUSED", () => {
  const userId = makeTestUser("stale");
  try {
    seedRealTrades(userId, 10, 40);
    seedShadowTrades(userId, 20, 8, 6 * 24 * 60 * 60_000); // 6 days old
    assert.equal(getAutoAdaptivePauseRecovery(userId, PRESET).eligible, false);
    assert.equal(getPresetRiskMetrics(userId, PRESET).status, "PAUSED");
  } finally {
    cleanup(userId);
  }
});
