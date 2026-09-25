# vol75 — forward demo test (from 2026-09-25)

## Why this preset

A 12-month replay (2025-09-25 → 2026-09-25, Deriv 1m/5m/15m/1H/4H candles) of
the live engine path found no edge for `crash` and `crash900`: the same entries
with a random direction did as well. `vol75` with the Au Pluriel spec levels was
the only candidate:

| Setting | expectancy / trade, all | expectancy / trade, last 30 % |
|---|---|---|
| vol75 (ADX 25, SL 1.5 ATR, TP 2.5R, score ≥ 80, 240 min hold) | +0.087 R | +0.113 R |
| same entries, random direction (20 draws): mean / 95th percentile | +0.036 / +0.081 R | +0.024 / +0.098 R |

On the spec's own grid (ADX 20/25/30 × SL 1.3/1.5/2.0 ATR × TP 1.5/2/2.5/3R),
34/36 combinations were positive in both halves and 9/36 beat the random 95th
percentile in both. The strong zone is ADX 20–25, SL 1.3–1.5 ATR, TP 2.5–3R.
The edge over random is only about +0.05 to +0.1 R per trade, **before Deriv's
multiplier commission**, which the replay could not model. Only a forward test
shows the real number.

Not modelled in the replay: commission, learned indicator weights, the market
regime router, the Risk Manager's sizing. A one-position-at-a-time, 5-minute
scan cadence was assumed.

## What the preset now does

`VOL75_PRESET` (src/lib/autotrader.ts) and `vol75-signal.server.ts`:

| Field | Before | Now |
|---|---|---|
| module: min ADX / SL / TP / min score | 15 / 1.1 ATR / 1.8 ATR / 74 | 25 / 1.5 ATR / 2.5R / 80 |
| minConfidence | 74 | 80 |
| stake | 0.25 % of balance | fixed $5 |
| progressiveStakeReduction | on | off |
| maxHoldMinutes | 8 | 240 |
| minSymbolWinRate / hourlyEdgeFilter | 0.30 / on | 0 / off |
| maxDailyLossUsd | 2 | 5 |

`vol50` keeps its exact previous values (it now builds on `VOL75_BASE`).
The preset stays **demo-only** (every API path forces `mode: "demo"` for vol75).

## Protocol and decision rule (fixed before the first trade)

1. Run in demo only, $5 fixed stake, until **100 closed trades**.
2. Read the results from `bot_trades` (preset `vol75`) — P&L includes Deriv's
   commission, so this is the first commission-inclusive number.
3. Decide at 100 trades:
   - **Continue** (to 200 trades) if the net expectancy per trade is > 0 **and** the
     profit factor is ≥ 1.05.
   - **Stop** if the net expectancy is ≤ 0, or at any point if the demo drawdown
     reaches 20 × the average loss.
   - Checks at 20 and 50 trades are for bugs and execution problems only (wrong
     stake, no fills, stops at the wrong distance), not a verdict.
4. No parameter changes during the test. Any change restarts the count.
5. Real money only after 200+ positive demo trades **and** explicit approval.
