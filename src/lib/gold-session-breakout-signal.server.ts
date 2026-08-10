// Gold V2 is intentionally not a variation of the EMA trend engine.  It
// trades a session-range breakout only after the market retests the broken
// level and closes back in the breakout direction.  This keeps its journal a
// clean test of the London/New York breakout-and-pullback hypothesis.
import { atr, rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export interface GoldSessionBreakoutSignal {
  direction: "CALL" | "PUT";
  confidence: number;
  volatilityPct: number;
  reason: string;
}

const RANGE_LOOKBACK = 16;
export const MIN_GOLD_SESSION_CANDLES = RANGE_LOOKBACK + 8;

export function generateGoldSessionBreakoutSignal(candles: ServerCandle[]): GoldSessionBreakoutSignal | null {
  if (candles.length < MIN_GOLD_SESSION_CANDLES) return null;

  const last = candles.length - 1;
  const breakout = candles[last - 2];
  const pullback = candles[last - 1];
  const confirmation = candles[last];
  const rangeCandles = candles.slice(-(RANGE_LOOKBACK + 3), -3);
  const rangeHigh = Math.max(...rangeCandles.map((c) => c.high));
  const rangeLow = Math.min(...rangeCandles.map((c) => c.low));
  const rangeWidth = Math.max(rangeHigh - rangeLow, Number.EPSILON);

  const closes = candles.map((c) => c.close);
  const rsiLine = rsi(closes, 14);
  const rsiNow = rsiLine[last];
  const rsiPrev = rsiLine[last - 1];
  if (rsiNow === null || rsiPrev === null) return null;

  const atrNow = atr(candles.map((c) => c.high), candles.map((c) => c.low), closes, 14)[last];
  const volatilityPct = atrNow && confirmation.close > 0 ? (atrNow / confirmation.close) * 100 : 0;
  // Reject a dormant range and news-sized candles.  The relative range is
  // more stable than a fixed gold price distance across brokers.
  const body = Math.abs(confirmation.close - confirmation.open);
  const bodyRatio = body / Math.max(confirmation.high - confirmation.low, Number.EPSILON);
  if (bodyRatio < 0.35 || volatilityPct <= 0 || volatilityPct > 6) return null;

  const bullish =
    breakout.close > rangeHigh &&
    pullback.low <= rangeHigh && pullback.close >= rangeHigh &&
    confirmation.close > rangeHigh && confirmation.close > confirmation.open &&
    rsiNow >= 52 && rsiNow > rsiPrev;
  const bearish =
    breakout.close < rangeLow &&
    pullback.high >= rangeLow && pullback.close <= rangeLow &&
    confirmation.close < rangeLow && confirmation.close < confirmation.open &&
    rsiNow <= 48 && rsiNow < rsiPrev;
  if (!bullish && !bearish) return null;

  const extension = bullish
    ? (confirmation.close - rangeHigh) / rangeWidth
    : (rangeLow - confirmation.close) / rangeWidth;
  const confidence = Math.min(92, Math.max(78, Math.round(78 + bodyRatio * 10 + Math.min(4, extension * 20))));
  return {
    direction: bullish ? "CALL" : "PUT",
    confidence,
    volatilityPct,
    reason: `${bullish ? "Cassure haussière" : "Cassure baissière"} de range, pullback validé et reprise RSI (${rsiNow.toFixed(0)})`,
  };
}
