/**
 * Feature Flags pour l'Architecture Trading Synthétiques V3 (2026-08-12).
 * Permet de contrôler individuellement chaque module et de maintenir le système en
 * OBSERVATION MODE avant activation progressive des blocages.
 */

export interface FeatureFlags {
  DATA_QUALITY_GUARD_ENABLED: boolean;
  MARKET_REGIME_ROUTER_ENABLED: boolean;
  GRANULAR_TIME_FILTER_ENABLED: boolean;
  TIME_SHADOW_MODE_ENABLED: boolean;
  STRATEGY_HEALTH_ENABLED: boolean;
  RISK_MANAGER_V2_ENABLED: boolean;
  DERIV_PROPOSAL_VALIDATION_ENABLED: boolean;
  EXECUTION_MONITOR_ENABLED: boolean;
  RECONCILIATION_ENABLED: boolean;
  CIRCUIT_BREAKER_ENABLED: boolean;
  OBSERVATION_MODE: boolean;
  // --- New P1-P7 Quant Architecture Flags ---
  PERFORMANCE_DRIFT_ENABLED: boolean;
  AUTO_SHADOW_ENABLED: boolean;
  NEWS_GUARD_ENABLED: boolean;
  KELLY_RESEARCH_ENABLED: boolean;
  KELLY_LIVE_ENABLED: boolean; // Strictly FALSE
  CROSS_ACCOUNT_EXPOSURE_ENABLED: boolean;
  REPLAY_ENGINE_ENABLED: boolean;
  WALK_FORWARD_ENABLED: boolean;
  RESTART_RECOVERY_ENABLED: boolean;
  CONFIG_REGISTRY_ENABLED: boolean;
  CHANGE_IMPACT_TRACKER_ENABLED: boolean;
  // --- R5: Loss Streak Circuit Breaker ---
  RISK_LOSS_STREAK_CIRCUIT_BREAKER_ENABLED: boolean;
}

export const FEATURE_FLAGS: FeatureFlags = {
  DATA_QUALITY_GUARD_ENABLED: false,
  MARKET_REGIME_ROUTER_ENABLED: true,
  GRANULAR_TIME_FILTER_ENABLED: true,
  TIME_SHADOW_MODE_ENABLED: true,
  STRATEGY_HEALTH_ENABLED: true,
  RISK_MANAGER_V2_ENABLED: true,
  DERIV_PROPOSAL_VALIDATION_ENABLED: true,
  EXECUTION_MONITOR_ENABLED: true,
  RECONCILIATION_ENABLED: true,
  CIRCUIT_BREAKER_ENABLED: true,
  OBSERVATION_MODE: true,
  // --- New P1-P7 Quant Architecture Flags ---
  PERFORMANCE_DRIFT_ENABLED: true,
  AUTO_SHADOW_ENABLED: true,
  NEWS_GUARD_ENABLED: false, // Gold/Forex only
  KELLY_RESEARCH_ENABLED: true,
  KELLY_LIVE_ENABLED: false, // Strictly FALSE
  CROSS_ACCOUNT_EXPOSURE_ENABLED: true, // Observation Mode
  REPLAY_ENGINE_ENABLED: true,
  WALK_FORWARD_ENABLED: true,
  RESTART_RECOVERY_ENABLED: true,
  CONFIG_REGISTRY_ENABLED: true,
  CHANGE_IMPACT_TRACKER_ENABLED: true,
  // --- R5: Loss Streak Circuit Breaker ---
  // TRUE = new NORMAL/PAUSED/RECOVERY breaker (risk_version becomes "R5").
  // Backfill run and verified 2026-08-16 against production: CRASH_ENGINE
  // (Ludovic/Juluo/Stella) and VOL75_1S_TREND_PULLBACK (Ludovic/Juluo) all
  // initialized into RECOVERY from their real last-loss timestamps. Set
  // back to false for an instant rollback to the old permanent-latch
  // behavior without touching the DB.
  RISK_LOSS_STREAK_CIRCUIT_BREAKER_ENABLED: true,
};

export function getFeatureFlags(): FeatureFlags {
  return { ...FEATURE_FLAGS };
}

export function setFeatureFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
  FEATURE_FLAGS[key] = value;
}
