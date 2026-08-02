---
name: tune-multi-preset
description: Runs a real, data-backed parameter sweep for the Multi/Default preset (DEFAULT_CONFIG in src/lib/signal-core.ts, covering forex majors + XAU/USD + BTC) using historical Deriv candles and the SAME binary CALL/PUT walk-forward engine the app's live auto-backtest scheduler uses. Use this whenever the user asks to tune, optimize, backtest, or improve the Multi/Default preset, asks which confidence/TF-agreement threshold would perform better, or wants evidence before changing DEFAULT_CONFIG's minConfidence/minTfAgreement.
---

# Tune Multi (Default) preset

The actual backtest logic lives in `backtestMultiTfServer()` in
`src/lib/backtest.server.ts` — the exact function the app's own scheduled
auto-backtest job calls (see `auto-backtest.server.ts`), so results here
match what the live scan pipeline would really have decided. This skill's
script is a thin sweep loop around repeated calls to that function.

Unlike `tune-boom-preset`/`tune-crash-preset`, this preset trades **binary
CALL/PUT** on Deriv, not Multiplier — see the `instrumentType` handling in
`src/lib/signal-core.ts`. A binary contract resolves at a fixed expiry
(win/lose the whole stake at a fixed payout), it never has a stop-loss or
take-profit distance, so there's no TP%/SL%/leverage to sweep here — only
`minConfidence` and `minTfAgreement` actually change which signals qualify.

## A real limitation of this skill, be upfront about it

`backtestMultiTfServer()` fetches its own candles on every call — there is no
"fetch once, replay every combo" optimization here (that's what makes
`tune-boom-preset`'s sweep near-instant after the first fetch; this one isn't).
A sweep over N symbols × M combos makes N×M live calls to Deriv's public API,
each one several hundred ms to ~1s. Keep grids small:

- `--quick`: 4 combos (minConfidence∈{70,75} × minTfAgreement∈{3,4}) — start here.
- Default (no `--quick`): 10 combos (minConfidence∈{65,70,72,75,80} × minTfAgreement∈{3,4}).
- Start with 1-2 symbols to sanity-check before running the full `DEFAULT_CONFIG.symbols` list (11 pairs) — that's up to 110 live calls on the default grid.

## Running the sweep

```bash
npx tsx .claude/skills/tune-multi-preset/scripts/sweep.ts [--quick] [--candles=150] [--symbols=frxEURUSD,frxXAUUSD] [--duration=15] [--stake=5] [--payout=0.85]
```

- `--duration` should match `durationMinutes` in `DEFAULT_CONFIG` (15 by default).
- `--payout` is a FLAT assumption (Deriv's typical binary payout is ~0.85 but varies per quote in the live engine) — the $ total in the report is therefore an approximation. Treat the **edge in percentage points** as the primary signal, not the dollar figure.
- A progress dot prints per combo to stderr since this can take a while — if it hangs with no dots appearing at all, check network access to Deriv's public API before assuming the script is broken.

## Reading the output

For every combo: trade count, win rate, the breakeven win rate for the assumed payout, edge in pp, and the approximate total $ P&L. `DEFAULT_CONFIG`'s own header comment documents a real historical paradox worth checking for here too: in a July 2026 sample, win rate DROPPED as confidence rose (<80 → 62.5% win, 90+ → 0%) because the indicators are lagging — by the time everything aligns (high confidence), the move is already over. Don't assume higher confidence = better without checking; this sweep is exactly how to verify whether that pattern still holds.

Small samples are the norm here given the fetch-per-combo cost — treat anything under ~30 trades per combo as exploratory, same rule as `audit-trading-production`.

## After running the sweep

1. Report the winning combo and per-symbol breakdown in plain terms — don't just dump the table.
2. If a symbol is clearly dragging the average down, say so explicitly (consider excluding it) rather than hiding it in the aggregate — same rule as the Boom/Crash skills.
3. Only apply `minConfidence`/`minTfAgreement` changes to `DEFAULT_CONFIG` in `src/lib/signal-core.ts` after the user confirms — this changes real trading behavior for every account still on the Multi preset's defaults.
4. Mention the sample-size and flat-payout caveats above whenever presenting results — don't let a small, approximate sweep read as a settled conclusion.
