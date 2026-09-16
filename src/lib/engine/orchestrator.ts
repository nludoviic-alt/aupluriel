import { validateMarketData } from './data-quality-guard.js';
import { analyzeMarketRegime } from './market-regime-analyst.js';
import { evaluateRisk, type RiskParams } from './risk-manager.js';
import { CircuitBreaker } from './circuit-breaker.js';
import type { Signal, RiskAssessment } from './types.js';

export interface OrchestratorInput {
  symbol: string;
  candles: Array<{ epoch: number; open: number; high: number; low: number; close: number }>;
  signal: Signal;
  riskParams: RiskParams;
  openPositionsCount: number;
  dailyDrawdown: number;
}

export interface OrchestratorOutput {
  status: 'EXECUTED' | 'REJECTED';
  reason?: string;
  riskAssessment?: RiskAssessment;
}

export class EngineOrchestrator {
  private circuitBreaker = new CircuitBreaker();

  public processSignal(input: OrchestratorInput): OrchestratorOutput {
    if (this.circuitBreaker.isTripped()) {
      return {
        status: 'REJECTED',
        reason: 'Circuit breaker is TRIPPED',
      };
    }

    const dataCheck = validateMarketData(input.symbol, input.candles);
    if (dataCheck.status === 'INVALID') {
      return {
        status: 'REJECTED',
        reason: `Invalid market data: ${dataCheck.reason}`,
      };
    }

    const regime = analyzeMarketRegime(input.candles);
    if (regime.regime === 'UNKNOWN') {
      return {
        status: 'REJECTED',
        reason: 'Market regime UNKNOWN',
      };
    }

    const riskAssessment = evaluateRisk(
      input.signal,
      input.riskParams,
      input.openPositionsCount,
      input.dailyDrawdown
    );

    if (!riskAssessment.approved) {
      return {
        status: 'REJECTED',
        reason: riskAssessment.reason,
        riskAssessment,
      };
    }

    return {
      status: 'EXECUTED',
      riskAssessment,
    };
  }

  public recordTradeOutcome(profit: number): void {
    this.circuitBreaker.recordTrade(profit);
  }
}
