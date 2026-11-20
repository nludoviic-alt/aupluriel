import assert from "node:assert/strict";
import test from "node:test";
import { isClosedTradeResult } from "../push.server";

test("allows only closed win/loss trade notifications, for any preset", () => {
  assert.equal(isClosedTradeResult("✅ Trade fermé gagnant — Scalping", "trade"), true);
  assert.equal(isClosedTradeResult("🔴 Trade fermé perdant — Scalping", "trade"), true);
  assert.equal(isClosedTradeResult("🟦 Trade ouvert — Scalping", "trade"), false);
  assert.equal(isClosedTradeResult("✅ Trade fermé gagnant — Flux24 — mesure haute fréquence (démo)", "trade"), true);
  assert.equal(isClosedTradeResult("🔴 Trade fermé perdant — Volatility 75 (1s) — démo", "trade"), true);
  assert.equal(isClosedTradeResult("✅ Trade fermé gagnant — Multi", "trade"), true);
  assert.equal(isClosedTradeResult("✅ Trade fermé gagnant — Scalping", "signal"), false);
  assert.equal(isClosedTradeResult("🚨 Bot en pause — Scalping", "risk"), false);
});
