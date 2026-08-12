---
name: regression-tester
description: Executes regression checks across strategy presets, indicator math, API routes, database schemas, and historical trade logs to ensure new features preserve exact behavior and performance baselines. Use before deploying updates or modifying trading engine logic.
---

# Regression Tester

A comprehensive testing suite verifying that code updates, refactors, or new features introduce zero silent regressions in trading performance, indicator calculations, or system stability.

## Regression Testing Workflow

### 1. Indicator & Signal Math Verification
- Compare signal output (`generateSignal`) against known candle test vectors.
- Ensure RSI, EMA, MACD, Bollinger Bands, ATR, and Stochastic calculations produce identical results across client and server.

### 2. Historical Trade Log & Analytics Integrity
- Verify that trade summary calculations (`summarize` in `analytics.ts`) match raw trade arrays.
- Confirm Profit Factor ($\frac{\text{Gross Profit}}{\text{Gross Loss}}$), Expectancy, Win Rate, and Max Drawdown calculations are mathematically accurate.

### 3. Replay & Backtest Determinism
- Run `ReplayEngine.runReplay()` on historical candle sets before and after code edits.
- Confirm trade count, entry prices, direction, and profit factor remain 100% deterministic for identical strategy versions.

### 4. Code & Build Verification
- Execute `npx tsc --noEmit` and `npx svelte-check` to guarantee clean type compilation.
- Verify API endpoints return valid JSON structures and correct HTTP status codes.
