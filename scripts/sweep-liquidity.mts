// Liquidity Reversal parameter sweep for frxXAUUSD.
// Tests different lookback/bodyRatio/RSI thresholds + TP/SL combos
// against historical M15 candles using the same simulateCombo logic
// as the Boom/Crash preset sweeps.
//
// Usage: npx tsx scripts/sweep-liquidity.mts

import { rsi } from "../src/lib/indicators.ts";
import { getCachedCandlesServer } from "../src/lib/deriv-bigdata.server.ts";
import { fetchCandlesServer, type ServerCandle } from "../src/lib/deriv.server.ts";
import type { RawEntry, SweepCombo, SweepSimResult } from "../src/lib/boom-sweep.server.ts";

// ── Configurable liquidity signal (mirrors generateLiquidityReversalSignal
//    but with parameterized thresholds instead of hardcoded constants) ──

interface LiquidityParams {
  lookback: number;       // range window (was 20)
  minBodyRatio: number;   // body / range (was 0.35)
  rsiUpper: number;       // RSI max for CALL turn (was 55)
  rsiLower: number;       // RSI min for PUT turn (was 45)
}

function volatilityPct(candles: ServerCandle[]): number {
  const tail = candles.slice(-15);
  if (tail.length < 2) return 0;
  const avgRange = tail.reduce((s, c) => s + (c.high - c.low), 0) / tail.length;
  const price = tail[tail.length - 1].close;
  return price > 0 ? (avgRange / price) * 100 : 0;
}

function genLiquiditySignal(
  candles: ServerCandle[],
  p: LiquidityParams,
): { direction: "CALL" | "PUT"; confidence: number; volatilityPct: number } | null {
  const minCandles = p.lookback + 15;
  if (candles.length < minCandles) return null;
  const current = candles[candles.length - 1];
  const previous = candles.slice(-(p.lookback + 1), -1);
  const priorLow = Math.min(...previous.map((c) => c.low));
  const priorHigh = Math.max(...previous.map((c) => c.high));
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const bodyRatio = Math.abs(current.close - current.open) / range;
  if (bodyRatio < p.minBodyRatio) return null;

  const rsiLine = rsi(candles.map((c) => c.close), 14);
  const currentRsi = rsiLine[rsiLine.length - 1];
  const previousRsi = rsiLine[rsiLine.length - 2];
  if (currentRsi === null || previousRsi === null) return null;

  const sweptLow = current.low < priorLow && current.close > priorLow && current.close > current.open;
  const sweptHigh = current.high > priorHigh && current.close < priorHigh && current.close < current.open;
  const rsiTurnsUp = currentRsi > previousRsi && currentRsi <= p.rsiUpper;
  const rsiTurnsDown = currentRsi < previousRsi && currentRsi >= p.rsiLower;
  const vol = volatilityPct(candles);

  if (sweptLow && rsiTurnsUp) {
    return {
      direction: "CALL",
      confidence: Math.min(95, Math.round(80 + bodyRatio * 10 + Math.min(5, currentRsi - previousRsi))),
      volatilityPct: vol,
    };
  }
  if (sweptHigh && rsiTurnsDown) {
    return {
      direction: "PUT",
      confidence: Math.min(95, Math.round(80 + bodyRatio * 10 + Math.min(5, previousRsi - currentRsi))),
      volatilityPct: vol,
    };
  }
  return null;
}

// ── simulateCombo (copied from boom-sweep to avoid import chain issues) ──

