// Read-only probe: confirm the LIVE confluence engine (analyzeSymbolCore) and
// the LIVE structural scalping engine (generateScalpingSignal) both produce
// tradeable signals on 1HZ75V before we repoint demo presets at them.
// Run: npx tsx scripts/probe-1hz75v-engines.ts

import { fetchCandlesServer, closePublicSocket } from "../src/lib/deriv.server";
import { analyzeSymbolCore } from "../src/lib/signal-core.server";
import { generateScalpingSignal, MIN_M1_CANDLES } from "../src/lib/scalping-signal.server";

const SYMBOL = "1HZ75V";

async function main() {
  const fetcher = (s: string, g: number, c: number) => fetchCandlesServer(s, g, c);

  // ── Confluence (live path used by the `default` preset / else-branch) ──
  const core = await analyzeSymbolCore(SYMBOL, fetcher, {
    confluenceMode: "weighted",
    adxFilterMode: "block",
    adxBlockThreshold: 20,
  });
  const a = core.analysis;
  console.log("── CONFLUENCE (analyzeSymbolCore) ──");
  console.log({
    direction: a.direction,
    confidence: a.confidence,
    agreement: a.agreement,
    volatilityPct: Number(a.volatilityPct?.toFixed?.(3)),
    volatilityRatio: Number(a.volatilityRatio?.toFixed?.(2)),
    blockers: a.blockers,
  });

  // ── Structural scalping (live path used by the `scalping` preset) ──
  const m1 = await fetcher(SYMBOL, 60, Math.max(MIN_M1_CANDLES + 10, 400));
  console.log(`\n── SCALPING (generateScalpingSignal) — ${m1.length} m1 candles ──`);
  const now = generateScalpingSignal(m1);
  console.log("latest:", now);

  // Rolling count over the last ~300 m1 closes to estimate live frequency
  let hits = 0;
  const start = Math.max(MIN_M1_CANDLES, m1.length - 300);
  for (let i = start; i < m1.length; i++) {
    const sig = generateScalpingSignal(m1.slice(0, i));
    if (sig) hits++;
  }
  console.log(`signals in last ${m1.length - start} m1 bars: ${hits}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePublicSocket());
