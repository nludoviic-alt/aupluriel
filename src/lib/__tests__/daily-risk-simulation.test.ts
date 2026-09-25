import assert from "node:assert/strict";
import test from "node:test";
import { simulateDailyLimits } from "../daily-risk-simulation.server";

const observation = JSON.stringify({
  equity_at_signal: 1_000,
  BASE_DAILY_LOSS_LIMIT: 100,
  NOMINAL_RISK_PER_TRADE: 10,
});

test("daily simulation blocks only trades after the simulated daily loss limit", () => {
  const result = simulateDailyLimits(
    [
      {
        time: Date.UTC(2026, 0, 1, 9),
        virtual_pnl: -10,
        r_multiple: -1,
        risk_observation: observation,
      },
      {
        time: Date.UTC(2026, 0, 1, 10),
        virtual_pnl: -10,
        r_multiple: -1,
        risk_observation: observation,
      },
      {
        time: Date.UTC(2026, 0, 1, 11),
        virtual_pnl: 10,
        r_multiple: 1,
        risk_observation: observation,
      },
    ],
    [{ name: "1R", limit: () => 10 }],
  );
  assert.equal(result[0].tradesExecuted, 1);
  assert.equal(result[0].tradesBlocked, 2);
  assert.equal(result[0].lossesAvoided, 10);
  assert.equal(result[0].positivePnlBlocked, 10);
  assert.equal(result[0].netProtectionValue, 0);
});
