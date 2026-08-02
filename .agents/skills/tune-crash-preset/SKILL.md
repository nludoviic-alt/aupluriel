---
name: tune-crash-preset
description: Runs a real, data-backed parameter sweep for the Crash preset (CRASH_PRESET in src/lib/autotrader.ts, covering CRASH1000/500/600/900) using historical Deriv candles — not guesswork. Use this whenever the user asks to tune, optimize, backtest, or improve the Crash preset/config, asks which take-profit/stop-loss/confidence/leverage would perform better, or wants evidence before changing CRASH_PRESET's risk parameters. Also use it proactively when proposing a change to CRASH_PRESET's TP/SL/confidence/leverage fields, to back the recommendation with real numbers instead of theory.
---

# Tune Crash preset

The actual sweep logic lives in `src/lib/boom-sweep.server.ts` (production
code, name notwithstanding — it's symbol-agnostic), shared with the
`/api/backtest/boom-sweep` route and with `tune-boom-preset`. This skill's
script is a thin CLI wrapper defaulted to `CRASH_SYMBOLS` instead of
`BOOM_SYMBOLS`. Keep changes to the sweep logic itself in that lib file, not
duplicated in the script.

Sweeps take-profit %, stop-loss %, minConfidence, and minTfAgreement
combinations for the Crash preset against real historical Deriv candles,
using the same path-dependent walk-forward logic as the live Multiplier
trades (stop/target whichever hits first, or a time-based exit at
`maxHoldMinutes`). Reports which combination actually made money, not which
one sounds reasonable.

## Why this exists

Crash indices only trade as Multiplier on Deriv (no Rise/Fall), same as Boom
— see the `instrumentType` handling in `src/lib/signal-core.ts`. `CRASH_PRESET`
was itself derived from exactly this sweep on 2026-08-01 (see that constant's
header comment in `src/lib/autotrader.ts`), on a single 125h window — treat
its current TP10%/SL30%/confidence 60/leverage 100 as a real but early
signal, not a settled result. Re-running this sweep with more history, or
after live trades have accumulated, is how that confidence improves.

## Running the sweep

```bash
npx tsx .agents/skills/tune-crash-preset/scripts/sweep.ts [--quick] [--candles=150] [--symbols=CRASH1000,CRASH500,CRASH600,CRASH900] [--stake=5] [--leverage=100] [--hold=60]
```

- `--quick`: small 4-combo grid (TP∈{5,10}, SL∈{10,20}, conf=55, TF=2) — use this first to sanity-check leverage/hold assumptions before the full grid.
- Default (no `--quick`): 72 combos (TP∈{5,8,10}, SL∈{10,15,20,30}, conf∈{50,55,60}, TF∈{2,3}) × however many symbols you pass.
- `--leverage` should match (or test candidates for) `multiplierLevel` in `CRASH_PRESET` — **always try more than one value**, leverage is usually the dominant lever, not TP/SL (same finding as Boom, see `tune-boom-preset`).
- `--hold` should match `maxHoldMinutes` in `CRASH_PRESET`.
- The script fetches candles from Deriv's public API ONCE per symbol (no auth needed), then replays every combo against the cached data in memory. Do NOT fetch per-combo — that made a comparable Boom sweep take hours instead of seconds.

## Reading the output

Same diagnostic as `tune-boom-preset`: for every combo, trade count, win rate, breakeven win rate, edge in pp, total $ P&L, and the stop/target/time-exit split.

**The exit split is the single most important diagnostic.** If `timeExits` dominates `stopHits + targetHits`, the configured TP/SL distance is wider than the symbol's typical price range within `--hold` minutes — raise `--leverage` before touching TP/SL percentages, then re-run.

The report aggregates across ALL symbols passed in per combo, because `CRASH_PRESET` is one shared config. Still read the per-symbol breakdown under the winning combo: CRASH_PRESET's own header comment already flags CRASH600 as the strongest performer (94.8% WR, edge +9.1pp) while CRASH1000/900 sat near breakeven in that first sweep — check whether that pattern still holds before trusting an aggregate number that could be carried by one symbol.

## After running the sweep

1. Report the winning combo and the per-symbol breakdown to the user in plain terms (trades, win rate vs. breakeven, $ P&L) — don't just dump the raw table, explain what it means for their actual bot.
2. If a symbol is clearly underperforming (edge near zero or negative) while others are strong, say so explicitly and suggest either excluding it or leaving it for now pending more live data — don't hide it in an average.
3. Only apply the winning parameters to `CRASH_PRESET` in `src/lib/autotrader.ts` (and any UI copy referencing the old values, e.g. `src/routes/autotrader.tsx`, `src/routes/admin.tsx`) after the user confirms — this changes real trading behavior, treat it with the same care as any other change to live trade logic.
4. `testCandles=150` at 15-minute granularity covers roughly 37.5 hours of history — a small, recent sample. CRASH_PRESET's current values come from exactly one such window. Suggest a much larger `--candles` value as a follow-up before treating any single run (including this one) as settled.
