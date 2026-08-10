/**
 * Guardrails for an opportunity-led MANUAL order.  They are intentionally
 * tighter than the automatic preset: a human-clicked order must never turn a
 * small experimental thesis into a $50 discretionary bet.
 *
 * Evidence used (VPS, 2026-08-10): CRASH900 MULTDOWN PF 1.60 / +$181.64 on
 * 289 closed bot trades; BOOM500 MULTUP is only near break-even (PF 1.01),
 * while MULTDOWN is negative (PF 0.81).  This is risk control, not a promise
 * of profitability.
 */
export type ManualGuardPreset = "boom" | "boomv2" | "crash" | "crash900";

export interface ManualOpportunityGuard {
  label: string;
  direction: "CALL" | "PUT";
  stakeUsd: number;
  maxDailyLossUsd: number;
  maxTradesPerDay: number;
  maxConsecutiveLosses: number;
  minConfidence: number;
  maxConfidence: number;
  minTfAgreement: number;
}

export const MANUAL_OPPORTUNITY_GUARDS: Record<ManualGuardPreset, ManualOpportunityGuard> = {
  boom: {
    label: "Boom500 · validation haussière",
    direction: "CALL",
    stakeUsd: 25,
    maxDailyLossUsd: 15,
    maxTradesPerDay: 5,
    maxConsecutiveLosses: 3,
    minConfidence: 85,
    maxConfidence: 89,
    minTfAgreement: 4,
  },
  boomv2: {
    label: "Boom500 V2 · validation haussière",
    direction: "CALL",
    stakeUsd: 25,
    maxDailyLossUsd: 15,
    maxTradesPerDay: 5,
    maxConsecutiveLosses: 3,
    minConfidence: 85,
    maxConfidence: 89,
    minTfAgreement: 4,
  },
  crash: {
    label: "Crash900 · continuation baissière",
    direction: "PUT",
    stakeUsd: 25,
    maxDailyLossUsd: 15,
    maxTradesPerDay: 5,
    maxConsecutiveLosses: 3,
    minConfidence: 85,
    maxConfidence: 100,
    minTfAgreement: 3,
  },
  crash900: {
    label: "Crash900 · continuation baissière",
    direction: "PUT",
    stakeUsd: 25,
    maxDailyLossUsd: 15,
    maxTradesPerDay: 5,
    maxConsecutiveLosses: 3,
    minConfidence: 85,
    maxConfidence: 100,
    minTfAgreement: 3,
  },
};

export function guardForManualPreset(preset: string): ManualOpportunityGuard | null {
  return preset in MANUAL_OPPORTUNITY_GUARDS
    ? MANUAL_OPPORTUNITY_GUARDS[preset as ManualGuardPreset]
    : null;
}
