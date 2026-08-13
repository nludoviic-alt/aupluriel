/**
 * Future stake-scaling policy. It is an eligibility and audit layer only:
 * it never changes a saved stake and it is deliberately not consulted to
 * increase an order at runtime. The execution ceiling remains FINAL_STAKE =
 * MIN(requested, strategySuggested, maxRiskAllowed, brokerMaxAllowed).
 */
import type { Preset } from "./bot-engine.server";
import { getDb } from "./db.server";
import { hashConfig } from "./config-registry.server";
import type { AutoTraderConfig } from "./signal-core";

export const STAKE_SCALING_TIERS = [25, 50, 100, 250, 500, 1000] as const;
export type StakeScalingTier = (typeof STAKE_SCALING_TIERS)[number];

export type StakeScalingPolicy = {
  maxStakeUsd: StakeScalingTier;
  maxRiskPct: number;
  maxDailyLossUsd: number;
  maxExposureUsd: number;
  brokerMaxStakeUsd: number | null;
  minClosedTrades: number;
  minProfitFactor: number;
  maxDrawdownUsd: number;
};

export function scalingConfigFingerprint(config: AutoTraderConfig): string {
  const {
    stakeUsd: _stakeUsd,
    stakeMode: _stakeMode,
    stakePercent: _stakePercent,
    ...riskAndStrategy
  } = config;
  return hashConfig(riskAndStrategy as Record<string, unknown>);
}

const DEFAULT_POLICY: Readonly<StakeScalingPolicy> = Object.freeze({
  maxStakeUsd: 1000,
  maxRiskPct: 0.25,
  maxDailyLossUsd: 100,
  maxExposureUsd: 1000,
  brokerMaxStakeUsd: null,
  minClosedTrades: 100,
  minProfitFactor: 1.1,
  maxDrawdownUsd: 100,
});

const POLICIES: Record<Preset, StakeScalingPolicy> = {
  default: DEFAULT_POLICY,
  boom: DEFAULT_POLICY,
  crash: DEFAULT_POLICY,
  crash500: { ...DEFAULT_POLICY, maxStakeUsd: 500, maxExposureUsd: 500 },
  vol75: { ...DEFAULT_POLICY, maxStakeUsd: 500, maxExposureUsd: 500 },
  vol50: { ...DEFAULT_POLICY, maxStakeUsd: 500, maxExposureUsd: 500 },
  rb100: {
    ...DEFAULT_POLICY,
    maxStakeUsd: 100,
    maxDailyLossUsd: 2,
    maxExposureUsd: 100,
    maxDrawdownUsd: 2,
  },
  boom900: { ...DEFAULT_POLICY, maxStakeUsd: 25, maxExposureUsd: 25, brokerMaxStakeUsd: 0.9 },
  scalping: DEFAULT_POLICY,
  liquidity: DEFAULT_POLICY,
  gold: DEFAULT_POLICY,
  crash900: DEFAULT_POLICY,
  boomv2: DEFAULT_POLICY,
  scalpingv2: DEFAULT_POLICY,
  liquidityv2: DEFAULT_POLICY,
  goldv2: DEFAULT_POLICY,
};

export function getStakeScalingPolicy(preset: Preset): StakeScalingPolicy {
  return { ...POLICIES[preset] };
}

export function describeStakeScaling(
  requestedStake: number,
  finalStake: number,
  estimatedMaxLoss: number,
  equity: number | null,
  preset: Preset,
) {
  const policy = getStakeScalingPolicy(preset);
  // This is an effective ceiling for audit only, not an approved tier. A $1
  // legacy stake must not be misrepresented as a $25 promotion.
  const tier =
    finalStake >= STAKE_SCALING_TIERS[0]
      ? (STAKE_SCALING_TIERS.find((candidate) => finalStake <= candidate) ?? null)
      : null;
  return {
    tier,
    // No tier is ever auto-enabled. A higher requested stake still needs a
    // separate, human-approved config change after readiness review.
    reason:
      finalStake < requestedStake ? "RISK_OR_BROKER_REDUCED" : "MANUAL_REQUEST_ONLY_NO_AUTO_SCALE",
    estimatedMaxLoss,
    riskPctOfEquity: equity && equity > 0 ? (estimatedMaxLoss / equity) * 100 : null,
    policy,
  };
}

