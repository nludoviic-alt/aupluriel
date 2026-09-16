import type { Signal, RiskAssessment } from './types.js';

export interface RiskParams {
  maxDailyDrawdown: number;
  maxOpenPositions: number;
  minConfidence: number;
  minTfAgreement: number;
  stake: number;
}

export function evaluateRisk(
  signal: Signal,
  params: RiskParams,
  currentOpenPositions: number,
  currentDailyDrawdown: number
): RiskAssessment {
  if (currentDailyDrawdown >= params.maxDailyDrawdown) {
    return {
      approved: false,
      reason: `Daily drawdown limit reached ($${currentDailyDrawdown} >= $${params.maxDailyDrawdown})`,
    };
  }

  if (currentOpenPositions >= params.maxOpenPositions) {
    return {
      approved: false,
      reason: `Max open positions reached (${currentOpenPositions} >= ${params.maxOpenPositions})`,
    };
  }

  if (signal.confidence < params.minConfidence) {
    return {
      approved: false,
      reason: `Signal confidence below threshold (${signal.confidence} < ${params.minConfidence})`,
    };
  }

  if (signal.tfAgreement < params.minTfAgreement) {
    return {
      approved: false,
      reason: `Signal TF agreement below threshold (${signal.tfAgreement} < ${params.minTfAgreement})`,
    };
  }

  return {
    approved: true,
    adjustedStake: params.stake,
  };
}
