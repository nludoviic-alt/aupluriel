// Backtest harnesses for the three engines that have never had one:
// liquidity-sweep, Spike Hunter, and price-action scalping — the "Track B"
// (Multiplier / path-dependent) half of the strategy-tournament skill.
// Confluence's own fetchAndAnalyzeSymbol() + simulateCombo() (boom-sweep.server.ts)
// already cover Track B's fourth engine and are reused unchanged.
//
// Liquidity and Spike Hunter both synthesize a %-of-stake stop/target live
// (see bot-engine.server.ts's "liquidity"/confluence branches, agreement
// hardcoded to 4 the same way there) — so their entries are plain RawEntry
// and get simulated with the EXISTING simulateCombo(), same as confluence.
// Scalping is the odd one out: its signal carries its OWN structural
// riskAbs/rewardAbs (last swing high/low), which the live engine converts via
// computeStructuralStopUsd() instead of a combo-level percentage — that's
// what simulateComboStructural() below replicates.
import type { ServerCandle } from "./deriv.server";
import { getCachedCandlesServer } from "./deriv-bigdata.server";
import { generateLiquidityReversalSignal, MIN_LIQUIDITY_CANDLES } from "./liquidity-reversal-signal.server";
import { generateSpikeHunterSignal } from "./spike-hunter-signal.server";
import { generateScalpingSignal, MIN_M1_CANDLES, RR_TARGET } from "./scalping-signal.server";
import { computeStructuralStopUsd } from "./signal-core";
import type { RawEntry, AnalyzedSymbol, SweepSimResult } from "./boom-sweep.server";

// All fetches in this file go through the cache (unlike boom-sweep.server.ts's
// fetchAndAnalyzeSymbol, which backs the live scheduled auto-backtest job and
// stays on its existing direct-fetch path) — this is new research-only code,
// and a 4-engine x N-symbol tournament makes enough repeat calls to the same
// symbol/granularity to hit Deriv's public ticks_history rate limit otherwise
// (observed directly running this file's own sweep during development).

/** Mirrors sliceAsOf() in backtest.server.ts / boom-sweep.server.ts (neither exports it). */
function sliceAsOf(candles: ServerCandle[], epoch: number, lookback: number): ServerCandle[] {
  let lo = 0, hi = candles.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].epoch <= epoch) { idx = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (idx < 0) return [];
  return candles.slice(Math.max(0, idx - lookback + 1), idx + 1);
}

/** M15 walk-forward for the liquidity-reversal engine. Entries carry
 * agreement=4 whenever a signal fires, matching bot-engine.server.ts's own
 * synthesis for the live "liquidity" preset — NOT a tournament-specific
 * choice, so comparisons stay faithful to what production actually does. */