function simulateCombo(
  entries: RawEntry[],
  c5m: ServerCandle[],
  combo: SweepCombo,
  stakeUsd: number,
  leverage: number,
  maxHoldMinutes: number,
): SweepSimResult {
  const maxHoldSec = maxHoldMinutes * 60;
  const leveredNotional = stakeUsd * leverage;
  const stopLossUsd = stakeUsd * (combo.stopLossPctOfStake / 100);
  const takeProfitUsd = stakeUsd * (combo.takeProfitPctOfStake / 100);
  const stopFrac = stopLossUsd / leveredNotional;
  const tpFrac = takeProfitUsd / leveredNotional;

  let wins = 0, losses = 0, stopHits = 0, targetHits = 0, timeExits = 0;
  let totalPnlUsd = 0, totalHoldMinutes = 0;

  for (const e of entries) {
    if (e.confidence < combo.minConfidence || e.agreement < combo.minTfAgreement) continue;
    const slPrice = e.direction === "CALL" ? e.entryPrice * (1 - stopFrac) : e.entryPrice * (1 + stopFrac);
    const tpPrice = e.direction === "CALL" ? e.entryPrice * (1 + tpFrac) : e.entryPrice * (1 - tpFrac);
    const forward = c5m.filter((c) => c.epoch > e.entryEpoch && c.epoch <= e.entryEpoch + maxHoldSec);

    let outcome: "stop" | "target" | "time" = "time";
    let exitPrice = forward.length ? forward[forward.length - 1].close : e.entryPrice;
    let exitEpoch = e.entryEpoch + maxHoldSec;
    for (const c of forward) {
      const hitStop = e.direction === "CALL" ? c.low <= slPrice : c.high >= slPrice;
      const hitTarget = e.direction === "CALL" ? c.high >= tpPrice : c.low <= tpPrice;
      if (hitStop) { outcome = "stop"; exitPrice = slPrice; exitEpoch = c.epoch; break; }
      if (hitTarget) { outcome = "target"; exitPrice = tpPrice; exitEpoch = c.epoch; break; }
    }

    const pctMove = e.direction === "CALL" ? (exitPrice - e.entryPrice) / e.entryPrice : (e.entryPrice - exitPrice) / e.entryPrice;
    const pnlUsd = outcome === "stop" ? -stopLossUsd : outcome === "target" ? takeProfitUsd : leveredNotional * pctMove;
    const won = pnlUsd > 0;
    if (outcome === "stop") stopHits++;
    else if (outcome === "target") targetHits++;
    else timeExits++;
    won ? wins++ : losses++;
    totalPnlUsd += pnlUsd;
    totalHoldMinutes += (exitEpoch - e.entryEpoch) / 60;
  }

  const trades = wins + losses;
  const effectiveRR = combo.takeProfitPctOfStake / combo.stopLossPctOfStake;
  return {
    trades, wins,
    winRate: trades > 0 ? (wins / trades) * 100 : 0,
    breakEvenWinRate: (1 / (1 + effectiveRR)) * 100,
    totalPnlUsd: Math.round(totalPnlUsd * 100) / 100,
    avgHoldMinutes: trades > 0 ? Math.round(totalHoldMinutes / trades) : 0,
    stopHits, targetHits, timeExits,
  };
}

// ── Main sweep ──

const SYMBOL = "frxXAUUSD";
const TEST_CANDLES = 4000;       // ~42 days of M15
const STAKE = 1;
const LEVERAGE = 20;             // matches LIQUIDITY_PRESET's multiplier leverage
const MAX_HOLD = 60;             // minutes

// Parameter grid for the signal engine
const LOOKBACKS = [15, 20, 25, 30];
const BODY_RATIOS = [0.25, 0.35, 0.45, 0.55];
const RSI_PAIRS: [number, number][] = [
  [50, 50],
  [55, 45],
  [60, 40],
  [65, 35],
];

// TP/SL grid for the simulation
const TP_SL_COMBOS: SweepCombo[] = [];
for (const tp of [5, 8, 10, 15]) {
  for (const sl of [5, 10, 15, 20]) {
    for (const conf of [75, 80, 85]) {
      TP_SL_COMBOS.push({ takeProfitPctOfStake: tp, stopLossPctOfStake: sl, minConfidence: conf, minTfAgreement: 4 });
    }
  }
}

