import assert from "node:assert/strict";
import test from "node:test";
import { effectiveMultiplier } from "../deriv.server";

test("normalizes Volatility 50 multipliers to Deriv's accepted ladder", () => {
  assert.equal(effectiveMultiplier("1HZ50V", 100), 80);
  assert.equal(effectiveMultiplier("1HZ50V", 50), 80);
  assert.equal(effectiveMultiplier("1HZ50V", 600), 600);
  assert.equal(effectiveMultiplier("BOOM900", 100), 100);
});
