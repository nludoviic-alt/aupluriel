import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionMonitorStore } from "../execution-quality-monitor.server";

test("two successes and one contract rejection do not halt all markets", () => {
  const monitor = new ExecutionMonitorStore();
  for (let i = 0; i < 2; i++) {
    monitor.recordProposal("BOOM500", 200, true);
    monitor.recordBuy("BOOM500", 200, true);
  }
  monitor.recordProposal("BOOM900", 200, false, "ContractBuyValidationError", "Rejected");
  monitor.recordBuy("BOOM900", 200, false, "ContractBuyValidationError", "Rejected");
  const metrics = monitor.getMetrics();
  assert.equal(metrics.health, "DEGRADED");
  assert.equal(metrics.buysFailed, 1);
  assert.equal(metrics.buySuccessRatePct, 66.7);
  assert.equal(metrics.recentErrors[0].symbol, "BOOM900");
});

test("contract refusals still block the affected symbol after three attempts", () => {
  const monitor = new ExecutionMonitorStore();
  for (let i = 0; i < 3; i++) monitor.recordProposal("BOOM900", 50, false, "ContractBuyValidationError", "Rejected");
  assert.equal(monitor.isSymbolInExecutionCooldown("BOOM900").blocked, true);
  assert.equal(monitor.isSymbolInExecutionCooldown("RB100").blocked, false);
  assert.notEqual(monitor.getMetrics().health, "CRITICAL");
});

test("unknown and transport failures retain the global protection", () => {
  for (const code of ["EXECUTION_ERROR", "BUY_OUTCOME_UNKNOWN", "ConnectionError"]) {
    const monitor = new ExecutionMonitorStore();
    monitor.recordBuy("RB100", 200, false, code, "Failure");
    assert.equal(monitor.getMetrics().health, "CRITICAL");
  }
});

test("successful end-to-end latency alone does not establish broker failure", () => {
  const monitor = new ExecutionMonitorStore();
  monitor.recordProposal("RB100", 5000, true);
  monitor.recordBuy("RB100", 5000, true);
  assert.equal(monitor.getMetrics().health, "POOR");
});
