import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSymbolCore } from "../signal-core.server";

test("a missing required timeframe cannot produce an executable analysis", async () => {
  const { analysis, candles15m } = await analyzeSymbolCore("R_75", async (_symbol, granularity) => {
    if (granularity === 900)
      throw Object.assign(new Error("You have reached the rate limit for ticks_history."), {
        code: "RateLimit",
      });
    return Array.from({ length: 250 }, (_, index) => ({
      epoch: 1_700_000_000 + index * granularity,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
    }));
  });
  assert.equal(analysis.direction, null);
  assert.deepEqual(analysis.blockers, ["MARKET_DATA_RATE_LIMIT"]);
  assert.equal(candles15m, null);
});
