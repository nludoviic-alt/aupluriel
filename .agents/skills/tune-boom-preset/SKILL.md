---
name: tune-boom-preset
description: Runs a real, data-backed parameter sweep for the Boom preset (BOOM_PRESET in src/lib/autotrader.ts, covering BOOM1000/500/600/900) using historical Deriv candles — not guesswork. Use this whenever the user asks to tune, optimize, backtest, or improve the Boom preset/config, asks which take-profit/stop-loss/confidence/leverage would perform better, or wants evidence before changing BOOM_PRESET's risk parameters. Also use it proactively when proposing a change to BOOM_PRESET's TP/SL/confidence/leverage fields, to back the recommendation with real numbers instead of theory.
---

# Tune Boom preset

The actual sweep logic lives in `src/lib/boom-sweep.server.ts` (production
code), shared with the `/api/backtest/boom-sweep` route used by the app's own
Backtest page — this skill's script is a thin CLI wrapper around the same
function. Keep changes to the sweep logic itself in that lib file, not
duplicated in the script.

Sweeps take-profit %, stop-loss %, minConfidence, and minTfAgreement combinations
for the Boom preset against real historical Deriv candles, using the same
path-dependent walk-forward logic as the live Multiplier trades (stop/target
whichever hits first, or a time-based exit at `maxHoldMinutes`). Reports which
combination actually made money, not which one sounds reasonable.

## Why this exists

Boom/Crash indices only trade as Multiplier on Deriv (no Rise/Fall) — see the
`instrumentType` handling in `src/lib/signal-core.ts`. Multiplier P&L depends on
**leverage**, not just take-profit/stop-loss percentages: the required price
move to hit a given $ target shrinks as leverage rises. A 5%-of-stake take
profit at 20x leverage needs the price to move much further than the same 5%
target at 100x leverage. Get this wrong and trades just time out without ever
reaching either barrier — the strategy behaves nothing like intended, even
though the config numbers "look" fine on paper. This skill catches that kind
of mismatch by actually simulating the walk-forward instead of reasoning about
percentages in the abstract.

## Running the sweep

```bash
npx tsx .agents/skills/tune-boom-preset/scripts/sweep.ts [--quick] [--candles=150] [--symbols=BOOM1000,BOOM500,BOOM600,BOOM900] [--stake=5] [--leverage=100] [--hold=60]
```

- `--quick`: small 4-combo grid (TP∈{5,10}, SL∈{10,20}, conf=55, TF=2) — use this first to sanity-check leverage/hold assumptions before the full grid.
- Default (no `--quick`): 72 combos (TP∈{5,8,10}, SL∈{10,15,20,30}, conf∈{50,55,60}, TF∈{2,3}) × however many symbols you pass.
- `--leverage` should match (or test candidates for) `multiplierLevel` in `BOOM_PRESET` — **always try more than one value**, leverage is usually the dominant lever, not TP/SL (see below).
- `--hold` should match `maxHoldMinutes` in `BOOM_PRESET`.
- The script fetches candles from Deriv's public API ONCE per symbol (no auth needed), then replays every combo against the cached data in memory — the network fetch is the only slow part (roughly under a second per symbol here), the combo sweep itself is near-instant. Do NOT try to "optimize" this further by fetching per-combo — that was the first draft and it made a 288-run sweep take hours.

## Reading the output

For every combo it prints: trade count, win rate, the breakeven win rate implied by that TP:SL ratio, the edge in percentage points, total $ P&L across all symbols combined, and the stop/target/time-exit split.

**The exit split is the single most important diagnostic.** If `timeExits` dominates `stopHits + targetHits`, the configured TP/SL distance is wider than the symbol's typical price range within `--hold` minutes — trades are resolving on random drift at the timeout, not on the take-profit/stop-loss logic the preset is supposed to run on. When you see this: raise `--leverage` (shrinks the required price move for the same $ target) before touching TP/SL percentages, then re-run. Confirmed on this repo: BOOM1000 at 20x leverage had 75/81 trades (93%) time out; at 100x leverage (Deriv's own UI default for Boom symbols) that dropped to 2/81 (2.5%) and total P&L on the same 4-combo grid went from +$0.02 to +$2.30.

The report aggregates across ALL symbols passed in per combo, because `BOOM_PRESET` is one shared config — there's no way to apply a different TP/SL to each symbol without adding `MULTIPLIER_SYMBOL_OVERRIDES` entries (see `src/lib/signal-core.ts`), so the actionable number is the combined total, not four separate "best" answers. Still read the per-symbol breakdown under the winning combo: if one symbol is dragging the average down while the others are strong, that's a signal to consider a per-symbol override rather than compromising the shared preset — don't silently average over a clear outlier.

## After running the sweep

1. Report the winning combo and the per-symbol breakdown to the user in plain terms (trades, win rate vs. breakeven, $ P&L) — don't just dump the raw table, explain what it means for their actual bot.
2. If a symbol is clearly underperforming (edge near zero or negative) while others are strong, say so explicitly and suggest either excluding it or leaving it for now pending more live data — don't hide it in an average.
3. Only apply the winning parameters to `BOOM_PRESET` in `src/lib/autotrader.ts` (and any UI copy referencing the old values, e.g. `src/routes/autotrader.tsx`, `src/routes/admin.tsx`) after the user confirms — this changes real trading behavior, treat it with the same care as any other change to live trade logic.
4. `testCandles=150` at 15-minute granularity covers roughly 37.5 hours of history — a small, recent sample. Mention this to the user: it's a quick real-data check, not a rigorous multi-week backtest. If they want more confidence, suggest a much larger `--candles` value (slower to fetch, more history) as a follow-up rather than treating one run as gospel.
