// Server-safe replay of the live multi-timeframe pipeline, used by the
// periodic auto-backtest scheduler (auto-backtest.server.ts). Mirrors
// backtestMultiTf() in autotrader.ts but swaps every browser-only dependency
// for its server-side equivalent, since this runs unattended in a background
// Node process rather than a signed-in browser tab:
//   - fetchCandles (browser WS)        -> fetchCandlesServer
//   - getLearnedWeights (localStorage) -> getLearnedWeightsServer (DB)
//   - fetchRealPayoutRatio (live quote via an authenticated session)
//       -> fixed 0.85 fallback, the same value backtestMultiTf() itself
//          falls back to whenever a live quote isn't available.
import { fetchCandlesServer, type ServerCandle } from "./deriv.server";
import { atr, generateSignal } from "./indicators";
import { aggregateTfSignals, computeAtrStopUsd, GRANULARITY_SECONDS, TIMEFRAMES, type TfSignalMap, type Veto4hMode } from "./signal-core";
import { getLearnedWeightsServer } from "./indicator-weights.server";
import { generateLiquidityReversalSignal, MIN_LIQUIDITY_CANDLES } from "./liquidity-reversal-signal.server";

const GRAN_MINUTES: Record<string, number> = { "5m": 5, "15m": 15, "1H": 60, "4H": 240 };
const LOOKBACK = 250;
const FALLBACK_PAYOUT_PCT = 0.85;

/** Binary search: the trailing `lookback` candles that were already closed as of `epoch`. */
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

export interface ServerBacktestResult {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  breakEvenWinRate: number;
  payoutPct: number;
}

/** Replay the exact M15 liquidity-reversal detector without look-ahead. */
export async function backtestLiquidityReversalServer(
  symbolDeriv: string,
  { durationMinutes = 15, testCandles = 300 }: { durationMinutes?: number; testCandles?: number } = {},
): Promise<ServerBacktestResult> {
  const durationCandles = Math.max(1, Math.round(durationMinutes / 15));
  const candles = await fetchCandlesServer(symbolDeriv, 900, MIN_LIQUIDITY_CANDLES + testCandles + durationCandles + 5);
  let wins = 0;
  let losses = 0;
  const start = Math.max(MIN_LIQUIDITY_CANDLES, candles.length - testCandles - durationCandles);
  const end = candles.length - durationCandles;

  for (let i = start; i < end; i++) {
    // The setup only receives candles closed before entry; the expiry candle
    // is read afterwards, so the replay cannot see into the future.
    const signal = generateLiquidityReversalSignal(candles.slice(0, i));
    if (!signal) continue;
    const entry = candles[i - 1].close;
    const exit = candles[i - 1 + durationCandles].close;
    const won = signal.direction === "CALL" ? exit > entry : exit < entry;
    if (won) wins++; else losses++;
  }

  const trades = wins + losses;
  return {
    trades,
    wins,
    losses,
    winRate: trades ? wins / trades : 0,
    breakEvenWinRate: 1 / (1 + FALLBACK_PAYOUT_PCT),
    payoutPct: FALLBACK_PAYOUT_PCT,
  };
}

export async function backtestMultiTfServer(
  symbolDeriv: string,
  {
    minConfidence = 72,
    minTfAgreement = 4,
    durationMinutes = 15,
    testCandles = 150,
    veto4h = "strong-only",
    vetoDaily = "strong-only",
  }: {
    minConfidence?: number;
    minTfAgreement?: number;
    durationMinutes?: number;
    testCandles?: number;
    veto4h?: Veto4hMode;
    vetoDaily?: Veto4hMode;
  } = {},
): Promise<ServerBacktestResult> {
  const durationCandles = Math.max(1, Math.round(durationMinutes / 15));
  const testSpanMinutes = testCandles * 15;

  let weights: ReturnType<typeof getLearnedWeightsServer> | undefined;
  try { weights = getLearnedWeightsServer(symbolDeriv); } catch { /* base weights */ }

  const countFor = (tf: (typeof TIMEFRAMES)[number], margin = 20) =>
    Math.ceil((testSpanMinutes + LOOKBACK * GRAN_MINUTES[tf]) / GRAN_MINUTES[tf]) + margin;

  const [c5m, c15m, c1h, c4h] = await Promise.all([
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["5m"], countFor("5m")),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["15m"], countFor("15m") + durationCandles),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["1H"], countFor("1H")),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["4H"], countFor("4H")),
  ]);
  const bySrc: Record<string, ServerCandle[]> = { "5m": c5m, "15m": c15m, "1H": c1h, "4H": c4h };

  let wins = 0, losses = 0;
  const start = Math.max(LOOKBACK, c15m.length - testCandles - durationCandles);
  const end = c15m.length - durationCandles;

  for (let i = start; i < end; i++) {
    const asOfEpoch = c15m[i - 1].epoch;
    const tfSignals: TfSignalMap = {};
    for (const tf of TIMEFRAMES) {
      const slice = sliceAsOf(bySrc[tf], asOfEpoch, LOOKBACK);
      if (slice.length >= 60) tfSignals[tf] = generateSignal(slice, { weights });
    }
    const analysis = aggregateTfSignals(tfSignals, 0, 1, veto4h, 0, undefined, vetoDaily);
    if (!analysis.direction) continue;
    if (analysis.confidence < minConfidence) continue;
    if (analysis.agreement < minTfAgreement) continue;

    const entry = c15m[i - 1].close;
    const exit = c15m[i - 1 + durationCandles].close;
    const won = analysis.direction === "CALL" ? exit > entry : exit < entry;
    if (won) wins++; else losses++;
  }

  const trades = wins + losses;
  const winRate = trades > 0 ? wins / trades : 0;
  return {
    trades, wins, losses, winRate,
    breakEvenWinRate: 1 / (1 + FALLBACK_PAYOUT_PCT),
    payoutPct: FALLBACK_PAYOUT_PCT,
  };
}

