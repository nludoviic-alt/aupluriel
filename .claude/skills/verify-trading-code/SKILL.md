---
name: verify-trading-code
description: Read-only quality-control pass over the trading engine — checks that saved configs are actually used by the server, compares frontend/API/engine filters for drift, detects presets that silently reset to wrong values, verifies P&L/profit-factor/expectancy/win-rate math, checks open positions/pauses/daily limits/restart handling, and looks for divergences between Dashboard, Admin, Surveillance and Auto-Trader pages showing the same numbers differently. Use when asked to "verify the code", "audit the bot's code", "find inconsistencies", or before trusting a number that looks surprising until proven wrong by two different pages of the app.
---

# Verify trading code

A quality-control pass, not a feature review. The question this answers is
narrow: "does the code actually do what its comments and the UI claim it
does, right now, in this codebase" — not "is this good architecture."
Produce findings with exact file:line references, never vague impressions.

## Checklist

### 1. Saved config vs. actual server behavior
- Pick a running preset (`bot_state` row with `enabled=1`) and confirm the
  fields the server engine actually reads (`bot-engine.server.ts`) match what
  `config` in that row contains — especially `minConfidence`,
  `excludedSymbols`, `symbols`, `stopLossPctOfStake`/`takeProfitPctOfStake`/
  `multiplierLevel` for Boom/Crash.
- Confirm `updateConfigForUser` (`src/lib/bot-engine.server.ts`) is the ONLY
  write path to `bot_state.config` — grep for any other `UPDATE bot_state SET
  config` that bypasses it (and therefore bypasses `logConfigChange`, see
  `config-change-impact`).

### 2. Preset reset / drift bugs
- Check that `BOOM_PRESET`/`CRASH_PRESET`/`SCALPING_PRESET` in
  `src/lib/autotrader.ts` never set `excludedSymbols` themselves (see the
  comment on `BOOM_PRESET` — this was a real production bug on 2026-08-01:
  BOOM600 reappeared after a preset round-trip because the preset silently
  reset `excludedSymbols` to nothing).
- Confirm all THREE application points (client `applyPreset`, `/api/bot`
  action=update/reset, `/api/admin/user-config.ts` `resetToCanonical`)
  preserve `excludedSymbols`/`minConfidence`/`maxConfidence` from the existing
  config instead of overwriting them with the raw preset spread.
- Preset attribution on `bot_trades` is an explicit `preset` column set at
  insert time (2026-08-02), not inferred from `symbol` — this replaced the old
  hand-duplicated `BOOM_SYMS`/`CRASH_SYMS` constants in `bot-engine.server.ts`
  (removed) once Scalping needed to trade BOOM500, a symbol Boom already uses.
  There is no more constant-drift class to check here; instead confirm every
  preset-scoped query (`loadRecentTrades`, `getTodayStats`, `getAllTimeStats`,
  etc.) filters on `preset = ?` and that `upsertTrade` is always called with
  the engine's own `this.preset`, never a value derived from `symbol`.
- Run `node .claude/skills/verify-trading-code/scripts/check-symbol-overlap.mjs DB_PATH`
  — catches a symbol present in BOTH `symbols` and `excludedSymbols` on the
  same saved config, which silently drops it from every scan even though the
  watchlist UI shows it active (real bug, found in production 2026-08-02
  re-adding BOOM900 after an earlier exclusion — `excludedSymbols` applies in
  watchlist mode too, not just all-markets, despite what an earlier version
  of the field's comment implied).

### 3. Risk-guard calibration
- Whenever `stopLossPctOfStake` changed recently in `BOOM_PRESET`/
  `CRASH_PRESET`, confirm `maxDailyLossUsd`, `trailingStopMinPeakUsd`,
  `maxConsecutiveLosses` were recalibrated to match (documented bug: a preset
  once had `trailingStopMinPeakUsd: 3` while a single loss was $0.75 — the
  bot paused after ~6 wins and one normal loss). The math to check:
  `perTradeLossUsd = stakeUsd × stopLossPctOfStake`; guards should tolerate at
  least `maxConsecutiveLosses` of those before pausing.

### 4. P&L / profit factor / expectancy / win-rate math
- Spot-check `summarize()` (`src/lib/analytics.ts`) against a manual
  calculation on a handful of real closed trades from `bot_trades`.
- Confirm `profitFactor = grossWin / grossLoss` is `null`/`Infinity`-safe when
  `grossLoss` is 0 (check every place that formats it — a raw `.toFixed(2)`
  on `Infinity` prints `"Infinity"`, not `"∞"`).
- Confirm demo and live P&L are NEVER summed together anywhere new — grep for
  `mode = 'demo'` / `mode = 'live'` handling in any new query and check it
  matches the existing separation pattern (`api/admin/stats.ts` is the
  reference: NULL `mode` treated as demo).

### 5. Open positions / pauses / daily limits / restarts
- Confirm `hasOpenPositions()` is checked before any code path that stops a
  bot engine (`stop()` tears down every subscription — an orphaned open
  position stops receiving P&L updates and its `maxHoldMinutes` force-close
  never fires).
- Confirm `pausedUntil` (risk pause) survives a server restart — it's read
  from `bot_state.paused_until`, not memory-only.
- Confirm the daily-loss/daily-profit checks use the SAME "today" boundary
  everywhere (midnight UTC vs. local — a mismatch here silently changes which
  trades count toward the day's limit right at the boundary hour).

### 6. Cross-page consistency
- Pick one preset, one time window, and pull the SAME number (e.g. net P&L)
  from: Dashboard (BotDashboard equity curve), Admin (`/admin` recap table),
  Surveillance (`trading-surveillance-panel.tsx`), and Auto-Trader's own KPI
  strip. They read from different sources (local `logs` vs. `cloudSelected`
  vs. raw `bot_trades` SQL) — a real discrepancy here means one of them is
  reading stale or wrongly-scoped data, not that the underlying trades
  disagree.
- Specifically re-check anything that reads `logs` from
  `useAutoTraderEngine()` (the LOCAL browser engine) instead of switching to
  cloud data when `cloudActive` — this exact class of bug was found and fixed
  across the Journal, Positions en direct, and Poids adaptatifs panels in
  `autotrader.tsx` on 2026-08-02; check nothing new reintroduced it.

### 7. Build, targeted tests, logs
- Run the project's typecheck/build (`npm run build` or the project's
  configured check) on any files touched before treating a fix as done.
- Run any existing tests that touch `src/lib/analytics.ts`,
  `src/lib/bot-engine.server.ts`, or `src/lib/signal-core.ts` if they exist.
- Grep recent server logs (or ask the user to paste them) for repeated
  `[bot]` errors, unexpected pause reasons, or scan failures — a code review
  can miss something a running instance is already reporting.

## Producing findings

- Every finding names a file and line (or line range), quotes the relevant
  code, and states the concrete failure scenario (what input/state produces
  the wrong output) — not just "this looks off."
- Rank findings by whether they affect money movement (risk guards, P&L math,
  live-mode gating) before ones that only affect display.
- If a check passes, say so briefly — don't only report problems, a clean
  pass on the checklist above IS useful information.
