import type { MarketRegime } from './types.js';

export function analyzeMarketRegime(
  candles: Array<{ open: number; high: number; low: number; close: number }>
): MarketRegime {
  if (!candles || candles.length < 5) {
    return { regime: 'UNKNOWN', confidence: 0 };
  }

  const closes = candles.map((c) => c.close);
  const first = closes[0];
  const last = closes[closes.length - 1];
  const changePercent = ((last - first) / first) * 100;

  if (changePercent > 0.5) {
    return { regime: 'TRENDING_BULL', confidence: 0.85 };
  } else if (changePercent < -0.5) {
    return { regime: 'TRENDING_BEAR', confidence: 0.85 };
  } else {
    return { regime: 'RANGING', confidence: 0.75 };
  }
}
