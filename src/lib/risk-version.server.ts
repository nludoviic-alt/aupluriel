import { FEATURE_FLAGS } from "./feature-flags.server";

/**
 * Single source of truth for the live risk-tagging version. Reflects which
 * behavior actually ran: "R5" only once the loss-streak circuit breaker is
 * live, else "R4" (old permanent-latch behavior, unchanged). Always a
 * function, never a frozen constant — FEATURE_FLAGS is mutable at runtime
 * via setFeatureFlag(), and a value computed once at import time would go
 * stale if the flag is toggled without a process restart.
 */
export function currentRiskVersion(): string {
  return FEATURE_FLAGS.RISK_LOSS_STREAK_CIRCUIT_BREAKER_ENABLED ? "R5" : "R4";
}
