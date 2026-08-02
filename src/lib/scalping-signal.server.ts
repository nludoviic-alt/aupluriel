// Pure price-action signal for the "Scalping Démo" plan (Ludovic, 2026-08-02):
// M5 trend (price vs SMA20, MA rising/falling) -> M1 pullback to SMA10
// without an impulsive move right before -> M1 confirmation candle ->
// structural stop (last swing low/high) -> 1.5R target.
//
// Deliberately independent of signal-core.ts's multi-indicator/4-timeframe
// engine (5m/15m/1H/4H) — this trades M1/M5, a different and much finer
// granularity, so it can't reuse aggregateTfSignals. Validated by backtest on
// real Deriv M1 candles before being wired into bot-engine.server.ts: BOOM500
// averaged +0.35R/trade (PF 1.79, 895 trades over 13.9 days) WITHOUT a
// breakeven stop-move (Deriv contract_update isn't wired in this codebase
// yet, so the live engine can't amend an open Multiplier's stop — that's a
// possible fast-follow, not blocking). Volatility 10 and Volatility 10 (1s)
// were both far weaker on the same test — that's why SCALPING_SYMBOLS stays
// BOOM500-only, not a free choice of instrument.
import type { ServerCandle } from "./deriv.server";

export interface ScalpingSignal {
  direction: "CALL" | "PUT";
  entryPrice: number;
  riskAbs: number;   // |entry - stop|, absolute price distance
  rewardAbs: number; // riskAbs * RR_TARGET
  volatilityPct: number; // M1 ATR% — feeds the existing maxVolatilityPct gate
  confidence: number; // 0-100 composite (trend strength + confirmation strength) — feeds minConfidence/maxConfidence
}

const SWING_LOOKBACK = 5;
const PULLBACK_WINDOW = 5;
const M5_TREND_PERIOD = 20;
const M1_PULLBACK_PERIOD = 10;
export const RR_TARGET = 1.5;
// M5_TREND_PERIOD*5 + PULLBACK_WINDOW + a small buffer for the ATR warm-up.
export const MIN_M1_CANDLES = M5_TREND_PERIOD * 5 + PULLBACK_WINDOW + 20;

function sma(values: number[], period: number, idx: number): number | null {
  if (idx < period - 1) return null;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += values[i];
  return sum / period;
}

function buildM5Closes(m1: ServerCandle[]): number[] {
  const closes: number[] = [];
  for (let i = 0; i + 5 <= m1.length; i += 5) closes.push(m1[i + 4].close);
  return closes;
}

/** M1 ATR% on the same candles, for the shared maxVolatilityPct scan gate —
 * same formula as analyzeSymbolCore's 15m ATR%, just on M1 data. */
function m1AtrPct(m1: ServerCandle[]): number {
  const n = m1.length;
  if (n < 15) return 0;
  const tail = m1.slice(-15);
  let trSum = 0;
  for (let i = 1; i < tail.length; i++) {
    trSum += Math.max(
      tail[i].high - tail[i].low,
      Math.abs(tail[i].high - tail[i - 1].close),
      Math.abs(tail[i].low - tail[i - 1].close),
    );
  }
  const atrNow = trSum / (tail.length - 1);
  const price = tail[tail.length - 1].close;
  return price > 0 ? (atrNow / price) * 100 : 0;
}

/**
 * Evaluates the entry rules against the MOST RECENT candle in `m1` (must be
 * the latest CLOSED one — called once per scan tick, matching bot-engine's
 * 60s SCAN_MS cadence). `m1` must be ascending by epoch.
 */
export function generateScalpingSignal(m1: ServerCandle[]): ScalpingSignal | null {
  const i = m1.length - 1;
  if (i < MIN_M1_CANDLES - 1) return null;

  const m5Closes = buildM5Closes(m1);
  // buildM5Closes only ever returns COMPLETE quintets, so its last element's
  // closing M1 index is (5*m5Closes.length - 1). The backtest this was
  // validated against always used a bar that closed STRICTLY BEFORE the
  // current M1 candle i — when i is itself the closing leg of the latest
  // quintet ((i+1)%5===0), that quintet's own bar must be excluded (it
  // "closes AT i", not before), falling back to the one before it.
  const lastClosedM5Idx = (i + 1) % 5 === 0 ? m5Closes.length - 2 : m5Closes.length - 1;
  if (lastClosedM5Idx < M5_TREND_PERIOD - 1) return null;

  const m5Ma = sma(m5Closes, M5_TREND_PERIOD, lastClosedM5Idx);
  const m5MaPrev = sma(m5Closes, M5_TREND_PERIOD, Math.max(0, lastClosedM5Idx - 3));
  if (m5Ma === null || m5MaPrev === null || m5Ma === 0) return null;
  const m5Close = m5Closes[lastClosedM5Idx];

  const bullTrend = m5Close > m5Ma && m5Ma > m5MaPrev;
  const bearTrend = m5Close < m5Ma && m5Ma < m5MaPrev;
  if (!bullTrend && !bearTrend) return null;

  const m1Closes = m1.map((c) => c.close);
  const m1Ma = sma(m1Closes, M1_PULLBACK_PERIOD, i);
  if (m1Ma === null) return null;

  const swingWindow = m1.slice(i - SWING_LOOKBACK, i);
  const swingLow = Math.min(...swingWindow.map((c) => c.low));
  const swingHigh = Math.max(...swingWindow.map((c) => c.high));

  const recentWindow = m1.slice(i - PULLBACK_WINDOW, i);
  const pulledBack = bullTrend
    ? recentWindow.some((c) => c.low <= m1Ma * 1.0005)
    : recentWindow.some((c) => c.high >= m1Ma * 0.9995);
  if (!pulledBack) return null;

  // "Ne pas entrer si le marché vient de faire une grande impulsion" — skip
  // if a recent candle's range dwarfs the window's average (crude proxy).
  const avgRange = recentWindow.reduce((s, c) => s + (c.high - c.low), 0) / recentWindow.length;
  const impulsive = recentWindow.some((c) => (c.high - c.low) > avgRange * 3);
  if (impulsive) return null;

  const cur = m1[i];
  const bullConfirm = bullTrend && cur.close > cur.open && cur.close > m1Ma;
  const bearConfirm = bearTrend && cur.close < cur.open && cur.close < m1Ma;
  if (!bullConfirm && !bearConfirm) return null;

  const direction: "CALL" | "PUT" = bullConfirm ? "CALL" : "PUT";
  const entryPrice = cur.close;
  const stopPrice = direction === "CALL" ? swingLow : swingHigh;
  const riskAbs = Math.abs(entryPrice - stopPrice);
  if (riskAbs <= 0) return null;
  const rewardAbs = riskAbs * RR_TARGET;

  const trendStrengthPct = Math.min(1, Math.abs(m5Close - m5Ma) / m5Ma / 0.003); // 0.3% move = full marks
  const bodyPct = Math.min(1, Math.abs(cur.close - cur.open) / (avgRange || 1));
  const confidence = Math.min(100, Math.round(70 + trendStrengthPct * 15 + bodyPct * 15));

  return { direction, entryPrice, riskAbs, rewardAbs, volatilityPct: m1AtrPct(m1), confidence };
}