export function getApprovedStakeScalingTier(
  userId: number,
  preset: Preset,
): StakeScalingTier | null {
  const row = getDb()
    .prepare("SELECT approved_tier FROM stake_scaling_approvals WHERE user_id = ? AND preset = ?")
    .get(userId, preset) as { approved_tier?: number } | undefined;
  return row && STAKE_SCALING_TIERS.includes(row.approved_tier as StakeScalingTier)
    ? (row.approved_tier as StakeScalingTier)
    : null;
}

/** A persisted approval is effective only while strategy/risk inputs are the
 * same cohort fingerprint that earned it. Stake fields are excluded so the
 * one approved promotion itself does not invalidate its own evidence. */
export function getEffectiveApprovedStakeScalingTier(
  userId: number,
  preset: Preset,
  config: AutoTraderConfig,
  versions: { strategyVersion: string; riskVersion: string; executionVersion: string },
): StakeScalingTier | null {
  const row = getDb()
    .prepare(
      "SELECT approved_tier, config_hash, strategy_version, risk_version, execution_version FROM stake_scaling_approvals WHERE user_id = ? AND preset = ?",
    )
    .get(userId, preset) as
    | {
        approved_tier?: number;
        config_hash?: string;
        strategy_version?: string;
        risk_version?: string;
        execution_version?: string;
      }
    | undefined;
  if (
    !row ||
    row.config_hash !== scalingConfigFingerprint(config) ||
    row.strategy_version !== versions.strategyVersion ||
    row.risk_version !== versions.riskVersion ||
    row.execution_version !== versions.executionVersion
  )
    return null;
  return STAKE_SCALING_TIERS.includes(row.approved_tier as StakeScalingTier)
    ? (row.approved_tier as StakeScalingTier)
    : null;
}

function requiredTier(stake: number): StakeScalingTier | null {
  if (stake < STAKE_SCALING_TIERS[0]) return null;
  return STAKE_SCALING_TIERS.find((tier) => stake <= tier) ?? null;
}

/** Rejects a newly requested higher tier; it deliberately permits the saved
 * legacy stake so this architecture never alters a current configuration. */
export function assertStakeScalingApproved(
  userId: number,
  preset: Preset,
  currentConfig: AutoTraderConfig,
  nextConfig: AutoTraderConfig,
  versions: { strategyVersion: string; riskVersion: string; executionVersion: string },
): void {
  const policy = getStakeScalingPolicy(preset);
  if (nextConfig.stakeUsd > policy.maxStakeUsd)
    throw new Error(`La mise dépasse MAX_STAKE_USD ($${policy.maxStakeUsd}) du preset.`);
  const requestedTier = requiredTier(nextConfig.stakeUsd);
  const approvedTier = getEffectiveApprovedStakeScalingTier(
    userId,
    preset,
    currentConfig,
    versions,
  );
  const approval = getDb()
    .prepare("SELECT config_hash FROM stake_scaling_approvals WHERE user_id = ? AND preset = ?")
    .get(userId, preset) as { config_hash?: string } | undefined;
  const approvalMatches = approval?.config_hash === scalingConfigFingerprint(currentConfig);
  if (approval && !approvalMatches)
    throw new Error(
      "APPROVAL_CONFIG_MISMATCH: revalidation requise après modification de la stratégie ou du risque.",
    );
  if (approval && approval.config_hash !== scalingConfigFingerprint(nextConfig))
    throw new Error(
      "APPROVAL_CONFIG_MISMATCH: toute modification stratégie/risque exige une nouvelle validation de palier.",
    );
  const percentChanged =
    currentConfig.stakeMode !== nextConfig.stakeMode ||
    currentConfig.stakePercent !== nextConfig.stakePercent;
  if (percentChanged && !approvalMatches)
    throw new Error(
      "PERCENT_STAKE_REQUIRES_APPROVED_TIER: valide d'abord un palier avec une cohorte homogène.",
    );
  if (requestedTier === null && nextConfig.stakeUsd > STAKE_SCALING_TIERS.at(-1)!)
    throw new Error("La mise dépasse le dernier palier supporté ($1000).");
  if (!requestedTier && !percentChanged) return;
  if (!requestedTier)
    throw new Error("PERCENT_STAKE_REQUIRES_APPROVED_TIER: un palier explicite est requis.");
  if (!approvedTier || requestedTier > approvedTier) {
    throw new Error(
      `Palier $${requestedTier} non activé pour ${preset}. Une validation de performance et de sécurité est requise avant toute hausse de mise.`,
    );
  }
}

