import type { MarketDataCheck } from './types.js';

export function validateMarketData(
  symbol: string,
  candles: Array<{ epoch: number; open: number; high: number; low: number; close: number }>
): MarketDataCheck {
  if (!candles || candles.length === 0) {
    return {
      status: 'INVALID',
      symbol,
      reason: 'No candles provided',
    };
  }

  if (candles.length < 5) {
    return {
      status: 'INVALID',
      symbol,
      reason: `Insufficient candle history (${candles.length} < 5)`,
    };
  }

  // Check for stale data (last candle older than 5 minutes)
  const lastCandle = candles[candles.length - 1];
  const now = Math.floor(Date.now() / 1000);
  if (now - lastCandle.epoch > 300) {
    return {
      status: 'INVALID',
      symbol,
      reason: `Stale candle data: ${now - lastCandle.epoch}s old`,
    };
  }

  return {
    status: 'READY',
    symbol,
    candles,
  };
}
