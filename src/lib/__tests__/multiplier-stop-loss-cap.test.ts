import test from "node:test";
import assert from "node:assert/strict";
import { computeAtrStopUsd, computeStructuralStopUsd } from "../signal-core";
import { CRASH_PRESET } from "../autotrader";
import { generateVol75Signal } from "../vol75-signal.server";

test("computeAtrStopUsd strictly caps stopLossUsd <= 85% of stake (Deriv broker limit)", () => {
  // Scenario 1: stake 2.50 USD with high volatility and large multiple
  const res1 = computeAtrStopUsd(2.5, 100, 5.0, 2.0, 1.8);
  assert(res1.stopLossUsd <= 2.5 * 0.85 + 0.001, `stopLossUsd ${res1.stopLossUsd} should be <= ${2.5 * 0.85}`);
  assert.equal(res1.stopLossUsd, 2.12); // Math.floor(2.50 * 0.85 * 100) / 100 = 2.12

  // Scenario 2: stake 3.75 USD
  const res2 = computeAtrStopUsd(3.75, 100, 5.0, 2.0, 1.8);
  assert(res2.stopLossUsd <= 3.75 * 0.85 + 0.001, `stopLossUsd ${res2.stopLossUsd} should be <= ${3.75 * 0.85}`);
  assert.equal(res2.stopLossUsd, 3.18); // Math.floor(3.75 * 0.85 * 100) / 100 = 3.18

  // Scenario 3: stake 25 USD
  const res3 = computeAtrStopUsd(25, 100, 10.0, 2.0, 1.8);
  assert(res3.stopLossUsd <= 25 * 0.85 + 0.001);
  assert.equal(res3.stopLossUsd, 21.25);
});

test("computeStructuralStopUsd strictly caps stopLossUsd <= 85% of stake", () => {
  // Deep structural stop loss (e.g. 5% price distance with 100x multiplier)
  const res = computeStructuralStopUsd(10, 100, 1000, 50, 100);
  assert(res.stopLossUsd <= 10 * 0.85 + 0.001);
  assert.equal(res.stopLossUsd, 8.5);
});

test("CRASH_PRESET maxHoldMinutes is at least 30 minutes to prevent MAX_HOLD_TIMEOUT truncation", () => {
  assert.equal(CRASH_PRESET.maxHoldMinutes, 30);
});

test("vol75 signal generation does not hard-reject a 0.50 ATR pullback", () => {
  // Synthetic test candle series where pullback is ~0.50 ATR
  const makeCandle = (close: number, high: number, low: number, open: number, epoch: number) => ({
    close, high, low, open, epoch
  });
  
  const m15 = Array.from({ length: 250 }, (_, i) => makeCandle(1000 + i * 2, 1005 + i * 2, 995 + i * 2, 998 + i * 2, 1000 + i * 900));
  const m5 = Array.from({ length: 250 }, (_, i) => makeCandle(1500 + i * 2, 1505 + i * 2, 1495 + i * 2, 1498 + i * 2, 1000 + i * 300));
  const m1 = Array.from({ length: 250 }, (_, i) => makeCandle(2000 + i * 2, 2005 + i * 2, 1995 + i * 2, 1998 + i * 2, 1000 + i * 60));

  const result = generateVol75Signal(m15, m5, m1, [1000, 1000.5]);
  assert(result !== null);
});
