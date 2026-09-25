---
name: tune-scalping-preset
description: Runs a real, data-backed parameter sweep for the Scalping preset (SCALPING_PRESET in src/lib/autotrader.ts) using historical Deriv candles — not guesswork. Use this whenever the user asks to tune, optimize, backtest, or improve the Scalping preset/config, asks which take-profit/stop-loss/confidence/leverage would perform better, or wants evidence before changing SCALPING_PRESET's risk parameters.
---

# Tune Scalping preset

Sweeps take-profit %, stop-loss %, minConfidence, and minTfAgreement combinations for the Scalping preset against real historical Deriv candles, using path-dependent walk-forward logic.

## Why this exists

Scalping relies on high-frequency, short-duration trades with tight TP/SL boundaries. Finding the optimal balance between confidence thresholds and risk-reward ratio is essential to maximize expectancy while preventing premature stop-outs.

## Running the sweep

```bash
npx tsx .agents/skills/tune-multi-preset/scripts/sweep.ts [--quick] [--candles=150]
```

## After running the sweep

1. Report the winning combo and per-symbol breakdown to the user.
2. Only apply winning parameters to `SCALPING_PRESET` in `src/lib/autotrader.ts` after confirmation.
