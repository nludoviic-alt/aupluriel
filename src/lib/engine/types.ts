export interface MarketDataReady {
  status: 'READY';
  symbol: string;
  candles: Array<{
    epoch: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
}

export interface MarketDataInvalid {
  status: 'INVALID';
  symbol: string;
  reason: string;
}

export type MarketDataCheck = MarketDataReady | MarketDataInvalid;

export type MarketRegimeType = 'TRENDING_BULL' | 'TRENDING_BEAR' | 'RANGING' | 'VOLATILE' | 'UNKNOWN';

export interface MarketRegime {
  regime: MarketRegimeType;
  confidence: number;
  adx?: number;
}

export interface Signal {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  confidence: number;
  tfAgreement: number;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface RiskAssessment {
  approved: boolean;
  reason?: string;
  adjustedStake?: number;
}

export interface CircuitBreakerState {
  tripped: boolean;
  reason?: string;
  trippedAt?: number;
  cooldownMs?: number;
}
