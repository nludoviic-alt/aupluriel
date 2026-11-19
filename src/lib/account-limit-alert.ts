/** Latch that fires once after N consecutive RISK_ACCOUNT_LIMIT rejections
 * (balance/equity unavailable), so a silently blind bot is surfaced instead of
 * rejecting every signal for days. Resets on any non-account-limit outcome. */
export const ACCOUNT_LIMIT_ALERT_THRESHOLD = 20;

export class AccountLimitStreak {
  private count = 0;
  private alerted = false;
  constructor(private readonly threshold = ACCOUNT_LIMIT_ALERT_THRESHOLD) {}

  /** Returns true exactly once per streak, when the threshold is reached. */
  recordRejection(): boolean {
    this.count += 1;
    if (this.count >= this.threshold && !this.alerted) {
      this.alerted = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.count = 0;
    this.alerted = false;
  }
}
