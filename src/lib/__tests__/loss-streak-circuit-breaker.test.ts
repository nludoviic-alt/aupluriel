import assert from "node:assert/strict";
import test from "node:test";
import { getDb } from "../db.server";
import { setFeatureFlag } from "../feature-flags.server";
import { evaluateRiskCheck } from "../risk-manager.server";
import {
  evaluateLossStreakGate,
  getLossStreakState,
  recordTradeOutcome,
} from "../loss-streak-circuit-breaker.server";

let nextUserId = 500_000;

function makeTestUser(label: string): number {
  const db = getDb();
  const email = `test-loss-streak-${label}-${nextUserId}@example.invalid`;
  db.prepare(
    "INSERT INTO users (email, username, password_hash, status) VALUES (?, ?, 'x', 'approved')",
  ).run(email, `test-loss-streak-${label}-${nextUserId}`);
  const { id } = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number };
  nextUserId++;
  return id;
}

function insertTrade(userId: number, preset: string, strategy: string, status: "won" | "lost", time: number, profit = status === "won" ? 1 : -1) {
  getDb()
    .prepare(`
      INSERT INTO bot_trades (id, user_id, time, symbol, direction, stake, status, profit, strategy, preset)
      VALUES (?, ?, ?, 'TESTSYM', 'CALL', 1, ?, ?, ?, ?)
    `)
    .run(`trd_${userId}_${time}_${Math.random().toString(36).slice(2, 6)}`, userId, time, status, profit, strategy, preset);
}