export function activateStakeScalingTier(input: {
  userId: number;
  preset: Preset;
  tier: StakeScalingTier;
  config: AutoTraderConfig;
  evidence: Parameters<typeof evaluateStakeScalingReadiness>[0] & {
    equityAtSignal: number | null;
    cohortScalingFingerprint: string | null;
    cohortVersions: {
      strategyVersion: string;
      riskVersion: string;
      executionVersion: string;
    } | null;
  };
}): { approved: true; tier: StakeScalingTier } {
  const policy = getStakeScalingPolicy(input.preset);
  if (input.tier > policy.maxStakeUsd)
    throw new Error(`Le palier $${input.tier} dépasse MAX_STAKE_USD du preset.`);
  if (policy.brokerMaxStakeUsd === null)
    throw new Error("BROKER_CONFIGURATION_REQUIRED: plafond broker inconnu.");
  if (input.tier > policy.brokerMaxStakeUsd)
    throw new Error(`Le palier $${input.tier} dépasse BROKER_MAX_STAKE.`);
  if (input.config.maxDailyLossUsd > policy.maxDailyLossUsd)
    throw new Error("MAX_DAILY_LOSS dépasse la politique du preset.");
  const requestedExposure = input.tier * Math.max(1, input.config.maxOpenPositions ?? 1);
  if (requestedExposure > policy.maxExposureUsd)
    throw new Error("MAX_EXPOSURE dépasse la politique du preset.");
  if (!input.evidence.equityAtSignal || input.evidence.equityAtSignal <= 0)
    throw new Error("EQUITY_EVIDENCE_REQUIRED: équité valide absente.");
  if ((input.tier / input.evidence.equityAtSignal) * 100 > policy.maxRiskPct)
    throw new Error("MAX_RISK_PCT dépasse la politique du preset.");
  if (input.evidence.cohortScalingFingerprint !== scalingConfigFingerprint(input.config))
    throw new Error(
      "COHORT_CONFIG_MISMATCH: la cohorte ne correspond pas à la configuration active.",
    );
  const readiness = evaluateStakeScalingReadiness(
    { ...input.evidence, brokerCapKnown: true },
    policy,
  );
  if (!readiness.eligible) throw new Error(`Activation refusée: ${readiness.reasons.join(", ")}`);
  getDb()
    .prepare(
      `
    INSERT INTO stake_scaling_approvals (user_id, preset, approved_tier, config_hash, strategy_version, risk_version, execution_version, evidence_json, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id, preset) DO UPDATE SET approved_tier = excluded.approved_tier, config_hash = excluded.config_hash, strategy_version = excluded.strategy_version, risk_version = excluded.risk_version, execution_version = excluded.execution_version, evidence_json = excluded.evidence_json, approved_at = excluded.approved_at
  `,
    )
    .run(
      input.userId,
      input.preset,
      input.tier,
      scalingConfigFingerprint(input.config),
      input.evidence.cohortVersions?.strategyVersion ?? null,
      input.evidence.cohortVersions?.riskVersion ?? null,
      input.evidence.cohortVersions?.executionVersion ?? null,
      JSON.stringify(input.evidence),
    );
  return { approved: true, tier: input.tier };
}

