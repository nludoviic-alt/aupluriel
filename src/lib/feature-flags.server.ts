/**
 * Feature Flags pour l'Architecture Trading Synthétiques V3 (2026-08-12).
 * Permet de contrôler individuellement chaque module et de maintenir le système en
 * OBSERVATION MODE avant activation progressive des blocages.
 */

export interface FeatureFlags {
  GRANULAR_TIME_FILTER_ENABLED: boolean;
  TIME_SHADOW_MODE_ENABLED: boolean;
  STRATEGY_HEALTH_ENABLED: boolean;
  RISK_MANAGER_V2_ENABLED: boolean;
  DERIV_PROPOSAL_VALIDATION_ENABLED: boolean;
  OBSERVATION_MODE: boolean;
}

export const FEATURE_FLAGS: FeatureFlags = {
  GRANULAR_TIME_FILTER_ENABLED: true,
  TIME_SHADOW_MODE_ENABLED: true,
  STRATEGY_HEALTH_ENABLED: true,
  RISK_MANAGER_V2_ENABLED: true,
  DERIV_PROPOSAL_VALIDATION_ENABLED: true,
  // OBSERVATION_MODE = true : Calcule toutes les métriques, statuts et Shadow trades,
  // mais n'applique AUCUN blocage réel tant que les données n'ont pas été observées et validées.
  OBSERVATION_MODE: true,
};

export function getFeatureFlags(): FeatureFlags {
  return { ...FEATURE_FLAGS };
}

export function setFeatureFlag<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
  FEATURE_FLAGS[key] = value;
}
