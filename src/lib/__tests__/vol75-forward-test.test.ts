// vol75 forward demo test (docs/VOL75_FORWARD_TEST.md). Run with DB_PATH=:memory:.
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG, VOL50_PRESET, VOL75_PRESET } from "../autotrader";
import { VOL75_MIN_ADX, VOL75_MIN_SCORE, VOL75_SL_ATR, VOL75_TP_R } from "../vol75-signal.server";

const vol75 = { ...DEFAULT_CONFIG, ...VOL75_PRESET };
const vol50 = { ...DEFAULT_CONFIG, ...VOL50_PRESET };

test("vol75 module trades the backtested levels", () => {
  assert.deepEqual([VOL75_MIN_ADX, VOL75_SL_ATR, VOL75_TP_R, VOL75_MIN_SCORE], [25, 1.5, 2.5, 80]);
});

test("vol75 preset reproduces the tested conditions", () => {
  assert.equal(vol75.mode, "demo");
  assert.equal(vol75.minConfidence, 80);
  assert.equal(vol75.stakeMode, "fixed");
  assert.equal(vol75.stakeUsd, 5);
  assert.equal(vol75.progressiveStakeReduction, false);
  assert.equal(vol75.adaptiveStake, false);
  assert.equal(vol75.maxHoldMinutes, 240);
  assert.equal(vol75.minSymbolWinRate, 0);
  assert.equal(vol75.hourlyEdgeFilter, false);
  assert.equal(vol75.maxTradesPerDay, 8);
  assert.equal(vol75.maxOpenPositions, 1);
});

test("vol50 does not inherit the vol75 forward-test fields", () => {
  assert.equal(vol50.stakeMode, "percent");
  assert.equal(vol50.stakePercent, 0.25);
  assert.equal(vol50.progressiveStakeReduction, true);
  assert.equal(vol50.maxHoldMinutes, 8);
  assert.equal(vol50.minSymbolWinRate, 0.3);
  assert.equal(vol50.hourlyEdgeFilter, true);
  assert.equal(vol50.maxDailyLossUsd, 2);
  assert.equal(vol50.minConfidence, 76);
});
