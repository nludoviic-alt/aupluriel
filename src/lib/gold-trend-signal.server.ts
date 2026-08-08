// Trend-following M15 signal engine for the "gold" preset — deliberately
// isolated from the Multi indicator engine (signal-core.ts/indicators.ts),
// for the same reason Scalping and Liquidity are: a different strategy that
// must not bleed its logic into the validated multi-TF confluence engine.
//
// WHY A DEDICATED ENGINE FOR GOLD:
// The Multi engine (generateSignal in indicators.ts) uses a mean-reversion
// filter that blocks buying when RSI > 70 and selling when RSI < 30. Gold
// can stay overbought/oversold for extended periods during strong trends —
// that filter systematically blocks the BEST trend-following entries on
// XAU/USD, which is the root cause of the 16.7% win rate observed on the
// 6 real production trades (−$37.46) that led to frxXAUUSD being excluded
// from DEFAULT_CONFIG.
//
// STRATEGY — Trend-Following Breakout (London/NY sessions only):
//   1. EMA50 > EMA200 → bullish trend (or EMA50 < EMA200 → bearish)
//   2. ADX > 25 → trend is strong enough to trade
//   3. RSI > 50 + rising → momentum confirms the trend (NOT mean-reversion:
//      RSI > 70 is treated as STRENGTH, not as a sell signal)
//   4. MACD histogram > 0 and expanding → momentum accelerating
//   5. ATR% between 1.5% and 4% → enough movement, not news-level chaos
//   6. Last candle body in the trend direction → price action confirmation
//
// This is a CALL/PUT binary-option signal (fixed expiry), not a multiplier
// position — gold on Deriv supports Rise/Fall from 15 minutes.
import { ema, rsi, macd, atr, adx } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export interface GoldTrendSignal {
  direction: "CALL" | "PUT";
  confidence: number;
  volatilityPct: number;
  reason: string;
}

// EMA periods — 50 and 200 are the standard trend-following pair.
// On M15 candles, EMA50 ≈ 12.5 hours of trading, EMA200 ≈ 50 hours ≈ 2 days.
const EMA_FAST = 50;
const EMA_SLOW = 200;
const RSI_PERIOD = 14;
const ATR_PERIOD = 14;
const ADX_PERIOD = 14;

// ATR% bounds — gold's natural intraday ATR% is 1.5-3.5%.
// Below 1.5% the market is too flat for a 30-min binary to work.
// Above 4% we're likely in a news spike — too unpredictable for binary.
const MIN_ATR_PCT = 1.5;
const MAX_ATR_PCT = 4.0;

// ADX threshold — 25 is the standard "trend is strong" level.
const MIN_ADX = 25;

// We need enough candles for EMA200 warm-up + a lookback buffer.
// EMA200 needs 200 candles to be fully warmed up; we add 15 for ATR/ADX
// calculation stability on the tail.
export const MIN_GOLD_CANDLES = EMA_SLOW + 15;

function volatilityPct(candles: ServerCandle[]): number {
  const tail = candles.slice(-15);
  if (tail.length < 2) return 0;
  const averageRange = tail.reduce((sum, c) => sum + (c.high - c.low), 0) / tail.length;
  const price = tail[tail.length - 1].close;
  return price > 0 ? (averageRange / price) * 100 : 0;
}

/**
 * Generate a trend-following signal for XAU/USD on M15 candles.
 *
 * Returns null when any of the five gates fails — the engine must skip the
 * symbol entirely (no trade), not emit a weak signal that would pass a low
 * confidence threshold. This is by design: gold's 16.7% historical win rate
 * came from trading in conditions where the strategy had no edge, so the
 * gates here are strict.
 */
