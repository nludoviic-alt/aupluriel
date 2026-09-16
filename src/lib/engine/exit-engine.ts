export interface Position {
  id: string;
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  action: 'BUY' | 'SELL';
  stopLoss?: number;
  takeProfit?: number;
  openedAt: number;
}

export interface ExitDecision {
  shouldExit: boolean;
  reason?: string;
}

export function evaluateExit(position: Position, now = Date.now()): ExitDecision {
  const { action, entryPrice, currentPrice, stopLoss, takeProfit } = position;

  // 1. Take Profit hit
  if (takeProfit !== undefined) {
    if (action === 'BUY' && currentPrice >= takeProfit) {
      return { shouldExit: true, reason: 'TAKE_PROFIT_HIT' };
    }
    if (action === 'SELL' && currentPrice <= takeProfit) {
      return { shouldExit: true, reason: 'TAKE_PROFIT_HIT' };
    }
  }

  // 2. Stop Loss hit
  if (stopLoss !== undefined) {
    if (action === 'BUY' && currentPrice <= stopLoss) {
      return { shouldExit: true, reason: 'STOP_LOSS_HIT' };
    }
    if (action === 'SELL' && currentPrice >= stopLoss) {
      return { shouldExit: true, reason: 'STOP_LOSS_HIT' };
    }
  }

  // 3. Maximum position duration check (e.g. 24 hours)
  const maxDurationMs = 24 * 60 * 60 * 1000;
  if (now - position.openedAt > maxDurationMs) {
    return { shouldExit: true, reason: 'MAX_DURATION_EXCEEDED' };
  }

  return { shouldExit: false };
}
