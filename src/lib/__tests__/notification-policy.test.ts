import assert from "node:assert/strict";
import test from "node:test";
import { isScalpingTradeResult } from "../push.server";

test("allows only closed Scalping win/loss notifications", () => {
  assert.equal(isScalpingTradeResult("✅ Trade fermé gagnant — Scalping", "trade"), true);
  assert.equal(isScalpingTradeResult("🔴 Trade fermé perdant — Scalping", "trade"), true);
  assert.equal(isScalpingTradeResult("🟦 Trade ouvert — Scalping", "trade"), false);
  assert.equal(isScalpingTradeResult("✅ Trade fermé gagnant — Multi", "trade"), false);
  assert.equal(isScalpingTradeResult("🚨 Bot en pause — Scalping", "risk"), false);
});
