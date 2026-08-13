import { generateRb100Signal } from "../rb100-signal.server";
import type { ServerCandle } from "../deriv.server";

function createFakeCandle(close: number, high?: number, low?: number, open?: number): ServerCandle {
  const o = open ?? close;
  const h = high ?? Math.max(o, close) + 1;
  const l = low ?? Math.min(o, close) - 1;
  return { time: Date.now() / 1000, open: o, high: h, low: l, close };
}

function generateHistory(count: number, basePrice = 50000): ServerCandle[] {
  const candles: ServerCandle[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const change = (Math.sin(i / 3) * 5) + ((i % 2 === 0 ? 1 : -1) * 2);
    const open = price;
    price += change;
    const high = Math.max(open, price) + 2;
    const low = Math.min(open, price) - 2;
    candles.push({ time: (Date.now() / 1000) - (count - i) * 60, open, high, low, close: price });
  }
  return candles;
}

console.log("=== Testing RB100 Pipeline V3 ===");

// Test 1: Insufficient History
const invalidResult = generateRb100Signal([], [], []);
console.log("Test 1 (Insufficient history):", invalidResult.rejection?.reason === "INVALID_RANGE" ? "PASS" : "FAIL");

// Test 2: Range Trader Candidate with ADX 29 & RSI 30
const m15 = generateHistory(60, 50000);
const m5 = generateHistory(60, 50000);
const m1 = generateHistory(60, 50000);

// Adjust last candle of m1 to lower range boundary with wick and reversal
const rangeBars = m5.slice(-12, -1);
const lo = Math.min(...rangeBars.map((x) => x.low));
m1[m1.length - 1] = {
  time: Date.now() / 1000,
  open: lo + 1,
  high: lo + 3,
  low: lo - 2, // 20% lower wick
  close: lo + 2, // inside 0-30% zone
};

const ticks = Array.from({ length: 30 }, (_, i) => 50000 + i);

const decision = generateRb100Signal(m15, m5, m1, ticks);
console.log("Test 2 Decision:", decision.signal ? `SIGNAL: ${decision.signal.strategy} (${decision.signal.confidence} pts)` : `REJECTED: ${decision.rejection?.reason} (${decision.rejection?.primaryReason}) - All: ${decision.rejection?.allRejectionReasons?.join(", ")}`);

// Test 3: Breakout Retest Candidate
const m1Breakout = generateHistory(60, 50000);
const hi = Math.max(...m5.slice(-12, -1).map((x) => x.high));
m1Breakout[m1Breakout.length - 1] = {
  time: Date.now() / 1000,
  open: hi + 1,
  high: hi + 15,
  low: hi - 1, // retest boundary
  close: hi + 10, // closed above
};
const breakoutTicks = Array.from({ length: 30 }, (_, i) => 50000 + i * 2);

const breakoutDecision = generateRb100Signal(m15, m5, m1Breakout, breakoutTicks);
console.log("Test 3 Decision:", breakoutDecision.signal ? `SIGNAL: ${breakoutDecision.signal.strategy} (${breakoutDecision.signal.confidence} pts)` : `REJECTED: ${breakoutDecision.rejection?.reason} (${breakoutDecision.rejection?.primaryReason})`);

console.log("=== All Tests Completed ===");