/** Server-derived evidence only: callers never supply performance metrics. */
export function getStakeScalingEvidence(userId: number, preset: Preset) {
  const db = getDb();
  const newest = db
    .prepare(
      `
    SELECT strategy_version, risk_version, execution_version, config_hash
    FROM bot_trades
    WHERE user_id = ? AND preset = ? AND status IN ('won', 'lost')
      AND strategy_version IS NOT NULL AND risk_version IS NOT NULL
      AND execution_version IS NOT NULL AND config_hash IS NOT NULL
    ORDER BY time DESC LIMIT 1
  `,
    )
    .get(userId, preset) as
    | {
        strategy_version: string;
        risk_version: string;
        execution_version: string;
        config_hash: string;
      }
    | undefined;
  const rows = newest
    ? (db
        .prepare(
          `
    SELECT profit, status FROM bot_trades
    WHERE user_id = ? AND preset = ? AND status IN ('won', 'lost')
      AND strategy_version = ? AND risk_version = ? AND execution_version = ? AND config_hash = ?
    ORDER BY time ASC
  `,
        )
        .all(
          userId,
          preset,
          newest.strategy_version,
          newest.risk_version,
          newest.execution_version,
          newest.config_hash,
        ) as { profit: number; status: string }[])
    : [];
  let grossWin = 0,
    grossLoss = 0,
    cumulative = 0,
    peak = 0,
    maxDrawdownUsd = 0;
  for (const row of rows) {
    const pnl = Number(row.profit) || 0;
    cumulative += pnl;
    peak = Math.max(peak, cumulative);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - cumulative);
    if (pnl > 0) grossWin += pnl;
    else grossLoss += -pnl;
  }
  const safety = db
    .prepare(
      `
    SELECT COUNT(*) AS n FROM safety_alerts
    WHERE user_id = ? AND preset = ? AND alert_type = 'STAKE_SAFETY_VIOLATION'
  `,
    )
    .get(userId, preset) as { n: number };
  const execution = db
    .prepare(
      `
    SELECT COUNT(*) AS n FROM bot_trades
    WHERE user_id = ? AND preset = ? AND status = 'error'
  `,
    )
    .get(userId, preset) as { n: number };
  const observationRow = newest
    ? (db
        .prepare(
          `
    SELECT risk_manager_decision FROM bot_trades
    WHERE user_id = ? AND preset = ? AND risk_manager_decision IS NOT NULL
      AND strategy_version = ? AND risk_version = ? AND execution_version = ? AND config_hash = ?
    ORDER BY time DESC LIMIT 1
  `,
        )
        .get(
          userId,
          preset,
          newest.strategy_version,
          newest.risk_version,
          newest.execution_version,
          newest.config_hash,
        ) as { risk_manager_decision?: string } | undefined)
    : undefined;
  let equityAtSignal: number | null = null;
  let cohortScalingFingerprint: string | null = null;
  try {
    const observation = JSON.parse(observationRow?.risk_manager_decision ?? "{}");
    const value = Number(observation?.equityAtSignal);
    equityAtSignal = Number.isFinite(value) && value > 0 ? value : null;
    cohortScalingFingerprint =
      typeof observation?.stakeScalingConfigFingerprint === "string"
        ? observation.stakeScalingConfigFingerprint
        : null;
  } catch {
    // A malformed legacy record is not sufficient evidence for a promotion.
  }
  return {
    closedTrades: rows.length,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancy: rows.length ? cumulative / rows.length : 0,
    maxDrawdownUsd,
    executionAnomalies: Number(execution.n) || 0,
    stakeSafetyViolations: Number(safety.n) || 0,
    homogeneousConfig: !!newest,
    brokerCapKnown: getStakeScalingPolicy(preset).brokerMaxStakeUsd !== null,
    equityAtSignal,
    cohortScalingFingerprint,
    cohortVersions: newest
      ? {
          strategyVersion: newest.strategy_version,
          riskVersion: newest.risk_version,
          executionVersion: newest.execution_version,
        }
      : null,
  };
}

export function evaluateStakeScalingReadiness(
  input: {
    closedTrades: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdownUsd: number;
    executionAnomalies: number;
    stakeSafetyViolations: number;
    homogeneousConfig: boolean;
    brokerCapKnown: boolean;
  },
  policy: StakeScalingPolicy,
) {
  const reasons = [
    input.closedTrades < policy.minClosedTrades && "INSUFFICIENT_SAMPLE",
    input.profitFactor < policy.minProfitFactor && "PF_TOO_LOW",
    input.expectancy <= 0 && "EXPECTANCY_NOT_POSITIVE",
    input.maxDrawdownUsd > policy.maxDrawdownUsd && "DRAWDOWN_TOO_HIGH",
    input.executionAnomalies > 0 && "EXECUTION_ANOMALY",
    input.stakeSafetyViolations > 0 && "STAKE_SAFETY_VIOLATION",
    !input.homogeneousConfig && "MIXED_COHORT",
    !input.brokerCapKnown && "BROKER_CAP_UNKNOWN",
  ].filter((reason): reason is string => !!reason);
  return { eligible: reasons.length === 0, reasons };
}