function cleanup(userId: number) {
  const db = getDb();
  db.prepare("DELETE FROM loss_streak_state WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM bot_trades WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

test("A: 0 loss -> NORMAL, gate allows at full stake", () => {
  const userId = makeTestUser("a");
  try {
    const state = getLossStreakState(userId, "TEST_ENGINE");
    assert.equal(state.state, "NORMAL");
    const gate = evaluateLossStreakGate(userId, "TEST_ENGINE");
    assert.equal(gate.allow, true);
    assert.equal(gate.stakeMultiplier, 1.0);
  } finally {
    cleanup(userId);
  }
});

test("B/C: 1 then 2 losses stay NORMAL (no PAUSED before the 3rd)", () => {
  const userId = makeTestUser("bc");
  try {
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    assert.equal(getLossStreakState(userId, "TEST_ENGINE").state, "NORMAL");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    const state = getLossStreakState(userId, "TEST_ENGINE");
    assert.equal(state.state, "NORMAL");
    assert.equal(state.lossStreakCount, 2);
  } finally {
    cleanup(userId);
  }
});

test("D: 3rd consecutive loss triggers PAUSED with a future resume_at", () => {
  const userId = makeTestUser("d");
  try {
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    const state = getLossStreakState(userId, "TEST_ENGINE");
    assert.equal(state.state, "PAUSED");
    assert.equal(state.lossStreakCount, 3);
    assert.ok(state.resumeAt !== null && state.resumeAt > Date.now());
  } finally {
    cleanup(userId);
  }
});

test("E: PAUSED before resume_at rejects the next signal", () => {
  const userId = makeTestUser("e");
  try {
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    const gate = evaluateLossStreakGate(userId, "TEST_ENGINE");
    assert.equal(gate.allow, false);
    assert.equal(gate.reason, "RISK_LOSS_STREAK");
  } finally {
    cleanup(userId);
  }
});

test("F: PAUSED after resume_at has elapsed transitions to RECOVERY", () => {
  const userId = makeTestUser("f");
  try {
    // Seed a PAUSED row directly with a resume_at already in the past —
    // simulates a real strategy latched hours/days ago.
    const now = Date.now();
    const pastLoss = now - 60 * 60_000;
    insertTrade(userId, "test", "TEST_ENGINE", "lost", pastLoss - 2000);
    insertTrade(userId, "test", "TEST_ENGINE", "lost", pastLoss - 1000);
    insertTrade(userId, "test", "TEST_ENGINE", "lost", pastLoss);
    getDb()
      .prepare(`
        INSERT INTO loss_streak_state (user_id, strategy, state, loss_streak_count, paused_at, resume_at, recovery_trades_used, last_loss_at, updated_at)
        VALUES (?, 'TEST_ENGINE', 'PAUSED', 3, ?, ?, 0, ?, ?)
      `)
      .run(userId, pastLoss, pastLoss + 1000, pastLoss, now);
    const gate = evaluateLossStreakGate(userId, "TEST_ENGINE");
    assert.equal(gate.allow, true);
    assert.equal(gate.stakeMultiplier, 0.5);
    assert.equal(getLossStreakState(userId, "TEST_ENGINE").state, "RECOVERY");
  } finally {
    cleanup(userId);
  }
});

test("G: RECOVERY win returns to NORMAL with streak reset to 0", () => {
  const userId = makeTestUser("g");
  try {
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    // Force straight into RECOVERY without waiting on a real timer.
    getDb()
      .prepare("UPDATE loss_streak_state SET state = 'RECOVERY', recovery_trades_used = 0 WHERE user_id = ? AND strategy = ?")
      .run(userId, "TEST_ENGINE");
    const gateBefore = evaluateLossStreakGate(userId, "TEST_ENGINE");
    assert.equal(gateBefore.allow, true);
    assert.equal(gateBefore.stakeMultiplier, 0.5);

    recordTradeOutcome(userId, "TEST_ENGINE", "won");
    const state = getLossStreakState(userId, "TEST_ENGINE");
    assert.equal(state.state, "NORMAL");
    assert.equal(state.lossStreakCount, 0);
    assert.equal(state.recoveryTradesUsed, 0);
  } finally {
    cleanup(userId);
  }
});

test("H: RECOVERY loss escalates to streak 4 with a longer pause", () => {
  const userId = makeTestUser("h");
  try {
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    const pausedAfter3 = getLossStreakState(userId, "TEST_ENGINE");
    const pauseMs3 = pausedAfter3.resumeAt! - pausedAfter3.pausedAt!;

    getDb()
      .prepare("UPDATE loss_streak_state SET state = 'RECOVERY', recovery_trades_used = 0 WHERE user_id = ? AND strategy = ?")
      .run(userId, "TEST_ENGINE");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");

    const state = getLossStreakState(userId, "TEST_ENGINE");
    assert.equal(state.state, "PAUSED");
    assert.equal(state.lossStreakCount, 4);
    const pauseMs4 = state.resumeAt! - state.pausedAt!;
    assert.ok(pauseMs4 > pauseMs3, "4th-loss pause must be strictly longer than the 3rd-loss pause");
  } finally {
    cleanup(userId);
  }
});

test("I: rejected candidates never touch the streak (gate is read-only outside outcomes)", () => {
  const userId = makeTestUser("i");
  try {
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    const before = getLossStreakState(userId, "TEST_ENGINE").lossStreakCount;
    evaluateLossStreakGate(userId, "TEST_ENGINE");
    evaluateLossStreakGate(userId, "TEST_ENGINE");
    evaluateLossStreakGate(userId, "TEST_ENGINE");
    const after = getLossStreakState(userId, "TEST_ENGINE").lossStreakCount;
    assert.equal(after, before);
  } finally {
    cleanup(userId);
  }
});

test("J: multi-user isolation — identical strategy name, independent state", () => {
  const userA = makeTestUser("multiuser-a");
  const userB = makeTestUser("multiuser-b");
  try {
    recordTradeOutcome(userA, "SHARED_ENGINE", "lost");
    recordTradeOutcome(userA, "SHARED_ENGINE", "lost");
    recordTradeOutcome(userA, "SHARED_ENGINE", "lost");
    assert.equal(getLossStreakState(userA, "SHARED_ENGINE").state, "PAUSED");
    assert.equal(getLossStreakState(userB, "SHARED_ENGINE").state, "NORMAL");
  } finally {
    cleanup(userA);
    cleanup(userB);
  }
});

test("K: multi-strategy isolation for the same user", () => {
  const userId = makeTestUser("multistrat");
  try {
    recordTradeOutcome(userId, "STRAT_ONE", "lost");
    recordTradeOutcome(userId, "STRAT_ONE", "lost");
    recordTradeOutcome(userId, "STRAT_ONE", "lost");
    recordTradeOutcome(userId, "STRAT_TWO", "lost");
    assert.equal(getLossStreakState(userId, "STRAT_ONE").state, "PAUSED");
    assert.equal(getLossStreakState(userId, "STRAT_TWO").state, "NORMAL");
    assert.equal(getLossStreakState(userId, "STRAT_TWO").lossStreakCount, 1);
  } finally {
    cleanup(userId);
  }
});

test("L: restart simulation — PAUSED state restored unchanged on next process read", () => {
  const userId = makeTestUser("restart-paused");
  try {
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    recordTradeOutcome(userId, "TEST_ENGINE", "lost");
    const before = getLossStreakState(userId, "TEST_ENGINE");
    // Simulate a fresh process: the module's reconciled-pairs cache isn't
    // cleared here (single test process), but reconciliation is idempotent
    // — re-reading must return the exact same persisted state, not rebuild.
    const after = getLossStreakState(userId, "TEST_ENGINE");
    assert.deepEqual(after, before);
  } finally {
    cleanup(userId);
  }
});

test("M: feature flag OFF preserves the old permanent-latch behavior in evaluateRiskCheck", () => {
  const userId = makeTestUser("flag-off");
  setFeatureFlag("RISK_LOSS_STREAK_CIRCUIT_BREAKER_ENABLED", false);
  try {
    const now = Date.now();
    insertTrade(userId, "test", "OLD_LATCH_ENGINE", "lost", now - 3000);
    insertTrade(userId, "test", "OLD_LATCH_ENGINE", "lost", now - 2000);
    insertTrade(userId, "test", "OLD_LATCH_ENGINE", "lost", now - 1000);
    const input = {
      userId, preset: "test" as any, strategyId: "OLD_LATCH_ENGINE", symbol: "TESTSYM",
      direction: "CALL" as const, confidenceScore: 80, currentEquity: 1000, currentBalance: 1000,
    };
    const result = evaluateRiskCheck(input);
    assert.equal(result.decision, "REJECTED");
    assert.equal(result.reason, "RISK_LOSS_STREAK");
    // Old behavior never recovers on its own — call again, still rejected.
    const result2 = evaluateRiskCheck(input);
    assert.equal(result2.decision, "REJECTED");
  } finally {
    setFeatureFlag("RISK_LOSS_STREAK_CIRCUIT_BREAKER_ENABLED", false);
    cleanup(userId);
  }
});

test("N: AUTO_SHADOW is checked before the loss-streak circuit breaker and takes priority", () => {
  const userId = makeTestUser("auto-shadow");
  setFeatureFlag("RISK_LOSS_STREAK_CIRCUIT_BREAKER_ENABLED", true);
  const db = getDb();
  try {
    const now = Date.now();
    insertTrade(userId, "test", "SHADOWED_ENGINE", "lost", now - 3000);
    insertTrade(userId, "test", "SHADOWED_ENGINE", "lost", now - 2000);
    insertTrade(userId, "test", "SHADOWED_ENGINE", "lost", now - 1000);
    db.prepare(`
      INSERT INTO strategy_performance_drift (strategy, strategy_version, symbol, risk_state, risk_multiplier)
      VALUES ('SHADOWED_ENGINE', 'V1', 'TESTSYM', 'SHADOW', 0)
    `).run();
    const input = {
      userId, preset: "test" as any, strategyId: "SHADOWED_ENGINE", symbol: "TESTSYM",
      direction: "CALL" as const, confidenceScore: 80, currentEquity: 1000, currentBalance: 1000,
    };
    const result = evaluateRiskCheck(input);
    assert.equal(result.reason, "STRATEGY_AUTO_SHADOW");
    assert.notEqual(result.reason, "RISK_LOSS_STREAK");
  } finally {
    setFeatureFlag("RISK_LOSS_STREAK_CIRCUIT_BREAKER_ENABLED", false);
    db.prepare("DELETE FROM strategy_performance_drift WHERE strategy = 'SHADOWED_ENGINE'").run();
    cleanup(userId);
  }
});