// ─── OANDA-realistic backtest: path-dependent stop-loss / take-profit ────────
// backtestMultiTfServer judges a signal by price at a fixed future candle —
// accurate for Deriv's binary CALL/PUT (which really does resolve at a fixed
// expiry), but not for OANDA's margin-traded spot position, which exits the
// moment price actually touches its stop or target, whichever comes first.
// This walks forward 5m candle-by-candle from entry (using each candle's
// high/low, not just its close) so the measured win rate reflects what
// OANDA would really have done, including trades that time out at
// maxHoldMinutes without ever reaching either level.

export interface OandaBacktestResult {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  breakEvenWinRate: number; // derived from the stop:target ratio, not a fixed payout
  totalPnlUsd: number;
  avgHoldMinutes: number;
  stopHits: number;
  targetHits: number;
  timeExits: number;
  skippedIncomplete: number; // entries too close to "now" to have finished playing out
}

export async function backtestOandaSlTpServer(
  symbolDeriv: string,
  {
    minConfidence = 72,
    minTfAgreement = 4,
    veto4h = "strong-only",
    vetoDaily = "off",
    testCandles = 150,
    stakeUsd = 13.5,
    stopLossPctOfStake = 50,
    takeProfitPctOfStake = 100,
    leverage = 20,
    maxHoldMinutes = 720,
    atrStopMode = false,
    atrStopMultiple = 3.0,
    riskRewardRatio = 1.5,
  }: {
    minConfidence?: number;
    minTfAgreement?: number;
    veto4h?: Veto4hMode;
    vetoDaily?: Veto4hMode;
    testCandles?: number;
    stakeUsd?: number;
    stopLossPctOfStake?: number;
    takeProfitPctOfStake?: number;
    leverage?: number;
    maxHoldMinutes?: number;
    atrStopMode?: boolean;
    atrStopMultiple?: number;
    riskRewardRatio?: number;
  } = {},
): Promise<OandaBacktestResult> {
  const testSpanMinutes = testCandles * 15;
  const maxHoldSec = maxHoldMinutes * 60;
  const holdCandleMargin = Math.ceil(maxHoldMinutes / 5) + 20;

  let weights: ReturnType<typeof getLearnedWeightsServer> | undefined;
  try { weights = getLearnedWeightsServer(symbolDeriv); } catch { /* base weights */ }

  const countFor = (tf: (typeof TIMEFRAMES)[number], margin = 20) =>
    Math.ceil((testSpanMinutes + LOOKBACK * GRAN_MINUTES[tf]) / GRAN_MINUTES[tf]) + margin;

  const [c5m, c15m, c1h, c4h] = await Promise.all([
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["5m"], countFor("5m") + holdCandleMargin),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["15m"], countFor("15m")),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["1H"], countFor("1H")),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["4H"], countFor("4H")),
  ]);
  const bySrc: Record<string, ServerCandle[]> = { "5m": c5m, "15m": c15m, "1H": c1h, "4H": c4h };

  // Same math as the live OANDA order path (bot-engine.server.ts) — leverage
  // applied to notional so the stake-% (or ATR-derived) stop/target map to
  // real price moves. Fixed mode: same $ distance for every trade. ATR mode:
  // recomputed per signal from that signal's own volatilityPct (below).
  const leveredNotional = stakeUsd * leverage;
  const fixedStopLossUsd = stakeUsd * (stopLossPctOfStake / 100);
  const fixedTakeProfitUsd = stakeUsd * (takeProfitPctOfStake / 100);

  let wins = 0, losses = 0, stopHits = 0, targetHits = 0, timeExits = 0, skippedIncomplete = 0;
  let totalPnlUsd = 0, totalHoldMinutes = 0;

  const start = Math.max(LOOKBACK, c15m.length - testCandles);
  const end = c15m.length;
  const lastAvailableEpoch = c5m.length ? c5m[c5m.length - 1].epoch : 0;

  for (let i = start; i < end; i++) {
    const asOfEpoch = c15m[i - 1].epoch;
    const tfSignals: TfSignalMap = {};
    let slice15m: ServerCandle[] = [];
    for (const tf of TIMEFRAMES) {
      const slice = sliceAsOf(bySrc[tf], asOfEpoch, LOOKBACK);
      if (tf === "15m") slice15m = slice;
      if (slice.length >= 60) tfSignals[tf] = generateSignal(slice, { weights });
    }
    // Same ATR%-of-price calc analyzeSymbolCore uses for the live scan (the
    // 15m timeframe is the entry timeframe). aggregateTfSignals only ECHOES
    // back whatever volatilityPct it's given — it never derives it — so
    // passing a literal 0 here (as the plain-outcome backtestMultiTfServer
    // above does, harmlessly, since it never reads the field) silently
    // pinned every ATR stop to its 0.01%-floor regardless of atrStopMultiple
    // once reused for computeAtrStopUsd below (that was the bug: identical
    // results across atrStopMultiple 1.5/2.0/3.0 in the first pass).
    let volatilityPct = 0;
    if (slice15m.length >= 15) {
      const atrSeries = atr(slice15m.map((c) => c.high), slice15m.map((c) => c.low), slice15m.map((c) => c.close), 14);
      const atrNow = atrSeries[atrSeries.length - 1];
      const price = slice15m[slice15m.length - 1].close;
      if (atrNow !== null && price > 0) volatilityPct = (atrNow / price) * 100;
    }
    const analysis = aggregateTfSignals(tfSignals, volatilityPct, 1, veto4h, 0, undefined, vetoDaily);
    if (!analysis.direction) continue;
    if (analysis.confidence < minConfidence) continue;
    if (analysis.agreement < minTfAgreement) continue;

    const entryEpoch = c15m[i - 1].epoch;
    const entryPrice = c15m[i - 1].close;
    // Not enough forward 5m data yet to know how this one would have ended.
    if (entryEpoch + maxHoldSec > lastAvailableEpoch) { skippedIncomplete++; continue; }

    const { stopLossUsd, takeProfitUsd } = atrStopMode
      ? computeAtrStopUsd(stakeUsd, leverage, analysis.volatilityPct, atrStopMultiple, riskRewardRatio)
      : { stopLossUsd: fixedStopLossUsd, takeProfitUsd: fixedTakeProfitUsd };
    const stopFrac = stopLossUsd / leveredNotional;
    const tpFrac = takeProfitUsd / leveredNotional;
    const slPrice = analysis.direction === "CALL" ? entryPrice * (1 - stopFrac) : entryPrice * (1 + stopFrac);
    const tpPrice = analysis.direction === "CALL" ? entryPrice * (1 + tpFrac) : entryPrice * (1 - tpFrac);
    const forward = c5m.filter((c) => c.epoch > entryEpoch && c.epoch <= entryEpoch + maxHoldSec);

    let outcome: "stop" | "target" | "time" = "time";
    let exitPrice = forward.length ? forward[forward.length - 1].close : entryPrice;
    let exitEpoch = entryEpoch + maxHoldSec;
    for (const c of forward) {
      const hitStop = analysis.direction === "CALL" ? c.low <= slPrice : c.high >= slPrice;
      const hitTarget = analysis.direction === "CALL" ? c.high >= tpPrice : c.low <= tpPrice;
      // Both levels inside the same 5m candle: no intra-candle ordering in
      // OHLC data, so assume the worse outcome (stop) — conservative, never
      // overstates the edge.
      if (hitStop) { outcome = "stop"; exitPrice = slPrice; exitEpoch = c.epoch; break; }
      if (hitTarget) { outcome = "target"; exitPrice = tpPrice; exitEpoch = c.epoch; break; }
    }

    const pctMove = analysis.direction === "CALL" ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
    const pnlUsd = outcome === "stop" ? -stopLossUsd : outcome === "target" ? takeProfitUsd : leveredNotional * pctMove;
    const won = pnlUsd > 0;

    if (outcome === "stop") stopHits++;
    else if (outcome === "target") targetHits++;
    else timeExits++;
    won ? wins++ : losses++;
    totalPnlUsd += pnlUsd;
    totalHoldMinutes += (exitEpoch - entryEpoch) / 60;
  }

  const trades = wins + losses;
  // ATR mode's ratio is fixed (riskRewardRatio) even though the $ distance
  // varies trade to trade — same breakeven math as the fixed-% case.
  const effectiveRR = atrStopMode ? riskRewardRatio : takeProfitPctOfStake / stopLossPctOfStake;
  return {
    trades, wins, losses,
    winRate: trades > 0 ? wins / trades : 0,
    breakEvenWinRate: 1 / (1 + effectiveRR),
    totalPnlUsd: Math.round(totalPnlUsd * 100) / 100,
    avgHoldMinutes: trades > 0 ? Math.round(totalHoldMinutes / trades) : 0,
    stopHits, targetHits, timeExits, skippedIncomplete,
  };
}
