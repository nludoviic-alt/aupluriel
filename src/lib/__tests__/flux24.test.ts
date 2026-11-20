import assert from "node:assert/strict";
import test from "node:test";
import { FLUX24_BASE_SCORE, FLUX24_MIN_CANDLES, generateFlux24Signal } from "../flux24-signal.server";
import { FLUX24_PRESET } from "../autotrader";
process.env.DB_PATH = ":memory:"; // engine import must never touch the local lio23.db
const { ACTIVE_PRESETS, lockPresetSymbols } = await import("../bot-engine.server");
const { effectiveMultiplier } = await import("../deriv.server");
import type { ServerCandle } from "../deriv.server";

function candle(i: number, close: number, spread = 1): ServerCandle {
  return { epoch: 1_700_000_000 + i * 60, open: close, high: close + spread, low: close - spread, close };
}
/** Steady uptrend, then a closed candle that dips to EMA9 and closes back above,
 * followed by the still-forming candle (ignored by the generator). */
function uptrendWithPullback(): ServerCandle[] {
  const c: ServerCandle[] = [];
  for (let i = 0; i < 60; i++) c.push(candle(i, 100 + i * 0.5));
  const last = c[c.length - 1].close;
  c.push({ epoch: 1_700_000_000 + 60 * 60, open: last, high: last + 0.2, low: last - 6, close: last + 0.1 });
  c.push(candle(61, last + 5)); // forming candle: must not change the decision
  return c;
}

test("rejects when there is not enough history", () => {
  const d = generateFlux24Signal([candle(0, 100)]);
  assert.equal(d.signal, undefined);
  assert.equal(d.rejection?.reason, "INSUFFICIENT_DATA");
  assert.ok(FLUX24_MIN_CANDLES > 1);
});

test("emits a CALL on an uptrend micro-pullback", () => {
  const d = generateFlux24Signal(uptrendWithPullback());
  assert.equal(d.signal?.direction, "CALL");
  assert.equal(d.signal?.confidence, FLUX24_BASE_SCORE);
});

test("emits a PUT on a mirrored downtrend micro-pullback", () => {
  const up = uptrendWithPullback();
  const mirrored = up.map((c) => ({ ...c, open: 1000 - c.open, high: 1000 - c.low, low: 1000 - c.high, close: 1000 - c.close }));
  assert.equal(generateFlux24Signal(mirrored).signal?.direction, "PUT");
});

test("no signal in a flat market", () => {
  const flat = Array.from({ length: 60 }, (_, i) => candle(i, 100));
  assert.equal(generateFlux24Signal(flat).signal, undefined);
});

test("preset invariants: demo-only, score gate reachable, tiny fixed stake, capped risk", () => {
  assert.equal(FLUX24_PRESET.mode, "demo");
  assert.ok(FLUX24_BASE_SCORE >= (FLUX24_PRESET.minConfidence ?? 100));
  assert.equal(FLUX24_PRESET.stakeMode, "fixed");
  assert.ok((FLUX24_PRESET.stakeUsd ?? 99) <= 5);
  assert.ok((FLUX24_PRESET.maxDailyLossUsd ?? 99) <= 5);
  assert.ok((FLUX24_PRESET.maxOpenPositions ?? 99) <= 2);
  assert.equal(FLUX24_PRESET.atrStopMode, true);
});

test("engine forces demo for flux24 even if a live config is saved", () => {
  const forced = lockPresetSymbols("flux24", { ...(FLUX24_PRESET as Record<string, unknown>), mode: "live" } as never) as { mode: string };
  assert.equal(forced.mode, "demo");
  assert.ok(ACTIVE_PRESETS.includes("flux24"));
});

test("multiplier is normalised to each index's accepted ladder", () => {
  assert.equal(effectiveMultiplier("1HZ10V", 50), 400);
  assert.equal(effectiveMultiplier("1HZ25V", 50), 160);
  assert.equal(effectiveMultiplier("1HZ100V", 50), 40);
  assert.equal(effectiveMultiplier("1HZ75V", 50), 50);
  assert.equal(effectiveMultiplier("1HZ50V", 50), 80);
});

test("a setup that exists only on the forming candle is ignored", () => {
  const closed = uptrendWithPullback().slice(0, -2); // no pullback candle left
  closed.push(candle(60, closed[closed.length - 1].close)); // forming candle
  assert.equal(generateFlux24Signal(closed).signal, undefined);
});
