/**
 * Global Circuit Breaker / Kill Switch (Section 37 - Spécification V3).
 * Interrompt IMMÉDIATEMENT la prise de nouveaux ordres LIVE si une anomalie système grave est détectée :
 * Incohérence majeure de données, instabilité API Broker, déconnexion prolongée ou décalage de réconciliation.
 */

import { FEATURE_FLAGS } from "./feature-flags.server";

export interface CircuitBreakerState {
  isActive: boolean;
  reason?: string;
  triggeredAt?: string;
  autoTriggers: {
    dataQualityFailure: boolean;
    executionQualityCritical: boolean;
    reconciliationDesync: boolean;
    hardDailyDrawdownExceeded: boolean;
  };
}

class GlobalCircuitBreakerStore {
  private active = false;
  private reason?: string;
  private triggeredAt?: string;

  private dataQualityFailure = false;
  private executionQualityCritical = false;
  private reconciliationDesync = false;
  private hardDailyDrawdownExceeded = false;

  trigger(reason: string) {
    this.active = true;
    this.reason = reason;
    this.triggeredAt = new Date().toISOString();
    console.error(`[CIRCUIT_BREAKER] 🛑 KILL SWITCH ACTIVÉ : ${reason}`);
  }

  reset() {
    this.active = false;
    this.reason = undefined;
    this.triggeredAt = undefined;
    this.dataQualityFailure = false;
    this.executionQualityCritical = false;
    this.reconciliationDesync = false;
    this.hardDailyDrawdownExceeded = false;
    console.log(`[CIRCUIT_BREAKER] ✅ KILL SWITCH DÉSACTIVÉ / RÉINITIALISÉ`);
  }

  updateAutoTriggers(params: {
    dataQualityFailure?: boolean;
    executionQualityCritical?: boolean;
    reconciliationDesync?: boolean;
    hardDailyDrawdownExceeded?: boolean;
  }) {
    if (params.dataQualityFailure !== undefined) this.dataQualityFailure = params.dataQualityFailure;
    if (params.executionQualityCritical !== undefined) this.executionQualityCritical = params.executionQualityCritical;
    if (params.reconciliationDesync !== undefined) this.reconciliationDesync = params.reconciliationDesync;
    if (params.hardDailyDrawdownExceeded !== undefined) this.hardDailyDrawdownExceeded = params.hardDailyDrawdownExceeded;

    // Évaluation automatique
    if (this.hardDailyDrawdownExceeded && !this.active) {
      this.trigger("Drawdown Quotidien Maximal Dépassé (-2.0%)");
    } else if (this.reconciliationDesync && !this.active) {
      this.trigger("Désynchronisation Grave détectée par le Reconciliation Engine");
    }
  }

  getState(): CircuitBreakerState {
    const observationMode = FEATURE_FLAGS.OBSERVATION_MODE;
    return {
      isActive: observationMode ? false : this.active, // En mode observation, n'interrompt pas les ordres réels
      reason: this.reason ? (observationMode ? `[OBSERVATION] ${this.reason}` : this.reason) : undefined,
      triggeredAt: this.triggeredAt,
      autoTriggers: {
        dataQualityFailure: this.dataQualityFailure,
        executionQualityCritical: this.executionQualityCritical,
        reconciliationDesync: this.reconciliationDesync,
        hardDailyDrawdownExceeded: this.hardDailyDrawdownExceeded,
      },
    };
  }
}

export const circuitBreaker = new GlobalCircuitBreakerStore();
