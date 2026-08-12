/**
 * Execution Quality Monitor & Execution Cooldown (Sections 32 & 33 - Spécification V3).
 * Mesure en temps réel la qualité de l'exécution Deriv : latence proposal, latence buy, taux de rejets,
 * et déclenche un EXECUTION_COOLDOWN si le broker rejette plusieurs fois le même contrat.
 */

import { FEATURE_FLAGS } from "./feature-flags.server";

export type ExecutionHealth = "HEALTHY" | "DEGRADED" | "POOR" | "CRITICAL";

export interface ExecutionMetrics {
  proposalsSent: number;
  proposalsSuccess: number;
  proposalsFailed: number;
  buysSent: number;
  buysSuccess: number;
  buysFailed: number;
  avgProposalLatencyMs: number;
  avgBuyLatencyMs: number;
  proposalSuccessRatePct: number;
  buySuccessRatePct: number;
  health: ExecutionHealth;
  activeCooldowns: { symbol: string; cooldownUntil: number; reason: string }[];
  recentErrors: { symbol: string; code: string; message: string; timestamp: number }[];
}

class ExecutionMonitorStore {
  private proposalsSent = 0;
  private proposalsSuccess = 0;
  private proposalsFailed = 0;
  private proposalLatencies: number[] = [];

  private buysSent = 0;
  private buysSuccess = 0;
  private buysFailed = 0;
  private buyLatencies: number[] = [];

  private errors: { symbol: string; code: string; message: string; timestamp: number }[] = [];
  private consecutiveErrorsPerSymbol = new Map<string, number>();
  private activeCooldowns = new Map<string, { cooldownUntil: number; reason: string }>();

  recordProposal(symbol: string, latencyMs: number, success: boolean, errorCode?: string, errorMessage?: string) {
    this.proposalsSent++;
    if (success) {
      this.proposalsSuccess++;
      this.proposalLatencies.push(latencyMs);
      if (this.proposalLatencies.length > 100) this.proposalLatencies.shift();
      this.consecutiveErrorsPerSymbol.set(symbol, 0);
    } else {
      this.proposalsFailed++;
      const currentErrCount = (this.consecutiveErrorsPerSymbol.get(symbol) ?? 0) + 1;
      this.consecutiveErrorsPerSymbol.set(symbol, currentErrCount);

      if (errorCode && errorMessage) {
        this.errors.push({ symbol, code: errorCode, message: errorMessage, timestamp: Date.now() });
        if (this.errors.length > 50) this.errors.shift();
      }

      // Execution Cooldown (Section 32): 3 erreurs consécutives sur un symbole -> 5 min cooldown
      if (currentErrCount >= 3) {
        const cooldownUntil = Date.now() + 5 * 60 * 1000;
        const reason = `EXECUTION_COOLDOWN: 3 rejets consécutifs Deriv (${errorCode || "PROPOSAL_ERROR"})`;
        this.activeCooldowns.set(symbol, { cooldownUntil, reason });
      }
    }
  }

  recordBuy(symbol: string, latencyMs: number, success: boolean, errorCode?: string, errorMessage?: string) {
    this.buysSent++;
    if (success) {
      this.buysSuccess++;
      this.buyLatencies.push(latencyMs);
      if (this.buyLatencies.length > 100) this.buyLatencies.shift();
    } else {
      this.buysFailed++;
      if (errorCode && errorMessage) {
        this.errors.push({ symbol, code: errorCode, message: errorMessage, timestamp: Date.now() });
        if (this.errors.length > 50) this.errors.shift();
      }
    }
  }

  isSymbolInExecutionCooldown(symbol: string): { blocked: boolean; reason?: string } {
    const entry = this.activeCooldowns.get(symbol);
    if (!entry) return { blocked: false };
    if (Date.now() > entry.cooldownUntil) {
      this.activeCooldowns.delete(symbol);
      this.consecutiveErrorsPerSymbol.set(symbol, 0);
      return { blocked: false };
    }
    return { blocked: true, reason: entry.reason };
  }

  getMetrics(): ExecutionMetrics {
    const avgProposalLat = this.proposalLatencies.length > 0
      ? this.proposalLatencies.reduce((a, b) => a + b, 0) / this.proposalLatencies.length
      : 0;

    const avgBuyLat = this.buyLatencies.length > 0
      ? this.buyLatencies.reduce((a, b) => a + b, 0) / this.buyLatencies.length
      : 0;

    const propSR = this.proposalsSent > 0 ? (this.proposalsSuccess / this.proposalsSent) * 100 : 100;
    const buySR = this.buysSent > 0 ? (this.buysSuccess / this.buysSent) * 100 : 100;

    let health: ExecutionHealth = "HEALTHY";
    if (propSR < 70 || buySR < 70 || avgProposalLat > 3000) {
      health = "CRITICAL";
    } else if (propSR < 85 || buySR < 85 || avgProposalLat > 1500) {
      health = "POOR";
    } else if (propSR < 95 || buySR < 95 || avgProposalLat > 800) {
      health = "DEGRADED";
    }

    const cooldownList = Array.from(this.activeCooldowns.entries()).map(([symbol, val]) => ({
      symbol,
      cooldownUntil: val.cooldownUntil,
      reason: val.reason,
    }));

    return {
      proposalsSent: this.proposalsSent,
      proposalsSuccess: this.proposalsSuccess,
      proposalsFailed: this.proposalsFailed,
      buysSent: this.buysSent,
      buysSuccess: this.buysSuccess,
      buysFailed: this.buysFailed,
      avgProposalLatencyMs: Math.round(avgProposalLat),
      avgBuyLatencyMs: Math.round(avgBuyLat),
      proposalSuccessRatePct: Number(propSR.toFixed(1)),
      buySuccessRatePct: Number(buySR.toFixed(1)),
      health,
      activeCooldowns: cooldownList,
      recentErrors: [...this.errors].reverse().slice(0, 10),
    };
  }
}

export const executionMonitor = new ExecutionMonitorStore();