async function main() {
  console.log(`\n=== Liquidity Reversal Sweep — ${SYMBOL} ===`);
  console.log(`Fetching ${TEST_CANDLES} M15 candles + 5m forward data...\n`);

  const c15m = await getCachedCandlesServer(SYMBOL, 900, TEST_CANDLES + 50);
  const c5m = await getCachedCandlesServer(SYMBOL, 300, TEST_CANDLES * 3 + 100);

  if (c15m.length < TEST_CANDLES) {
    console.error(`Not enough M15 candles: got ${c15m.length}, need ${TEST_CANDLES}`);
    process.exit(1);
  }
  console.log(`Got ${c15m.length} M15 candles, ${c5m.length} M5 candles`);

  const results: Array<{
    params: LiquidityParams;
    combo: SweepCombo;
    sim: SweepSimResult;
    signalCount: number;
  }> = [];

  for (const lookback of LOOKBACKS) {
    for (const bodyRatio of BODY_RATIOS) {
      for (const [rsiUpper, rsiLower] of RSI_PAIRS) {
        const params: LiquidityParams = { lookback, minBodyRatio: bodyRatio, rsiUpper, rsiLower };
        const minCandles = lookback + 15;

        // Generate entries once per param set
        const entries: RawEntry[] = [];
        const start = Math.max(minCandles, c15m.length - TEST_CANDLES);
        const end = c15m.length;
        for (let i = start; i < end; i++) {
          const sig = genLiquiditySignal(c15m.slice(0, i), params);
          if (!sig) continue;
          entries.push({
            entryEpoch: c15m[i - 1].epoch,
            entryPrice: c15m[i - 1].close,
            direction: sig.direction,
            confidence: sig.confidence,
            agreement: 4,
            volatilityPct: sig.volatilityPct,
          });
        }

        if (entries.length === 0) continue;

        // Sweep TP/SL combos
        for (const combo of TP_SL_COMBOS) {
          const sim = simulateCombo(entries, c5m, combo, STAKE, LEVERAGE, MAX_HOLD);
          if (sim.trades < 5) continue; // skip combos with too few trades
          results.push({ params, combo, sim, signalCount: entries.length });
        }
      }
    }
  }

  // Sort by total P&L
  results.sort((a, b) => b.sim.totalPnlUsd - a.sim.totalPnlUsd);

  // Print top 30
  console.log(`\nTop 30 combos (out of ${results.length} with ≥5 trades):\n`);
  console.log("Rank | Lookback | Body% | RSI↑/↓ | TP% | SL% | Conf | Trades | Win% | BE% | P&L $ | AvgHold");
  console.log("-----|----------|-------|--------|-----|-----|------|--------|------|-----|-------|-------");
  for (let i = 0; i < Math.min(30, results.length); i++) {
    const r = results[i];
    console.log(
      `${String(i + 1).padStart(4)} | ` +
      `${r.params.lookback.toString().padStart(8)} | ` +
      `${(r.params.minBodyRatio * 100).toFixed(0).padStart(5)}% | ` +
      `${r.params.rsiUpper.toString().padStart(2)}/${r.params.rsiLower.toString().padStart(2)}  | ` +
      `${r.combo.takeProfitPctOfStake.toString().padStart(3)} | ` +
      `${r.combo.stopLossPctOfStake.toString().padStart(3)} | ` +
      `${r.combo.minConfidence.toString().padStart(4)} | ` +
      `${r.sim.trades.toString().padStart(6)} | ` +
      `${r.sim.winRate.toFixed(1).padStart(5)} | ` +
      `${r.sim.breakEvenWinRate.toFixed(1).padStart(4)} | ` +
      `${r.sim.totalPnlUsd.toFixed(2).padStart(5)} | ` +
      `${r.sim.avgHoldMinutes}m`
    );
  }

  // Also show signal counts per param set
  console.log(`\nSignal counts per param set:`);
  const seen = new Set<string>();
  for (const r of results) {
    const key = `${r.params.lookback}-${r.params.minBodyRatio}-${r.params.rsiUpper}-${r.params.rsiLower}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  lookback=${r.params.lookback} body≥${r.params.minBodyRatio} RSI≤${r.params.rsiUpper}/≥${r.params.rsiLower} → ${r.signalCount} signals`);
  }

  // Current config baseline
  console.log(`\n=== Current config baseline (lookback=20, body=0.35, RSI 55/45) ===`);
  const baselineResults = results.filter(
    (r) => r.params.lookback === 20 && r.params.minBodyRatio === 0.35 && r.params.rsiUpper === 55 && r.params.rsiLower === 45,
  );
  if (baselineResults.length === 0) {
    console.log("  No combos with ≥5 trades for current config!");
  } else {
    for (const r of baselineResults.slice(0, 5)) {
      console.log(`  TP=${r.combo.takeProfitPctOfStake}% SL=${r.combo.stopLossPctOfStake}% conf=${r.combo.minConfidence} → ${r.sim.trades} trades, ${r.sim.winRate.toFixed(1)}% win, $${r.sim.totalPnlUsd} P&L`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
