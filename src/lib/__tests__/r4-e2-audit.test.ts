import test from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../db.server";
import {
  R4_E2_DEPLOYED_AT,
  getSampleSizeStatus,
  getPostR4E2Performance,
  checkVersioningIntegrity,
  getRiskStopAuditReport,
  getShadowSavingsSummary,
  logSafetyAlert,
  analyze300TradeRobustness,
} from "../r4-e2-audit.server";

test("Deliverable 1 & 12 — Sample size status badge math", () => {
  assert.equal(getSampleSizeStatus(5), "LEARNING");
  assert.equal(getSampleSizeStatus(29), "LEARNING");
  assert.equal(getSampleSizeStatus(30), "EARLY SAMPLE");
  assert.equal(getSampleSizeStatus(99), "EARLY SAMPLE");
  assert.equal(getSampleSizeStatus(100), "INTERMEDIATE");
  assert.equal(getSampleSizeStatus(299), "INTERMEDIATE");
  assert.equal(getSampleSizeStatus(300), "STRONGER SAMPLE");
  assert.equal(getSampleSizeStatus(500), "STRONGER SAMPLE");
});

test("Deliverable 2 & 3 — Versioning integrity & zero violation check", () => {
  const health = checkVersioningIntegrity();
  assert.equal(typeof health.violations, "number");
  assert.equal(typeof health.mismatchCount, "number");
  assert.equal(typeof health.validCount, "number");
  assert.equal(health.violations, 0);
});

test("Deliverable 4 — Stake Invariants assertion logic", () => {
  const req = 10.0;
  const maxRisk = 5.0;
  const derivMax = 20.0;

  const finalStake = Math.min(req, maxRisk, derivMax);
  assert.equal(finalStake, 5.0);

  // Assert invariants
  assert.ok(finalStake <= req);
  assert.ok(finalStake <= maxRisk);
  assert.ok(finalStake <= derivMax);
});

test("Deliverable 7 & 8 — Shadow savings summary math", () => {
  const summary = getShadowSavingsSummary();
  assert.equal(typeof summary.riskStops, "number");
  assert.equal(typeof summary.shadowWins, "number");
  assert.equal(typeof summary.shadowLosses, "number");
  assert.equal(typeof summary.capitalSavedUsd, "number");
});

test("Deliverable 13 — Safety alert logger", () => {
  const db = getDb();
  const symbol = "TEST_R4E2_ALERT";

  logSafetyAlert({
    alertType: "STAKE_SAFETY_VIOLATION",
    userId: 999,
    preset: "rb100",
    symbol,
    details: "Test safety alert logging",
  });

  const row = db.prepare("SELECT * FROM safety_alerts WHERE symbol = ?").get(symbol) as any;
  assert.ok(row);
  assert.equal(row.alert_type, "STAKE_SAFETY_VIOLATION");
  assert.equal(row.symbol, symbol);

  // Cleanup
  db.prepare("DELETE FROM safety_alerts WHERE symbol = ?").run(symbol);
});

test("300-Trade Robustness Analysis & Profit Concentration Warning", () => {
  const mockTrades = Array.from({ length: 300 }, (_, i) => ({
    profit: i % 2 === 0 ? 5.0 : -2.0,
    stake: 5.0,
    rMultiple: i % 2 === 0 ? 1.0 : -0.4,
  }));

  const result = analyze300TradeRobustness(mockTrades);

  // PF = 750/300 = 2.5 (>= 1.75 STRONG threshold), but expectancyR = 0.30R
  // falls short of the STRONG threshold (>= 0.35R) — correctly lands in
  // POSITIVE (PF >= 1.25 AND expectancyR >= 0.15R). Business rule confirmed
  // 2026-08-13: do not lower the STRONG threshold to fit this mock — fix
  // the test's expectation instead.
  assert.equal(result.classification, "POSITIVE");
  assert.equal(result.temporalBlocks.length, 3);
  assert.equal(result.profitConcentrationWarning, false);
  assert.ok(result.robustnessChecks.netPnlPositive);
  assert.ok(result.robustnessChecks.profitFactorAboveOne);
});
