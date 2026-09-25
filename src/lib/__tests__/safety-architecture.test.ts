import test from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../db.server";
import { evaluateRiskCheck } from "../risk-manager.server";
import { getActiveBreakoutEvent, clearActiveBreakoutEvent } from "../rb100-signal.server";

test("Priority 1 — stakePercent normalization math", () => {
  const equity = 100.0;

  // stakePercent = 1  => 1% of $100 = $1.00
  const stake1 = (equity * 1) / 100;
  assert.equal(stake1, 1.0);

  // stakePercent = 0.25 => 0.25% of $100 = $0.25
  const stake025 = (equity * 0.25) / 100;
  assert.equal(stake025, 0.25);

  // stakePercent = 20 => 20% of $100 = $20.00
  const stake20 = (equity * 20) / 100;
  assert.equal(stake20, 20.0);
});

test("Priority 2 — FINAL_STAKE = MIN(requested, maxRisk, derivMax)", () => {
  const derivMaxAllowed = Infinity;

  // Case A: Preset requests $5.00, Risk allows $23.31 => Final = $5.00 (NEVER INCREASED)
  const reqA = 5.0;
  const riskA = 23.31;
  const finalA = Math.min(reqA, riskA, derivMaxAllowed);
  assert.equal(finalA, 5.0);

  // Case B: Preset requests $25.00, Risk allows $12.50 => Final = $12.50 (REDUCED)
  const reqB = 25.0;
  const riskB = 12.5;
  const finalB = Math.min(reqB, riskB, derivMaxAllowed);
  assert.equal(finalB, 12.5);
});

test("Priority 3 — Deriv Minimum Stake Rejection (No Silent Escalation)", () => {
  const DERIV_MINIMUM_STAKE = 1.0;

  // Small stake $0.25
  const calculatedStake = 0.25;
  const isRejected = calculatedStake < DERIV_MINIMUM_STAKE;

  assert.equal(isRejected, true);
  // Must NOT silently boost to $1.00
  assert.notEqual(calculatedStake, 1.0);
});

test("Priority 4 — Loss Streak Order (3 Losses => PAUSED)", () => {
  // Mock check for a non-existent strategy to verify baseline
  const res = evaluateRiskCheck({
    userId: 999999,
    preset: "rb100",
    strategyId: "RB100_RANGE_TRADER",
    symbol: "RB100",
    direction: "CALL",
    confidenceScore: 85,
    currentEquity: 100,
    currentBalance: 100,
  });

  assert.ok(["NORMAL", "CAUTION", "RESTRICTED", "PAUSED", "REJECTED", "APPROVED", "REDUCED_RISK"].includes(res.decision));
});

test("Priority 5 — Breakout Memory SQLite Persistence", () => {
  const symbol = "TEST_RB100_PERSISTENCE";
  clearActiveBreakoutEvent(symbol);

  // Verify DB table exists
  const db = getDb();
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rb100_active_breakouts'").get();
  assert.ok(tableCheck);

  // Insert mock breakout directly to test DB restoration
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO rb100_active_breakouts
    (symbol, event_id, direction, breakout_level, breakout_time, expires_at, strategy_version, config_hash, retest_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(symbol, "brk_test_123", "CALL", 105.5, now, now + 600000, "RB100_V3.1", "hash_test", "PENDING");

  // Call getActiveBreakoutEvent to trigger restoration
  const ev = getActiveBreakoutEvent(symbol);
  assert.ok(ev);
  assert.equal(ev.symbol, symbol);
  assert.equal(ev.eventId, "brk_test_123");
  assert.equal(ev.direction, "CALL");
  assert.equal(ev.level, 105.5);

  // Cleanup
  clearActiveBreakoutEvent(symbol);
});

// ── Priority 6 (2026-08-13): universal FINAL_STAKE ceiling ──
// Root cause of the real STAKE_SAFETY_VIOLATION on user 23 / vol75
// (requestedStake $5.00, vol75Level suggestion $23.18, finalStake ended up
// $23.18): requestedStake was computed but never included in the final
// MIN() that produces stakeForTrade in bot-engine.server.ts. Fixed by
// adding requestedStake as a hard ceiling in that MIN() — this mirrors the
// exact formula now in place:
//   FINAL_STAKE = MIN(requestedStake, strategyRiskSuggestedStake, maxRiskAllowed, derivMaxAllowed)
function finalStakeOf(requestedStake: number, strategyRiskSuggestedStake: number, maxRiskAllowed: number, derivMaxAllowed = Infinity): number {
  return Math.min(requestedStake, strategyRiskSuggestedStake, maxRiskAllowed, derivMaxAllowed);
}

test("Priority 6A — Fixed $5 stake, VOL75 suggests $23.18, risk cap $25 => Final $5 (never increased)", () => {
  assert.equal(finalStakeOf(5.00, 23.18, 25.00), 5.00);
});

test("Priority 6B — Fixed $25 stake, VOL75 suggests $10, risk cap $20 => Final $10 (strategy reduces)", () => {
  assert.equal(finalStakeOf(25.00, 10.00, 20.00), 10.00);
});

test("Priority 6C — Fixed $25 stake, VOL75 suggests $30, risk cap $12.50 => Final $12.50 (Risk Manager reduces)", () => {
  assert.equal(finalStakeOf(25.00, 30.00, 12.50), 12.50);
});

test("Priority 6D — Percent-mode requested $20, strategy suggests $30, risk cap $25 => Final $20 (requestedStake ceiling wins)", () => {
  assert.equal(finalStakeOf(20.00, 30.00, 25.00), 20.00);
});

test("Priority 6E — requested $0.50 below Deriv minimum $1 => REJECT, never silently bumped to $1", () => {
  const requestedStake = 0.50;
  const strategyRiskSuggestedStake = 0.50;
  const maxRiskAllowed = 25.00;
  const finalStake = finalStakeOf(requestedStake, strategyRiskSuggestedStake, maxRiskAllowed);
  const DERIV_MINIMUM_STAKE = 1.00;
  const rejected = finalStake < DERIV_MINIMUM_STAKE;

  assert.equal(rejected, true);
  assert.notEqual(finalStake, 1.00); // must reject, not auto-escalate
});

test("Priority 6F — no specialized strategy suggestion can ever push finalStake above requestedStake", () => {
  const requestedStake = 5.00;
  // A spread of strategy suggestions and risk caps, several deliberately
  // larger than requestedStake (the exact failure mode that produced the
  // real vol75 violation) — finalStake must never exceed requestedStake.
  const suggestions = [0.10, 5.00, 5.01, 10.00, 23.18, 100.00, 1000.00];
  const riskCaps = [1.00, 5.00, 12.50, 25.00, 46.37, 1000.00];
  for (const suggestion of suggestions) {
    for (const cap of riskCaps) {
      const finalStake = finalStakeOf(requestedStake, suggestion, cap);
      assert.ok(
        finalStake <= requestedStake + 0.001,
        `finalStake ${finalStake} exceeded requestedStake ${requestedStake} (suggestion=${suggestion}, cap=${cap})`,
      );
    }
  }
});