export function generateGoldTrendSignal(candles: ServerCandle[]): GoldTrendSignal | null {
  if (candles.length < MIN_GOLD_CANDLES) return null;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const opens = candles.map((c) => c.open);
  const last = closes.length - 1;
  const price = closes[last];

  // ── 1. Volatility gate (ATR%) ──────────────────────────────────
  const atrArr = atr(highs, lows, closes, ATR_PERIOD);
  const atrNow = atrArr[last];
  if (atrNow === null) return null;
  const atrPct = (atrNow / price) * 100;
  if (atrPct < MIN_ATR_PCT || atrPct > MAX_ATR_PCT) return null;

  // ── 2. Trend direction (EMA50 vs EMA200) ───────────────────────
  const emaFast = ema(closes, EMA_FAST);
  const emaSlow = ema(closes, EMA_SLOW);
  const emaFastNow = emaFast[last];
  const emaSlowNow = emaSlow[last];
  if (emaFastNow === null || emaSlowNow === null) return null;

  const isBullTrend = emaFastNow > emaSlowNow;
  const isBearTrend = emaFastNow < emaSlowNow;
  if (!isBullTrend && !isBearTrend) return null;

  // ── 3. Trend strength (ADX) ────────────────────────────────────
  const { adx: adxArr, plusDI, minusDI } = adx(highs, lows, closes, ADX_PERIOD);
  const adxNow = adxArr[last];
  if (adxNow === null || adxNow < MIN_ADX) return null;

  // +DI / -DI must agree with the EMA trend direction.
  const pdiNow = plusDI[last];
  const mdiNow = minusDI[last];
  if (pdiNow === null || mdiNow === null) return null;
  if (isBullTrend && pdiNow <= mdiNow) return null;
  if (isBearTrend && mdiNow <= pdiNow) return null;

  // ── 4. RSI momentum confirmation (trend-following, NOT mean-reversion) ──
  // Bullish: RSI > 50 and rising. RSI > 70 is STRENGTH, not a sell signal.
  // Bearish: RSI < 50 and falling. RSI < 30 is STRENGTH, not a buy signal.
  const rsiLine = rsi(closes, RSI_PERIOD);
  const rsiNow = rsiLine[last];
  const rsiPrev = rsiLine[last - 1];
  if (rsiNow === null || rsiPrev === null) return null;

  const bullMomentum = rsiNow > 50 && rsiNow > rsiPrev;
  const bearMomentum = rsiNow < 50 && rsiNow < rsiPrev;
  if (isBullTrend && !bullMomentum) return null;
  if (isBearTrend && !bearMomentum) return null;

  // ── 5. MACD histogram direction ────────────────────────────────
  const { histogram: hist } = macd(closes);
  const histNow = hist[last];
  const histPrev = hist[last - 1];
  if (histNow === null || histPrev === null) return null;

  // Histogram must be in the trend direction AND expanding (accelerating).
  const bullMacd = histNow > 0 && histNow > histPrev;
  const bearMacd = histNow < 0 && histNow < histPrev;
  if (isBullTrend && !bullMacd) return null;
  if (isBearTrend && !bearMacd) return null;

  // ── 6. Last closed candle body confirms direction ──────────────
  const prevCandle = candles[last - 1];
  const prevBody = prevCandle.close - prevCandle.open;
  const prevRange = Math.max(prevCandle.high - prevCandle.low, Number.EPSILON);
  const prevBodyRatio = Math.abs(prevBody) / prevRange;

  // Require at least a 30% body in the trend direction — a doji or an
  // opposite-color candle after 5 confirming indicators is a warning that
  // the move is stalling right at entry.
  if (isBullTrend && (prevBody <= 0 || prevBodyRatio < 0.3)) return null;
  if (isBearTrend && (prevBody >= 0 || prevBodyRatio < 0.3)) return null;

  // ── Confidence scoring ─────────────────────────────────────────
  // Base 75 (above the 55-70 typical range of the Multi engine, reflecting
  // that 5 independent gates all agreed), then bonuses for strength.
  let confidence = 75;

  // ADX bonus: stronger trend = higher confidence.
  if (adxNow > 35) confidence += 10;
  else if (adxNow > 30) confidence += 6;
  else confidence += 3;

  // RSI strength bonus: in trend-following, RSI > 70 (bull) or < 30 (bear)
  // is a positive signal, not a warning.
  if (isBullTrend && rsiNow > 70) confidence += 5;
  else if (isBearTrend && rsiNow < 30) confidence += 5;

  // EMA separation bonus: wider gap = more established trend.
  const emaSepPct = Math.abs(emaFastNow - emaSlowNow) / emaSlowNow * 100;
  if (emaSepPct > 0.5) confidence += 5;

  // Candle body strength bonus.
  if (prevBodyRatio > 0.6) confidence += 5;

  confidence = Math.min(95, Math.max(75, Math.round(confidence)));

  const volPct = volatilityPct(candles);

  if (isBullTrend) {
    return {
      direction: "CALL",
      confidence,
      volatilityPct: volPct,
      reason: `Tendance haussière EMA${EMA_FAST}>EMA${EMA_SLOW}, ADX ${adxNow.toFixed(0)}, RSI ${rsiNow.toFixed(0)} en momentum, MACD haussier`,
    };
  }
  return {
    direction: "PUT",
    confidence,
    volatilityPct: volPct,
    reason: `Tendance baissière EMA${EMA_FAST}<EMA${EMA_SLOW}, ADX ${adxNow.toFixed(0)}, RSI ${rsiNow.toFixed(0)} en repli, MACD baissier`,
  };
}
