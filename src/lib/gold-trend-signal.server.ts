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

/** Candle requirements for the H1 → M15 → M5 → M1 pullback model. */
export const MIN_GOLD_PULLBACK_H1_CANDLES = EMA_SLOW + 15;
export const MIN_GOLD_PULLBACK_M15_CANDLES = 60;
export const MIN_GOLD_PULLBACK_M5_CANDLES = 60;
export const MIN_GOLD_PULLBACK_M1_CANDLES = 30;

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

function candleBodyRatio(candle: ServerCandle): number {
  return Math.abs(candle.close - candle.open) / Math.max(candle.high - candle.low, Number.EPSILON);
}

function slopesUp(line: (number | null)[], at: number, bars = 3): boolean {
  return line[at] !== null && line[at - bars] !== null && (line[at] as number) > (line[at - bars] as number);
}

function slopesDown(line: (number | null)[], at: number, bars = 3): boolean {
  return line[at] !== null && line[at - bars] !== null && (line[at] as number) < (line[at - bars] as number);
}

/**
 * Gold Trend Pullback, deliberately separate from the old M15 trend signal.
 * It only emits after the whole sequence requested by the preset exists:
 * H1 trend, M15 alignment, M5 retracement, then an M1 rejection/BOS trigger.
 */
export function generateGoldTrendPullbackSignal(
  h1: ServerCandle[],
  m15: ServerCandle[],
  m5: ServerCandle[],
  m1: ServerCandle[],
): GoldTrendSignal | null {
  if (
    h1.length < MIN_GOLD_PULLBACK_H1_CANDLES
    || m15.length < MIN_GOLD_PULLBACK_M15_CANDLES
    || m5.length < MIN_GOLD_PULLBACK_M5_CANDLES
    || m1.length < MIN_GOLD_PULLBACK_M1_CANDLES
  ) return null;

  const h1Close = h1.map((c) => c.close);
  const h1Last = h1Close.length - 1;
  const h1E20 = ema(h1Close, 20);
  const h1E50 = ema(h1Close, 50);
  const h1E200 = ema(h1Close, 200);
  const h1Rsi = rsi(h1Close, 14);
  const h1Values = [h1E20[h1Last], h1E50[h1Last], h1E200[h1Last], h1Rsi[h1Last]];
  if (h1Values.some((v) => v === null)) return null;
  const [h1_20, h1_50, h1_200, h1R] = h1Values as number[];
  const h1Price = h1Close[h1Last];

  const bullishH1 = h1Price > h1_200 && h1_20 > h1_50 && h1_50 > h1_200 && h1R >= 50;
  const bearishH1 = h1Price < h1_200 && h1_20 < h1_50 && h1_50 < h1_200 && h1R <= 50;
  if (!bullishH1 && !bearishH1) return null;
  const bullish = bullishH1;

  // H1 / 40: alignment is mandatory; slope and structure distinguish a
  // merely aligned market from a mature trend.
  const h1Slope = bullish ? slopesUp(h1E20, h1Last) && slopesUp(h1E50, h1Last) : slopesDown(h1E20, h1Last) && slopesDown(h1E50, h1Last);
  const h1Structure = bullish ? h1Price > h1Close[h1Last - 4] : h1Price < h1Close[h1Last - 4];
  let score = 25 + (h1Slope ? 10 : 0) + (h1Structure ? 5 : 0);
  if (score < 30) return null;
  const m15Close = m15.map((c) => c.close);
  const m15Last = m15Close.length - 1;
  const m15E20 = ema(m15Close, 20)[m15Last];
  const m15E50 = ema(m15Close, 50)[m15Last];
  const m15Rsi = rsi(m15Close, 14)[m15Last];
  if (m15E20 === null || m15E50 === null || m15Rsi === null) return null;
  const m15PriceAligned = bullish ? m15Close[m15Last] > m15E20 : m15Close[m15Last] < m15E20;
  const m15EmaAligned = bullish ? m15E20 > m15E50 : m15E20 < m15E50;
  const m15RsiAligned = bullish ? m15Rsi >= 50 : m15Rsi <= 50;
  const m15Score = (m15PriceAligned ? 8 : 0) + (m15EmaAligned ? 7 : 0) + (m15RsiAligned ? 5 : 0);
  if (m15Score < 15) return null;
  score += m15Score;

  const m5Close = m5.map((c) => c.close);
  const m5High = m5.map((c) => c.high);
  const m5Low = m5.map((c) => c.low);
  const m5Last = m5Close.length - 1;
  const m5E20 = ema(m5Close, 20)[m5Last];
  const m5E50 = ema(m5Close, 50)[m5Last];
  const m5Rsi = rsi(m5Close, 14)[m5Last];
  const m5Atr = atr(m5High, m5Low, m5Close, 14)[m5Last];
  if (m5E20 === null || m5E50 === null || m5Rsi === null || m5Atr === null) return null;
  const m5Recent = m5.slice(-5);
  const pullbackTouched = bullish
    ? m5Recent.some((c) => c.low <= m5E20 || c.low <= m5E50)
    : m5Recent.some((c) => c.high >= m5E20 || c.high >= m5E50);
  const pullbackRsi = bullish ? m5Rsi >= 40 && m5Rsi <= 55 : m5Rsi >= 45 && m5Rsi <= 60;
  const structureIntact = bullish ? m5Close[m5Last] >= m5E50 : m5Close[m5Last] <= m5E50;
  if (!pullbackTouched || !pullbackRsi || !structureIntact) return null;
  score += 20;

  const m1Close = m1.map((c) => c.close);
  const m1Last = m1Close.length - 1;
  const trigger = m1[m1Last];
  const priorMicro = m1.slice(-7, -1);
  const microHigh = Math.max(...priorMicro.map((c) => c.high));
  const microLow = Math.min(...priorMicro.map((c) => c.low));
  const triggerRange = Math.max(trigger.high - trigger.low, Number.EPSILON);
  const lowerWick = Math.min(trigger.open, trigger.close) - trigger.low;
  const upperWick = trigger.high - Math.max(trigger.open, trigger.close);
  const rejection = bullish
    ? trigger.close > trigger.open && lowerWick / triggerRange >= 0.35
    : trigger.close < trigger.open && upperWick / triggerRange >= 0.35;
  const bos = bullish ? trigger.close > microHigh : trigger.close < microLow;
  const m1RsiLine = rsi(m1Close, 14);
  const m1Rsi = m1RsiLine[m1Last];
  const m1PrevRsi = m1RsiLine[m1Last - 1];
  const momentum = m1Rsi !== null && m1PrevRsi !== null && (bullish ? m1Rsi > 50 && m1Rsi > m1PrevRsi : m1Rsi < 50 && m1Rsi < m1PrevRsi);
  if (!rejection || !bos || !momentum || candleBodyRatio(trigger) < 0.35) return null;
  score += 20;

  const confidence = Math.min(100, score);
  if (confidence < 85) return null;
  return {
    direction: bullish ? "CALL" : "PUT",
    confidence,
    volatilityPct: (m5Atr / m5Close[m5Last]) * 100,
    reason: `Trend Pullback ${bullish ? "haussier" : "baissier"} H1→M15, retracement M5 EMA20/50 puis rejet+BOS M1 (score ${confidence})`,
  };
}
