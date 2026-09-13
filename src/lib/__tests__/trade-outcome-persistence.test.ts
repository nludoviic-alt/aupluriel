import assert from "node:assert/strict";
import test from "node:test";
import { getDb } from "../db.server";
import { persistTradeAndRiskOutcome } from "../bot-engine.server";
import { FEATURE_FLAGS } from "../feature-flags.server";
import {
  evaluateLossStreakGate,
  getLossStreakState,
  getLossStreakStatesForPreset,
} from "../loss-streak-circuit-breaker.server";
import type { TradeLog } from "../signal-core";

function user() {
  return Number(
    getDb()
      .prepare("INSERT INTO users(email,username,password_hash,status) VALUES(?,?,'x','approved')")
      .run(`${crypto.randomUUID()}@example.invalid`, crypto.randomUUID()).lastInsertRowid,
  );
}
function trade(status: TradeLog["status"] = "lost"): TradeLog {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    time: now - 1000,
    closedAt: now,
    symbol: "BOOM500",
    direction: "MULTUP",
    stake: 5,
    payout: 0,
    status,
    profit: -0.5,
    confidence: 80,
    tfAgreement: 3,
    strategy: "SCALPING_ENGINE",
  };
}

test("settlement integration: cold count, third-loss pause, mode isolation, durable replay, API agreement", () => {
  FEATURE_FLAGS.RISK_LOSS_STREAK_CIRCUIT_BREAKER_ENABLED = true;
  const uid = user();
  const first = trade();
  persistTradeAndRiskOutcome(uid, "scalping", first, "demo");
  assert.equal(getLossStreakState(uid, first.strategy!, "demo").lossStreakCount, 1);
  persistTradeAndRiskOutcome(uid, "scalping", first, "demo");
  assert.equal(getLossStreakState(uid, first.strategy!, "demo").lossStreakCount, 1);
  persistTradeAndRiskOutcome(uid, "scalping", trade(), "live");
  persistTradeAndRiskOutcome(uid, "scalping", trade(), "demo");
  persistTradeAndRiskOutcome(uid, "scalping", trade(), "demo");
  assert.equal(evaluateLossStreakGate(uid, first.strategy!, "demo").allow, false);
  assert.equal(getLossStreakState(uid, first.strategy!, "demo").lossStreakCount, 3);
  assert.equal(getLossStreakState(uid, first.strategy!, "live").lossStreakCount, 1);
  assert.equal(getLossStreakStatesForPreset(uid, "scalping", "demo")[0].state, "PAUSED");
});

test("settlement uses persisted account mode even when engine mode changes", () => {
  const uid = user();
  const log = trade("open");
  persistTradeAndRiskOutcome(uid, "scalping", log, "demo");
  persistTradeAndRiskOutcome(uid, "scalping", { ...log, status: "lost" }, "live");
  assert.equal(getLossStreakState(uid, log.strategy!, "demo").lossStreakCount, 1);
  assert.equal(getLossStreakState(uid, log.strategy!, "live").lossStreakCount, 0);
});

test("restart reconciles a missed recovery loss and counts more than five losses", () => {
  const uid = user();
  const db = getDb();
  const now = Date.now();
  db.prepare(
    "INSERT INTO loss_streak_state(user_id,strategy,state,loss_streak_count,last_loss_at,updated_at) VALUES(?,?,'RECOVERY',5,?,?)",
  ).run(uid, "demo::SCALPING_ENGINE", now - 7200000, now - 7200000);
  for (let i = 0; i < 6; i++)
    db.prepare(
      "INSERT INTO bot_trades(id,user_id,time,closed_at,symbol,direction,stake,status,profit,strategy,preset,mode) VALUES(?,?,?,?,'BOOM500','MULTUP',5,'lost',-.5,'SCALPING_ENGINE','scalping','demo')",
    ).run(crypto.randomUUID(), uid, now - 10000 + i, now - 1000 + i);
  const state = getLossStreakState(uid, "SCALPING_ENGINE", "demo");
  assert.equal(state.state, "PAUSED");
  assert.equal(state.lossStreakCount, 6);
  assert.equal(state.lastLossAt, now - 995);
  assert.equal(evaluateLossStreakGate(uid, "SCALPING_ENGINE", "demo").allow, false);
});

test("risk write failure rolls back settlement; retry counts once", () => {
  const uid = user();
  const db = getDb();
  const log = trade();
  getLossStreakState(uid, log.strategy!, "demo");
  db.exec(
    `CREATE TRIGGER fail_risk_update BEFORE UPDATE ON loss_streak_state WHEN NEW.user_id = ${uid} BEGIN SELECT RAISE(ABORT, 'test risk failure'); END`,
  );
  try {
    assert.throws(
      () => persistTradeAndRiskOutcome(uid, "scalping", log, "demo"),
      /test risk failure/,
    );
    assert.equal(db.prepare("SELECT id FROM bot_trades WHERE id=?").get(log.id), undefined);
  } finally {
    db.exec("DROP TRIGGER fail_risk_update");
  }
  persistTradeAndRiskOutcome(uid, "scalping", log, "demo");
  assert.equal(getLossStreakState(uid, log.strategy!, "demo").lossStreakCount, 1);
});

test("a recovery probe loss rearms the pause with its settlement timestamp", () => {
  const uid = user();
  for (let i = 0; i < 3; i++) persistTradeAndRiskOutcome(uid, "scalping", trade(), "demo");
  getDb()
    .prepare("UPDATE loss_streak_state SET resume_at = ? WHERE user_id = ?")
    .run(Date.now() - 1, uid);
  assert.equal(evaluateLossStreakGate(uid, "SCALPING_ENGINE", "demo").stakeMultiplier, 0.5);
  const probe = trade();
  persistTradeAndRiskOutcome(uid, "scalping", probe, "demo");
  const state = getLossStreakState(uid, "SCALPING_ENGINE", "demo");
  assert.equal(state.state, "PAUSED");
  assert.equal(state.lossStreakCount, 4);
  assert.equal(state.lastLossAt, probe.closedAt);
  assert.equal(evaluateLossStreakGate(uid, "SCALPING_ENGINE", "demo").allow, false);
});
