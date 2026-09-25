// Experimental M15 liquidity-reversal setup. It is deliberately isolated from
// the Multi indicator engine: a sweep through a recent high/low only counts
// once price closes back inside the range and RSI turns with the reversal.
// This module is used by the demo-only "liquidity" preset.
import { rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export interface LiquidityReversalSignal {
  direction: "CALL" | "PUT";
  confidence: number;
  volatilityPct: number;
  reason: string;
}

export const LIQUIDITY_LOOKBACK = 30;
export const MIN_LIQUIDITY_CANDLES = LIQUIDITY_LOOKBACK + 15;

function volatilityPct(candles: ServerCandle[]): number {
  const tail = candles.slice(-15);
  if (tail.length < 2) return 0;
  const averageRange = tail.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / tail.length;
  const price = tail[tail.length - 1].close;
  return price > 0 ? (averageRange / price) * 100 : 0;
}

/**
 * Latest closed M15 candle must sweep the previous 20-candle range, close
 * back through that level, and have a turning RSI. This is a deterministic
 * definition of the liquidity-reversal idea, not a vague visual judgement.
 */
export function generateLiquidityReversalSignal(candles: ServerCandle[]): LiquidityReversalSignal | null {
  if (candles.length < MIN_LIQUIDITY_CANDLES) return null;
  const current = candles[candles.length - 1];
  const previous = candles.slice(-(LIQUIDITY_LOOKBACK + 1), -1);
  const priorLow = Math.min(...previous.map((c) => c.low));
  const priorHigh = Math.max(...previous.map((c) => c.high));
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const bodyRatio = Math.abs(current.close - current.open) / range;
  if (bodyRatio < 0.25) return null;

  const rsiLine = rsi(candles.map((c) => c.close), 14);
  const currentRsi = rsiLine[rsiLine.length - 1];
  const previousRsi = rsiLine[rsiLine.length - 2];
  if (currentRsi === null || previousRsi === null) return null;

  const sweptLow = current.low < priorLow && current.close > priorLow && current.close > current.open;
  const sweptHigh = current.high > priorHigh && current.close < priorHigh && current.close < current.open;
  const rsiTurnsUp = currentRsi > previousRsi && currentRsi <= 60;
  const rsiTurnsDown = currentRsi < previousRsi && currentRsi >= 40;
  const volatility = volatilityPct(candles);

  if (sweptLow && rsiTurnsUp) {
    return {
      direction: "CALL",
      confidence: Math.min(95, Math.round(80 + bodyRatio * 10 + Math.min(5, currentRsi - previousRsi))),
      volatilityPct: volatility,
      reason: "Balayage du plus bas 20 bougies, réintégration haussière et RSI en reprise",
    };
  }
  if (sweptHigh && rsiTurnsDown) {
    return {
      direction: "PUT",
      confidence: Math.min(95, Math.round(80 + bodyRatio * 10 + Math.min(5, previousRsi - currentRsi))),
      volatilityPct: volatility,
      reason: "Balayage du plus haut 20 bougies, réintégration baissière et RSI en repli",
    };
  }
  return null;
}
