---
name: risk-manager-auditor
description: Audits risk management logic, max daily loss limits, drawdown caps, position sizing (Kelly/Fixed), consecutive loss pauses, and account balance protections in the trading engine. Use when validating risk safeguards, inspecting drawdown behaviors, or reviewing capital protection rules.
---

# Risk Manager Auditor

A specialized audit pass focused strictly on capital preservation, risk control mechanics, and loss prevention rules in the **Au Pluriel** engine.

## Risk Audit Checklist

### 1. Daily Loss & Max Drawdown Limits
- Verify that `maxDailyLossUsd` and `maxDrawdownPercent` are checked **before** every trade proposal in `bot-engine.server.ts`.
- Ensure that once a risk cap is breached, `paused_until` is updated in `bot_state` and survives server restarts.
- Check that floating P&L of open positions is added to realized daily loss when evaluating risk thresholds (`floating + realized`).

### 2. Position Sizing & Kelly Criterion Math
- Confirm that position size (`stakeUsd`) never exceeds hard risk boundaries (max 5% of total account balance).
- Validate Kelly stake calculations (`computeKellyStakeServer`) against actual `bot_trades` win rate and win/loss ratio.
- Ensure zero-division safety when trade sample size is small ($N < 10$).

### 3. Consecutive Loss Pause Mechanics
- Verify that consecutive losing trades increment loss counters per preset.
- Confirm cooldown periods dynamically scale or trigger mandatory pause states upon $N$ consecutive losses.

### 4. Multiplier & TP/SL Safeguards
- Verify that stop-loss (`stopLossPctOfStake`) and take-profit (`takeProfitPctOfStake`) parameters are correctly calculated and transmitted to Deriv API contract proposals.
- Ensure trailing stops correctly update peak P&L without prematurely closing positions on normal market retracements.