export async function fetchAndAnalyzeSymbolLiquidity(
  symbolDeriv: string,
  testCandles: number,
  maxHoldMinutes: number,
): Promise<AnalyzedSymbol> {
  const holdCandleMargin = Math.ceil(maxHoldMinutes / 15) + 5;
  const c15m = await getCachedCandlesServer(symbolDeriv, 900, MIN_LIQUIDITY_CANDLES + testCandles + holdCandleMargin);
  const c5m = await getCachedCandlesServer(symbolDeriv, 300, testCandles * 3 + Math.ceil(maxHoldMinutes / 5) + 20);

  const start = Math.max(MIN_LIQUIDITY_CANDLES, c15m.length - testCandles);
  const end = c15m.length;
  const entries: RawEntry[] = [];
  for (let i = start; i < end; i++) {
    const sig = generateLiquidityReversalSignal(c15m.slice(0, i));
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
  return { entries, c5m };
}

/** M1+M5 walk-forward for Spike Hunter. Measures the engine STANDALONE — live
 * it only fires as a fallback when confluence confidence <75 on Boom/Crash,
 * so this number is not directly its live contribution, only its own edge if
 * it traded every qualifying setup. Report this distinction alongside the
 * numbers, don't let it read as "what Spike Hunter added live." */
export async function fetchAndAnalyzeSymbolSpikeHunter(
  symbolDeriv: string,
  testCandles: number,
  maxHoldMinutes: number,
): Promise<AnalyzedSymbol> {
  const M1_LOOKBACK = 60;
  const M5_LOOKBACK = 30;
  const holdCandleMargin = Math.ceil(maxHoldMinutes / 5) + 20;
  const [c1m, c5m] = await Promise.all([
    getCachedCandlesServer(symbolDeriv, 60, testCandles + M1_LOOKBACK + 5),
    getCachedCandlesServer(symbolDeriv, 300, Math.ceil((testCandles + M1_LOOKBACK) / 5) + M5_LOOKBACK + holdCandleMargin),
  ]);

  const start = Math.max(M1_LOOKBACK, c1m.length - testCandles);
  const end = c1m.length;
  const entries: RawEntry[] = [];
  for (let i = start; i < end; i++) {
    const asOfEpoch = c1m[i - 1].epoch;
    const m1Slice = c1m.slice(Math.max(0, i - M1_LOOKBACK), i);
    const m5Slice = sliceAsOf(c5m, asOfEpoch, M5_LOOKBACK);
    if (m1Slice.length < 30 || m5Slice.length < 15) continue;
    const sig = generateSpikeHunterSignal(symbolDeriv, m1Slice, m5Slice);
    if (!sig) continue;
    entries.push({
      entryEpoch: asOfEpoch,
      entryPrice: c1m[i - 1].close,
      direction: sig.direction,
      confidence: sig.confidence,
      agreement: 4,
      volatilityPct: 1,
    });
  }
  return { entries, c5m };
}

export interface StructuralEntry extends RawEntry {
  riskAbs: number;
  rewardAbs: number;
}

/** M1 walk-forward for the price-action scalping engine — the one engine
 * that's been live since 2026-08-02 with NO backtest coverage until now (see
 * the header comment in scalping-signal.server.ts, which cites a one-off
 * PF 1.79 result that has never been reproducible as a reusable function).
 * Keeps the signal's own riskAbs/rewardAbs instead of forcing it through a
 * shared combo % — simulateComboStructural() below is what actually prices
 * these the way the live engine does. */
export async function fetchAndAnalyzeSymbolScalping(
  symbolDeriv: string,
  testCandles: number,
  maxHoldMinutes: number,
): Promise<{ entries: StructuralEntry[]; c1m: ServerCandle[] }> {
  const holdCandleMargin = Math.ceil(maxHoldMinutes) + 10;
  const c1m = await getCachedCandlesServer(symbolDeriv, 60, MIN_M1_CANDLES + testCandles + holdCandleMargin);

  const start = Math.max(MIN_M1_CANDLES, c1m.length - testCandles);
  const end = c1m.length;
  const entries: StructuralEntry[] = [];
  for (let i = start; i < end; i++) {
    const sig = generateScalpingSignal(c1m.slice(0, i));
    if (!sig) continue;
    entries.push({
      entryEpoch: c1m[i - 1].epoch,
      entryPrice: c1m[i - 1].close,
      direction: sig.direction,
      confidence: sig.confidence,
      agreement: 4,
      volatilityPct: sig.volatilityPct,
      riskAbs: sig.riskAbs,
      rewardAbs: sig.rewardAbs,
    });
  }
  return { entries, c1m };
}

/** Same path-dependent walk as simulateCombo() (boom-sweep.server.ts), but
 * each entry prices its OWN stop/target via computeStructuralStopUsd()
 * (signal-core.ts — the exact function the live engine calls) instead of a
 * shared combo-level stopLossPctOfStake/takeProfitPctOfStake. RR_TARGET
 * (1.5, the signal's own guaranteed reward:risk ratio) gives the breakeven
 * win rate directly, no need to average per-entry ratios. */
export function simulateComboStructural(
  entries: StructuralEntry[],
  forwardCandles: ServerCandle[],
  stakeUsd: number,
  multiplierLevel: number,
  maxHoldMinutes: number,
  minConfidence = 0,
): SweepSimResult {
  const maxHoldSec = maxHoldMinutes * 60;
  const leveredNotional = stakeUsd * multiplierLevel;

  let wins = 0, losses = 0, stopHits = 0, targetHits = 0, timeExits = 0;
  let totalPnlUsd = 0, totalHoldMinutes = 0;

  for (const e of entries) {
    if (e.confidence < minConfidence) continue;
    const { stopLossUsd, takeProfitUsd } = computeStructuralStopUsd(stakeUsd, multiplierLevel, e.entryPrice, e.riskAbs, e.rewardAbs);
    const slPrice = e.direction === "CALL" ? e.entryPrice - e.riskAbs : e.entryPrice + e.riskAbs;
    const tpPrice = e.direction === "CALL" ? e.entryPrice + e.rewardAbs : e.entryPrice - e.rewardAbs;
    const forward = forwardCandles.filter((c) => c.epoch > e.entryEpoch && c.epoch <= e.entryEpoch + maxHoldSec);

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
  return {
    trades, wins,
    winRate: trades > 0 ? (wins / trades) * 100 : 0,
    breakEvenWinRate: (1 / (1 + RR_TARGET)) * 100,
    totalPnlUsd: Math.round(totalPnlUsd * 100) / 100,
    avgHoldMinutes: trades > 0 ? Math.round(totalHoldMinutes / trades) : 0,
    stopHits, targetHits, timeExits,
  };
}
