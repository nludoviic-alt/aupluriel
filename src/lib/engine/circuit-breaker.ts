import type { CircuitBreakerState } from './types.js';

export class CircuitBreaker {
  private state: CircuitBreakerState = { tripped: false };
  private maxConsecutiveLosses: number;
  private cooldownMs: number;
  private consecutiveLosses = 0;

  constructor(maxConsecutiveLosses = 3, cooldownMs = 15 * 60 * 1000) {
    this.maxConsecutiveLosses = maxConsecutiveLosses;
    this.cooldownMs = cooldownMs;
  }

  public recordTrade(profit: number): void {
    if (profit < 0) {
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
        this.state = {
          tripped: true,
          reason: `${this.consecutiveLosses} consecutive losses`,
          trippedAt: Date.now(),
          cooldownMs: this.cooldownMs,
        };
      }
    } else {
      this.consecutiveLosses = 0;
      this.state = { tripped: false };
    }
  }

  public isTripped(): boolean {
    if (!this.state.tripped) return false;
    if (this.state.trippedAt && Date.now() - this.state.trippedAt >= this.cooldownMs) {
      // Cooldown expired, reset
      this.state = { tripped: false };
      this.consecutiveLosses = 0;
      return false;
    }
    return true;
  }

  public getState(): CircuitBreakerState {
    return { ...this.state };
  }
}
